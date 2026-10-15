import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { deployPassRecordsFromObjectList, resolvePostProcessingConfig } from "../core/handler/postProcessPassDeploy.js";
import { createPassByType } from "../core/handler/postProcessPassTypeRegistry.js";

test("post-processing defaults add a render pass before configured effects", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const passes = [];
  const composer = { addPass(pass) { passes.push(pass); } };
  const deployed = deployPassRecordsFromObjectList({
    sceneConfig: { postProcessing: {} },
    objectList: [{ objType: "pass", passType: "output", id: "final" }]
  }, { scene, camera, renderer: null, composer });
  assert.equal(deployed.length, 2);
  assert.equal(passes[0].isPass, true);
  assert.equal(resolvePostProcessingConfig({}).autoRenderPass, true);
});

test("an unregistered pass type produces a structured error", () => {
  assert.throws(
    () => createPassByType({ passType: "not-registered" }, {}),
    (error) => error?.code === "E_POST_PROCESS_PASS_UNAVAILABLE"
  );
});

test("duplicate final color conversions are rejected instead of silently washing out the image", () => {
  assert.throws(() => deployPassRecordsFromObjectList({ objectList: [
    { objType: "pass", passType: "output", id: "a" }, { objType: "pass", passType: "output", id: "b" }
  ] }, {}), error => error.code === "E_DUPLICATE_OUTPUT_PASS");
});
