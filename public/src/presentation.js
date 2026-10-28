// Missing forecast values are gaps, never dry weather.
export function buildForecastPaths(samples) {
  const horizon = Math.max(1, samples.at(-1)?.minutes ?? 240);
  const segments = [];
  let segment = [];
  for (const sample of samples) {
    if (!Number.isFinite(sample.rateMmh)) {
      if (segment.length) segments.push(segment);
      segment = [];
      continue;
    }
    segment.push([
      (sample.minutes / horizon) * 100,
      96 - Math.max(0, Math.min(1, sample.level || 0)) * 88
    ]);
  }
  if (segment.length) segments.push(segment);
  const coordinate = ([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`;
  return {
    line: segments.map((points) => `M ${points.map(coordinate).join(" L ")}`).join(" "),
    area: segments.filter((points) => points.length > 1).map((points) => (
      `M ${points[0][0].toFixed(2)} 96 L ${points.map(coordinate).join(" L ")} L ${points.at(-1)[0].toFixed(2)} 96 Z`
    )).join(" ")
  };
}

export function forecastEvent(forecast) {
  const samples = forecast?.samples ?? [];
  if (!samples.length) return { kind: "missing" };
  if (forecast.method === "dry") return { kind: "current-dry" };
  if (forecast.status === "unavailable") return { kind: "uncertain", sample: samples[0] };
  if (!Number.isFinite(samples[0].rateMmh)) return { kind: "uncertain" };

  // Only report an onset/end when all preceding samples are available.
  const firstGap = samples.findIndex((sample) => !Number.isFinite(sample.rateMmh));
  const known = firstGap < 0 ? samples : samples.slice(0, firstGap);
  if (known[0].rateMmh >= 0.1) {
    const dry = known.find((sample) => sample.rateMmh < 0.1);
    return { kind: dry ? "ending" : "ongoing", sample: known[0], until: dry?.timestamp };
  }
  const rain = known.find((sample) => sample.rateMmh >= 0.1);
  if (rain) return { kind: "starting", sample: rain };
  return { kind: firstGap < 0 ? "dry" : "partial-dry" };
}
