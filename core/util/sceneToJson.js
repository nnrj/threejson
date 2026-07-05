import * as THREE from "three";

import { isTaggedThreeJsonSceneAudioNode } from "../builder/audioBuilder.js";
import { snapshotBoxModelTransformFromObject3D } from "../builder/modelBuilder.js";
import { getDomain, resolveDomainIdForSceneDeployRoot } from "../handler/businessDomainRegistry.js";
import {
  assertSceneExportableOrThrow,
  DOMAIN_EDIT_STATES,
  exportDeployRootDescriptor,
  getDomainEditState,
  getPersistSource,
  isDomainDeployRootObjJson,
  syncDomainDeployItemFromObject3D
} from "../handler/domainDeployDescriptor.js";

export {
  assertSceneExportable,
  assertSceneExportableOrThrow,
  SceneExportBlockedError
} from "../handler/domainDeployDescriptor.js";
import { normalizeCanonicalObjectRecord } from "../handler/sceneFriendlyNormalizer.js";
import { sanitizePlainData } from "../handler/sceneJsonHandler.js";
import { sceneToNativeJson } from "../handler/sceneJsonHandler.js";
import { sanitizeObjectRecordForExport } from "./descriptorExportSanitize.js";
import { shouldSkipSceneExportNode } from "./sceneExportNode.js";
import {
  applyRuntimeSceneConfigToPayload,
  stripRuntimeSceneConfigFromPayload
} from "./sceneRuntimeConfigExport.js";
import { descriptorListMergeKey } from "./persistListMerge.js";
import {
  extractRootMetadataFromBase,
  mergeObjectListByIdentity,
  preserveDeclarativeAudioFromBase,
  preserveNativeSceneEmbedFromBase,
  resolveBaseObjectList
} from "./scenePayloadMerge.js";
import { convertStandardJsonToFriendlyJson } from "./util.js";
import { JSON_ORIGIN_LIST, ensureJsonOrigin } from "./sceneJsonOrigin.js";
import { applySubSceneLayout } from "../handler/subSceneHierarchy.js";

/**
 * @param {import("three").Object3D} object3D
 * @returns {object|null}
 */
function cloneDescriptorFromDeployRoot(object3D) {
  const domainExport = exportDeployRootDescriptor(object3D);
  if (domainExport) {
    return sanitizeObjectRecordForExport(domainExport);
  }
  const liveJson = object3D?.userData?.objJson;
  if (!liveJson || typeof liveJson !== "object" || Array.isArray(liveJson)) {
    return null;
  }
  if (isDomainDeployRootObjJson(liveJson)) {
    return sanitizeObjectRecordForExport(syncDomainDeployItemFromObject3D(liveJson, object3D));
  }
  const domainId = resolveDomainIdForSceneDeployRoot(liveJson);
  if (domainId) {
    const domain = getDomain(domainId);
    const capture = domain?.api?.capturePersistDescriptor;
    if (typeof capture === "function") {
      const descriptor = capture(object3D);
      if (descriptor) {
        return sanitizeObjectRecordForExport(descriptor);
      }
    }
  }
  const modelData = sanitizePlainData(liveJson) || {};
  const transform = snapshotBoxModelTransformFromObject3D(object3D);
  if (transform) {
    modelData.position = transform.position;
    modelData.rotation = transform.rotation;
    modelData.scale = transform.scale;
  }
  if (typeof object3D.visible === "boolean") {
    modelData.visible = object3D.visible;
  }
  return sanitizeObjectRecordForExport(modelData);
}

/**
 * Domain deploy roots rebuild child subtrees via factory; reverse-scan must not write runtime children into subScene (would duplicate items deployment).
 * @param {object|null|undefined} raw
 * @returns {boolean}
 */
function shouldExportSubSceneForDeployRoot(raw) {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  if (isDomainDeployRootObjJson(raw)) {
    return false;
  }
  if (resolveDomainIdForSceneDeployRoot(raw)) {
    return false;
  }
  return true;
}

/**
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {import("three").Object3D[]}
 */
