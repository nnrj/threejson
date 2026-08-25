import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createLightBundleFromDescriptor } from "../core/builder/lightFactory.js";
import { extractLightsConfigFromScene } from "../core/util/sceneRuntimeConfigExport.js";

test("RectAreaLight is a first-class scene light and round-trips", () => {
  const { light, attachments, type } = createLightBundleFromDescriptor({
    type: "rect-area-light",
    color: "#ffeecc",
    intensity: 3,
    width: 4,
    height: 2,
    position: { x: 1, y: 4, z: 3 },
    target: { x: 0, y: 0, z: 0 }
  });
  assert.equal(type, "rectarea");
  assert.equal(light.isRectAreaLight, true);
  assert.equal(light.width, 4);
  assert.equal(light.height, 2);
  assert.deepEqual(attachments, []);

  const scene = new THREE.Scene();
  scene.add(light);
  const [saved] = extractLightsConfigFromScene(scene);
  assert.equal(saved.type, "rectarea");
  assert.equal(saved.width, 4);
  assert.equal(saved.height, 2);
});

test("SpotLight target remains an explicit scene attachment", () => {
  const { light, attachments } = createLightBundleFromDescriptor({
    type: "spot",
    target: { x: 1, y: 2, z: 3 }
  });
  assert.equal(light.isSpotLight, true);
  assert.equal(attachments.length, 1);
  assert.equal(light.target, attachments[0]);
});

test("unknown light types fail before a scene silently loses illumination", () => {
  assert.throws(
    () => createLightBundleFromDescriptor({ type: "not-registered" }),
    (error) => error?.code === "E_LIGHT_TYPE_UNAVAILABLE"
  );
});
