import { test } from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera } from "three";
import { createControlsFromDescriptor, applyControlsConfig } from "../core/builder/controlsBuilder.js";
import { createShowerFirstPersonUi } from "../tools/scene-host/shower/js/showerFirstPersonUi.js";

// An isolated ownerDocument, not a global document: exercise real Three.js controls
// and browser events while keeping pointer-lock grants and frame time deterministic.
class Surface extends EventTarget {
  constructor(doc, tag = "") {
    super();
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.hidden = false;
  }
  addEventListener(type, listener, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  get listenerCount() { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  hasAttribute(name) { return this.attributes.has(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { for (const child of children) this.appendChild(child); }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  focus() { this.ownerDocument.focusElement(this); }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.focusElement(this.ownerDocument.body); }
}
function emit(target, type, fields = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, fields);
  target.dispatchEvent(event);
  return event;
}
function createDocument() {
  const doc = new Surface();
  doc.defaultView = new Surface(doc);
  doc.createElement = (tag) => new Surface(doc, tag);
  doc.body = doc.createElement("body");
  doc.activeElement = doc.body;
  doc.pointerLockElement = null;
  doc.visibilityState = "visible";
  doc.focused = true;
  doc.hasFocus = () => doc.focused;
  doc.focusElement = (element) => {
    if (doc.activeElement === element) return;
    doc.activeElement = element;
    emit(doc, "focusout");
    emit(doc, "focusin");
  };
  doc.grant = (element) => { doc.pointerLockElement = element; emit(doc, "pointerlockchange"); };
  doc.exitCalls = 0;
  doc.exitPointerLock = () => { doc.exitCalls++; doc.grant(null); };
  return doc;
}
function fixture(t, config = {}, doc = createDocument()) {
  let now = 1000;
  t.mock.method(performance, "now", () => now);
  const canvas = doc.createElement("canvas");
  doc.body.appendChild(canvas);
  canvas.requestPointerLock = () => { doc.grant(canvas); return Promise.resolve(); };
  const camera = new PerspectiveCamera();
  const controls = createControlsFromDescriptor(camera, canvas, { type: "firstPerson", floorSnap: false, ...config });
  t.after(() => controls.dispose());
  return { doc, canvas, camera, controls,
    key: (code, type = "keydown", extra = {}) => emit(doc.defaultView, type, { code, ...extra }),
    frames(count = 3) { for (let i = 0; i < count; i++) { now += 16; controls.update(); } }
  };
}
function view(t, fixture) {
  const container = fixture.doc.createElement("div");
  fixture.doc.body.appendChild(container);
  let language = "zh";
  const ui = createShowerFirstPersonUi(container, (key) => `${language}:${key}`);
  t.after(() => ui.dispose());
  ui.setRuntime({ controls: fixture.controls });
  const root = container.children[0];
  const [panel, hint] = root.children;
  const [title, description, button, error] = panel.children;
  return { ui, root, panel, hint, title, description, button, error,
    translate(next) { language = next; ui.refresh(); } };
}

test("locked input moves only the owning canvas and clears held keys on unlock", async (t) => {
  const f = fixture(t);
  f.key("KeyW"); f.frames();
  assert.equal(f.camera.position.z, 0);
  assert.equal(await f.controls.lock(), true);
  f.key("KeyW"); f.frames();
  assert.ok(f.camera.position.z < 0);
  const z = f.camera.position.z;
  f.doc.grant(null); // Browser-handled Escape need not dispatch a keydown.
  f.frames();
  assert.equal(f.camera.position.z, z);
  await f.controls.lock();
  f.frames();
  assert.equal(f.camera.position.z, z, "missing keyup must not carry movement into the next walk");
  f.key("KeyW"); f.frames();
  assert.ok(f.camera.position.z < z);
});

test("core does not assign Escape to unlocking, disabling, or pausing", async (t) => {
  const f = fixture(t);
  await f.controls.lock();
  const event = f.key("Escape");
  assert.equal(event.defaultPrevented, false);
  assert.equal(f.controls.inputActive, true);
  assert.equal(f.controls.enabled, true);
  assert.equal(f.doc.exitCalls, 0);
});

test("unlocked focused input pauses when editing JSON and requires a new key press", (t) => {
  const f = fixture(t, { pointerLock: false });
  assert.equal(f.controls.getInputState().inputMode, "focused");
  emit(f.canvas, "click");
  assert.equal(f.doc.pointerLockElement, null);
  f.key("KeyW"); f.frames();
  const z = f.camera.position.z;
  assert.ok(z < 0);
  const textarea = f.doc.createElement("textarea");
  textarea.focus();
  f.key("KeyW"); f.frames();
  assert.equal(f.camera.position.z, z);
  f.controls.focusInput(); f.frames();
  assert.equal(f.camera.position.z, z);
  f.key("KeyW", "keydown", { ctrlKey: true }); f.frames();
  assert.equal(f.camera.position.z, z, "shortcuts must not start movement");
  f.key("KeyW"); f.frames();
  assert.ok(f.camera.position.z < z);
});

test("manual activation remains a host choice, including unlocked keyboard movement", (t) => {
  const f = fixture(t, { inputMode: "manual", lockOnClick: false });
  f.controls.focusInput();
  assert.equal(f.controls.inputActive, false);
  f.controls.setInputActive(true);
  f.key("KeyW"); f.frames();
  assert.ok(f.camera.position.z < 0);
  const z = f.camera.position.z;
  f.controls.setInputActive(false); f.frames();
  assert.equal(f.camera.position.z, z);
  f.controls.setInputActive(true); f.frames();
  assert.equal(f.camera.position.z, z);
  const otherCanvas = f.doc.createElement("canvas");
  f.doc.grant(otherCanvas);
  assert.equal(f.controls.inputActive, false, "a different pointer owner takes precedence");
  f.controls.unlock();
  assert.equal(f.doc.pointerLockElement, otherCanvas, "unlock does not release another canvas");
});

test("editable event paths suppress manual keyboard input, including shadow editors", (t) => {
  const f = fixture(t, { inputMode: "manual", inputActive: true });
  const editor = f.doc.createElement("div");
  editor.isContentEditable = true;
  const span = f.doc.createElement("span");
  editor.appendChild(span);
  f.key("KeyW", "keydown", { composedPath: () => [span, editor, f.doc.defaultView] });
  f.frames();
  assert.equal(f.camera.position.z, 0);
});

test("unlock discards smoothed look deltas without overwriting an externally moved camera", async (t) => {
  const f = fixture(t, { lookSmoothing: 0.5 });
  await f.controls.lock();
  f.frames(1);
  emit(f.doc, "mousemove", { movementX: 150, movementY: 50 });
  f.frames(1);
  assert.notEqual(f.camera.quaternion.y, 0);
  f.controls.unlock();
  const paused = f.camera.quaternion.clone();
  f.frames(8);
  assert.ok(f.camera.quaternion.equals(paused));
  f.camera.rotation.set(0.2, 0.6, 0, "YXZ"); // first-person yaw/pitch, without roll
  const external = f.camera.quaternion.clone();
  f.frames();
  assert.ok(f.camera.quaternion.equals(external));
  await f.controls.lock(); f.frames();
  assert.ok(f.camera.quaternion.angleTo(external) < 1e-7);
});

test("disabled input also gates the native non-smoothed mouse path", async (t) => {
  const f = fixture(t, { lookSmoothing: 0 });
  await f.controls.lock();
  f.key("KeyW");
  f.controls.enabled = false;
  emit(f.doc, "mousemove", { movementX: 100, movementY: 30 });
  f.frames();
  assert.equal(f.camera.quaternion.y, 0);
  assert.equal(f.camera.position.z, 0);
  f.controls.enabled = true; f.frames();
  assert.equal(f.camera.position.z, 0);
  emit(f.doc, "mousemove", { movementX: 100, movementY: 30 });
  assert.notEqual(f.camera.quaternion.y, 0);
});

test("blur and hiding clear input; releasing the pointer on blur is configurable", async (t) => {
  const f = fixture(t);
  await f.controls.lock(); f.key("KeyW");
  f.doc.focused = false;
  emit(f.doc.defaultView, "blur"); f.frames();
  assert.equal(f.controls.isLocked, false);
  assert.equal(f.camera.position.z, 0);
  f.doc.focused = true; emit(f.doc.defaultView, "focus");
  f.controls.applyInputConfig({ releaseOnBlur: false });
  await f.controls.lock(); f.key("KeyW");
  f.doc.visibilityState = "hidden"; emit(f.doc, "visibilitychange"); f.frames();
  assert.equal(f.controls.isLocked, true);
  assert.equal(f.controls.inputActive, false);
  f.doc.visibilityState = "visible"; emit(f.doc, "visibilitychange"); f.frames();
  assert.equal(f.controls.inputActive, true);
  assert.equal(f.camera.position.z, 0);
});

test("dispose releases owned pointer lock, restores tabindex and removes all listeners", async (t) => {
  const f = fixture(t);
  await f.controls.lock();
  assert.equal(f.canvas.getAttribute("tabindex"), "-1");
  f.controls.dispose();
  assert.equal(f.doc.pointerLockElement, null);
  assert.equal(f.canvas.hasAttribute("tabindex"), false);
  assert.equal(f.doc.listenerCount + f.doc.defaultView.listenerCount + f.canvas.listenerCount, 0);
  assert.equal(await f.controls.lock(), false);
  f.doc.grant(f.doc.createElement("canvas"));
  f.controls.dispose();
  assert.notEqual(f.doc.pointerLockElement, null);
});

test("lock returns a result for legacy void APIs and only requests once while pending", async (t) => {
  const f = fixture(t);
  let requests = 0;
  f.canvas.requestPointerLock = () => { requests++; };
  const result = f.controls.lock();
  assert.equal(f.controls.lock(), result);
  assert.equal(requests, 1);
  assert.equal(f.controls.getInputState().lockPending, true);
  f.doc.grant(f.canvas);
  assert.equal(await result, true);
  assert.equal(f.controls.getInputState().lockPending, false);
});

test("rejected, throwing and unsupported pointer lock report errors without unhandled rejections", async (t) => {
  const f = fixture(t);
  const errors = [];
  f.controls.addEventListener("lockerror", ({ error }) => errors.push(error));
  f.canvas.requestPointerLock = () => Promise.reject(new Error("denied"));
  assert.equal(await f.controls.lock(), false);
  f.canvas.requestPointerLock = () => { throw new Error("gesture required"); };
  assert.equal(await f.controls.lock(), false);
  f.canvas.requestPointerLock = undefined;
  assert.equal(await f.controls.lock(), false);
  assert.equal(errors.length, 3);
  assert.equal(errors[2].code, "E_POINTER_LOCK_UNAVAILABLE");
  f.canvas.requestPointerLock = () => { f.doc.grant(f.canvas); return Promise.resolve(); };
  assert.equal(await f.controls.lock(), true);
});

test("cancelled or disposed pending lock cannot grab the mouse later", async (t) => {
  const f = fixture(t);
  f.canvas.requestPointerLock = () => undefined;
  let result = f.controls.lock();
  f.controls.unlock();
  assert.equal(await result, false);
  f.doc.grant(f.canvas);
  assert.equal(f.doc.pointerLockElement, null);
  result = f.controls.lock();
  f.controls.dispose();
  assert.equal(await result, false);
  const otherCanvas = f.doc.createElement("canvas");
  f.doc.grant(otherCanvas);
  assert.equal(f.doc.pointerLockElement, otherCanvas, "unrelated lock changes must not consume a late-grant observer");
  f.doc.grant(f.canvas);
  assert.equal(f.doc.pointerLockElement, null);
  assert.equal(f.doc.listenerCount, 0, "temporary late-grant observers are removed");
});

test("late grant observers from an old controller do not unlock its replacement", async (t) => {
  const f = fixture(t);
  f.canvas.requestPointerLock = () => undefined;
  const oldRequest = f.controls.lock();
  f.controls.dispose();
  assert.equal(await oldRequest, false);
  const replacement = createControlsFromDescriptor(new PerspectiveCamera(), f.canvas, { type: "firstPerson" });
  t.after(() => replacement.dispose());
  const nextRequest = replacement.lock();
  f.doc.grant(f.canvas);
  assert.equal(await nextRequest, true);
  assert.equal(f.doc.pointerLockElement, f.canvas);
});

test("runtime controls configuration forwards the host input policy", (t) => {
  const f = fixture(t);
  applyControlsConfig(f.controls, { inputMode: "manual", inputActive: true, lockOnClick: false });
  assert.equal(f.controls.inputActive, true);
  emit(f.canvas, "click");
  assert.equal(f.controls.isLocked, false);
  assert.throws(() => f.controls.setInputMode("surprise"), /Unknown first-person inputMode/);
});

test("Shower alone implements click / Escape / continue, without changing scene configuration", async (t) => {
  const f = fixture(t, { inputMode: "manual", inputActive: true });
  const originalConfig = structuredClone(f.controls.threeJsonControlsConfig);
  const v = view(t, f);
  assert.equal(v.root.hidden, false);
  assert.equal(v.button.textContent, "zh:walkEnter");
  assert.equal(f.controls.getInputState().inputMode, "locked");
  emit(v.button, "click");
  assert.equal(v.root.dataset.state, "walking");
  assert.equal(v.panel.hidden, true);
  assert.equal(v.hint.hidden, false);
  f.key("KeyW"); f.frames();
  const z = f.camera.position.z;
  f.key("Escape"); f.frames();
  assert.equal(f.doc.pointerLockElement, null);
  assert.equal(v.root.dataset.state, "paused");
  assert.equal(v.button.textContent, "zh:walkResume");
  assert.equal(f.camera.position.z, z);
  assert.equal(f.controls.enabled, true, "pausing walk is not disabling the scene renderer");
  v.translate("en");
  assert.equal(v.button.textContent, "en:walkResume");
  emit(v.button, "click"); f.frames();
  assert.equal(v.root.dataset.state, "walking");
  assert.equal(f.camera.position.z, z);
  f.doc.grant(null);
  assert.equal(v.root.dataset.state, "paused", "browser-only Escape updates the UI too");
  assert.deepEqual(f.controls.threeJsonControlsConfig, originalConfig);
});

test("Shower unlocked focus mode can pause and continue without Pointer Lock API", (t) => {
  const f = fixture(t, { pointerLock: false });
  f.canvas.requestPointerLock = undefined;
  const v = view(t, f);
  assert.equal(v.button.disabled, false);
  emit(v.button, "click");
  assert.equal(f.controls.inputActive, true);
  f.key("Escape");
  assert.equal(f.controls.inputActive, false);
  assert.equal(v.button.textContent, "zh:walkResume");
  emit(v.button, "click");
  assert.equal(f.controls.inputActive, true);
});

test("Shower handles denied lock and can retry; loading failure restores existing input", async (t) => {
  const f = fixture(t);
  const v = view(t, f);
  f.canvas.requestPointerLock = () => Promise.reject(new Error("denied"));
  emit(v.button, "click");
  await Promise.resolve();
  assert.equal(v.error.hidden, false);
  assert.equal(v.button.disabled, false);
  f.canvas.requestPointerLock = () => { f.doc.grant(f.canvas); return Promise.resolve(); };
  emit(v.button, "click");
  assert.equal(v.error.hidden, true);
  v.ui.setLoading(true);
  assert.equal(f.controls.inputActive, false);
  assert.equal(v.button.disabled, true);
  emit(f.canvas, "click");
  assert.equal(f.controls.isLocked, false);
  v.ui.setLoading(false); // failed preparation keeps the previously committed runtime
  assert.equal(f.controls.enabled, true);
  assert.equal(v.button.disabled, false);
  emit(v.button, "click");
  assert.equal(f.controls.isLocked, true);
});

test("Shower scene switch releases input, removes its UI for orbit and restores disabled state", async (t) => {
  const f = fixture(t);
  const v = view(t, f);
  await f.controls.lock();
  v.ui.setRuntime({ controls: { threeJsonControlsKind: "orbit" } });
  assert.equal(f.controls.isLocked, false);
  assert.equal(v.root.hidden, true);
  v.ui.setRuntime({ controls: f.controls });
  f.controls.enabled = false;
  v.ui.setLoading(true); v.ui.setLoading(false);
  assert.equal(f.controls.enabled, false, "loading does not override an initially disabled control");
  v.ui.dispose();
  assert.equal(v.root.parentElement, null);
});