function enumerateScanRoots(scene, options = {}) {
  const scanDepth = options.scanDepth || "deployRoots";
  const shouldSkip = typeof options.shouldSkipObject === "function"
    ? options.shouldSkipObject
    : shouldSkipSceneExportNode;
  if (scanDepth === "traverse") {
    const out = [];
    scene?.traverse?.((obj) => {
      if (obj === scene || shouldSkip(obj)) {
        return;
      }
      const record = obj?.userData?.objJson;
      if (record && typeof record === "object" && !Array.isArray(record)) {
        out.push(obj);
      }
    });
    return out;
  }
  if (scanDepth === "registryRoots") {
    return enumerateScanRoots(scene, { ...options, scanDepth: "deployRoots" });
  }
  const out = [];
  const children = scene?.children;
  if (!children?.length) {
    return out;
  }
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (!shouldSkip(child)) {
      out.push(child);
    }
  }
  return out;
}

function isPersistFidelityExportState(state) {
  return state === DOMAIN_EDIT_STATES.PRISTINE
    || state === DOMAIN_EDIT_STATES.SHELL_DIRTY
    || !state;
}

/**
 * @param {import("three").Object3D} object3D
 * @returns {boolean}
 */
function shouldPreservePersistExportShape(object3D) {
  return Boolean(getPersistSource(object3D))
    && isPersistFidelityExportState(getDomainEditState(object3D));
}

/**
 * Runtime subtrees of domain deploy roots (cabinets, doors, etc.) are rebuilt by domain factory; must not be exported as subScene.
 *
 * @param {import("three").Object3D} object3D
 * @param {object|null|undefined} raw
 * @returns {boolean}
 */
function shouldCollectSubSceneForDeployRoot(object3D, raw) {
  if (!raw || typeof raw !== "object") {
    return false;
  }
  if (shouldPreservePersistExportShape(object3D)) {
    return false;
  }
  if (isDomainDeployRootObjJson(raw)) {
    return false;
  }
  const domainId = resolveDomainIdForSceneDeployRoot(raw);
  if (domainId) {
    const domain = getDomain(domainId);
    if (typeof domain?.api?.capturePersistDescriptor === "function") {
      return false;
    }
  }
  return true;
}

/**
 * @param {import("three").Object3D} object3D
 * @param {object} raw
 * @returns {object|null}
 */
function normalizeCollectedRecord(object3D, raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (shouldPreservePersistExportShape(object3D)) {
    return sanitizeObjectRecordForExport(raw);
  }
  const objType = String(raw.objType || raw.type || "").trim();
  const isInstanceBoxRecord =
    raw.instance === true && Array.isArray(raw.transforms) && raw.transforms.length > 0;
  const isDomainDeployRoot = isDomainDeployRootObjJson(raw);
  const isSemanticGroupRecord =
    String(raw.objType || "").trim().toLowerCase() === "group"
    || (Array.isArray(raw.subScene) && raw.subScene.length > 0);
  let forceObjType;
  if (
    (object3D instanceof THREE.Group || (Array.isArray(raw.subScene) && raw.subScene.length > 0))
    && !isInstanceBoxRecord
    && !isDomainDeployRoot
    && isSemanticGroupRecord
  ) {
    forceObjType = "group";
  } else if (objType === "line" || objType === "leakLine") {
    forceObjType = "line";
  } else if (objType === "wind") {
    forceObjType = "wind";
  } else if (objType === "shaderSurface") {
    forceObjType = "shaderSurface";
  } else if (objType === "heatMap") {
    forceObjType = "heatMap";
  } else if (objType === "infoPanel") {
    forceObjType = "infoPanel";
  } else if (objType === "objModel") {
    forceObjType = "externalModel";
  } else if (raw.boxType === "sphere" || Number.isFinite(raw.geometry?.radius)) {
    forceObjType = "sphere";
  }
  return normalizeCanonicalObjectRecord(raw, forceObjType ? { forceObjType } : {});
}

/**
 * @param {import("three").Object3D} object3D
 * @param {object} [options]
 * @returns {object[]}
 */
function collectSubSceneFromObject3D(object3D, options = {}) {
  const shouldSkip = typeof options.shouldSkipObject === "function"
    ? options.shouldSkipObject
    : shouldSkipSceneExportNode;
  const out = [];
  const children = object3D?.children;
  if (!children?.length) {
    return out;
  }
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (!child || shouldSkip(child)) {
      continue;
    }
    const raw = cloneDescriptorFromDeployRoot(child);
    if (!raw) {
      continue;
    }
    const normalized = normalizeCollectedRecord(child, raw);
    if (!normalized) {
      continue;
    }
    const nested = collectSubSceneFromObject3D(child, options);
    if (nested.length > 0) {
      normalized.subScene = nested.map((item) => ensureJsonOrigin(item, JSON_ORIGIN_LIST));
    }
    out.push(ensureJsonOrigin(normalized, JSON_ORIGIN_LIST));
  }
  return out;
}

