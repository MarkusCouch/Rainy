const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lng - a.lng) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function destinationPoint(start, bearingDeg, distanceKm) {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const bearing = bearingDeg * Math.PI / 180;
  const lat1 = start.lat * Math.PI / 180;
  const lon1 = start.lng * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance)
      + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );

  return {
    lat: lat2 * 180 / Math.PI,
    lng: ((lon2 * 180 / Math.PI + 540) % 360) - 180
  };
}

export function bearingToCompass(bearing) {
  const directions = [
    "Norden", "Nordnordost", "Nordost", "Ostnordost",
    "Osten", "Ostsüdost", "Südost", "Südsüdost",
    "Süden", "Südsüdwest", "Südwest", "Westsüdwest",
    "Westen", "Westnordwest", "Nordwest", "Nordnordwest"
  ];
  const index = Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16;
  return directions[index];
}

export function computeTimelineGeometry(position, movementBearing, speedKmh) {
  const sourceBearing = (movementBearing + 180) % 360;
  const distance2 = speedKmh * 2;
  const distance4 = speedKmh * 4;
  return {
    position,
    movementBearing,
    sourceBearing,
    distance2,
    distance4,
    point2: destinationPoint(position, sourceBearing, distance2),
    point4: destinationPoint(position, sourceBearing, distance4)
  };
}

export function downsampleField(field, factor = 4) {
  const width = Math.floor(field.width / factor);
  const height = Math.floor(field.height / factor);
  const values = new Int16Array(width * height);
  values.fill(-999);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let max = -999;
      const y0 = y * factor;
      const x0 = x * factor;
      for (let oy = 0; oy < factor; oy += 1) {
        const row = (y0 + oy) * field.width;
        for (let ox = 0; ox < factor; ox += 1) {
          max = Math.max(max, field.values[row + x0 + ox]);
        }
      }
      values[y * width + x] = max;
    }
  }
  return { values, width, height };
}

function intensity(dbz, minDbz) {
  if (dbz < minDbz) return 0;
  return Math.min(1, (dbz - minDbz + 4) / 34);
}

function scoreShift(a, b, width, height, dx, dy, minDbz) {
  const startX = Math.max(0, -dx);
  const endX = Math.min(width, width - dx);
  const startY = Math.max(0, -dy);
  const endY = Math.min(height, height - dy);
  let overlap = 0;
  let union = 0;
  let active = 0;

  for (let y = startY; y < endY; y += 1) {
    const rowA = y * width;
    const rowB = (y + dy) * width;
    for (let x = startX; x < endX; x += 1) {
      const valueA = intensity(a[rowA + x], minDbz);
      const valueB = intensity(b[rowB + x + dx], minDbz);
      if (valueA === 0 && valueB === 0) continue;
      active += 1;
      overlap += Math.min(valueA, valueB);
      union += Math.max(valueA, valueB);
    }
  }

  if (active < 10 || union === 0) return -Infinity;
  return overlap / union;
}

function refineAxis(center, minus, plus) {
  const denominator = minus - (2 * center) + plus;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-6) return 0;
  return Math.max(-0.5, Math.min(0.5, 0.5 * (minus - plus) / denominator));
}

export function estimateShift(fieldA, fieldB, width, height, maxShift, minDbz = 15) {
  let best = { dx: 0, dy: 0, score: -Infinity };

  for (let dy = -maxShift; dy <= maxShift; dy += 1) {
    for (let dx = -maxShift; dx <= maxShift; dx += 1) {
      const score = scoreShift(fieldA, fieldB, width, height, dx, dy, minDbz);
      if (score > best.score) best = { dx, dy, score };
    }
  }

  if (!Number.isFinite(best.score)) return null;
  if (Math.abs(best.dx) < maxShift) {
    const minus = scoreShift(fieldA, fieldB, width, height, best.dx - 1, best.dy, minDbz);
    const plus = scoreShift(fieldA, fieldB, width, height, best.dx + 1, best.dy, minDbz);
    best.dx += refineAxis(best.score, minus, plus);
  }
  if (Math.abs(best.dy) < maxShift) {
    const minus = scoreShift(fieldA, fieldB, width, height, Math.round(best.dx), best.dy - 1, minDbz);
    const plus = scoreShift(fieldA, fieldB, width, height, Math.round(best.dx), best.dy + 1, minDbz);
    best.dy += refineAxis(best.score, minus, plus);
  }
  return best;
}

