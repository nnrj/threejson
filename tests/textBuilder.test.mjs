import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import {
  resolveTextRecord,
  resolveTextMode,
  anchorToTroikaPercents,
  sceneNeedsSdfText
} from "../core/builder/text/textStyleShared.js";
import {
  resolveSceneTextFont,
  resolveTextFontConfig
} from "../core/builder/text/fontResolver.js";
import { createText, createTextAsync } from "../core/builder/textBuilder.js";

describe("textStyleShared", () => {
  it("defaults mode to sdf", () => {
    assert.equal(resolveTextMode({}), "sdf");
    assert.equal(resolveTextMode({ mode: "texture" }), "texture");
    assert.equal(resolveTextMode({ mode: "mesh" }), "mesh");
    assert.equal(resolveTextMode({ mode: "invalid" }), "sdf");
  });

  it("resolveTextRecord normalizes anchor and align", () => {
    const resolved = resolveTextRecord({
      content: "Hello",
      align: "CENTER",
      anchor: { x: 0.25, y: 0.75 },
      fontSize: 0.5
    });
    assert.equal(resolved.content, "Hello");
    assert.equal(resolved.align, "center");
    assert.equal(resolved.anchor.x, 0.25);
    assert.equal(resolved.anchor.y, 0.75);
    assert.equal(resolved.fontSize, 0.5);
    assert.equal(resolved.mode, "sdf");
  });

  it("anchorToTroikaPercents maps 0..1 to percentage strings", () => {
    assert.deepEqual(anchorToTroikaPercents({ x: 0.5, y: 0.5 }), {
      anchorX: "50%",
      anchorY: "50%"
    });
  });

  it("sceneNeedsSdfText detects sdf text and preloadCharacters", () => {
    assert.equal(sceneNeedsSdfText({}, []), false);
    assert.equal(
      sceneNeedsSdfText(
        {},
        [{ objType: "text", mode: "texture", content: "a" }]
      ),
      false
    );
    assert.equal(
      sceneNeedsSdfText(
        {},
        [{ objType: "text", content: "中文" }]
      ),
      true
    );
    assert.equal(
      sceneNeedsSdfText({ textFont: { preloadCharacters: "测" } }, []),
      true
    );
  });
});

describe("createText degradation", () => {
  it("mesh mode falls back to texture when mesh.fontJsonUrl is missing", async () => {
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
    try {
      const parent = new THREE.Group();
      const result = await createTextAsync(parent, {
        objType: "text",
        mode: "mesh",
        content: "Fallback",
        fontSize: 1,
        name: "mesh-fallback-test",
        texture: { backgroundColor: "transparent" }
      });
      assert.ok(result);
      assert.equal(parent.children.length, 1);
      assert.equal(parent.children[0].userData?.objJson?.mode, "texture");
    } finally {
      if (priorDocument === undefined) {
        delete globalThis.document;
      } else {
        globalThis.document = priorDocument;
      }
    }
  });
});

describe("fontResolver", () => {
  it("per-object sdf.fontUrl overrides scene default", () => {
    const sceneConfig = {
      textFont: {
        fontUrl: "https://cdn.example.com/scene.woff",
        unicodeFontsUrl: "https://cdn.example.com/unicode/"
      }
    };
    const config = resolveTextFontConfig(
      { sdf: { fontUrl: "/assets/local.woff" } },
      sceneConfig
    );
    assert.equal(config.fontUrl, "/assets/local.woff");
    assert.equal(config.unicodeFontsUrl, "https://cdn.example.com/unicode/");
  });

  it("defaults to null fontUrl when unset", () => {
    const scene = resolveSceneTextFont({});
    assert.equal(scene.fontUrl, null);
    assert.equal(scene.unicodeFontsUrl, null);
    const config = resolveTextFontConfig({}, {});
    assert.equal(config.fontUrl, null);
  });

  it("inherits scene textFont when object sdf omits fields", () => {
    const config = resolveTextFontConfig(
      {},
      { textFont: { fontUrl: "https://fonts.example/a.woff", fontWeight: "bold" } }
    );
    assert.equal(config.fontUrl, "https://fonts.example/a.woff");
    assert.equal(config.fontWeight, "bold");
  });
});
