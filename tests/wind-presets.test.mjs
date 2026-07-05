import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWindPlaneRecord,
  isWindHandler,
  resolveWindHandlerFromRecord,
  WIND_HANDLER_PRESETS
} from "../domains/weather/windPresets.js";

test("isWindHandler recognizes wind strip presets", () => {
  assert.equal(isWindHandler("wind"), true);
  assert.equal(isWindHandler("wind_cold_left.png"), true);
  assert.equal(isWindHandler("wind_hot_left.png"), true);
  assert.equal(isWindHandler("rain"), false);
});

test("buildWindPlaneRecord merges overrides and sets objType wind", () => {
  const rec = buildWindPlaneRecord("coldwind", {
    speed: 2,
    position: { x: 1, y: 2, z: 3 },
    geometry: { width: 8, height: 30 }
  });
  assert.ok(rec);
  assert.equal(rec.objType, "wind");
  assert.equal(rec.speed, 2);
  assert.equal(rec.position.x, 1);
  assert.equal(String(rec.material.textureUrl).includes("wind_cold"), true);
});

test("resolveWindHandlerFromRecord infers hotwind from texture", () => {
  assert.equal(
    resolveWindHandlerFromRecord({
      objType: "wind",
      material: { textureUrl: "/assets/textures/environment/nature/weather/wind_hot_left.png" }
    }),
    "hotwind"
  );
});

test("cold and hot presets use distinct textures", () => {
  assert.ok(String(WIND_HANDLER_PRESETS.coldwind.material.textureUrl).includes("wind_cold"));
  assert.ok(String(WIND_HANDLER_PRESETS.hotwind.material.textureUrl).includes("wind_hot"));
});

test("visualScale enlarges mesh scale and lowers texture repeat density", () => {
  const rec = buildWindPlaneRecord("wind", {
    visualScale: 4,
    geometry: { width: 10, height: 20 },
    material: {
      textureRepeat: { x: 0.4, y: 8 }
    }
  });
  assert.equal(rec.visualScale, 4);
  assert.equal(rec.scale.scaleX, 4);
  assert.equal(rec.scale.scaleY, 4);
  assert.equal(rec.material.textureRepeat.x, 0.1);
  assert.equal(rec.material.textureRepeat.y, 2);
  assert.equal(rec.geometry.width, 10);
});
