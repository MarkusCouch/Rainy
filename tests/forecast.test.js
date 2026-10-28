import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdvectionForecast,
  chooseForecastZoom,
  dbzToRainRate,
  rainRateClass,
  rainRateLevel
} from "../public/src/forecast.js";

test("dBZ wird in eine plausible Regenrate umgerechnet", () => {
  assert.equal(dbzToRainRate(-999), 0);
  assert.ok(Math.abs(dbzToRainRate(30) - 2.73) < 0.05);
  assert.ok(Math.abs(dbzToRainRate(40) - 11.53) < 0.1);
  assert.equal(rainRateClass(0), "dry");
  assert.equal(rainRateClass(3), "medium");
  assert.ok(rainRateLevel(10) > rainRateLevel(2.5));
});

test("der Prognoseausschnitt skaliert mit der Vier-Stunden-Strecke", () => {
  assert.equal(chooseForecastZoom(51.05, 120), 6);
  assert.equal(chooseForecastZoom(51.05, 400), 4);
});

test("Advektionsverlauf enthält 15-Minuten-Werte bis +4 h", () => {
  const width = 512;
  const field = { width, height: width, values: new Int16Array(width * width).fill(30) };
  const forecast = buildAdvectionForecast(field, {
    latitude: 51.05,
    movementBearing: 90,
    speedKmh: 12,
    zoom: 6,
    baseTimestamp: 1_800_000_000
  });
  assert.equal(forecast.samples.length, 17);
  assert.equal(forecast.samples.at(-1).minutes, 240);
  assert.equal(forecast.status, "ready");
  assert.ok(forecast.samples.every((sample) => Math.abs(sample.rateMmh - 2.73) < 0.05));
});
