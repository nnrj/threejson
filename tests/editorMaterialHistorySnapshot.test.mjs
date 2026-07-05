/**
 * 镜像 scene-editor 内历史快照辅助逻辑（仅测试用，不进入 core）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { detectRuntimeMaterialsArray } from "../core/util/descriptorExportSanitize.js";
import { resolveTextureSource } from "../core/util/resolveTextureSource.js";

function cloneJsonDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function boxUsesIntentionalMaterialsArray(data) {
  if (!data || typeof data !== "object") {
    return false;
  }
  if (!Array.isArray(data.materials) || data.materials.length !== 6) {
    return false;
  }
  return !detectRuntimeMaterialsArray(data);
}

function normalizeDescriptorForHistorySnapshot(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    return descriptor;
  }
  const out = cloneJsonDeep(descriptor);
  if (detectRuntimeMaterialsArray(out)) {
    delete out.materials;
  }
  const mat = out.material;
  if (mat && typeof mat === "object" && typeof mat.textureUrl === "string" && !mat.textureUrl.trim()) {
    delete mat.textureUrl;
    if (Object.keys(mat).length === 0) {
      delete out.material;
    }
  }
  if (Array.isArray(out.materials) && out.materials.length === 6 && !out.material) {
    return out;
  }
  if (mat && Array.isArray(out.materials) && out.materials.length === 6) {
    const orphanEmptyMaterial =
      typeof mat.textureUrl === "string" &&
      !mat.textureUrl.trim() &&
      !resolveTextureSource(mat) &&
      (mat.color === undefined || mat.color === "");
    if (orphanEmptyMaterial) {
      delete out.material;
    }
  }
  return out;
}

function sixFaceFixture() {
  return {
    objType: "box",
    threeJsonId: "tj-six",
    name: "six-face",
    materials: [
      { type: "standard", textureUrl: "/face0.png", color: "#111111" },
      { type: "standard", textureUrl: "/face1.png", color: "#222222" },
      { type: "standard", textureUrl: "/face2.png", color: "#333333" },
      { type: "standard", textureUrl: "/face3.png", color: "#444444" },
      { type: "standard", textureUrl: "/face4.png", color: "#555555" },
      { type: "standard", textureUrl: "/face5.png", color: "#666666" }
    ]
  };
}

test("boxUsesIntentionalMaterialsArray: distinct six-face urls", () => {
  assert.equal(boxUsesIntentionalMaterialsArray(sixFaceFixture()), true);
});

test("boxUsesIntentionalMaterialsArray: runtime expanded six-face is false", () => {
  const material = { type: "standard", textureUrl: "/same.png" };
  const runtimeExpanded = {
    material,
    materials: [material, material, material, material, material, material]
  };
  assert.equal(boxUsesIntentionalMaterialsArray(runtimeExpanded), false);
});

test("normalizeDescriptorForHistorySnapshot keeps intentional six-face materials", () => {
  const before = sixFaceFixture();
  const norm = normalizeDescriptorForHistorySnapshot(before);
  assert.equal(norm.materials.length, 6);
  assert.equal(norm.materials[1].textureUrl, "/face1.png");
  assert.equal(norm.materials[1].color, "#222222");
});

test("six-face color edit snapshot preserves per-face textureUrl (undo/redeploy path)", () => {
  const before = normalizeDescriptorForHistorySnapshot(sixFaceFixture());
  const afterLive = cloneJsonDeep(before);
  afterLive.materials[1].color = "#aabbcc";
  const after = normalizeDescriptorForHistorySnapshot(afterLive);
  assert.equal(after.materials[1].color, "#aabbcc");
  assert.equal(after.materials[1].textureUrl, "/face1.png");
  assert.equal(after.materials[0].textureUrl, "/face0.png");
  assert.equal(boxUsesIntentionalMaterialsArray(after), true);
});
