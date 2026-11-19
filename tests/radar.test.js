import test from "node:test";
import assert from "node:assert/strict";
import { COVERAGE_VEIL, coverageTileUrl, veilCoverageImageData } from "../public/src/radar.js";

test("Abdeckungskachel nutzt den RainViewer-Coverage-Pfad", () => {
  assert.equal(
    coverageTileUrl("https://tilecache.rainviewer.com", { z: 5, x: 17, y: 10 }),
    "https://tilecache.rainviewer.com/v2/coverage/0/256/5/17/10/0/0_0.png"
  );
});

test("Schleier liegt nur über Gebieten ohne Radarabdeckung", () => {
  const imageData = { data: new Uint8ClampedArray([
    255, 255, 255, 80, // abgedeckt (halbtransparent)
    0, 0, 0, 0 // keine Abdeckung
  ]) };
  const { data } = veilCoverageImageData(imageData);
  assert.equal(data[3], 0);
  assert.deepEqual([...data.slice(4, 8)], COVERAGE_VEIL);
});
