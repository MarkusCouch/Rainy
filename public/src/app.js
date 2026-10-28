import * as L from "leaflet";
import { maplibreGL } from "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.4/dist/leaflet-maplibre-gl.mjs";
import {
  ANALYSIS_SIZE,
  ANALYSIS_ZOOM,
  createRadarLayer,
  loadAnalysisField,
  loadMotionFields,
  loadRadarMetadata
} from "./radar.js";
import {
  analyzeMotion,
  bearingToCompass,
  computeTimelineGeometry,
  destinationPoint,
  haversineKm
} from "./motion.js";
import {
  buildAdvectionForecast,
  buildDryForecast,
  buildUnavailableForecast,
  chooseForecastZoom,
  rainRateClass
} from "./forecast.js";
import { createBottomSheet } from "./sheet.js";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_VIEW = [51.16, 10.45];

const elements = {
  app: document.querySelector("#app"),
  liveBadge: document.querySelector("#liveBadge"),
  liveText: document.querySelector("#liveText"),
  locationTitle: document.querySelector("#locationTitle"),
  mapTime: document.querySelector("#mapTime span"),
  radarTime: document.querySelector("#radarTime"),
  motionTitle: document.querySelector("#motionTitle"),
  motionDetail: document.querySelector("#motionDetail"),
  scaleCard: document.querySelector("#scaleCard"),
  speedValue: document.querySelector("#speedValue"),
  distanceValue: document.querySelector("#distanceValue"),
  locateBtn: document.querySelector("#locateBtn"),
  moreBtn: document.querySelector("#moreBtn"),
  chartBtn: document.querySelector("#chartBtn"),
  mapRadarTab: document.querySelector("#mapRadarTab"),
  fitArrowBtn: document.querySelector("#fitArrowBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  pickBtn: document.querySelector("#pickBtn"),
  bottomSheet: document.querySelector("#bottomSheet"),
  sheetHandle: document.querySelector("#sheetHandle"),
  openForecastBtn: document.querySelector("#openForecastBtn"),
  forecastView: document.querySelector("#forecastView"),
  closeForecastBtn: document.querySelector("#closeForecastBtn"),
  forecastRadarBtn: document.querySelector("#forecastRadarBtn"),
  forecastRefreshBtn: document.querySelector("#forecastRefreshBtn"),
  forecastLocation: document.querySelector("#forecastLocation"),
  forecastSummary: document.querySelector("#forecastSummary"),
  forecastMeta: document.querySelector("#forecastMeta"),
  forecastBars: document.querySelector("#forecastBars"),
  forecastTimes: document.querySelector("#forecastTimes"),
  forecastEmpty: document.querySelector("#forecastEmpty"),
  forecastSelectedTime: document.querySelector("#forecastSelectedTime"),
  forecastSelectedRate: document.querySelector("#forecastSelectedRate"),
  forecastSelectedClass: document.querySelector("#forecastSelectedClass"),
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
  forecast: null,
  forecastSelectedIndex: 0,
  forecastReturnFocus: null,
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
    style: "https://tiles.openfreemap.org/styles/positron",
    attributionControl: false
  }).addTo(map);
} else {
  map.getContainer().classList.add("map-fallback");
}

map.attributionControl.addAttribution("OpenFreeMap &copy; OpenMapTiles · Daten &copy; OpenStreetMap-Mitwirkende");

const sheetController = createBottomSheet(elements.bottomSheet, elements.sheetHandle, {
  initialState: "collapsed",
  onStateChange(name) {
    elements.app.classList.toggle("sheet-compact", name === "compact");
    elements.app.classList.toggle("sheet-collapsed", name === "collapsed");
  }
});

function setLiveState(stateName, text) {
  elements.liveBadge.dataset.state = stateName;
  elements.liveText.textContent = text;
}

function setLoading(isLoading) {
  state.loading = isLoading;
  elements.refreshBtn.disabled = isLoading;
  elements.forecastRefreshBtn.disabled = isLoading;
  elements.refreshBtn.classList.toggle("is-loading", isLoading);
  elements.forecastRefreshBtn.classList.toggle("is-loading", isLoading);
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

function formatClockTime(timestamp) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp * 1000));
}

