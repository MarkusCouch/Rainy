import test from "node:test";
import assert from "node:assert/strict";
import { chooseDisplayMotion, windMotionFromResponse } from "../public/src/wind.js";
import { computeTimelineGeometry, haversineKm } from "../public/src/motion.js";

const now = 1_800_000_000;
function response(speed = 30, direction = 270, time = now) {
  return { hourly: { time: [time], wind_speed_700hPa: [speed], wind_direction_700hPa: [direction] } };
}

test("trockener Radarbereich erhält einen korrekt gerichteten, skalierten Höhenwindpfeil", async () => {
  const motion = await chooseDisplayMotion({ ok: false, reason: "not-enough-rain" }, {},
    async () => windMotionFromResponse(response(), now));
  assert.equal(motion.source, "wind");
  assert.equal(motion.bearing, 90); // Wind from west travels east.
  const position = { lat: 51.05, lng: 13.74 };
  const geometry = computeTimelineGeometry(position, motion.bearing, motion.speedKmh);
  assert.ok(geometry.point4.lng < position.lng); // Source-side timeline stays west.
  assert.ok(Math.abs(haversineKm(position, geometry.point4) - 120) < 0.2);
});

test("gemessene Radarbewegung hat Vorrang; uneindeutiger Regen wird nicht durch Wind ersetzt", async () => {
  const radar = { ok: true, speedKmh: 25, bearing: 120 };
  const unexpected = () => { throw new Error("must not fetch"); };
  assert.equal(await chooseDisplayMotion(radar, {}, unexpected), radar);
  assert.equal(await chooseDisplayMotion({ ok: false, reason: "inconsistent" }, {}, unexpected), null);
});

test("fehlende, alte oder windstille Modelldaten erfinden keine Bewegung", async () => {
  for (const data of [{}, response(null), response(0), response(30, null), response(30, 270, now - 7200)]) {
    assert.equal(windMotionFromResponse(data, now), null);
  }
  assert.equal(await chooseDisplayMotion({ ok: false, reason: "not-enough-rain" }, {},
    async () => { throw new Error("offline"); }), null);
});
