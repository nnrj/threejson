import assert from "node:assert/strict";
import { test } from "node:test";

import {
  injectOpacityIntoHtmlBackgrounds,
  resolveHtmlOpacity,
  resolveOpacityByPanel
} from "../core/builder/htmlPanelOpacity.js";
import {
  normalizeInfoPanelDescriptor,
  buildInfoPanelObject
} from "../core/builder/infoPanelBuilder.js";

test("resolveHtmlOpacity defaults to true", () => {
  assert.equal(resolveHtmlOpacity({}), true);
  assert.equal(resolveHtmlOpacity({ htmlOpacity: false }), false);
});

test("resolveOpacityByPanel defaults to false", () => {
  assert.equal(resolveOpacityByPanel({}), false);
  assert.equal(resolveOpacityByPanel({ opacityByPanel: true }), true);
});

test("injectOpacityIntoHtmlBackgrounds adjusts background-color not text color", () => {
  const header = {
    style: {
      backgroundColor: "rgb(183, 28, 28)",
      color: "rgb(255, 255, 255)"
    }
  };
  const body = {
    style: {
      backgroundColor: "rgb(255, 255, 255)",
      color: "rgb(0, 0, 0)"
    }
  };
  const root = {
    style: {},
    querySelectorAll() {
      return [header, body];
    }
  };
  injectOpacityIntoHtmlBackgrounds(root, 0.5);
  assert.equal(header.style.backgroundColor, "rgba(183, 28, 28, 0.5)");
  assert.equal(header.style.color, "rgb(255, 255, 255)");
  assert.equal(body.style.backgroundColor, "rgba(255, 255, 255, 0.5)");
  assert.equal(body.style.color, "rgb(0, 0, 0)");
});

test("normalizeInfoPanelDescriptor sets html opacity option defaults", () => {
  const out = normalizeInfoPanelDescriptor({ type: "html", text: "<div></div>" });
  assert.equal(out.htmlOpacity, true);
  assert.equal(out.opacityByPanel, false);
});

test("buildInfoPanelObject html with opacityByPanel uses material opacity", () => {
  const descriptor = normalizeInfoPanelDescriptor({
    type: "html",
    text: "<div>panel</div>",
    opacity: 0.5,
    opacityByPanel: true,
    panelBoxType: "sprite",
    panelWidth: 20,
    panelHeight: 10,
    panel: { position: { x: 0, y: 0, z: 0 } }
  });
  const sprite = buildInfoPanelObject(descriptor, { isTexture: true });
  assert.equal(sprite.material.opacity, 0.5);
  assert.equal(sprite.material.transparent, true);
});

test("buildInfoPanelObject html default keeps material opacity at 1", () => {
  const descriptor = normalizeInfoPanelDescriptor({
    type: "html",
    text: "<div>panel</div>",
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

test("buildInfoPanelObject text with opacityByPanel uses material opacity", () => {
  const descriptor = normalizeInfoPanelDescriptor({
    type: "text",
    text: "hello",
    opacity: 0.5,
    opacityByPanel: true,
    panelBoxType: "sprite",
    panelWidth: 20,
    panelHeight: 10,
    panel: { position: { x: 0, y: 0, z: 0 } }
  });
  const sprite = buildInfoPanelObject(descriptor, { isTexture: true });
  assert.equal(sprite.material.opacity, 0.5);
});
