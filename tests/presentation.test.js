import test from "node:test";
import assert from "node:assert/strict";
import {
  buildForecastPaths,
  forecastEvent,
  uncertaintyOpacity,
  isUncertain,
  FADE_MIN_OPACITY
} from "../public/src/presentation.js";

const sample = (minutes, rateMmh) => ({ minutes, timestamp: minutes * 60, rateMmh, level: rateMmh ? 0.5 : 0 });

test("Regenfläche verbindet keine Datenlücken mit erfundenem Trockenwetter", () => {
  const paths = buildForecastPaths([sample(0, 2), sample(60, 3), sample(120, null), sample(180, 1), sample(240, 2)]);
  assert.equal((paths.line.match(/M /g) ?? []).length, 2);
  assert.equal((paths.area.match(/Z/g) ?? []).length, 2);
  assert.ok(!paths.line.includes("50.00"));
  assert.equal(buildForecastPaths([sample(0, 2), sample(240, null)]).area, "");
});

test("Zusammenfassung nennt nur beobachtbare Beginn- und Endzeitpunkte", () => {
  assert.equal(forecastEvent({ samples: [sample(0, 0), sample(60, 1)] }).kind, "starting");
  assert.equal(forecastEvent({ samples: [sample(0, 1), sample(60, 0)] }).until, 3600);
  assert.equal(forecastEvent({ samples: [sample(0, 0), sample(60, null), sample(120, 2)] }).kind, "partial-dry");
  assert.equal(forecastEvent({ method: "dry", samples: [sample(0, 0)] }).kind, "current-dry");
  assert.equal(forecastEvent({ status: "unavailable", samples: [sample(0, 2), sample(60, null)] }).kind, "uncertain");
});

test("Unsicherheits-Fade beginnt erst nach +2 h und bleibt lesbar", () => {
  const close = (a, b) => Math.abs(a - b) < 1e-9;
  assert.equal(uncertaintyOpacity(0), 1);
  assert.equal(uncertaintyOpacity(120), 1);
  assert.ok(close(uncertaintyOpacity(180), 0.65));
  assert.ok(close(uncertaintyOpacity(240), FADE_MIN_OPACITY));
  assert.ok(close(uncertaintyOpacity(500), FADE_MIN_OPACITY));
  assert.equal(isUncertain(120), false);
  assert.equal(isUncertain(135), true);
});
