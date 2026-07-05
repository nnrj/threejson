/**
 * objType:text mode=texture — CanvasTexture plane or Sprite.
 */
import * as THREE from "three";

import { createStrTextureMultiline } from "../../util/textureUtils.js";
import { applyUiTextureSampling } from "../../util/textureSampling.js";
import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerObject } from "../../handler/objectRegistry.js";
import { setUserDataObjJson } from "../../handler/objectDescriptorAttach.js";
import {
  applyTextTransform,
  attachBillboardBehavior,
  hasValue,
  numberBetween,
  resolveTextRecord,
  valueOr
} from "./textStyleShared.js";

const TEXTURE_DEFAULTS = {
  padding: 8,
  fontSizePx: 14,
  minFontPx: 10,
  maxFontPx: 72,
  planeWidth: 2,
  planeHeight: 1
};

function splitLines(text) {
  return String(text ?? "").split(/\r?\n/);
}

function calcLongestLineLength(lines) {
  let max = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = String(lines[i] ?? "").length;
    if (len > max) {
      max = len;
    }
  }
  return max;
}

function resolveTextureStyle(resolved, textureBlock) {
  const textStyle = textureBlock.textStyle && typeof textureBlock.textStyle === "object" ? textureBlock.textStyle : {};
  const minFontPx = numberBetween(textStyle.minFontPx, TEXTURE_DEFAULTS.minFontPx, 6, 120);
  const maxFontPx = numberBetween(textStyle.maxFontPx, TEXTURE_DEFAULTS.maxFontPx, minFontPx, 160);
  let fontSizePx = numberBetween(
    textStyle.fontSizePx ?? resolved.fontSize,
    TEXTURE_DEFAULTS.fontSizePx,
    minFontPx,
    maxFontPx
  );
  const fontFamily =
    typeof textStyle.fontFamily === "string" && textStyle.fontFamily.trim()
      ? textStyle.fontFamily.trim()
      : resolved.fontFamily;
  const padding = numberBetween(textureBlock.padding, TEXTURE_DEFAULTS.padding, 0, 64);
  const autoFit = textStyle.autoFit === true;

  return { fontSizePx, fontFamily, padding, autoFit, minFontPx, maxFontPx, textStyle };
}

function estimateCanvasSize(resolved, style) {
  const textureBlock = resolved.texture;
  const explicitW = Number(textureBlock.canvasWidth);
  const explicitH = Number(textureBlock.canvasHeight);
  if (Number.isFinite(explicitW) && explicitW > 0 && Number.isFinite(explicitH) && explicitH > 0) {
    return { width: Math.round(explicitW), height: Math.round(explicitH) };
  }

  const lines = splitLines(resolved.content);
  const lineCount = Math.max(1, lines.length);
  const longest = Math.max(1, calcLongestLineLength(lines));
  let fontSizePx = style.fontSizePx;

  if (style.autoFit) {
    const targetWidth = Math.max(64, longest * fontSizePx * 0.62 + style.padding * 2);
    const targetHeight = Math.max(32, lineCount * fontSizePx * 1.3 + style.padding * 2);
    fontSizePx = style.fontSizePx;
    return {
      width: Math.round(Math.min(2048, targetWidth)),
      height: Math.round(Math.min(1024, targetHeight)),
      fontSizePx
    };
  }

  const width = Math.round(Math.max(64, longest * fontSizePx * 0.65 + style.padding * 2));
  const height = Math.round(Math.max(32, lineCount * fontSizePx * 1.3 + style.padding * 2));
  return { width: Math.min(2048, width), height: Math.min(1024, height), fontSizePx };
}

function mapAlign(align) {
  if (align === "center") {
    return "center";
  }
  if (align === "right") {
    return "right";
  }
  return "left";
}

function buildTexture(resolved) {
  const textureBlock = resolved.texture;
  const style = resolveTextureStyle(resolved, textureBlock);
  const canvasSize = estimateCanvasSize(resolved, style);
  const fontSizePx = canvasSize.fontSizePx ?? style.fontSizePx;
  const lineHeight =
    resolved.lineHeight != null
      ? Math.max(8, Math.round(fontSizePx * resolved.lineHeight))
      : Math.max(Math.round(fontSizePx * 1.2), fontSizePx + 2);

  const backgroundColor = textureBlock.backgroundColor;
  const textureInfo = {
    str: resolved.content,
    width: canvasSize.width,
    height: canvasSize.height,
    fillStyle: resolved.color,
    font: `${fontSizePx}px ${style.fontFamily}`,
    textBaseline: "top",
    textAlign: mapAlign(resolved.align),
    padding: style.padding,
    lineHeight,
    devicePixelRatio: hasValue(textureBlock.devicePixelRatio)
      ? Math.max(1, Number(textureBlock.devicePixelRatio))
      : undefined
  };
  if (hasValue(backgroundColor)) {
    textureInfo.backgroundColor = backgroundColor;
  } else {
    textureInfo.backgroundColor = "transparent";
  }

  const map = createStrTextureMultiline(textureInfo);
  applyUiTextureSampling(map, textureBlock);
  return { map, canvasSize };
}

/**
 * @param {THREE.Object3D} parent
 * @param {object} record
 * @returns {THREE.Object3D|null}
 */
export function createTextureText(parent, record) {
  if (!parent || !record) {
    return null;
  }
  const resolved = resolveTextRecord(record);
  const textureBlock = resolved.texture;
  const { map, canvasSize } = buildTexture(resolved);
  const aspect = canvasSize.height / Math.max(1, canvasSize.width);
  const planeWidth = resolved.maxWidth ?? numberBetween(textureBlock.planeWidth, TEXTURE_DEFAULTS.planeWidth, 0.1, 512);
  const planeHeight = planeWidth * aspect;

  const outRecord = { ...record, objType: "text", mode: "texture" };
  let object3D;

  if (resolved.billboard) {
    const mat = new THREE.SpriteMaterial({
      map,
      transparent: true,
      depthWrite: valueOr(textureBlock.depthWrite, false),
      depthTest: valueOr(textureBlock.depthTest, true)
    });
    trackDisposableResource(mat);
    object3D = new THREE.Sprite(mat);
    trackDisposableResource(object3D);
    const sx = hasValue(record.scale?.scaleX) ? Number(record.scale.scaleX) : planeWidth;
    const sy = hasValue(record.scale?.scaleY) ? Number(record.scale.scaleY) : planeHeight;
    object3D.scale.set(sx, sy, 1);
    const pos = record.position && typeof record.position === "object" ? { ...record.position } : {};
    const scale = record.scale && typeof record.scale === "object" ? { ...record.scale, scaleX: sx, scaleY: sy } : { scaleX: sx, scaleY: sy, scaleZ: 1 };
    applyTextTransform(object3D, { ...record, position: pos, scale, rotation: record.rotation, visible: record.visible });
  } else {
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    trackDisposableResource(geometry);
    const mat = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      side: textureBlock.doubleSided === false ? THREE.FrontSide : THREE.DoubleSide,
      depthWrite: valueOr(textureBlock.depthWrite, false),
      depthTest: valueOr(textureBlock.depthTest, true)
    });
    trackDisposableResource(mat);
    object3D = new THREE.Mesh(geometry, mat);
    trackDisposableResource(object3D);
    object3D.renderOrder = numberBetween(textureBlock.renderOrder, 0, -1000, 1000);
    applyTextTransform(object3D, record);
    attachBillboardBehavior(object3D, false);
  }

  object3D.name = resolved.name;
  setUserDataObjJson(object3D, outRecord);
  parent.add(object3D);
  registerObject(object3D, outRecord);
  return object3D;
}
