import test from "node:test";
import assert from "node:assert/strict";
import {
  computeTimelineGeometry,
  estimateShift,
  haversineKm
} from "../public/src/motion.js";

test("estimateShift erkennt eine synthetische Verschiebung", () => {
  const width = 40;
  const height = 40;
  const first = new Int16Array(width * height).fill(-999);
  const second = new Int16Array(width * height).fill(-999);

  for (let y = 10; y < 17; y += 1) {
    for (let x = 11; x < 19; x += 1) {
      first[y * width + x] = 30 + ((x + y) % 8);
      second[(y + 2) * width + x + 3] = 30 + ((x + y) % 8);
    }
  }

  const shift = estimateShift(first, second, width, height, 8, 15);
  assert.ok(shift);
  assert.ok(Math.abs(shift.dx - 3) < 0.55, `dx=${shift.dx}`);
  assert.ok(Math.abs(shift.dy - 2) < 0.55, `dy=${shift.dy}`);
  assert.ok(shift.score > 0.95);
});

test("+2h/+4h-Skala bleibt geografisch proportional", () => {
  const position = { lat: 48.137, lng: 11.575 };
  const geometry = computeTimelineGeometry(position, 120, 30);
  assert.ok(Math.abs(haversineKm(position, geometry.point2) - 60) < 0.2);
  assert.ok(Math.abs(haversineKm(position, geometry.point4) - 120) < 0.2);
  assert.equal(geometry.distance2, 60);
  assert.equal(geometry.distance4, 120);
});
