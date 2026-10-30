// A labelled display fallback only: never feed model wind into the radar forecast.
export function windMotionFromResponse(data, nowSeconds = Date.now() / 1000) {
  const hourly = data?.hourly;
  const time = hourly?.time?.[0];
  const speedKmh = hourly?.wind_speed_700hPa?.[0];
  const fromBearing = hourly?.wind_direction_700hPa?.[0];
  if (!Number.isFinite(time) || Math.abs(nowSeconds - time) > 90 * 60
    || !Number.isFinite(speedKmh) || speedKmh < 1 || speedKmh > 250
    || !Number.isFinite(fromBearing) || fromBearing < 0 || fromBearing > 360) return null;
  return {
    ok: true,
    source: "wind",
    speedKmh,
    // Meteorological wind direction names its origin; the arrow points downwind.
    bearing: (fromBearing + 180) % 360
  };
}

export async function loadWindMotion(position) {
  const params = new URLSearchParams({
    latitude: position.lat.toFixed(4),
    longitude: position.lng.toFixed(4),
    hourly: "wind_speed_700hPa,wind_direction_700hPa",
    forecast_hours: "1",
    timeformat: "unixtime",
    wind_speed_unit: "kmh",
    timezone: "UTC"
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: controller.signal,
      cache: "no-cache"
    });
    if (!response.ok) throw new Error(`Höhenwind: HTTP ${response.status}`);
    return windMotionFromResponse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

export async function chooseDisplayMotion(radarMotion, position, loadWind = loadWindMotion) {
  if (radarMotion.ok) return radarMotion;
  if (radarMotion.reason !== "not-enough-rain") return null;
  try {
    return await loadWind(position);
  } catch {
    return null;
  }
}
