import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createRuntimeContext, attachRuntimeContext } from "../core/runtime/runtimeContext.js";
import { configureSceneResourcePolicy } from "../core/resource/sceneResourcePolicy.js";
import { registerObject, getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { applyObjectVisibility } from "../core/handler/objectVisibility.js";
import { buildInfoPanelObject, normalizeInfoPanelDescriptor, deployInfoPanel } from "../core/builder/infoPanelBuilder.js";
import { updateInfoPanel } from "../core/handler/infoPanelRuntime.js";
import { showDevicePanel, hideDevicePanel, ensureDevicePanelDeployed } from "../domains/device/devicePanelRuntime.js";
import { bindDevicePanelActionTriggers } from "../domains/device/devicePanelActions.js";
import { getBindings } from "../core/runtime/eventMechanism/index.js";

function fixture(origin) {
  const context = createRuntimeContext();
  const scene = new THREE.Scene(); attachRuntimeContext(scene, context);
  configureSceneResourcePolicy(context, {}, { assetsBase: origin, assetsBaseMode: "base-only" });
  const descriptor = normalizeInfoPanelDescriptor({ threeJsonId: "panel", type: "img", text: "/assets/panel.png", visible: true, opacity: 1 });
  const panel = buildInfoPanelObject(descriptor, new THREE.Texture()); scene.add(panel);
  registerObject(panel, descriptor, {}, context);
  const device = new THREE.Group(); scene.add(device);
  registerObject(device, { threeJsonId: "device", objType: "domain", domain: "device.ups", devicePanelRef: "panel", panelShowTrigger: "click" }, {}, context);
  return { context, scene, panel, device };
}

test("device panel visibility, identity and bindings stay in their owning scene", async () => {
  const a = fixture("https://a.test/assets"), b = fixture("https://b.test/assets");
  try {
    assert.equal(await ensureDevicePanelDeployed(a.scene, a.device), "panel");
    hideDevicePanel(a.device);
    assert.equal(a.panel.visible, false); assert.equal(b.panel.visible, true);
    showDevicePanel("device", true, a.scene); assert.equal(a.panel.visible, true);
    await updateInfoPanel("panel", { visible: false, name: "only-a" }, { scene: a.scene });
    assert.equal(a.panel.visible, false); assert.equal(b.panel.visible, true);
    assert.equal(a.panel.name, "only-a"); assert.notEqual(b.panel.name, "only-a");
    bindDevicePanelActionTriggers(a.scene, { sceneToken: "a" });
    assert.equal(getBindings("device", "click", a.scene).length, 1);
    assert.equal(getBindings("device", "click", b.scene).length, 0);
  } finally { a.context.dispose(); b.context.dispose(); }
});

test("visibility never changes a shared or intentionally hidden material", () => {
  const material = new THREE.MeshBasicMaterial();
  const a = new THREE.Mesh(undefined, material), b = new THREE.Mesh(undefined, material);
  applyObjectVisibility(a, false);
  assert.equal(a.visible, false); assert.equal(b.visible, true); assert.equal(material.visible, true);
  material.visible = false; applyObjectVisibility(a, true);
  assert.equal(material.visible, false);
  a.geometry.dispose(); b.geometry.dispose(); material.dispose();
});

test("panel image acquisition and registration remain scoped across asynchronous completion", async () => {
  const a = fixture("https://a.test/assets"), b = fixture("https://b.test/assets");
  const original = THREE.TextureLoader.prototype.load, pending = [];
  THREE.TextureLoader.prototype.load = function (url, done, _progress, fail) {
    const texture = new THREE.Texture({ width: 2, height: 2 });
    pending.push({ url, done: () => done(texture), fail }); return texture;
  };
  try {
    const pa = deployInfoPanel(a.scene, { threeJsonId: "late", type: "img", text: "/assets/map.png", opacity: 1 });
    const pb = deployInfoPanel(b.scene, { threeJsonId: "late", type: "img", text: "/assets/map.png", opacity: 1 });
    while (pending.length < 2) await new Promise((r) => setImmediate(r));
    assert.deepEqual(pending.map((p) => p.url).sort(), ["https://a.test/assets/map.png", "https://b.test/assets/map.png"]);
    pending[1].done(); const ob = await pb; pending[0].done(); const oa = await pa;
    assert.equal(getObjectByThreeJsonId("late", a.scene), oa);
    assert.equal(getObjectByThreeJsonId("late", b.scene), ob);
    const map = (object) => (Array.isArray(object.material) ? object.material : [object.material]).find((m) => m.map)?.map;
    assert.ok(map(oa)?.isTexture); assert.notEqual(map(oa), map(ob));
    assert.equal(JSON.stringify(oa.userData.objJson).includes('"isTexture"'), false);
    assert.equal(oa.userData.objJson.panel.material.map, undefined);
  } finally { THREE.TextureLoader.prototype.load = original; a.context.dispose(); b.context.dispose(); }
});

test("failed or superseded panel updates preserve the valid carrier", async () => {
  const a = fixture("https://a.test/assets");
  const original = THREE.TextureLoader.prototype.load, pending = [];
  THREE.TextureLoader.prototype.load = function (url, done, _progress, fail) {
    const texture = new THREE.Texture({ width: 2, height: 2 });
    pending.push({ url, done: () => done(texture), fail }); return texture;
  };
  try {
    const failure = updateInfoPanel("panel", { panelBoxType: "sprite", type: "img", text: "/assets/bad.png" }, { scene: a.scene });
    const failed = assert.rejects(failure, /unavailable/);
    while (!pending.length) await new Promise((r) => setImmediate(r));
    assert.equal(a.panel.parent, a.scene);
    pending.shift().fail(new Error("unavailable")); await failed;
    assert.equal(getObjectByThreeJsonId("panel", a.scene), a.panel);
    const late = updateInfoPanel("panel", { type: "img", text: "/assets/late.png" }, { scene: a.scene });
    const superseded = assert.rejects(late, { name: "AbortError" });
    while (!pending.length) await new Promise((r) => setImmediate(r));
    await updateInfoPanel("panel", { name: "newer" }, { scene: a.scene });
    pending.shift().done(); await superseded;
    assert.equal(a.panel.name, "newer"); assert.equal(a.panel.parent, a.scene);
  } finally { THREE.TextureLoader.prototype.load = original; a.context.dispose(); }
});