/**
 * Force WYSIWYG export of deploy root (when degraded to group): includes subScene reverse-scan; ignores domain fidelity path.
 * @param {import("three").Object3D} object3D
 * @param {object} [options]
 * @returns {object|null}
 */
export function exportWysiwygDeployRootFromObject3D(object3D, options = {}) {
  const liveJson = object3D?.userData?.objJson;
  if (!liveJson || typeof liveJson !== "object" || Array.isArray(liveJson)) {
    return null;
  }
  const modelData = sanitizePlainData(liveJson) || {};
  delete modelData.domain;
  delete modelData.handler;
  delete modelData.items;
  delete modelData.childMutations;
  modelData.objType = "group";
  const transform = snapshotBoxModelTransformFromObject3D(object3D);
  if (transform) {
    modelData.position = transform.position;
    modelData.rotation = transform.rotation;
    modelData.scale = transform.scale;
  }
  if (typeof object3D.visible === "boolean") {
    modelData.visible = object3D.visible;
  }
  const normalized = normalizeCollectedRecord(object3D, modelData);
  if (!normalized) {
    return null;
  }
  const subScene = collectSubSceneFromObject3D(object3D, options);
  if (subScene.length > 0) {
    normalized.subScene = subScene;
  }
  return sanitizeObjectRecordForExport(normalized);
}

/**
 * Ambient audio is attached to the camera, not in scene.children; reverse-scan from runtimeTarget.camera.
 *
 * @param {object} [options]
 * @returns {object[]}
 */
function collectCameraAttachedSceneAudio(options = {}) {
  const runtimeTarget = options.runtimeTarget || options.target || {};
  const camera = runtimeTarget.camera;
  if (!camera || !Array.isArray(camera.children) || !camera.children.length) {
    return [];
  }
  const shouldSkip = typeof options.shouldSkipObject === "function"
    ? options.shouldSkipObject
    : shouldSkipSceneExportNode;
  const out = [];
  for (let i = 0; i < camera.children.length; i += 1) {
    const child = camera.children[i];
    if (!child || shouldSkip(child) || !isTaggedThreeJsonSceneAudioNode(child)) {
      continue;
    }
    const raw = cloneDescriptorFromDeployRoot(child);
    const normalized = normalizeCollectedRecord(child, raw);
    if (normalized) {
      out.push(ensureJsonOrigin(normalized, JSON_ORIGIN_LIST));
    }
  }
  return out;
}

/**
 * @param {object[]} target
 * @param {object[]} additions
 */
function appendUniqueObjectListRecords(target, additions) {
  if (!additions.length) {
    return;
  }
  const usedKeys = new Set();
  for (let i = 0; i < target.length; i += 1) {
    const key = descriptorListMergeKey(target[i]);
    if (key) {
      usedKeys.add(key);
    }
  }
  for (let i = 0; i < additions.length; i += 1) {
    const item = additions[i];
    const key = descriptorListMergeKey(item);
    if (key && usedKeys.has(key)) {
      continue;
    }
    if (key) {
      usedKeys.add(key);
    }
    target.push(item);
  }
}

/**
 * Read path: collect objectList entries from scene deploy roots.
 *
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {object[]}
 */
export function collectObjectListFromScene(scene, options = {}) {
  const roots = enumerateScanRoots(scene, options);
  const out = [];
  for (let i = 0; i < roots.length; i += 1) {
    const raw = cloneDescriptorFromDeployRoot(roots[i]);
    const normalized = normalizeCollectedRecord(roots[i], raw);
    if (normalized) {
      if (shouldCollectSubSceneForDeployRoot(roots[i], raw)) {
        const subScene = collectSubSceneFromObject3D(roots[i], options);
        if (subScene.length > 0) {
          normalized.subScene = subScene;
        }
      }
      out.push(ensureJsonOrigin(normalized, JSON_ORIGIN_LIST));
    }
  }
  appendUniqueObjectListRecords(out, collectCameraAttachedSceneAudio(options));
  return out;
}

/**
 * @param {object|null|undefined} basePayload
 * @param {object[]} freshList
 * @param {boolean} merge
 * @returns {object[]}
 */
