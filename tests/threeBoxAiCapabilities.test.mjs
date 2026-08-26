import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  projectSceneToRendererBackend,
  resolveThreeBoxAiRendererBackend,
  scenePayloadRequiresTslCode,
  scenePayloadRequiresWebgpu,
  shouldActivateThreeBoxTslCode
} from "../tools/scene-host/threebox/js/threeBoxAiCapabilities.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("ThreeBox recognizes every descriptor shape that requires its optional WebGPU entry", () => {
  assert.equal(scenePayloadRequiresWebgpu({ objectList: [{ material: { type: "tsl", tsl: { kind: "preset" } } }] }), true);
  assert.equal(scenePayloadRequiresWebgpu({ objectList: [{ objType: "particleEmitter", simulation: { backend: "webgpu-compute" } }] }), true);
  assert.equal(scenePayloadRequiresWebgpu({ sceneConfig: { renderer: { backend: "webgpu" } } }), true);
  assert.equal(scenePayloadRequiresWebgpu({ objectList: [{ objType: "renderer", backend: "webgpu" }] }), true);
  assert.equal(scenePayloadRequiresTslCode({ objectList: [{ material: { type: "tsl", tsl: { kind: "code" } } }] }), true);
  assert.equal(scenePayloadRequiresTslCode({ objectList: [{ material: { type: "tsl", tsl: { kind: "graph" } } }] }), false);
  assert.equal(scenePayloadRequiresWebgpu({ objectList: [{ objType: "box", material: { type: "standard" } }] }), false);
});

test("ThreeBox resolves negotiated TSL/compute selections to WebGPU and projects only the working scene", () => {
  assert.equal(resolveThreeBoxAiRendererBackend({ selectedCapabilityIds: ["webgpuTsl"] }), "webgpu");
  assert.equal(resolveThreeBoxAiRendererBackend({ selectedCapabilityIds: ["particles"] }), "webgl");
  assert.equal(resolveThreeBoxAiRendererBackend({
    scene: { objectList: [{ objType: "renderer", backend: "webgpu" }] }
  }), "webgpu");
  assert.equal(shouldActivateThreeBoxTslCode({ selectedCapabilityIds: ["tslCode"] }), true);
  assert.equal(shouldActivateThreeBoxTslCode({ selectedCapabilityIds: ["webgpuTsl"] }), false);
  const original = { threeJsonId: "scene", sceneConfig: { renderer: { antialias: true } }, objectList: [] };
  const projected = projectSceneToRendererBackend(original, "webgpu");
  assert.equal(projected.sceneConfig.renderer.backend, "webgpu");
  assert.equal(original.sceneConfig.renderer.backend, undefined);
});

test("ThreeBox advertises WebGPU on demand and has browser mappings without eager startup import", () => {
  const html = fs.readFileSync(path.join(ROOT, "tools/scene-host/threebox/index.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "tools/scene-host/threebox/js/threeBoxApp.js"), "utf8");
  assert.match(html, /"threejson\/webgpu"/);
  assert.match(html, /"threejson\/tsl-code"/);
  assert.match(html, /"three\/webgpu"/);
  assert.match(html, /"three\/tsl"/);
  assert.match(html, /"three":\s*"https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.184\.0\/build\/three\.module\.js"/);
  assert.match(app, /activatableCapabilityEntries:\s*\["threejson\/webgpu",\s*"threejson\/tsl-code"\]/);
  assert.match(app, /activatableTslCodePolicy:\s*"prompt"/);
  assert.doesNotMatch(app, /const webgpuCapabilitiesReady = await activateThreeBoxAiCapabilities/);
});
