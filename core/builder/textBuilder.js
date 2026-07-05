/**
 * objType:text build entry (texture / sdf / mesh).
 * SDF path lazy-loads troika (see sdfText.js); mesh/sdf failures fall back to texture without blocking the whole scene.
 */
import { loadSdfTextModule } from "../util/capabilityLoader.js";
import { log } from "../util/logger.js";
import {
  resolveTextMode,
  sceneNeedsSdfText
} from "./text/textStyleShared.js";
import { createTextureText } from "./text/textureText.js";
import { createMeshText } from "./text/meshText.js";

export { resolveSceneTextFont, resolveTextFontConfig } from "./text/fontResolver.js";
export {
  resolveTextRecord,
  resolveTextMode,
  sceneNeedsSdfText
} from "./text/textStyleShared.js";

/**
 * @param {import("three").Object3D} parent
 * @param {object} record
 * @param {object} [ctx]
 * @returns {Promise<import("three").Object3D|null>}
 */
async function createSdfTextWithFallback(parent, record, ctx = {}) {
  try {
    const { createSdfText } = await loadSdfTextModule();
    return createSdfText(parent, record, ctx);
  } catch (err) {
    log.warn(
      "[ThreeJSON] text mode=sdf unavailable, falling back to texture:",
      err?.message || err
    );
    return createTextureText(parent, record);
  }
}

/**
 * @param {import("three").Object3D} parent
 * @param {object} record
 * @returns {Promise<import("three").Object3D|null>}
 */
async function createMeshTextWithFallback(parent, record) {
  let meshResult = null;
  try {
    meshResult = await createMeshText(parent, record);
  } catch (err) {
    log.warn(
      "[ThreeJSON] text mode=mesh failed:",
      err?.message || err
    );
  }
  if (meshResult) {
    return meshResult;
  }
  log.warn(
    "[ThreeJSON] text mode=mesh unavailable, falling back to texture:",
    record.name ?? record.threeJsonId ?? "text"
  );
  try {
    return createTextureText(parent, record);
  } catch (err) {
    log.warn(
      "[ThreeJSON] text mode=mesh texture fallback failed:",
      err?.message || err
    );
    return null;
  }
}

/**
 * Full text deploy (all modes); use {@link createTextAsync} for awaitable entry.
 * @param {import("three").Object3D} parent
 * @param {object} record
 * @param {object} [ctx]
 * @returns {Promise<import("three").Object3D|null>}
 */
async function createTextFull(parent, record, ctx = {}) {
  if (!parent || !record) {
    return null;
  }
  const mode = resolveTextMode(record);
  if (mode === "texture") {
    return createTextureText(parent, record);
  }
  if (mode === "mesh") {
    return createMeshTextWithFallback(parent, record);
  }
  return createSdfTextWithFallback(parent, record, ctx);
}

/**
 * Sync subset: texture only; sdf/mesh synchronously degrade to texture (warn).
 * @param {import("three").Object3D} parent
 * @param {object} record
 * @param {object} [ctx]
 * @returns {import("three").Object3D|null}
 */
export function createText(parent, record, ctx = {}) {
  if (!parent || !record) {
    return null;
  }
  const mode = resolveTextMode(record);
  if (mode === "texture") {
    return createTextureText(parent, record);
  }
  log.warn(
    `[ThreeJSON] createText sync subset: mode=${mode} degraded to texture; use createTextAsync for full deploy`
  );
  return createTextureText(parent, record);
}

/**
 * Async full text deploy (sdf / mesh / texture with async fallbacks).
 * @param {import("three").Object3D} parent
 * @param {object} record
 * @param {object} [ctx]
 * @returns {Promise<import("three").Object3D|null>}
 */
export async function createTextAsync(parent, record, ctx = {}) {
  return createTextFull(parent, record, ctx);
}

/**
 * @param {THREE.Object3D} parent
 * @param {object} record
 * @param {object} [ctx]
 * @returns {import("three").Object3D|null}
 */
export function deployText(parent, record, ctx = {}) {
  return createText(parent, record, ctx);
}

/**
 * @param {object} [sceneConfig]
 * @param {object[]} [objectList]
 * @returns {Promise<void>}
 */
export async function preloadSceneTextFonts(sceneConfig, objectList = []) {
  if (!sceneNeedsSdfText(sceneConfig, objectList)) {
    return;
  }
  try {
    const { preloadSceneTextFonts: preload } = await loadSdfTextModule();
    preload(sceneConfig, objectList);
  } catch (err) {
    log.warn(
      "[ThreeJSON] text font preload skipped:",
      err?.message || err
    );
  }
}