function dataAgeMinutes(timestamp) {
  return Math.max(0, Math.round((Date.now() / 1000 - timestamp) / 60));
}

function formatChartTime(timestamp) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp * 1000));
}

function formatRainRate(rate) {
  if (!Number.isFinite(rate)) return "–";
  if (rate < 0.05) return "0 mm/h";
  if (rate < 10) return `${rate.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mm/h`;
  return `${Math.round(rate).toLocaleString("de-DE")} mm/h`;
}

function formatForecastOffset(minutes) {
  if (minutes < 60) return `+${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `+${hours} h ${remainder} min` : `+${hours} h`;
}

const rainClassText = {
  dry: "trocken",
  weak: "sehr schwacher Regen",
  light: "leichter Regen",
  medium: "mäßiger Regen",
  heavy: "starker Regen",
  extreme: "sehr starker Regen",
  unavailable: "keine sichere Hochrechnung"
};

function forecastSummary(forecast) {
  if (forecast.status === "unavailable") return "Zugrichtung nicht eindeutig";
  if (forecast.maxRate < 0.1) return "Voraussichtlich trocken";
  const peakIndex = forecast.samples.reduce((best, sample, index, samples) => (
    (sample.rateMmh ?? -1) > (samples[best].rateMmh ?? -1) ? index : best
  ), 0);
  const peak = forecast.samples[peakIndex];
  const className = rainRateClass(peak.rateMmh);
  return `${rainClassText[className]} gegen ${formatChartTime(peak.timestamp)}`;
}

function selectForecastSample(index) {
  if (!state.forecast?.samples?.length) return;
  const safeIndex = Math.max(0, Math.min(state.forecast.samples.length - 1, index));
  state.forecastSelectedIndex = safeIndex;
  const sample = state.forecast.samples[safeIndex];
  elements.forecastSelectedTime.textContent = sample.minutes === 0
    ? `Jetzt · ${formatChartTime(sample.timestamp)}`
    : `${formatChartTime(sample.timestamp)} · ${formatForecastOffset(sample.minutes)}`;
  elements.forecastSelectedRate.textContent = formatRainRate(sample.rateMmh);
  elements.forecastSelectedClass.textContent = rainClassText[sample.className] ?? "Radarwert";
  elements.forecastBars.querySelectorAll(".forecast-bar").forEach((bar, barIndex) => {
    const selected = barIndex === safeIndex;
    bar.classList.toggle("is-selected", selected);
    if (selected) bar.setAttribute("aria-current", "time");
    else bar.removeAttribute("aria-current");
  });
}

function renderForecast() {
  const forecast = state.forecast;
  elements.forecastBars.replaceChildren();
  elements.forecastTimes.replaceChildren();

  if (!forecast?.samples?.length) {
    elements.forecastSummary.textContent = state.loading ? "Verlauf wird berechnet …" : "Noch keine Radardaten";
    elements.forecastMeta.textContent = "bis +4 h";
    elements.forecastSelectedTime.textContent = "Jetzt";
    elements.forecastSelectedRate.textContent = "–";
    elements.forecastSelectedClass.textContent = state.position ? "Radar wird ausgewertet" : "Standort wird benötigt";
    elements.forecastEmpty.hidden = true;
    return;
  }

  elements.forecastSummary.textContent = forecastSummary(forecast);
  elements.forecastMeta.textContent = forecast.method === "advection"
    ? `${Math.round((forecast.confidence ?? 0) * 100)} % Zugmuster`
    : forecast.method === "dry" ? "aktuell kein Echo" : "nur aktueller Wert";
  elements.forecastEmpty.hidden = forecast.status !== "unavailable";

  const bars = document.createDocumentFragment();
  forecast.samples.forEach((sample, index) => {
    const bar = document.createElement("button");
    bar.type = "button";
    bar.className = "forecast-bar";
    bar.dataset.class = sample.className;
    bar.style.setProperty("--level", `${Math.max(sample.level || 0.006, 0.006) * 100}%`);
    bar.setAttribute(
      "aria-label",
      `${formatChartTime(sample.timestamp)}, ${formatRainRate(sample.rateMmh)}, ${rainClassText[sample.className] ?? "unbekannt"}`
    );
    bar.innerHTML = "<i aria-hidden=\"true\"></i>";
    bar.addEventListener("click", () => selectForecastSample(index));
    bars.append(bar);
  });
  elements.forecastBars.append(bars);

  [0, 4, 8, 12, 16].forEach((index) => {
    const label = document.createElement("span");
    label.textContent = forecast.samples[index] ? formatChartTime(forecast.samples[index].timestamp) : "";
    elements.forecastTimes.append(label);
  });

  const peakIndex = forecast.samples.reduce((best, sample, index, samples) => (
    (sample.rateMmh ?? -1) > (samples[best].rateMmh ?? -1) ? index : best
  ), 0);
  const preferredIndex = forecast.status === "unavailable" ? 0 : peakIndex;
  selectForecastSample(preferredIndex);
}

function openForecast(trigger) {
  state.forecastReturnFocus = trigger ?? document.activeElement;
  elements.forecastView.hidden = false;
  elements.forecastLocation.textContent = state.positionSource === "manual" ? "Gewählter Standort" : "Mein Standort";
  sheetController.collapse();
  renderForecast();
  requestAnimationFrame(() => elements.closeForecastBtn.focus());
}

function closeForecast() {
  elements.forecastView.hidden = true;
  state.forecastReturnFocus?.focus?.();
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
  const locationLabel = source === "manual" ? "Gewählter Standort" : "Mein Standort";
  elements.locationTitle.textContent = locationLabel;
  elements.forecastLocation.textContent = locationLabel;

  if (!state.userMarker) {
    state.userMarker = L.marker(normalized, { icon: markerIcon(), zIndexOffset: 1200 }).addTo(map);
  } else {
    state.userMarker.setLatLng(normalized);
  }

  if (state.accuracyCircle) state.accuracyCircle.remove();
  if (accuracy && accuracy < 10000) {
    state.accuracyCircle = L.circle(normalized, {
      radius: accuracy,
      color: "#0a84ff",
      weight: 1,
      opacity: 0.35,
      fillColor: "#0a84ff",
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
  state.userMarker?.setOpacity(1);
  elements.fitArrowBtn.hidden = true;
  elements.scaleCard.hidden = true;
}

function renderMotion(motion) {
  clearMotion();
  const geometry = computeTimelineGeometry(state.position, motion.bearing, motion.speedKmh);
  geometry.tailPoint = destinationPoint(
    geometry.point4,
    geometry.sourceBearing,
    geometry.distance4 * 0.08
  );
  const layer = L.layerGroup();
  const timeline = [geometry.tailPoint, geometry.point4, geometry.point2, geometry.position];

  L.polyline(timeline, {
    color: "#edf5f0",
    opacity: 0.82,
    weight: 6,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(layer);
  L.polyline(timeline, {
    color: "#27332e",
    opacity: 0.98,
    weight: 4,
    lineCap: "round",
    lineJoin: "round",
    interactive: false
  }).addTo(layer);

  const arrowIcon = L.divIcon({
    className: "",
    html: `<div class="motion-arrow-tip" style="--bearing:${motion.bearing}deg"><svg viewBox="0 0 40 28" aria-hidden="true"><path class="tip-halo" d="M5 20 L20 3 L35 20"></path><path class="tip-core" d="M5 20 L20 3 L35 20"></path></svg></div>`,
    iconSize: [40, 28],
    iconAnchor: [20, 3]
  });
  L.marker(geometry.position, { icon: arrowIcon, interactive: false, zIndexOffset: 1300 }).addTo(layer);
  state.userMarker?.setOpacity(0);

  for (const [point, label, markerClass] of [
    [geometry.point2, "+2h", "tick-2"],
    [geometry.point4, "+4h", "tick-4"]
  ]) {
    const icon = L.divIcon({
      className: "",
      html: `<div class="motion-timeline-marker ${markerClass}" style="--bearing:${motion.bearing}deg"><i></i><b>${label}</b></div>`,
      iconSize: [88, 68],
      iconAnchor: [44, 21]
    });
    L.marker(point, { icon, interactive: false, zIndexOffset: 1250 }).addTo(layer);
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
  const sheetState = sheetController.getState();
  const mobileBottomPadding = sheetState === "expanded" ? 330 : sheetState === "compact" ? 225 : 145;
  const bounds = L.latLngBounds([
    state.motionGeometry.tailPoint ?? state.motionGeometry.point4,
    state.motionGeometry.point4,
    state.motionGeometry.point2,
    state.motionGeometry.position
  ]);
  map.fitBounds(bounds, {
    paddingTopLeft: [48, 110],
    paddingBottomRight: [48, window.innerWidth < 760 ? mobileBottomPadding : 80],
    maxZoom: 10,
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

async function updateForecastData(metadata, latest, fields, motion) {
  const nowTimestamp = Math.floor(Date.now() / 60_000) * 60;
  const baseOptions = {
    latitude: state.position.lat,
    zoom: ANALYSIS_ZOOM,
    baseTimestamp: nowTimestamp
  };

  if (!motion.ok) {
    const currentOnly = buildUnavailableForecast(fields.at(-1), baseOptions);
    state.forecast = motion.reason === "not-enough-rain" && currentOnly.maxRate < 0.1
      ? buildDryForecast(nowTimestamp)
      : currentOnly;
    renderForecast();
    return;
  }

  try {
    const distance4 = motion.speedKmh * 4;
    const zoom = chooseForecastZoom(state.position.lat, distance4);
    const field = zoom === ANALYSIS_ZOOM
      ? fields.at(-1)
      : await loadAnalysisField(metadata.host, latest, state.position, zoom);
    state.forecast = buildAdvectionForecast(field, {
      latitude: state.position.lat,
      movementBearing: motion.bearing,
      speedKmh: motion.speedKmh,
      zoom,
      baseTimestamp: nowTimestamp,
      initialLeadMinutes: Math.min(20, Math.max(0, (nowTimestamp - latest.time) / 60))
    });
    state.forecast.confidence = motion.confidence;
  } catch (error) {
    console.warn("4-h-Verlauf konnte nicht vollständig berechnet werden", error);
    state.forecast = buildUnavailableForecast(fields.at(-1), baseOptions);
  }
  renderForecast();
}

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
    elements.mapTime.textContent = formatClockTime(latest.time);
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
    await updateForecastData(metadata, latest, fields, motion);

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
  elements.locationTitle.textContent = "Standort wird gesucht";
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
    elements.locationTitle.textContent = "Standort wählen";
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
elements.moreBtn.addEventListener("click", () => sheetController.expand());
elements.chartBtn.addEventListener("click", (event) => openForecast(event.currentTarget));
elements.mapRadarTab.addEventListener("click", () => sheetController.collapse());
elements.openForecastBtn.addEventListener("click", (event) => openForecast(event.currentTarget));
elements.closeForecastBtn.addEventListener("click", closeForecast);
elements.forecastRadarBtn.addEventListener("click", closeForecast);
elements.forecastRefreshBtn.addEventListener("click", () => updateRadar({ force: true }));
elements.fitArrowBtn.addEventListener("click", () => fitMotionBounds(true));
elements.refreshBtn.addEventListener("click", () => updateRadar({ force: true }));
elements.pickBtn.addEventListener("click", () => state.picking ? stopPicking() : startPicking());

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.forecastView.hidden) closeForecast();
});

window.addEventListener("online", () => {
  showToast("Verbindung wiederhergestellt");
  if (state.position) updateRadar({ force: true });
});
window.addEventListener("offline", () => setLiveState("error", "Offline"));
window.setInterval(() => updateRadar({ force: true }), REFRESH_INTERVAL_MS);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(console.error));
}

renderForecast();
locate();
