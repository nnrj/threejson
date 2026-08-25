import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureOptionalSceneCapabilitiesForPayload,
  sceneUsesAdvancedWebglPass
} from "../core/capabilities/optionalCapabilityLoader.js";
import { getPassTypeFactory } from "../core/handler/postProcessPassTypeRegistry.js";
import { registerShaderPassPreset } from "../core/builder/postprocess/shaderPassPresetRegistry.js";
import { createJsonSceneSimple } from "../core/handler/sceneLoadHandler.js";

test("advanced pass loader is descriptor-driven", async () => {
  const simple = { objectList: [{ objType: "box" }] };
  assert.equal(sceneUsesAdvancedWebglPass(simple), false);
  await ensureOptionalSceneCapabilitiesForPayload(simple);

  const scene = { sceneConfig: { passList: [{ objType: "pass", passType: "unrealBloom" }] } };
  assert.equal(sceneUsesAdvancedWebglPass(scene), true);
  await ensureOptionalSceneCapabilitiesForPayload(scene);
  assert.equal(typeof getPassTypeFactory("unrealbloom"), "function");
  const pass = getPassTypeFactory("unrealbloom")({ strength: 1.3 }, {
    renderer: { domElement: { width: 320, height: 180 }, getPixelRatio: () => 1 }
  });
  assert.equal(pass.strength, 1.3);
  pass.dispose?.();
});

test("ShaderPass accepts registered presets and never evaluates scene source", async () => {
  await ensureOptionalSceneCapabilitiesForPayload({ passType: "shader" });
  registerShaderPassPreset("invert-test", {
    uniforms: { tDiffuse: { value: null }, amount: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
    fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){gl_FragColor=texture2D(tDiffuse,vUv);}" 
  });
  const pass = getPassTypeFactory("shader")({
    shaderPreset: "invert-test",
    uniforms: { amount: 0.75 }
  }, {});
  assert.equal(pass.material.uniforms.amount.value, 0.75);
  pass.dispose?.();
});

test("FXAA inverse resolution follows EffectComposer resizing", async () => {
  await ensureOptionalSceneCapabilitiesForPayload({ passType: "fxaa" });
  const pass = getPassTypeFactory("fxaa")({}, {
    renderer: { domElement: { width: 320, height: 180 }, getPixelRatio: () => 2 }
  });
  const resolution = pass.material.uniforms.resolution.value;
  assert.equal(resolution.x, 1 / 640);
  assert.equal(resolution.y, 1 / 360);
  pass.setSize(800, 600);
  assert.equal(resolution.x, 1 / 800);
  assert.equal(resolution.y, 1 / 600);
  pass.dispose?.();
});

test("the synchronous scene API rejects optional modules instead of dropping them", () => {
  assert.throws(
    () => createJsonSceneSimple({ objectList: [{ objType: "pass", passType: "unrealBloom" }] }),
    (error) => error?.code === "E_SCENE_ASYNC_CAPABILITY_REQUIRED"
  );
});
