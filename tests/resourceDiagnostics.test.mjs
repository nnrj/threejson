import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createRuntimeContext } from "../core/runtime/runtimeContext.js";
import { requestTexture, whenTextureReady } from "../core/resource/textureRequest.js";
import { createSceneCardSession } from "@threejson/host-kit/js/sceneCardSession.js";
import { createJsonScene } from "../core/handler/sceneLoadHandler.js";
import { describeSceneDiagnostic, sceneDiagnosticTitle, subscribeSceneDiagnosticLanguage } from "../tools/scene-host/shared/js/sceneResourceDiagnostics.js";

test("diagnostic language changes use one shared observer and dispose subscriptions", () => {
  const previousDocument = globalThis.document, previousObserver = globalThis.MutationObserver;
  let notify, observers = 0, disconnected = 0, updates = 0;
  globalThis.document = { documentElement: { lang: "zh-CN" } };
  globalThis.MutationObserver = class { constructor(callback) { notify = callback; observers++; } observe() {} disconnect() { disconnected++; } };
  const first = subscribeSceneDiagnosticLanguage(() => updates++), second = subscribeSceneDiagnosticLanguage(() => updates++);
  try {
    assert.equal(observers, 1); assert.equal(sceneDiagnosticTitle(), "场景提示");
    document.documentElement.lang = "en"; notify();
    assert.equal(updates, 2); assert.equal(sceneDiagnosticTitle(), "Scene notices");
    assert.match(describeSceneDiagnostic({ code: "TEXTURE_RESOURCE_FAILED" }), /Texture unavailable/);
    first(); notify(); assert.equal(updates, 3); assert.equal(disconnected, 0);
    second(); assert.equal(disconnected, 1);
  } finally {
    first(); second(); globalThis.document = previousDocument; globalThis.MutationObserver = previousObserver;
  }
});

test("texture failures are scoped, deduplicated, observable and cleared by successful retry", async () => {
  const a = createRuntimeContext(), b = createRuntimeContext();
  const updates = []; a.diagnostics.subscribe((items) => updates.push(items));
  a.diagnostics.subscribe(() => { throw new Error("broken observer"); });
  let fail = true;
  const loader = { load(_source, ready, _, failed) {
    const texture = new THREE.Texture({ width: 2, height: 2 });
    queueMicrotask(() => fail ? failed(new Error("failed decode")) : ready(texture)); return texture;
  } };
  try {
    for (let i = 0; i < 2; i++) {
      const texture = requestTexture("https://test.invalid/a.png", { runtimeScope: a, loader });
      await assert.rejects(whenTextureReady(texture)); texture.dispose();
    }
    assert.equal(a.resourceDiagnostics.length, 1); assert.equal(b.resourceDiagnostics.length, 0);
    assert.equal(updates.length, 2);
    fail = false;
    const texture = requestTexture("https://test.invalid/a.png", { runtimeScope: a, loader });
    await whenTextureReady(texture); texture.dispose();
    assert.equal(a.resourceDiagnostics.length, 0); assert.equal(updates.at(-1).length, 0);
  } finally { a.dispose(); b.dispose(); }
});

test("diagnostic display redacts credentials/query/inline data and does not trust provider messages", () => {
  const text = describeSceneDiagnostic({ code: "TEXTURE_RESOURCE_FAILED", source: "https://user:password@example.test/map.png?secret=value#auth", message: "password" });
  assert.match(text, /example\.test\/map.png/); assert.doesNotMatch(text, /user|password|secret|auth/);
  assert.doesNotMatch(describeSceneDiagnostic({ code: "TEXTURE_RESOURCE_FAILED", source: "data:image/png;base64,PRIVATE" }), /PRIVATE/);
});

test("scene cards follow only the current runtime's resource diagnostics", async () => {
  const changes = [];
  const card = createSceneCardSession({ createRuntime: createJsonScene, onDiagnosticsChanged: (items) => changes.push(items) });
  try {
    await card.render({ objectList: [{ objType: "box", threeJsonId: "one" }] });
    const previous = card.runtime.runtimeContext;
    previous.diagnostics.report({ code: "TEXTURE_RESOURCE_FAILED", source: "a" });
    assert.equal(changes.at(-1).length, 1);
    await card.render({ objectList: [{ objType: "sphere", threeJsonId: "two" }] });
    assert.equal(changes.at(-1).length, 0);
    previous.diagnostics.report({ code: "TEXTURE_RESOURCE_FAILED", source: "late" });
    assert.equal(changes.at(-1).length, 0);
  } finally { card.dispose(); }
});
