import { decodeRadarImageData, recolorRadarImageData } from "./palette.js";

export const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
export const ANALYSIS_ZOOM = 7;
export const ANALYSIS_SIZE = 512;

export async function loadRadarMetadata() {
  const response = await fetch(RAINVIEWER_API, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Radar-Metadaten: HTTP ${response.status}`);
  const data = await response.json();
  const frames = data?.radar?.past;
  if (!data.host || !Array.isArray(frames) || frames.length < 3) {
    throw new Error("Radar-Metadaten sind unvollständig");
  }
  return { host: data.host, frames };
}

export function radarTileUrl(host, frame, coords, size = 256) {
  return `${host}${frame.path}/${size}/${coords.z}/${coords.x}/${coords.y}/2/0_0.png`;
}

export function analysisImageUrl(host, frame, position) {
  const lat = Number(position.lat).toFixed(5);
  const lng = Number(position.lng).toFixed(5);
  return `${host}${frame.path}/${ANALYSIS_SIZE}/${ANALYSIS_ZOOM}/${lat}/${lng}/2/0_0.png`;
}

async function bitmapFromResponse(response) {
  if (!response.ok) throw new Error(`Radarbild: HTTP ${response.status}`);
  const blob = await response.blob();
  if ("createImageBitmap" in window) return createImageBitmap(blob);

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Radarbild konnte nicht dekodiert werden"));
    };
    image.src = objectUrl;
  });
}

export async function loadAnalysisField(host, frame, position) {
  const response = await fetch(analysisImageUrl(host, frame, position), { cache: "force-cache" });
  const bitmap = await bitmapFromResponse(response);
  const canvas = document.createElement("canvas");
  canvas.width = ANALYSIS_SIZE;
  canvas.height = ANALYSIS_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = false;
  context.drawImage(bitmap, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
  bitmap.close?.();
  return decodeRadarImageData(context.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE));
}

export async function loadMotionFields(host, frames, position) {
  return Promise.all(frames.map((frame) => loadAnalysisField(host, frame, position)));
}

export function createRadarLayer(L, host, frame) {
  const RadarLayer = L.GridLayer.extend({
    createTile(coords, done) {
      const canvas = L.DomUtil.create("canvas", "rainy-radar-tile");
      canvas.width = 256;
      canvas.height = 256;
      canvas.setAttribute("role", "presentation");

      fetch(radarTileUrl(host, frame, coords), { cache: "force-cache" })
        .then(bitmapFromResponse)
        .then((bitmap) => {
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.imageSmoothingEnabled = false;
          context.drawImage(bitmap, 0, 0, 256, 256);
          bitmap.close?.();
          const imageData = context.getImageData(0, 0, 256, 256);
          context.putImageData(recolorRadarImageData(imageData), 0, 0);
          done(null, canvas);
        })
        .catch((error) => done(error, canvas));

      return canvas;
    }
  });

  return new RadarLayer({
    tileSize: 256,
    opacity: 0.9,
    maxNativeZoom: 7,
    maxZoom: 12,
    minZoom: 3,
    noWrap: true,
    keepBuffer: 2,
    updateWhenIdle: true,
    className: "rainy-radar-grid"
  });
}
