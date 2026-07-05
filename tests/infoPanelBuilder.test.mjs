import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  normalizeInfoPanelDescriptor,
  createInfoPanelDescriptor,
  buildInfoPanelObject,
  applyInfoPanelTextureDefaults,
  configureInfoPanelForDeploy,
  getInfoPanelMaxInFlightAsync,
  _resetInfoPanelDeployConfigForTests
} from "../core/builder/infoPanelBuilder.js";
import { applyOpacityToColor } from "../core/util/textureUtils.js";

test("applyInfoPanelTextureDefaults configures UI-friendly texture sampling", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  applyInfoPanelTextureDefaults(texture, {});
  assert.equal(texture.generateMipmaps, false);
  assert.equal(texture.minFilter, THREE.LinearFilter);
  assert.equal(texture.magFilter, THREE.LinearFilter);
  assert.equal(texture.anisotropy, 4);
  if (THREE.SRGBColorSpace !== undefined) {
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  }
});

test("applyInfoPanelTextureDefaults honors textureAnisotropy override", () => {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  applyInfoPanelTextureDefaults(texture, { textureAnisotropy: 8 });
  assert.equal(texture.anisotropy, 8);
});

test("createInfoPanelDescriptor builds normalized descriptor from text and position", () => {
  const out = createInfoPanelDescriptor("cab-01", { x: 1, y: 2, z: 3 }, {
    panelBoxType: "sprite",
    color: "#fff"
  });
  assert.equal(out.text, "cab-01");
  assert.equal(out.panelBoxType, "sprite");
  assert.equal(out.panel.position.x, 1);
  assert.equal(out.panel.position.y, 2);
  assert.equal(out.panel.position.z, 3);
  assert.equal(out.color, "#fff");
});

test("normalizeInfoPanelDescriptor fills panelBoxType and type defaults", () => {
  const out = normalizeInfoPanelDescriptor({
    text: "hello",
    panel: { position: { x: 1, y: 2, z: 3 } }
  });
  assert.equal(out.panelBoxType, "box");
  assert.equal(out.type, "text");
  assert.equal(out.panelWidth, 10);
  assert.equal(out.panel.position.x, 1);
  assert.equal(out.boxType, "box");
});

test("normalizeInfoPanelDescriptor defaults textAlign to left for text panels", () => {
  const out = normalizeInfoPanelDescriptor({ text: "hello" });
  assert.equal(out.textAlign, "left");
  assert.equal(out.textVerticalAlign, "top");
});

test("normalizeInfoPanelDescriptor preserves optional textAlign", () => {
  const out = normalizeInfoPanelDescriptor({ text: "hello", textAlign: "center" });
  assert.equal(out.textAlign, "center");
});

test("normalizeInfoPanelDescriptor preserves optional textVerticalAlign", () => {
  const out = normalizeInfoPanelDescriptor({ text: "hello", textVerticalAlign: "middle" });
  assert.equal(out.textVerticalAlign, "middle");
});

test("normalizeInfoPanelDescriptor maps legacy boxType to panelBoxType", () => {
  const out = normalizeInfoPanelDescriptor({
    text: "x",
    boxType: "sprite",
    type: "html"
  });
  assert.equal(out.panelBoxType, "sprite");
  assert.equal(out.type, "html");
});

test("buildInfoPanelObject routes sprite carrier", () => {
  const descriptor = normalizeInfoPanelDescriptor({
    text: "sprite",
    panelBoxType: "sprite",
    panelWidth: 20,
    panelHeight: 10,
    panel: { position: { x: 0, y: 0, z: 0 } }
  });
  const fakeTexture = { isTexture: true };
  const sprite = buildInfoPanelObject(descriptor, fakeTexture);
  assert.equal(sprite.isSprite, true);
  assert.equal(sprite.name, "infoPanel");
});

test("buildInfoPanelObject routes box carrier", () => {
  const descriptor = normalizeInfoPanelDescriptor({
    text: "box",
    panelBoxType: "box",
    panelWidth: 20,
    panelHeight: 10,
    panelDepth: 2,
    panel: { position: { x: 0, y: 0, z: 0 } }
  });
  const fakeTexture = { isTexture: true };
  const mesh = buildInfoPanelObject(descriptor, fakeTexture);
  assert.equal(mesh.isMesh, true);
  assert.equal(mesh.name, "infoPanel");
});

