import test from "node:test";
import assert from "node:assert/strict";
import { chooseSheetSnap, sheetSnapPoints } from "../public/src/sheet.js";

test("unteres Fenster erhält offene, kompakte und eingeklappte Rastpunkte", () => {
  assert.deepEqual(sheetSnapPoints(240), [0, 89, 164]);
});

test("Ziehen und Wischgeschwindigkeit wählen einen sinnvollen Rastpunkt", () => {
  const snaps = [0, 90, 164];
  assert.equal(chooseSheetSnap(82, snaps, 0), 90);
  assert.equal(chooseSheetSnap(82, snaps, 0.6), 164);
  assert.equal(chooseSheetSnap(82, snaps, -0.6), 0);
});
