import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createRenderLoop,
  resizeRendererToDisplaySize
} from "../core/handler/frameLoopHandler.js";

function createPerspectiveCamera() {
  return {
    aspect: 1,
    projectionUpdates: 0,
    updateProjectionMatrix() {
      this.projectionUpdates += 1;
    }
  };
}

test("display resize compares CSS pixels against the DPR-scaled drawing buffer", () => {
  const calls = [];
  const renderer = {
    domElement: { clientWidth: 320, clientHeight: 200, width: 640, height: 400 },
    getPixelRatio: () => 2,
    setSize: (...args) => calls.push(args)
  };
  const camera = createPerspectiveCamera();

  assert.equal(resizeRendererToDisplaySize(renderer, camera), false);
  assert.deepEqual(calls, []);
  assert.equal(camera.projectionUpdates, 0);
});

test("display resize ignores transient zero-sized layouts", () => {
  const renderer = {
    domElement: { clientWidth: 0, clientHeight: 0, width: 640, height: 400 },
    getPixelRatio: () => 2,
    setSize: () => assert.fail("zero-sized canvas must not be resized")
  };

  assert.equal(resizeRendererToDisplaySize(renderer, createPerspectiveCamera()), false);
});

test("manual render-loop resize can preserve responsive canvas CSS", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 2, innerWidth: 900, innerHeight: 600 };
  try {
    const calls = [];
    const renderer = {
      setPixelRatio: (ratio) => calls.push(["pixelRatio", ratio]),
      setSize: (width, height, updateStyle) => calls.push(["size", width, height, updateStyle])
    };
    const camera = createPerspectiveCamera();
    const loop = createRenderLoop({
      renderer,
      camera,
      config: { ratioRate: 0.75 }
    });

    loop.resize({ width: 320, height: 200, updateStyle: false });

    assert.deepEqual(calls, [
      ["pixelRatio", 1.5],
      ["size", 320, 200, false]
    ]);
    assert.equal(camera.aspect, 1.6);
    assert.equal(camera.projectionUpdates, 1);
  } finally {
    globalThis.window = previousWindow;
  }
});
