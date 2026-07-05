/**
 * objType:text mode=sdf — troika-three-text。
 */
import * as THREE from "three";
import { Text, configureTextBuilder, preloadFont } from "troika-three-text";

import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerObject } from "../../handler/objectRegistry.js";
import { setUserDataObjJson } from "../../handler/objectDescriptorAttach.js";
import {
  anchorToTroikaPercents,
  applyTextTransform,
  attachBillboardBehavior,
  hasValue,
  numberBetween,
  resolveTextRecord,
  wrapTextForBillboard
} from "./textStyleShared.js";
import { resolveTextFontConfig } from "./fontResolver.js";

let configuredUnicodeFontsUrl = null;

function ensureUnicodeFontsUrl(unicodeFontsUrl) {
  if (!unicodeFontsUrl || unicodeFontsUrl === configuredUnicodeFontsUrl) {
    return;
  }
  configureTextBuilder({
    unicodeFontsURL: unicodeFontsUrl
  });
  configuredUnicodeFontsUrl = unicodeFontsUrl;
}

function mapTextAlign(align) {
  if (align === "center" || align === "right") {
    return align;
  }
  return "left";
}

/**
 * @param {THREE.Object3D} parent
 * @param {object} record
 * @param {object} [ctx]
 * @returns {import("troika-three-text").Text|null}
 */
export function createSdfText(parent, record, ctx = {}) {
  if (!parent || !record) {
    return null;
  }
  const resolved = resolveTextRecord(record);
  const sdfBlock = resolved.sdf;
  const sceneConfig = ctx.sceneConfig && typeof ctx.sceneConfig === "object" ? ctx.sceneConfig : null;
  const fontConfig = resolveTextFontConfig(record, sceneConfig);

  if (fontConfig.unicodeFontsUrl) {
    ensureUnicodeFontsUrl(fontConfig.unicodeFontsUrl);
  }

  const text = new Text();
  trackDisposableResource(text);

  text.text = resolved.content;
  text.fontSize = resolved.fontSize;
  text.color = new THREE.Color(resolved.color);
  text.textAlign = mapTextAlign(resolved.align);
  text.fontStyle = fontConfig.fontStyle;
  text.fontWeight = fontConfig.fontWeight;
  text.letterSpacing = resolved.letterSpacing;

  const anchors = anchorToTroikaPercents(resolved.anchor);
  text.anchorX = anchors.anchorX;
  text.anchorY = anchors.anchorY;

  if (resolved.maxWidth != null) {
    text.maxWidth = resolved.maxWidth;
  }
  if (resolved.lineHeight != null) {
    text.lineHeight = resolved.lineHeight;
  }
  if (fontConfig.fontUrl) {
    text.font = fontConfig.fontUrl;
  }

  if (hasValue(sdfBlock.outlineWidth)) {
    text.outlineWidth = Number(sdfBlock.outlineWidth);
  }
  if (hasValue(sdfBlock.outlineColor)) {
    text.outlineColor = sdfBlock.outlineColor;
  }
  if (hasValue(sdfBlock.outlineOpacity)) {
    text.outlineOpacity = Number(sdfBlock.outlineOpacity);
  }
  if (hasValue(sdfBlock.fillOpacity)) {
    text.fillOpacity = Number(sdfBlock.fillOpacity);
  }
  if (hasValue(sdfBlock.curveRadius)) {
    text.curveRadius = Number(sdfBlock.curveRadius);
  }
  if (sdfBlock.gpuAccelerateSDF === false) {
    text.gpuAccelerateSDF = false;
  }

  const outRecord = { ...record, objType: "text", mode: "sdf" };
  text.name = resolved.name;

  let sceneRoot = text;
  if (resolved.billboard) {
    sceneRoot = wrapTextForBillboard(text, record, resolved.name);
    trackDisposableResource(sceneRoot);
  } else {
    applyTextTransform(text, record);
  }

  setUserDataObjJson(sceneRoot, outRecord);
  text.sync();

  parent.add(sceneRoot);
  registerObject(sceneRoot, outRecord);
  return text;
}

/**
 * @param {object} sceneConfig
 * @param {object[]} [objectList]
 */
export function preloadSceneTextFonts(sceneConfig, objectList = []) {
  const sceneFont = sceneConfig?.textFont;
  const chars = new Set();
  const preloadCharacters =
    sceneFont && typeof sceneFont.preloadCharacters === "string"
      ? sceneFont.preloadCharacters
      : "";
  for (const ch of preloadCharacters) {
    chars.add(ch);
  }
  for (const rec of objectList) {
    if (!rec || typeof rec !== "object") {
      continue;
    }
    const objType = typeof rec.objType === "string" ? rec.objType.trim().toLowerCase() : "";
    if (objType !== "text") {
      continue;
    }
    const mode = typeof rec.mode === "string" ? rec.mode.trim().toLowerCase() : "sdf";
    if (mode !== "sdf") {
      continue;
    }
    for (const ch of String(rec.content ?? "")) {
      chars.add(ch);
    }
  }
  if (!chars.size) {
    return;
  }
  const fontConfig = resolveTextFontConfig({}, sceneConfig);
  preloadFont({
    font: fontConfig.fontUrl,
    characters: [...chars].join("")
  });
}
