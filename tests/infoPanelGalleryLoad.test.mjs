import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { normalizeFriendlyScenePayload } from "../core/handler/sceneFriendlyNormalizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const galleryPath = path.join(__dirname, "../assets/json/tutorial/track-04/04-08-info-panel-gallery.json");

test("04-08-info-panel-gallery.json normalizes with eight infoPanel variants", () => {
  const payload = JSON.parse(fs.readFileSync(galleryPath, "utf8"));
  assert.equal(payload.threeJsonId, "04-08-info-panel-gallery");

  const normalized = normalizeFriendlyScenePayload(payload);
  const list = normalized.objectList || [];
  const panels = list.filter((item) => item.objType === "infoPanel");
  assert.equal(panels.length, 8, "expected 8 infoPanel records");

  const names = new Set(panels.map((p) => p.name));
  for (const expected of [
    "panel-box-text-single",
    "panel-box-text-full",
    "panel-sprite-text",
    "panel-sprite-html",
    "panel-sprite-img",
    "panel-sprite-img-port360",
    "panel-box-removable",
    "panel-plane-text"
  ]) {
    assert.ok(names.has(expected), `missing panel: ${expected}`);
  }

  const combos = panels.map((p) => `${p.panelBoxType || p.boxType}:${p.type}`);
  assert.ok(combos.includes("box:text"), "expected box:text");
  assert.ok(combos.filter((c) => c === "box:text").length >= 2, "expected two box:text panels");
  assert.ok(combos.includes("sprite:text"), "expected sprite:text");
  assert.ok(combos.includes("sprite:html"), "expected sprite:html");
  assert.ok(combos.includes("sprite:img"), "expected sprite:img");
  assert.ok(combos.includes("plane:text"), "expected plane:text");

  const fullFace = panels.find((p) => p.name === "panel-box-text-full");
  assert.equal(fullFace?.textFace, "full");

  const removable = panels.find((p) => p.name === "panel-box-removable");
  assert.equal(removable?.fix, false);
  assert.equal(removable?.dismissTrigger, undefined);

  const dismissNoneCount = panels.filter((p) => p.fix !== false).length;
  assert.equal(dismissNoneCount, 7, "expected 7 panels without fix:false");
});
