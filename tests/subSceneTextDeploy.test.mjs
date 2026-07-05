import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { deployGroupDescriptor } from "../core/handler/objectLoadHandler.js";

function installMinimalDocument() {
  const priorDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      const ctx = {
        scale() {},
        fillRect() {},
        fillText() {},
        measureText() {
          return { width: 48 };
        },
        font: ""
      };
      return {
        width: 256,
        height: 128,
        style: {},
        getContext() {
          return ctx;
        }
      };
    }
  };
  return () => {
    if (priorDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = priorDocument;
    }
  };
}

function countTextFallbackBoxes(root) {
  let count = 0;
  root.traverse((obj) => {
    if (!obj.isMesh || obj.geometry?.type !== "BoxGeometry") {
      return;
    }
    if (obj.userData?.objJson?.objType === "text") {
      count++;
    }
  });
  return count;
}

test("subScene texture text deploys without fallback box mesh", () => {
  const restoreDocument = installMinimalDocument();
  try {
    const scene = new THREE.Scene();
    const group = deployGroupDescriptor(scene, {
      name: "label-group",
      objType: "group",
      subScene: [
        {
          name: "label-texture",
          objType: "text",
          mode: "texture",
          content: "Q1",
          fontSize: 28,
          texture: { backgroundColor: "transparent" }
        }
      ]
    });
    assert.ok(group);
    assert.equal(countTextFallbackBoxes(group), 0);
    assert.ok(
      group.children.some((child) => child.userData?.objJson?.mode === "texture")
    );
  } finally {
    restoreDocument();
  }
});

test("subScene sdf text async deploy flushes to parent without fallback box", async () => {
  const restoreDocument = installMinimalDocument();
  try {
    const scene = new THREE.Scene();
    const group = deployGroupDescriptor(scene, {
      name: "label-group-sdf",
      objType: "group",
      subScene: [
        {
          name: "label-sdf",
          objType: "text",
          mode: "sdf",
          content: "Q1",
          fontSize: 0.85,
          billboard: true
        }
      ]
    });
    assert.ok(group);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(countTextFallbackBoxes(group), 0);
  } finally {
    restoreDocument();
  }
});