function angleDifference(a, b) {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

function countRain(values, minDbz) {
  let count = 0;
  for (const value of values) if (value >= minDbz) count += 1;
  return count;
}

export function analyzeMotion(rawFields, options) {
  const {
    latitude,
    frameTimes,
    zoom = 7,
    tileSize = 512,
    factor = 4,
    minDbz = 15,
    minSpeed = 5,
    maxSpeed = 140
  } = options;

  if (rawFields.length < 3 || frameTimes.length < 3) {
    return { ok: false, reason: "frames" };
  }

  const fields = rawFields.map((field) => downsampleField(field, factor));
  const lastRainCells = countRain(fields.at(-1).values, minDbz);
  if (lastRainCells < 12) return { ok: false, reason: "not-enough-rain", rainCells: lastRainCells };

  const metersPerPixel = Math.cos(latitude * Math.PI / 180)
    * 2 * Math.PI * 6378137 / (tileSize * (2 ** zoom));
  const cellKm = metersPerPixel * factor / 1000;
  const vectors = [];

  for (let index = 0; index < 2; index += 1) {
    const dtHours = (frameTimes[index + 1] - frameTimes[index]) / 3600;
    if (!(dtHours > 0 && dtHours <= 0.5)) return { ok: false, reason: "frames" };
    const maxShift = Math.min(18, Math.max(3, Math.ceil(maxSpeed * dtHours / cellKm) + 1));
    const shift = estimateShift(
      fields[index].values,
      fields[index + 1].values,
      fields[index].width,
      fields[index].height,
      maxShift,
      minDbz
    );
    if (!shift || shift.score < 0.24) return { ok: false, reason: "low-correlation", score: shift?.score ?? 0 };

    const eastKmh = shift.dx * cellKm / dtHours;
    const southKmh = shift.dy * cellKm / dtHours;
    const speedKmh = Math.hypot(eastKmh, southKmh);
    const bearing = (Math.atan2(eastKmh, -southKmh) * 180 / Math.PI + 360) % 360;
    vectors.push({ eastKmh, southKmh, speedKmh, bearing, score: shift.score, shift });
  }

  const angleDelta = angleDifference(vectors[0].bearing, vectors[1].bearing);
  const speedDelta = Math.abs(vectors[0].speedKmh - vectors[1].speedKmh);
  if (angleDelta > 65 || speedDelta > Math.max(38, Math.min(vectors[0].speedKmh, vectors[1].speedKmh) * 1.8)) {
    return { ok: false, reason: "inconsistent", angleDelta, speedDelta };
  }

  const totalWeight = vectors[0].score + vectors[1].score;
  const eastKmh = vectors.reduce((sum, vector) => sum + vector.eastKmh * vector.score, 0) / totalWeight;
  const southKmh = vectors.reduce((sum, vector) => sum + vector.southKmh * vector.score, 0) / totalWeight;
  const speedKmh = Math.hypot(eastKmh, southKmh);
  const bearing = (Math.atan2(eastKmh, -southKmh) * 180 / Math.PI + 360) % 360;

  if (speedKmh < minSpeed || speedKmh > maxSpeed) {
    return { ok: false, reason: "speed-range", speedKmh };
  }

  const correlation = (vectors[0].score + vectors[1].score) / 2;
  const consistency = Math.max(0, 1 - angleDelta / 65) * Math.max(0, 1 - speedDelta / 100);
  const rainCoverage = Math.min(1, lastRainCells / 70);
  const confidence = Math.max(0, Math.min(1, 0.2 + correlation * 0.55 + consistency * 0.2 + rainCoverage * 0.05));

  return {
    ok: true,
    speedKmh,
    bearing,
    confidence,
    rainCells: lastRainCells,
    cellKm,
    vectors
  };
}
