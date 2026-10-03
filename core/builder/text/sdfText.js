/**
 * objType:text mode=sdf — troika-three-text。
 */
import * as THREE from "three";
import { resolveRuntimeResourceUrl } from "../../resource/runtimeResourceUrl.js";
import { registerObjectReadiness } from "../../resource/objectReadiness.js";
import * as TroikaText from "troika-three-text";

import { trackDisposableResource } from "../../handler/trackedResourceRegistry.js";
import { registerObject, unregisterObject } from "../../handler/objectRegistry.js";
import { resolveRuntimeContext } from "../../runtime/runtimeContext.js";
import { log } from "../../util/logger.js";
import { setUserDataObjJson } from "../../handler/objectDescriptorAttach.js";
import {
  anchorToTroikaPercents,
  applyTextTransform,
  hasValue,
  resolveTextRecord,
  wrapTextForBillboard
} from "./textStyleShared.js";
import { resolveTextFontConfig } from "./fontResolver.js";
import { waitForSdfText, DEFAULT_TEXT_LOAD_TIMEOUT_MS } from "./sdfTextReadiness.js";
import { createTextureText } from "./textureText.js";

const { Text, getTextRenderInfo } = TroikaText;

if (
  typeof Text !== "function"
  || typeof getTextRenderInfo !== "function"
) {
  throw new Error("ThreeJSON SDF text requires the optional peer: npm install troika-three-text");
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

  const text = new Text();
  trackDisposableResource(text);
  // Global configureTextBuilder is ignored after the first font request, and
  // would leak a scene's font source into other simultaneous/history canvases.
  text.unicodeFontsURL = fontConfig.unicodeFontsUrl;

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
    text.font = resolveRuntimeResourceUrl(fontConfig.fontUrl, parent);
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
  parent.add(sceneRoot);
  registerObject(sceneRoot, outRecord, {}, parent);
  const runtime = resolveRuntimeContext(parent, { fallback: false });
  const signals = [ctx.signal, runtime?.loadSignal, runtime?.signal];
  // Start all text preparations during deploy; do not serially wait one timeout
  // per label. The timeline's resource barrier waits for these promises instead.
  const ready = waitForSdfText(text, {
    root: sceneRoot,
    signals,
    timeoutMs: ctx.textLoadTimeoutMs ?? runtime?.textLoadTimeoutMs ?? DEFAULT_TEXT_LOAD_TIMEOUT_MS
  }).catch((error) => {
    if (error?.name === "AbortError" || signals.some(signal => signal?.aborted) || !sceneRoot.parent) throw error;
    const owner = sceneRoot.parent;
    // Dispose only this text's own geometry/material, never Troika's shared SDF
    // atlas. Keep the original authoring record so a later load can retry SDF.
    unregisterObject(sceneRoot, { recursive: true }, parent);
    owner.remove(sceneRoot);
    text.dispose();
    for (const material of [].concat(text.material || [])) (material.baseMaterial || material).dispose();
    const fallback = createTextureText(owner, record, { sdfFallback: true });
    fallback.position.copy(sceneRoot.position); fallback.quaternion.copy(sceneRoot.quaternion);
    fallback.scale.copy(sceneRoot.scale); fallback.visible = sceneRoot.visible;
    setUserDataObjJson(fallback, outRecord);
    registerObject(fallback, outRecord, {}, parent);
    runtime?.diagnostics?.report({ code: "TEXT_SDF_FALLBACK", severity: "warning", objectId: record.threeJsonId,
      source: fontConfig.fontUrl || fontConfig.unicodeFontsUrl || "troika default unicode fonts",
      field: "sdf", message: `SDF text unavailable; using local canvas text. ${error.message}` });
    log.warn("[ThreeJSON] SDF font preparation failed; using local canvas text:", error.message);
    return fallback;
  });
  registerObjectReadiness(text, ready);
  if (sceneRoot !== text) registerObjectReadiness(sceneRoot, ready);
  return text;
}

/**
 * @param {object} sceneConfig
 * @param {object[]} [objectList]
 */
export async function preloadSceneTextFonts(sceneConfig, _objectList = [], ctx = {}) {
  const characters = sceneConfig?.textFont?.preloadCharacters;
  if (typeof characters !== "string" || !characters.length) return;
  // Text.sync already loads its own glyphs. A fire-and-forget duplicate warmup
  // can reserve atlas slots before they are filled, letting the real text sync
  // finish with an empty first frame. Only explicit warmups run, and are awaited.
  const fontConfig = resolveTextFontConfig({}, sceneConfig);
  const runtime = ctx.scene ? resolveRuntimeContext(ctx.scene, { fallback: false }) : null;
  await waitForSdfText({
    sync: done => getTextRenderInfo({ font: fontConfig.fontUrl, unicodeFontsURL: fontConfig.unicodeFontsUrl,
      fontStyle: fontConfig.fontStyle, fontWeight: fontConfig.fontWeight, text: characters }, done),
    dispose() {} // warmup owns no mesh or private GPU geometry
  }, { signals: [ctx.signal, runtime?.loadSignal, runtime?.signal],
    timeoutMs: ctx.textLoadTimeoutMs ?? runtime?.textLoadTimeoutMs ?? DEFAULT_TEXT_LOAD_TIMEOUT_MS });
}
