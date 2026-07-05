import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateSceneExtentFromPayload,
  normalizeLightsConfigWithMeta,
  resolveLightsDefaults,
  applySceneRuntimeDefaults,
  hasExplicitCameraConfig,
  mergeRuntimeDefaultOptions,
  ENGINE_RUNTIME_DEFAULTS
} from "../core/util/sceneRuntimeDefaults.js";
import { normalizeScenePayload } from "../core/handler/sceneFriendlyNormalizer.js";

test("estimateSceneExtentFromPayload includes modelList and groupList", () => {
  const extent = estimateSceneExtentFromPayload({
    worldInfo: {
      modelList: [
        {
          objType: "box",
          position: { x: 10, y: 0, z: 0 },
          geometry: { width: 20, height: 4, depth: 8 }
        }
      ]
    }
  });
  assert.ok(extent);
  assert.equal(extent.center.x, 10);
  assert.ok(extent.maxDim >= 8);
});

test("extentInclude filters by objType and threeJsonId", () => {
  const extentAll = estimateSceneExtentFromPayload({
    worldInfo: {
      boxModelList: [
        { threeJsonId: "a", position: { x: 0, y: 0, z: 0 }, geometry: { width: 10, height: 10, depth: 10 } },
        { threeJsonId: "b", position: { x: 100, y: 0, z: 0 }, geometry: { width: 10, height: 10, depth: 10 } }
      ]
    }
  });
  const extentFiltered = estimateSceneExtentFromPayload(
    {
      worldInfo: {
        boxModelList: [
          { threeJsonId: "a", position: { x: 0, y: 0, z: 0 }, geometry: { width: 10, height: 10, depth: 10 } },
          { threeJsonId: "b", position: { x: 100, y: 0, z: 0 }, geometry: { width: 10, height: 10, depth: 10 } }
        ]
      }
    },
    { extentInclude: { threeJsonIds: ["a"] } }
  );
  assert.ok(extentAll.maxDim > 50);
  assert.ok(extentFiltered);
  assert.ok(extentFiltered.maxDim < extentAll.maxDim);
});

test("resolveLightsDefaults fills when lights key missing", () => {
  const normalized = {
    sceneConfig: {},
    worldInfo: { boxModelList: [] },
    lightsMeta: normalizeLightsConfigWithMeta({}, {}).lightsMeta
  };
  const result = resolveLightsDefaults(normalized, null, { autoFillLights: true });
  assert.equal(result.injected, true);
  assert.equal(result.lights.length, 3);
});

test("resolveLightsDefaults honors explicit empty lights array", () => {
  const meta = normalizeLightsConfigWithMeta({ lights: [] }, {});
  const normalized = { sceneConfig: { lights: [] }, worldInfo: {}, lightsMeta: meta.lightsMeta };
  const result = resolveLightsDefaults(normalized, null, { autoFillLights: true });
  assert.equal(result.injected, false);
  assert.equal(result.lights.length, 0);
});

test("mergeRuntimeDefaultOptions reads sceneConfig.runtimeDefaults over engine defaults", () => {
  const merged = mergeRuntimeDefaultOptions(
    {
      sceneConfig: {
        runtimeDefaults: {
          autoFillLights: false,
          autoFitCamera: true
        }
      }
    },
    {}
  );
  assert.equal(merged.autoFillLights, false);
  assert.equal(merged.autoFitCamera, true);
  assert.equal(merged.fillLightsWhenExplicitEmpty, ENGINE_RUNTIME_DEFAULTS.fillLightsWhenExplicitEmpty);
});

test("mergeRuntimeDefaultOptions caller options override JSON", () => {
  const merged = mergeRuntimeDefaultOptions(
    { sceneConfig: { runtimeDefaults: { autoFillLights: false } } },
    { autoFillLights: true }
  );
  assert.equal(merged.autoFillLights, true);
});

test("applySceneRuntimeDefaults injects camera when autoFillCamera", () => {
  const normalized = normalizeScenePayload({
    worldInfo: {
      boxModelList: [
        { position: { x: 0, y: 0, z: 0 }, geometry: { width: 40, height: 20, depth: 60 } }
      ]
    }
  });
  applySceneRuntimeDefaults(normalized, { autoFillCamera: true, autoFillLights: false });
  assert.ok(normalized.cameraConfig?.position);
  assert.ok(normalized.controlsConfig?.target);
  assert.equal(hasExplicitCameraConfig({}, {}), false);
});
