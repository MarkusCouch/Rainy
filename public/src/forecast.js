const EARTH_RADIUS_M = 6378137;

export const FORECAST_STEP_MINUTES = 15;
export const FORECAST_HORIZON_MINUTES = 240;

export function metersPerPixel(latitude, zoom, imageSize = 512) {
  return Math.cos(latitude * Math.PI / 180)
    * 2 * Math.PI * EARTH_RADIUS_M / (imageSize * (2 ** zoom));
}

export function dbzToRainRate(dbz) {
  if (!Number.isFinite(dbz) || dbz < 5) return 0;
  const reflectivity = 10 ** (dbz / 10);
  return (reflectivity / 200) ** (1 / 1.6);
}

export function rainRateClass(rate) {
  if (!Number.isFinite(rate)) return "unavailable";
  if (rate < 0.1) return "dry";
  if (rate < 0.5) return "weak";
  if (rate < 2.5) return "light";
  if (rate < 10) return "medium";
  if (rate < 25) return "heavy";
  return "extreme";
}

export function rainRateLevel(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  if (rate <= 0.1) return (rate / 0.1) * 0.08;
  if (rate <= 2.5) return 0.08 + ((rate - 0.1) / 2.4) * 0.26;
  if (rate <= 10) return 0.34 + ((rate - 2.5) / 7.5) * 0.33;
  return Math.min(1, 0.67 + ((rate - 10) / 40) * 0.33);
}

export function chooseForecastZoom(latitude, distanceKm, {
  minZoom = 3,
  maxZoom = 7,
  imageSize = 512,
  marginKm = 12
} = {}) {
  const requiredRadius = Math.max(0, distanceKm) + marginKm;
  for (let zoom = maxZoom; zoom >= minZoom; zoom -= 1) {
    const radiusKm = metersPerPixel(latitude, zoom, imageSize) * (imageSize / 2 - 4) / 1000;
    if (radiusKm >= requiredRadius) return zoom;
  }
  return minZoom;
}

function averageRainRate(field, centerX, centerY, radiusPixels) {
  if (
    centerX < radiusPixels
    || centerY < radiusPixels
    || centerX >= field.width - radiusPixels
    || centerY >= field.height - radiusPixels
  ) return null;

  const radiusSquared = radiusPixels ** 2;
  let total = 0;
  let weight = 0;
  const x0 = Math.round(centerX);
  const y0 = Math.round(centerY);

  for (let dy = -radiusPixels; dy <= radiusPixels; dy += 1) {
    for (let dx = -radiusPixels; dx <= radiusPixels; dx += 1) {
      const distanceSquared = dx ** 2 + dy ** 2;
      if (distanceSquared > radiusSquared) continue;
      const sampleWeight = 1 - (distanceSquared / (radiusSquared + 1)) * 0.55;
      const dbz = field.values[(y0 + dy) * field.width + x0 + dx];
      total += dbzToRainRate(dbz) * sampleWeight;
      weight += sampleWeight;
    }
  }

  return weight ? total / weight : 0;
}

export function buildAdvectionForecast(field, {
  latitude,
  movementBearing,
  speedKmh,
  zoom = 7,
  baseTimestamp,
  initialLeadMinutes = 0,
  stepMinutes = FORECAST_STEP_MINUTES,
  horizonMinutes = FORECAST_HORIZON_MINUTES,
  sampleRadiusKm = 2.5
}) {
  const pixelKm = metersPerPixel(latitude, zoom, field.width) / 1000;
  const sampleRadiusPixels = Math.max(1, Math.min(5, Math.round(sampleRadiusKm / pixelKm)));
  const sourceBearing = ((movementBearing + 180) % 360) * Math.PI / 180;
  const centerX = (field.width - 1) / 2;
  const centerY = (field.height - 1) / 2;
  const samples = [];

  for (let minutes = 0; minutes <= horizonMinutes; minutes += stepMinutes) {
    const distanceKm = speedKmh * (minutes + initialLeadMinutes) / 60;
    const eastKm = Math.sin(sourceBearing) * distanceKm;
    const northKm = Math.cos(sourceBearing) * distanceKm;
    const x = centerX + eastKm / pixelKm;
    const y = centerY - northKm / pixelKm;
    const rateMmh = averageRainRate(field, x, y, sampleRadiusPixels);
    samples.push({
      minutes,
      timestamp: baseTimestamp + minutes * 60,
      rateMmh,
      level: rainRateLevel(rateMmh),
      className: rainRateClass(rateMmh)
    });
  }

  const available = samples.filter((sample) => Number.isFinite(sample.rateMmh));
  return {
    status: available.length === samples.length ? "ready" : "partial",
    method: "advection",
    samples,
    maxRate: Math.max(0, ...available.map((sample) => sample.rateMmh))
  };
}

export function buildDryForecast(baseTimestamp, {
  stepMinutes = FORECAST_STEP_MINUTES,
  horizonMinutes = FORECAST_HORIZON_MINUTES
} = {}) {
  const samples = [];
  for (let minutes = 0; minutes <= horizonMinutes; minutes += stepMinutes) {
    samples.push({
      minutes,
      timestamp: baseTimestamp + minutes * 60,
      rateMmh: 0,
      level: 0,
      className: "dry"
    });
  }
  return { status: "ready", method: "dry", samples, maxRate: 0 };
}

export function buildUnavailableForecast(field, {
  latitude,
  zoom = 7,
  baseTimestamp,
  stepMinutes = FORECAST_STEP_MINUTES,
  horizonMinutes = FORECAST_HORIZON_MINUTES
}) {
  const pixelKm = metersPerPixel(latitude, zoom, field.width) / 1000;
  const radius = Math.max(1, Math.min(5, Math.round(2.5 / pixelKm)));
  const currentRate = averageRainRate(field, (field.width - 1) / 2, (field.height - 1) / 2, radius) ?? 0;
  const samples = [];
  for (let minutes = 0; minutes <= horizonMinutes; minutes += stepMinutes) {
    const rateMmh = minutes === 0 ? currentRate : null;
    samples.push({
      minutes,
      timestamp: baseTimestamp + minutes * 60,
      rateMmh,
      level: rainRateLevel(rateMmh),
      className: rainRateClass(rateMmh)
    });
  }
  return { status: "unavailable", method: "current-only", samples, maxRate: currentRate };
}
