import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as THREE from "three";
import { createCanvasRenderActivity as createToolActivity } from "../tools/scene-host/shared/js/canvasRenderActivity.js";
import { createCanvasRenderActivity as createPackageActivity } from "../packages/host-kit/js/canvasRenderActivity.js";
import { captureMeshReviewViews as captureToolViews } from "../tools/scene-host/shared/js/meshViewCapture.js";
import { captureMeshReviewViews as capturePackageViews } from "../packages/host-kit/js/meshViewCapture.js";

function installActivityDom() {
  const previous = {
    document: globalThis.document,
    IntersectionObserver: globalThis.IntersectionObserver,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight
  };
  const listeners = new Map();
  const document = {
    hidden: false,
    documentElement: { clientWidth: 1280, clientHeight: 720 },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) {
      if (listeners.get(name) === listener) listeners.delete(name);
    }
  };
  let observer = null;
  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe(target) { this.target = target; }
    disconnect() { this.target = null; }
    emit(isIntersecting) {
      this.callback([{ target: this.target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }]);
    }
  }
  globalThis.document = document;
  globalThis.IntersectionObserver = FakeIntersectionObserver;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
  return {
    document,
    getObserver: () => observer,
    emitVisibility: () => listeners.get("visibilitychange")?.(),
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    }
  };
}

for (const [name, createActivity] of [
  ["native host", createToolActivity],
  ["package host", createPackageActivity]
]) {
  test(`${name} pauses offscreen scene-card render loops`, () => {
    const dom = installActivityDom();
    try {
      const calls = { start: 0, stop: 0, render: 0 };
      const runtime = {
        start() { calls.start += 1; },
        stop() { calls.stop += 1; },
        renderOnce() { calls.render += 1; }
      };
      const element = {
        isConnected: true,
        getBoundingClientRect: () => ({ left: 10, top: 10, right: 650, bottom: 370, width: 640, height: 360 })
      };
      const activity = createActivity({ element, getRuntime: () => runtime });
      activity.start();
      assert.equal(calls.start, 1);
      assert.equal(calls.render, 1);

      dom.getObserver().emit(false);
      assert.equal(calls.stop, 1);
      dom.getObserver().emit(true);
      assert.equal(calls.start, 2);
      assert.equal(calls.render, 2);

      dom.document.hidden = true;
      dom.emitVisibility();
      assert.equal(calls.stop, 2);
      activity.dispose();
      assert.ok(calls.stop >= 3);
    } finally {
      dom.restore();
    }
  });
}

function installCaptureCanvas() {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(name) {
      assert.equal(name, "canvas");
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
          putImageData() {}
        }),
        toDataURL: (mimeType) => `data:${mimeType};base64,AA==`
      };
    }
  };
  return () => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  };
}

function createFakeRenderer() {
  const initial = {
    target: { id: "screen-composer-target" },
    activeCubeFace: 2,
    activeMipmapLevel: 3,
    viewport: new THREE.Vector4(7, 11, 640, 360),
    scissor: new THREE.Vector4(13, 17, 320, 180),
    scissorTest: true,
    clearColor: new THREE.Color("#123456"),
    clearAlpha: 0.35,
    autoClear: true,
    autoClearColor: false,
    autoClearDepth: true,
    autoClearStencil: false,
    xrEnabled: true
  };
  const state = {
    target: initial.target,
    activeCubeFace: initial.activeCubeFace,
    activeMipmapLevel: initial.activeMipmapLevel,
    viewport: initial.viewport.clone(),
    scissor: initial.scissor.clone(),
    scissorTest: initial.scissorTest,
    clearColor: initial.clearColor.clone(),
    clearAlpha: initial.clearAlpha
  };
  const renderer = {
    isWebGLRenderer: true,
    outputColorSpace: THREE.SRGBColorSpace,
    xr: { enabled: initial.xrEnabled },
    autoClear: initial.autoClear,
    autoClearColor: initial.autoClearColor,
    autoClearDepth: initial.autoClearDepth,
    autoClearStencil: initial.autoClearStencil,
    getRenderTarget: () => state.target,
    getActiveCubeFace: () => state.activeCubeFace,
    getActiveMipmapLevel: () => state.activeMipmapLevel,
    getViewport: (target) => target.copy(state.viewport),
    getScissor: (target) => target.copy(state.scissor),
    getScissorTest: () => state.scissorTest,
    getClearColor: (target) => target.copy(state.clearColor),
    getClearAlpha: () => state.clearAlpha,
    setRenderTarget(target, face = 0, level = 0) {
      state.target = target;
      state.activeCubeFace = face;
      state.activeMipmapLevel = level;
    },
    setViewport(a, b, c, d) { state.viewport = a?.isVector4 ? a.clone() : new THREE.Vector4(a, b, c, d); },
    setScissor(a, b, c, d) { state.scissor = a?.isVector4 ? a.clone() : new THREE.Vector4(a, b, c, d); },
    setScissorTest(value) { state.scissorTest = value; },
    setClearColor(value, alpha) { state.clearColor.set(value); state.clearAlpha = alpha; },
    clear() {},
    render() {},
    readRenderTargetPixels(_target, _x, _y, _width, _height, pixels) { pixels.fill(128); }
  };
  return { renderer, state, initial };
}

