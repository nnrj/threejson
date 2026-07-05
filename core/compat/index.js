import { baseline153Adapter } from "./adapters/baseline153.js";
import { log } from "../util/logger.js";
import { r155lightsAdapter } from "./adapters/r155lights.js";
import { r169controlsAdapter } from "./adapters/r169controls.js";
import { latestAdapter } from "./adapters/latest.js";
import {
  getThreeJsonCompatRevisions,
  getThreeJsonMinSupportedRevision,
  getThreeJsonNativeRevisions,
  getThreeJsonPrimaryRevision,
  getThreeRevisionCompatibility,
  resolveEffectiveThreeRevision,
  THREEJSON_MIN_SUPPORTED_REVISION
} from "./threeRevisionMatrix.js";

export {
  getThreeJsonCompatRevisions,
  getThreeJsonMinSupportedRevision,
  getThreeJsonNativeRevisions,
  getThreeJsonPrimaryRevision,
  getThreeRevisionCompatibility,
  resolveEffectiveThreeRevision,
  THREEJSON_COMPAT_REVISIONS,
  THREEJSON_MIN_SUPPORTED_REVISION,
  THREEJSON_NATIVE_REVISIONS,
  THREEJSON_PRIMARY_REVISION
} from "./threeRevisionMatrix.js";

export { normalizeDeclaredRevision, parseRevisionFromThree } from "./revision.js";

/**
 * @param {number} revision
 * @returns {{ id: string, resolveLightIntensity: (entry: object) => number }}
 */
export function getCompatAdapter(revision) {
  const rev = Number.isFinite(revision) ? Math.trunc(revision) : getThreeJsonPrimaryRevision();
  if (rev <= 154) {
    return baseline153Adapter;
  }
  if (rev <= 168) {
    return r155lightsAdapter;
  }
  if (rev <= 183) {
    return r169controlsAdapter;
  }
  return latestAdapter;
}

/**
 * @param {{ three?: typeof import("three"), sceneJsonRoot?: object, sceneConfig?: object, worldInfo?: object }} [ctx]
 * @returns {{ tier: "native" | "compat" | "unsupported", needsCompat: boolean, revision: number }}
 */
export function warnIfUnsupportedThreeRevision(ctx = {}) {
  const revision = resolveEffectiveThreeRevision(ctx);
  const compat = getThreeRevisionCompatibility(revision);
  if (compat.tier === "unsupported") {
    log.warn(
      "[threejson] Three.js revision r" + revision +
      " is not in the supported matrix (r" + THREEJSON_MIN_SUPPORTED_REVISION +
      "–r" + getThreeJsonPrimaryRevision() +
      "). Behavior is not guaranteed. See doc/three-compat.md for upgrade notes and advanced workarounds."
    );
  }
  return compat;
}

/**
 * @param {object} entry
 * @param {{ three?: typeof import("three"), sceneJsonRoot?: object, sceneConfig?: object, worldInfo?: object }} [ctx]
 * @returns {number}
 */
export function resolveLightIntensityForContext(entry, ctx) {
  const revision = resolveEffectiveThreeRevision(ctx);
  const compat = getThreeRevisionCompatibility(revision);
  const adapter = compat.tier === "native"
    ? latestAdapter
    : getCompatAdapter(revision);
  return adapter.resolveLightIntensity(entry);
}

/**
 * @param {import("three").TransformControls} transformControls
 * @param {import("three").Scene} scene
 * @param {{ revision?: number }} [options]
 * @returns {import("three").Object3D}
 */
export function attachTransformControlsHelper(transformControls, scene, options = {}) {
  const revision = options.revision ?? getThreeJsonPrimaryRevision();
  if (revision >= 169 && typeof transformControls.getHelper === "function") {
    const helper = transformControls.getHelper();
    scene.add(helper);
    return helper;
  }
  if (transformControls.isObject3D !== false) {
    scene.add(transformControls);
  }
  return transformControls;
}
