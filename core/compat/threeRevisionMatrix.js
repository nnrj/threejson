import { log } from "../util/logger.js";
import {
  normalizeDeclaredRevision,
  parseRevisionFromThree,
  readDeclaredRevisionFromContext
} from "./revision.js";

/** Three.js revision ThreeJSON development and tests target (aligned with peer major version). */
export const THREEJSON_PRIMARY_REVISION = 184;

/** Lowest officially supported Three.js revision (compat lower bound). */
export const THREEJSON_MIN_SUPPORTED_REVISION = 179;

/** Three.js revisions that run without compat, 1:1 with core implementation. */
export const THREEJSON_NATIVE_REVISIONS = Object.freeze([184]);

/** Revisions runnable via compat (includes native; lower bound r179). */
export const THREEJSON_COMPAT_REVISIONS = Object.freeze([
  179, 180, 181, 182, 183, 184
]);

const NATIVE_SET = new Set(THREEJSON_NATIVE_REVISIONS);
const COMPAT_SET = new Set(THREEJSON_COMPAT_REVISIONS);

/**
 * @returns {readonly number[]}
 */
export function getThreeJsonNativeRevisions() {
  return THREEJSON_NATIVE_REVISIONS;
}

/**
 * @returns {readonly number[]}
 */
export function getThreeJsonCompatRevisions() {
  return THREEJSON_COMPAT_REVISIONS;
}

/**
 * @returns {number}
 */
export function getThreeJsonPrimaryRevision() {
  return THREEJSON_PRIMARY_REVISION;
}

/**
 * @returns {number}
 */
export function getThreeJsonMinSupportedRevision() {
  return THREEJSON_MIN_SUPPORTED_REVISION;
}

/**
 * @param {{ three?: typeof import("three"), sceneJsonRoot?: object, sceneConfig?: object, worldInfo?: object }} [options]
 * @returns {number}
 */
export function resolveEffectiveThreeRevision(options = {}) {
  const declared = readDeclaredRevisionFromContext(options);
  if (declared != null) {
    const runtime = parseRevisionFromThree(options.three);
    if (runtime != null && runtime !== declared) {
      log.warn(
        "[threejson] sceneConfig/worldInfo threeRevision",
        declared,
        "differs from runtime THREE.REVISION",
        runtime,
        "— using declared revision for compat routing."
      );
    }
    return declared;
  }
  const runtime = parseRevisionFromThree(options.three);
  if (runtime != null) {
    return runtime;
  }
  return THREEJSON_PRIMARY_REVISION;
}

/**
 * @param {number} revision
 * @returns {{ tier: "native" | "compat" | "unsupported", needsCompat: boolean, revision: number }}
 */
export function getThreeRevisionCompatibility(revision) {
  const rev = normalizeDeclaredRevision(revision) ?? THREEJSON_PRIMARY_REVISION;
  if (NATIVE_SET.has(rev)) {
    return { tier: "native", needsCompat: false, revision: rev };
  }
  if (COMPAT_SET.has(rev)) {
    return { tier: "compat", needsCompat: true, revision: rev };
  }
  return { tier: "unsupported", needsCompat: false, revision: rev };
}

export { normalizeDeclaredRevision, parseRevisionFromThree };