for (const [name, captureViews] of [
  ["native host", captureToolViews],
  ["package host", capturePackageViews]
]) {
  test(`${name} mesh review capture restores every shared renderer state`, async () => {
    const restoreDocument = installCaptureCanvas();
    try {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
      const { renderer, state, initial } = createFakeRenderer();
      const result = await captureViews({ object3D: mesh, renderer, views: ["front"], size: 32 });
      assert.equal(result.views.length, 1);
      assert.equal(state.target, initial.target);
      assert.equal(state.activeCubeFace, initial.activeCubeFace);
      assert.equal(state.activeMipmapLevel, initial.activeMipmapLevel);
      assert.deepEqual(state.viewport.toArray(), initial.viewport.toArray());
      assert.deepEqual(state.scissor.toArray(), initial.scissor.toArray());
      assert.equal(state.scissorTest, initial.scissorTest);
      assert.equal(state.clearColor.getHex(), initial.clearColor.getHex());
      assert.equal(state.clearAlpha, initial.clearAlpha);
      assert.equal(renderer.autoClear, initial.autoClear);
      assert.equal(renderer.autoClearColor, initial.autoClearColor);
      assert.equal(renderer.autoClearDepth, initial.autoClearDepth);
      assert.equal(renderer.autoClearStencil, initial.autoClearStencil);
      assert.equal(renderer.xr.enabled, initial.xrEnabled);
      mesh.geometry.dispose();
      mesh.material.dispose();
    } finally {
      restoreDocument();
    }
  });
}

test("ThreeBox avoids WebGL backdrop filtering and overlapping thumbnail renderers", async () => {
  const [nativeCss, appCss, packageCss, nativeThumbs, appThumbs] = await Promise.all([
    readFile(new URL("../tools/scene-host/threebox/css/threebox.css", import.meta.url), "utf8"),
    readFile(new URL("../apps/threebox/src/threebox.css", import.meta.url), "utf8"),
    readFile(new URL("../packages/react-scene-agent/src/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../tools/scene-host/threebox/js/threeBoxTemplateGallery.js", import.meta.url), "utf8"),
    readFile(new URL("../apps/threebox/src/lib/threeBoxTemplateThumbnails.js", import.meta.url), "utf8")
  ]);
  for (const css of [nativeCss, appCss]) {
    const sceneCardCss = css.slice(css.indexOf(".sceneCardCanvasWrap"), css.indexOf("/* ---- Scene card action bar"));
    assert.match(sceneCardCss, /contain:\s*paint/);
    assert.doesNotMatch(sceneCardCss, /backdrop-filter/);
  }
  assert.match(packageCss, /contain:\s*paint/);
  assert.doesNotMatch(packageCss, /backdrop-filter/);
  for (const source of [nativeThumbs, appThumbs]) {
    assert.match(source, /hasVisibleForegroundSceneCanvas/);
    assert.doesNotMatch(source, /return\s+Promise\.race|\bwithTimeout\s*\(/);
    assert.match(source, /finally\s*\{\s*activeRuntime\?\.dispose\?\.\(\)/);
  }
});
