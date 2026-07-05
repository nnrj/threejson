import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCameraFromDescriptor,
  resolveCameraType,
  applyCameraDescriptor,
  resizeOrthographicCameraToAspect
} from "../core/util/cameraFactory.js";

test("resolveCameraType", () => {
  assert.equal(resolveCameraType({}), "perspective");
  assert.equal(resolveCameraType({ type: "orthographic" }), "orthographic");
  assert.equal(resolveCameraType({ type: "ortho" }), "orthographic");
});

test("createCameraFromDescriptor orthographic", () => {
  const camera = createCameraFromDescriptor(
    { type: "orthographic", left: -10, right: 10, top: 5, bottom: -5, near: 0.1, far: 100 },
    800,
    600
  );
  assert.equal(camera.isOrthographicCamera, true);
  assert.equal(camera.left, -10);
  assert.equal(camera.right, 10);
});

test("applyCameraDescriptor updates orthographic bounds", () => {
  const camera = createCameraFromDescriptor({ type: "orthographic" }, 100, 100);
  applyCameraDescriptor(camera, { left: -20, right: 20, top: 15, bottom: -15, zoom: 2 });
  assert.equal(camera.left, -20);
  assert.equal(camera.zoom, 2);
});

test("createCameraFromDescriptor applies lookAt", () => {
  const camera = createCameraFromDescriptor(
    {
      type: "orthographic",
      position: { x: 10, y: 10, z: 10 },
      lookAt: { x: 0, y: 0, z: 0 }
    },
    800,
    600
  );
  assert.ok(Math.abs(camera.rotation.y) > 0.01);
});

test("resizeOrthographicCameraToAspect keeps world height not pixels", () => {
  const camera = createCameraFromDescriptor(
    { type: "orthographic", top: 40, bottom: -40, left: -70, right: 70 },
    800,
    600
  );
  resizeOrthographicCameraToAspect(camera, 1920, 1080);
  assert.equal(camera.top, 40);
  assert.equal(camera.bottom, -40);
  assert.ok(camera.right > 40);
});
