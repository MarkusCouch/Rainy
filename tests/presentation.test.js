import test from "node:test";
import assert from "node:assert/strict";
import { buildForecastPaths, forecastEvent } from "../public/src/presentation.js";

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
