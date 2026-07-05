import test from "node:test";
import assert from "node:assert/strict";

import {
  CREATE_JSON_SCENE_FIT_DEFAULTS,
  createJsonScene,
  createJsonSceneFit,
  createJsonSceneFromInputFit,
  createJsonSceneSimple
} from "../core/handler/sceneLoadHandler.js";
import { normalizeScenePayload } from "../core/handler/sceneFriendlyNormalizer.js";
import { applySceneRuntimeDefaults } from "../core/util/sceneRuntimeDefaults.js";

test("CREATE_JSON_SCENE_FIT_DEFAULTS enables lights camera fit", () => {
  assert.equal(CREATE_JSON_SCENE_FIT_DEFAULTS.autoFillLights, true);
  assert.equal(CREATE_JSON_SCENE_FIT_DEFAULTS.autoFillCamera, true);
  assert.equal(CREATE_JSON_SCENE_FIT_DEFAULTS.autoFitCamera, true);
});

test("createJsonSceneFit preset spread allows caller to disable autoFillCamera", () => {
  const merged = {
    ...CREATE_JSON_SCENE_FIT_DEFAULTS,
    autoFillCamera: false
  };
  assert.equal(merged.autoFillLights, true);
  assert.equal(merged.autoFillCamera, false);
  assert.equal(merged.autoFitCamera, true);
});

test("createJsonSceneSimple is exported", () => {
  assert.equal(typeof createJsonSceneSimple, "function");
});

test("createJsonSceneFromInputFit is a function", () => {
  assert.equal(typeof createJsonSceneFromInputFit, "function");
});

test("createJsonSceneFit is a function", () => {
  assert.equal(typeof createJsonSceneFit, "function");
});

test("createJsonScene onRuntimeReady runs before object deploy", async () => {
  let childCountAtRuntimeReady = -1;
  const runtime = await createJsonScene(
    {
      worldInfo: {
        boxModelList: [
          {
            name: "early-box",
            objType: "box",
            threeJsonId: "early-box-1",
            geometry: { width: 1, height: 1, depth: 1 },
            position: { x: 0, y: 0, z: 0 },
            material: { type: "standard", color: "#ffffff" }
          }
        ]
      }
    },
    {
      async onRuntimeReady(ctx) {
        childCountAtRuntimeReady = ctx.runtime?.scene?.children?.length ?? 0;
      }
    }
  );
  const childCountAfterDeploy = runtime.scene?.children?.length ?? 0;
  assert.ok(childCountAtRuntimeReady >= 0);
  assert.ok(childCountAfterDeploy > childCountAtRuntimeReady);
});
