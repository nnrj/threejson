import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { normalizeScenePayload } from "../core/handler/sceneFriendlyNormalizer.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tutorialJsonPath = join(
  repoRoot,
  "assets/json/tutorial/track-03/03-04-obj-maps-fallback.json"
);

const ALPACA_MODEL_PATH = "/assets/model/obj/maps_fallback/alpaca.obj";

test("03-04 tutorial JSON normalizes alpaca objModelList with modelPath", () => {
  const payload = JSON.parse(readFileSync(tutorialJsonPath, "utf8"));
  assert.equal(payload.worldInfo?.objModelList?.[0]?.modelPath, ALPACA_MODEL_PATH);
  assert.equal(payload.worldInfo?.objModelList?.[0]?.modelUrl, undefined);

  const { payload: normalized } = normalizeScenePayload(payload);
  const alpaca = (normalized.objectList || []).find((entry) => entry?.name === "alpaca-obj");
  assert.ok(alpaca, "expected alpaca-obj in objectList");
  assert.equal(String(alpaca.objType || "").toLowerCase(), "externalmodel");
  assert.equal(alpaca.modelPath, ALPACA_MODEL_PATH);
  assert.equal(alpaca.modelFileType, "obj");
});
