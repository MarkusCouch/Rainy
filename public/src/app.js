import * as L from "leaflet";
import { maplibreGL } from "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/dist/leaflet-maplibre-gl.mjs";
import {
  ANALYSIS_SIZE,
  ANALYSIS_ZOOM,
  createRadarLayer,
  loadMotionFields,
  loadRadarMetadata
} from "./radar.js";
import {
  analyzeMotion,
  bearingToCompass,
  computeTimelineGeometry,
  haversineKm
} from "./motion.js";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_VIEW = [51.16, 10.45];

const elements = {
  app: document.querySelector("#app"),
  liveBadge: document.querySelector("#liveBadge"),
  liveText: document.querySelector("#liveText"),
  radarTime: document.querySelector("#radarTime"),
  motionTitle: document.querySelector("#motionTitle"),
  motionDetail: document.querySelector("#motionDetail"),
  scaleCard: document.querySelector("#scaleCard"),
  speedValue: document.querySelector("#speedValue"),
  distanceValue: document.querySelector("#distanceValue"),
  locateBtn: document.querySelector("#locateBtn"),
  fitArrowBtn: document.querySelector("#fitArrowBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  pickBtn: document.querySelector("#pickBtn"),
  toast: document.querySelector("#toast")
};

const state = {
  position: null,
  positionSource: null,
  userMarker: null,
  accuracyCircle: null,
  radarLayer: null,
  motionLayer: null,
  motionGeometry: null,
  metadata: null,
  picking: false,
  loading: false,
  watchId: null,
  lastAnalysisAt: 0,
  lastAnalysisPosition: null,
  toastTimer: null
};

const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
  preferCanvas: true,
  minZoom: 3,
  maxZoom: 12
}).setView(DEFAULT_VIEW, 6);

const webgl2Canvas = document.createElement("canvas");
if (webgl2Canvas.getContext("webgl2")) {
  maplibreGL({
    style: "https://tiles.openfreemap.org/styles/fiord",
    attributionControl: false
  }).addTo(map);
} else {
  map.getContainer().classList.add("map-fallback");
}

map.attributionControl.addAttribution("OpenFreeMap &copy; OpenMapTiles · Daten &copy; OpenStreetMap-Mitwirkende");

function setLiveState(stateName, text) {
  elements.liveBadge.dataset.state = stateName;
  elements.liveText.textContent = text;
}

function setLoading(isLoading) {
  state.loading = isLoading;
  elements.refreshBtn.disabled = isLoading;
  elements.refreshBtn.classList.toggle("is-loading", isLoading);
}

function showToast(message, duration = 4200) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  state.toastTimer = setTimeout(() => { elements.toast.hidden = true; }, duration);
}

function formatRadarTime(timestamp) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(timestamp * 1000));
}

function dataAgeMinutes(timestamp) {
  return Math.max(0, Math.round((Date.now() / 1000 - timestamp) / 60));
}