function resolveMergedObjectList(basePayload, freshList, merge) {
  if (!merge) {
    return freshList;
  }
  const baseList = resolveBaseObjectList(basePayload);
  return mergeObjectListByIdentity(baseList, freshList);
}

/**
 * @param {import("three").Scene} scene
 * @param {object} basePayload
 * @param {object} options
 * @returns {object}
 */
function buildStandardPayloadFromScene(scene, basePayload, options = {}) {
  if (options.assertExportable === true) {
    assertSceneExportableOrThrow(scene, options);
  }
  const merge = options.merge !== false;
  const freshList = collectObjectListFromScene(scene, options);
  const objectList = resolveMergedObjectList(basePayload, freshList, merge);
  const metadata = extractRootMetadataFromBase(basePayload);
  const payload = {
    ...metadata,
    objectList
  };
  const runtimeTarget = options.runtimeTarget || options.target || { scene };
  if (options.includeRuntimeRecords !== false) {
    applyRuntimeSceneConfigToPayload(payload, runtimeTarget, scene);
  } else {
    stripRuntimeSceneConfigFromPayload(payload);
  }
  preserveDeclarativeAudioFromBase(payload, options.basePayload || basePayload);
  preserveNativeSceneEmbedFromBase(payload, options.basePayload || basePayload);
  if (options.embedNative === true) {
    const nativeOpts = {
      shouldSkipObject: options.shouldSkipObject,
      sanitizeUserData: options.sanitizeUserData,
      space: options.space
    };
    const { jsonString } = sceneToNativeJson(scene, nativeOpts);
    payload.worldInfo = payload.worldInfo && typeof payload.worldInfo === "object" ? payload.worldInfo : {};
    payload.worldInfo.nativeSceneList = [{ jsonData: jsonString }];
  }
  const prevMeta = payload.saveMeta && typeof payload.saveMeta === "object" ? payload.saveMeta : {};
  payload.saveMeta = {
    ...prevMeta,
    exportMode: "standard_primary",
    exportedAt: new Date().toISOString()
  };
  // Default nested; pass subSceneLayout: "subSceneList" | "flat" only for display/explicit export paths
  const layout = options.subSceneLayout;
  const withLayout = layout && layout !== "nested"
    ? applySubSceneLayout(payload, layout)
    : payload;
  return sanitizePlainData(withLayout) || withLayout;
}

/**
 * Sync variant (does not convert friendly base to standard); for editor history and similar paths.
 *
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {object}
 */
export function sceneToStandardJsonSimple(scene, options = {}) {
  if (!scene?.isScene) {
    throw new Error("sceneToStandardJsonSimple requires a THREE.Scene");
  }
  const basePayload = options.basePayload && typeof options.basePayload === "object"
    ? options.basePayload
    : {};
  return buildStandardPayloadFromScene(scene, basePayload, options);
}

/**
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function sceneToStandardJson(scene, options = {}) {
  if (!scene?.isScene) {
    throw new Error("sceneToStandardJson requires a THREE.Scene");
  }
  const mode = options.mode || "read";
  if (mode === "rebuild") {
    return sceneToStandardJson(scene, { ...options, mode: "read" });
  }

  let basePayload = options.basePayload && typeof options.basePayload === "object"
    ? options.basePayload
    : {};
  if (basePayload.worldInfo && typeof basePayload.worldInfo === "object" && !Array.isArray(basePayload.objectList)) {
    const { convertFriendlyJsonToStandardJson } = await import("./util.js");
    basePayload = await convertFriendlyJsonToStandardJson(basePayload);
  }

  return buildStandardPayloadFromScene(scene, basePayload, options);
}

/**
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function sceneToFriendlyJson(scene, options = {}) {
  const standard = await sceneToStandardJson(scene, options);
  return convertStandardJsonToFriendlyJson(standard, options.friendlyMap);
}

/**
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function rebuildStandardJson(scene, options = {}) {
  return sceneToStandardJson(scene, { ...options, mode: "rebuild" });
}

/**
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function rebuildFriendlyJson(scene, options = {}) {
  return sceneToFriendlyJson(scene, { ...options, mode: "rebuild" });
}

/**
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {Promise<object>}
 */
export async function sceneToJson(scene, options = {}) {
  const format = options.format || "standard";
  if (format === "friendly") {
    return sceneToFriendlyJson(scene, options);
  }
  return sceneToStandardJson(scene, options);
}
