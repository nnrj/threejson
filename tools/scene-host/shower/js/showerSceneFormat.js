import {
  buildStandardScenePayloadFromCanonical,
  normalizeScenePayload
} from "../../../../core/scenePayload.js";

/** Preserve non-object authoring configuration (intro, fonts, etc.) when switching views. */
export function toShowerStandardScene(json) {
  const normalized = normalizeScenePayload(structuredClone(json || {}));
  // normalized.payload is the internal all-record list, NOT a complete public scene.
  return buildStandardScenePayloadFromCanonical(normalized.sourcePayload, normalized.payload);
}