test("normalizeInfoPanelDescriptor sets objType and default name", () => {
  const out = normalizeInfoPanelDescriptor({ text: "hello" });
  assert.equal(out.objType, "infoPanel");
  assert.equal(out.name, "infoPanel");
});

test("normalizeInfoPanelDescriptor preserves custom name", () => {
  const out = normalizeInfoPanelDescriptor({ text: "hello", name: "devicePanel" });
  assert.equal(out.name, "devicePanel");
});

test("buildInfoPanelObject routes plane carrier", () => {
  const descriptor = normalizeInfoPanelDescriptor({
    text: "plane",
    panelBoxType: "plane",
    panelWidth: 20,
    panelHeight: 10,
    panel: {
      position: { x: 0, y: 0, z: 0 },
      material: { side: "double" }
    }
  });
  const fakeTexture = { isTexture: true };
  const mesh = buildInfoPanelObject(descriptor, fakeTexture);
  assert.equal(mesh.isMesh, true);
  assert.equal(mesh.name, "infoPanel");
  assert.equal(mesh.material.side, 2);
});

test("buildInfoPanelObject plane defaults to DoubleSide without material.side", () => {
  const descriptor = normalizeInfoPanelDescriptor({
    text: "plane",
    panelBoxType: "plane",
    panelWidth: 20,
    panelHeight: 10,
    panel: { position: { x: 0, y: 0, z: 0 } }
  });
  const mesh = buildInfoPanelObject(descriptor, { isTexture: true });
  assert.equal(mesh.material.side, 2);
});

test("normalizeInfoPanelDescriptor accepts panelBoxType plane", () => {
  const out = normalizeInfoPanelDescriptor({
    text: "wall sign",
    panelBoxType: "plane",
    boxType: "plane"
  });
  assert.equal(out.panelBoxType, "plane");
  assert.equal(out.boxType, "plane");
});

test("normalizeInfoPanelDescriptor falls back unknown panelBoxType to box", () => {
  const out = normalizeInfoPanelDescriptor({
    text: "x",
    panelBoxType: "unknown"
  });
  assert.equal(out.panelBoxType, "box");
});

test("applyOpacityToColor bakes opacity into rgba", () => {
  assert.equal(applyOpacityToColor("#3A8798", 0.5), "rgba(58, 135, 152, 0.5)");
  assert.equal(applyOpacityToColor("#3A8798", 1), "#3A8798");
});

test("buildInfoPanelObject keeps material opacity at 1 when panel opacity below 1", () => {
  const descriptor = normalizeInfoPanelDescriptor({
    text: "hello",
    type: "text",
    opacity: 0.5,
    panelBoxType: "sprite",
    panelWidth: 20,
    panelHeight: 10,
    panel: { position: { x: 0, y: 0, z: 0 } }
  });
  const sprite = buildInfoPanelObject(descriptor, { isTexture: true });
  assert.equal(sprite.material.opacity, 1);
  assert.equal(sprite.material.transparent, true);
});

test("buildInfoPanelObject box text face material opacity stays at 1", () => {
  const descriptor = normalizeInfoPanelDescriptor({
    text: "hello",
    type: "text",
    opacity: 0.5,
    panelBoxType: "box",
    panelWidth: 20,
    panelHeight: 10,
    panelDepth: 2,
    panel: { position: { x: 0, y: 0, z: 0 } }
  });
  const mesh = buildInfoPanelObject(descriptor, { isTexture: true });
  const textMaterial = mesh.material[4];
  assert.equal(textMaterial.opacity, 1);
  assert.equal(textMaterial.transparent, true);
});

test("configureInfoPanelForDeploy reads sceneConfig.infoPanel.maxInFlightAsync", () => {
  try {
    assert.equal(getInfoPanelMaxInFlightAsync(), 4);
    configureInfoPanelForDeploy({
      sceneConfig: { infoPanel: { maxInFlightAsync: 6 } }
    });
    assert.equal(getInfoPanelMaxInFlightAsync(), 6);
    configureInfoPanelForDeploy({ sceneConfig: {} });
    assert.equal(getInfoPanelMaxInFlightAsync(), 4);
    configureInfoPanelForDeploy({
      sceneConfig: { infoPanel: { maxInFlightAsync: 0.9 } }
    });
    assert.equal(getInfoPanelMaxInFlightAsync(), 1);
  } finally {
    _resetInfoPanelDeployConfigForTests();
  }
});