function markerIcon() {
  return L.divIcon({
    className: "",
    html: '<div class="user-location"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}

function setPosition(position, source, { center = false, accuracy = null } = {}) {
  const normalized = { lat: Number(position.lat), lng: Number(position.lng) };
  state.position = normalized;
  state.positionSource = source;

  if (!state.userMarker) {
    state.userMarker = L.marker(normalized, { icon: markerIcon(), zIndexOffset: 1200 }).addTo(map);
  } else {
    state.userMarker.setLatLng(normalized);
  }

  if (state.accuracyCircle) state.accuracyCircle.remove();
  if (accuracy && accuracy < 10000) {
    state.accuracyCircle = L.circle(normalized, {
      radius: accuracy,
      color: "#66f2ae",
      weight: 1,
      opacity: 0.35,
      fillColor: "#66f2ae",
      fillOpacity: 0.06,
      interactive: false
    }).addTo(map);
  }

  if (center) map.setView(normalized, Math.max(map.getZoom(), 7), { animate: true });
}

function clearMotion() {
  state.motionLayer?.remove();
  state.motionLayer = null;
  state.motionGeometry = null;
  elements.fitArrowBtn.hidden = true;
  elements.scaleCard.hidden = true;
}

function renderMotion(motion) {
  clearMotion();
  const geometry = computeTimelineGeometry(state.position, motion.bearing, motion.speedKmh);
  const layer = L.layerGroup();

  L.polyline([geometry.point2, geometry.position], {
    color: "#66f2ae",
    opacity: 0.96,
    weight: 5,
    lineCap: "round",
    interactive: false
  }).addTo(layer);

  L.polyline([geometry.point4, geometry.point2], {
    color: "#66f2ae",
    opacity: 0.58,
    weight: 4,
    dashArray: "10 11",
    lineCap: "round",
    interactive: false
  }).addTo(layer);

  const arrowIcon = L.divIcon({
    className: "",
    html: `<div class="motion-arrow-head" style="transform:rotate(${motion.bearing}deg)">▲</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
  L.marker(geometry.position, { icon: arrowIcon, interactive: false, zIndexOffset: 1100 }).addTo(layer);

  for (const [point, label] of [[geometry.point2, "+2 h"], [geometry.point4, "+4 h"]]) {
    const icon = L.divIcon({
      className: "",
      html: `<div class="hour-marker"><i></i><b>${label}</b></div>`,
      iconSize: [66, 24],
      iconAnchor: [5, 12]
    });
    L.marker(point, { icon, interactive: false, zIndexOffset: 1050 }).addTo(layer);
  }

  layer.addTo(map);
  state.motionLayer = layer;
  state.motionGeometry = geometry;
  elements.fitArrowBtn.hidden = false;
  elements.scaleCard.hidden = false;
  elements.speedValue.textContent = Math.round(motion.speedKmh);
  elements.distanceValue.textContent = Math.round(geometry.distance4);
  fitMotionBounds(false);
}

function fitMotionBounds(force = true) {
  if (!state.motionGeometry) return;
  const bounds = L.latLngBounds([
    state.motionGeometry.point4,
    state.motionGeometry.point2,
    state.motionGeometry.position
  ]);
  map.fitBounds(bounds, {
    paddingTopLeft: [48, 110],
    paddingBottomRight: [48, window.innerWidth < 760 ? 285 : 80],
    maxZoom: 9,
    animate: force
  });
}

const reasonText = {
  frames: "Für die Bewegungsanalyse fehlen zusammenhängende Radarbilder.",
  "not-enough-rain": "Aktuell kaum auswertbarer Regen im Umkreis von etwa 100 km.",
  "low-correlation": "Das Regenmuster lässt sich zwischen den Bildern nicht sicher verfolgen.",
  inconsistent: "Die beiden gemessenen Bewegungen sind zu uneindeutig für einen verlässlichen Pfeil.",
  "speed-range": "Die berechnete Bewegung liegt außerhalb des plausiblen Bereichs von 5–140 km/h."
};

async function updateRadar({ force = false } = {}) {
  if (!state.position || state.loading) return;
  if (!force && Date.now() - state.lastAnalysisAt < 60_000) return;
  setLoading(true);
  setLiveState("loading", "Radar lädt");
  elements.motionTitle.textContent = "Regenbewegung wird berechnet …";
  elements.motionDetail.textContent = "Drei Radarstände werden direkt auf diesem Gerät verglichen.";

  try {
    const metadata = await loadRadarMetadata();
    state.metadata = metadata;
    const frames = metadata.frames.slice(-3);
    const latest = frames.at(-1);

    if (state.radarLayer) state.radarLayer.remove();
    state.radarLayer = createRadarLayer(L, metadata.host, latest).addTo(map);
    state.radarLayer.setZIndex(350);

    elements.radarTime.textContent = `Radar ${formatRadarTime(latest.time)} · ${dataAgeMinutes(latest.time)} min alt`;
    const fields = await loadMotionFields(metadata.host, frames, state.position);
    const motion = analyzeMotion(fields, {
      latitude: state.position.lat,
      frameTimes: frames.map((frame) => frame.time),
      zoom: ANALYSIS_ZOOM,
      tileSize: ANALYSIS_SIZE
    });

    state.lastAnalysisAt = Date.now();
    state.lastAnalysisPosition = { ...state.position };
    setLiveState("live", navigator.onLine ? "Live" : "Cache");

    if (!motion.ok) {
      clearMotion();
      elements.motionTitle.textContent = "Kein verlässlicher Bewegungspfeil";
      elements.motionDetail.textContent = reasonText[motion.reason] ?? "Die Bewegung ist momentan nicht eindeutig.";
      return;
    }

    renderMotion(motion);
    const sourceDirection = bearingToCompass((motion.bearing + 180) % 360);
    elements.motionTitle.textContent = `Regen kommt aus ${sourceDirection}`;
    elements.motionDetail.textContent = `${Math.round(motion.speedKmh)} km/h · ${Math.round(motion.confidence * 100)} % Bewegungskonfidenz · +4 h entspricht ${Math.round(motion.speedKmh * 4)} km`;
  } catch (error) {
    console.error(error);
    setLiveState("error", navigator.onLine ? "Fehler" : "Offline");
    elements.motionTitle.textContent = "Radar gerade nicht erreichbar";
    elements.motionDetail.textContent = "Die Karte bleibt nutzbar. Rainy versucht es beim nächsten Aktualisieren erneut.";
    showToast("Radardaten konnten nicht geladen werden.");
  } finally {
    setLoading(false);
  }
}

function geolocationErrorMessage(error) {
  if (error?.code === 1) return "Standortzugriff wurde nicht erlaubt. Du kannst einen Punkt auf der Karte wählen.";
  if (error?.code === 2) return "Der Standort ist momentan nicht verfügbar. Du kannst einen Kartenpunkt wählen.";
  return "Die Standortermittlung hat zu lange gedauert. Du kannst einen Kartenpunkt wählen.";
}

function getFastPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation wird nicht unterstützt"));
      return;
    }
    let settled = false;
    const deadline = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject({ code: 3 });
      }
    }, 8500);

    navigator.geolocation.getCurrentPosition(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        reject(error);
      },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 7000 }
    );
  });
}

function startPreciseWatch() {
  if (!navigator.geolocation) return;
  if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = navigator.geolocation.watchPosition(
    (result) => {
      const next = { lat: result.coords.latitude, lng: result.coords.longitude };
      const movedKm = state.position ? haversineKm(state.position, next) : Infinity;
      setPosition(next, "gps", { accuracy: result.coords.accuracy });
      if (movedKm > 5 || (Date.now() - state.lastAnalysisAt > REFRESH_INTERVAL_MS)) updateRadar({ force: true });
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 60_000, timeout: 20_000 }
  );
}

async function locate() {
  setLiveState("loading", "GPS");
  elements.motionTitle.textContent = "Position wird bestimmt …";
  elements.motionDetail.textContent = "Zuerst schnell, anschließend präziser im Hintergrund.";
  try {
    const result = await getFastPosition();
    const position = { lat: result.coords.latitude, lng: result.coords.longitude };
    setPosition(position, "gps", { center: true, accuracy: result.coords.accuracy });
    stopPicking();
    await updateRadar({ force: true });
    startPreciseWatch();
  } catch (error) {
    setLiveState("error", "Standort fehlt");
    elements.motionTitle.textContent = "Standort auf der Karte wählen";
    elements.motionDetail.textContent = geolocationErrorMessage(error);
    showToast(geolocationErrorMessage(error), 6000);
    startPicking();
  }
}

function startPicking() {
  state.picking = true;
  elements.app.classList.add("picking");
  elements.pickBtn.classList.add("is-active");
  elements.pickBtn.textContent = "Auswahl abbrechen";
}

function stopPicking() {
  state.picking = false;
  elements.app.classList.remove("picking");
  elements.pickBtn.classList.remove("is-active");
  elements.pickBtn.textContent = "Standort wählen";
}

map.on("click", async (event) => {
  if (!state.picking && state.position) return;
  setPosition(event.latlng, "manual", { center: true });
  stopPicking();
  if (state.watchId != null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  await updateRadar({ force: true });
});

elements.locateBtn.addEventListener("click", locate);
elements.fitArrowBtn.addEventListener("click", () => fitMotionBounds(true));
elements.refreshBtn.addEventListener("click", () => updateRadar({ force: true }));
elements.pickBtn.addEventListener("click", () => state.picking ? stopPicking() : startPicking());

window.addEventListener("online", () => {
  showToast("Verbindung wiederhergestellt");
  if (state.position) updateRadar({ force: true });
});
window.addEventListener("offline", () => setLiveState("error", "Offline"));
window.setInterval(() => updateRadar({ force: true }), REFRESH_INTERVAL_MS);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
}

locate();
