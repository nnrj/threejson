import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeScenePayload } from "../core/handler/sceneFriendlyNormalizer.js";

test("normalizes friendly material.map.url to material.textureUrl", () => {
  const normalized = normalizeScenePayload({
    threeJsonId: "texture-alias",
    sceneConfig: {},
    objectList: [{
      objType: "box",
      material: {
        type: "standard",
        color: "#ffffff",
        map: { url: " https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg " }
      }
    }]
  });
  assert.equal(
    normalized.objectList[0].material.textureUrl,
    "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg"
  );
  assert.equal(normalized.objectList[0].material.map, undefined);
});

test("preserves textureRepeat when it is supplied inside the legacy map", () => {
  const normalized = normalizeScenePayload({
    threeJsonId: "texture-repeat-alias",
    sceneConfig: {},
    objectList: [{
      objType: "plane",
      material: { map: { url: "https://example.com/floor.jpg", repeat: { x: 4, y: 2 } } }
    }]
  });
  assert.deepEqual(normalized.objectList[0].material.textureRepeat, { x: 4, y: 2 });
});

test("does not rewrite native material map structures", () => {
  const nativeMap = { url: "https://example.com/native.jpg", uuid: "texture-1" };
  const normalized = normalizeScenePayload({
    threeJsonId: "native-map",
    sceneConfig: {},
    objectList: [{ objType: "native", material: { map: nativeMap } }]
  });
  assert.deepEqual(normalized.objectList[0].material.map, nativeMap);
  assert.equal(normalized.objectList[0].material.textureUrl, undefined);
});
