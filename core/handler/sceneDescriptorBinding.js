/**
 * Optional lightweight sync between scene descriptors (`userData.objJson`) and Object3D transforms.
 * Off by default; configure in `worldInfo.descriptorBinding` and call {@link startDescriptorBinding}.
 *
 * Tier 1: position / rotation / scale only (same as {@link syncBoxModelTransformFromObject3D} / {@link applyBoxModelTransformToObject3D}).
 * Tier 3: full object rebuild after non-transform field changes is experimental and costly; see {@link scheduleDescriptorBindingRebuild}.
 */

import { log } from "../util/logger.js";
import {
  applyBoxModelTransformToObject3D,
  createGroup,
  deployMesh,
  syncBoxModelTransformFromObject3D
} from "../builder/modelBuilder.js";
import {
  getObjectByThreeJsonId,
  unregisterObject
} from "./objectRegistry.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

/** @type {WeakMap<import("three").Object3D, { ldh: string; loh: string }>} */
const transformSyncMeta = new WeakMap();

/**
 * jsonDirtyIds/rebuildTimers are per RuntimeContext (see core/runtime/runtimeContext.js)
 * so two scenes editing objects that share a threeJsonId (this experimental,
 * off-by-default feature is keyed by author id) don't cross-cancel each other's
 * pending rebuilds/dirty flags. Resolution is automatic via `scene`, which every
 * entry point here already receives.
 */
export function createDescriptorBindingStore() {
  /** @type {Set<string>} */
  const jsonDirtyIds = new Set();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const rebuildTimers = new Map();

  function dispose() {
    for (const t of rebuildTimers.values()) {
      clearTimeout(t);
    }
    rebuildTimers.clear();
    jsonDirtyIds.clear();
  }

  return { jsonDirtyIds, rebuildTimers, dispose };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).descriptorBinding;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {import("three").Object3D|null|undefined} obj
 * @returns {object|null}
 */
function linkedDescriptorFromUserData(obj) {
  const u = obj?.userData;
  if (u?.objJson && typeof u.objJson === "object" && !Array.isArray(u.objJson)) {
    return u.objJson;
  }
  return null;
}

/**
 * @param {object} raw
 * @returns {object}
 */
function normalizeBindingConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      enabled: false,
      objectToJsonFromTransform: true,
      jsonToObjectFromTransform: true,
      transformConflictResolution: "object",
      objectToJsonIntervalMs: 0,
      fullRebuildDebounceMs: 320,
      byId: null,
      byIds: null,
      byName: null,
      byNames: null
    };
  }
  return {
    enabled: raw.enabled === true,
    objectToJsonFromTransform: raw.objectToJsonFromTransform !== false,
    jsonToObjectFromTransform: raw.jsonToObjectFromTransform !== false,
    transformConflictResolution: raw.transformConflictResolution === "json" ? "json" : "object",
    objectToJsonIntervalMs: Math.max(0, Number(raw.objectToJsonIntervalMs) || 0),
    fullRebuildDebounceMs: Math.max(0, Number(raw.fullRebuildDebounceMs) || 320),
    byId: raw.byId && typeof raw.byId === "object" && !Array.isArray(raw.byId) ? raw.byId : null,
    byIds: Array.isArray(raw.byIds) ? raw.byIds : null,
    byName: raw.byName && typeof raw.byName === "object" && !Array.isArray(raw.byName) ? raw.byName : null,
    byNames: Array.isArray(raw.byNames) ? raw.byNames : null
  };
}

/**
 * @param {object} worldInfo
 */
export function readDescriptorBindingConfig(worldInfo) {
  const raw = worldInfo && typeof worldInfo === "object" && !Array.isArray(worldInfo) ? worldInfo.descriptorBinding : null;
  return normalizeBindingConfig(raw);
}

/**
 * @param {object|undefined|null} descriptor
 * @returns {boolean|null} null = not configured; inherit from lower tier
 */
function coerceDescriptorBindingFlag(descriptor) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    return null;
  }
  const raw = descriptor.descriptorBinding;
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    if (typeof raw.enabled === "boolean") {
      return raw.enabled;
    }
    return true;
  }
  return null;
}

/**
 * Name key: `Object3D.name` first, else descriptor `name` (matches registry display name; refName is not resolved to avoid id-rule confusion).
 * @param {import("three").Object3D|null|undefined} object3D
 * @param {object} descriptor
 */
function bindingNameKey(object3D, descriptor) {
  return normalizeText(object3D?.name) || normalizeText(descriptor?.name);
}

/**
 * Whether binding is enabled for this node (priority: descriptor > byId > byIds > byName > byNames > global enabled).
 * @param {object} descriptor
 * @param {import("three").Object3D} object3D
 * @param {ReturnType<typeof normalizeBindingConfig>} cfg
 */
export function isDescriptorBindingEnabled(descriptor, object3D, cfg) {
  const direct = coerceDescriptorBindingFlag(descriptor);
  if (direct !== null) {
    return direct;
  }
  const id = normalizeText(descriptor?.threeJsonId);
  if (id && cfg.byId && Object.prototype.hasOwnProperty.call(cfg.byId, id)) {
    return Boolean(cfg.byId[id]);
  }
  if (id && Array.isArray(cfg.byIds) && cfg.byIds.some((x) => normalizeText(x) === id)) {
    return true;
  }
  const nk = bindingNameKey(object3D, descriptor);
  if (nk && cfg.byName && Object.prototype.hasOwnProperty.call(cfg.byName, nk)) {
    return Boolean(cfg.byName[nk]);
  }
  if (nk && Array.isArray(cfg.byNames) && cfg.byNames.some((x) => normalizeText(x) === nk)) {
    return true;
  }
  return cfg.enabled === true;
}

/**
 * @param {object} data
 */
function transformSignatureFromDescriptor(data) {
  if (!data || typeof data !== "object") {
    return "";
  }
  const p = data.position || {};
  const r = data.rotation || {};
  const s = data.scale || {};
  return [
    Number(p.x) || 0,
    Number(p.y) || 0,
    Number(p.z) || 0,
    Number(r.rotationX) || 0,
    Number(r.rotationY) || 0,
    Number(r.rotationZ) || 0,
    Number(s.scaleX) || 1,
    Number(s.scaleY) || 1,
    Number(s.scaleZ) || 1
  ].join("|");
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 */
function transformSignatureFromObject3D(object3D) {
  if (!object3D) {
    return "";
  }
  return [
    Number(object3D.position.x) || 0,
    Number(object3D.position.y) || 0,
    Number(object3D.position.z) || 0,
    Number(object3D.rotation.x) || 0,
    Number(object3D.rotation.y) || 0,
    Number(object3D.rotation.z) || 0,
    Number(object3D.scale.x) || 1,
    Number(object3D.scale.y) || 1,
    Number(object3D.scale.z) || 1
  ].join("|");
}

function disposeSubtreeGeometries(root) {
  if (!root || typeof root.traverse !== "function") {
    return;
  }
  root.traverse((o) => {
    if (!o) {
      return;
    }
    try {
      o.geometry?.dispose?.();
    } catch (_) {
      /* ignore */
    }
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (let i = 0; i < mats.length; i++) {
      try {
        mats[i]?.dispose?.();
      } catch (_) {
        /* ignore */
      }
    }
  });
}

/**
 * Recreate the root object from the current descriptor (experimental): supports single-mesh `deployMesh` or composites with `boxModelList`/`subGroup`.
 * Disposes old subtree geometry/materials and removes from parent; **does not** guarantee coverage of all objTypes.
 *
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object|string} descriptorOrThreeJsonId
 * @returns {import("three").Object3D|null}
 */
export function redeployObject(scene, descriptorOrThreeJsonId) {
  const descriptor =
    typeof descriptorOrThreeJsonId === "string"
      ? linkedDescriptorFromUserData(getObjectByThreeJsonId(normalizeText(descriptorOrThreeJsonId), scene))
      : descriptorOrThreeJsonId;
  if (!scene || !descriptor || typeof descriptor !== "object") {
    return null;
  }
  const id = normalizeText(descriptor.threeJsonId);
  const prev = id ? getObjectByThreeJsonId(id, scene) : null;
  const attachParent = prev?.parent || scene;
  if (prev && prev.parent) {
    prev.parent.remove(prev);
    unregisterObject(prev, { recursive: true, keepDescriptor: true });
    disposeSubtreeGeometries(prev);
  }
  const hasGroupShape =
    (Array.isArray(descriptor.boxModelList) && descriptor.boxModelList.length > 0) ||
    (Array.isArray(descriptor.subGroup) && descriptor.subGroup.length > 0);
  if (hasGroupShape) {
    const group = createGroup(descriptor);
    if (group) {
      attachParent.add(group);
    }
    return group;
  }
  deployMesh(descriptor, attachParent);
  return id ? getObjectByThreeJsonId(id, scene) : null;
}

/**
 * Run {@link redeployObject} after debounce (Tier 3).
 *
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object|string} descriptorOrThreeJsonId
 * @param {{ debounceMs?: number }} [opts]
 */
export function scheduleDescriptorBindingRebuild(scene, descriptorOrThreeJsonId, opts = {}) {
  const debounceMs = Number(opts.debounceMs);
  const delay = Number.isFinite(debounceMs) && debounceMs > 0 ? debounceMs : 320;

  let descriptor =
    typeof descriptorOrThreeJsonId === "string"
      ? linkedDescriptorFromUserData(getObjectByThreeJsonId(normalizeText(descriptorOrThreeJsonId), scene))
      : descriptorOrThreeJsonId;
  if (typeof descriptorOrThreeJsonId === "string" && !descriptor) {
    return;
  }
  if (!descriptor || typeof descriptor !== "object") {
    return;
  }
  const { rebuildTimers } = resolveStore(scene);
  const id = normalizeText(descriptor.threeJsonId) || JSON.stringify(descriptor).slice(0, 80);
  const prevTimer = rebuildTimers.get(id);
  if (prevTimer) {
    clearTimeout(prevTimer);
  }
  rebuildTimers.set(
    id,
    setTimeout(() => {
      rebuildTimers.delete(id);
      try {
        redeployObject(scene, descriptor);
      } catch (err) {
        log.warn("[descriptorBinding] rebuild failed:", err);
      }
    }, delay)
  );
}

/**
 * Mark that a descriptor's transforms should be pushed from JSON to the object (handled next frame by the binding loop).
 * @param {object|string} descriptorOrThreeJsonId
 * @param {*} [runtimeScope] Scene/Object3D/RuntimeContext to scope this to; omit for the shared default (single-scene behavior).
 */
export function markDescriptorBindingJsonDirty(descriptorOrThreeJsonId, runtimeScope) {
  const id =
    typeof descriptorOrThreeJsonId === "string"
      ? normalizeText(descriptorOrThreeJsonId)
      : normalizeText(descriptorOrThreeJsonId?.threeJsonId);
  if (id) {
    resolveStore(runtimeScope).jsonDirtyIds.add(id);
  }
}

/**
 * @param {import("three").Scene} scene
 * @param {import("three").Object3D} object3D
 * @param {object} descriptor
 * @param {ReturnType<typeof normalizeBindingConfig>} cfg
 */
function syncTransformsForObject(object3D, descriptor, cfg, jsonDirtyIds) {
  const id = normalizeText(descriptor?.threeJsonId);
  if (id && jsonDirtyIds.has(id)) {
    applyBoxModelTransformToObject3D(object3D);
    jsonDirtyIds.delete(id);
    transformSyncMeta.set(object3D, {
      ldh: transformSignatureFromDescriptor(descriptor),
      loh: transformSignatureFromObject3D(object3D)
    });
    return;
  }

  const oEnabled = cfg.objectToJsonFromTransform !== false;
  const jEnabled = cfg.jsonToObjectFromTransform !== false;
  const dh = transformSignatureFromDescriptor(descriptor);
  const oh = transformSignatureFromObject3D(object3D);
  let meta = transformSyncMeta.get(object3D);
  if (!meta) {
    meta = { ldh: dh, loh: oh };
    transformSyncMeta.set(object3D, meta);
    return;
  }

  if (oEnabled && !jEnabled) {
    syncBoxModelTransformFromObject3D(object3D);
    meta.ldh = transformSignatureFromDescriptor(descriptor);
    meta.loh = transformSignatureFromObject3D(object3D);
    return;
  }
  if (!oEnabled && jEnabled) {
    if (dh !== oh) {
      applyBoxModelTransformToObject3D(object3D);
    }
    meta.ldh = transformSignatureFromDescriptor(descriptor);
    meta.loh = transformSignatureFromObject3D(object3D);
    return;
  }
  if (!oEnabled && !jEnabled) {
    return;
  }

  const preferJson = cfg.transformConflictResolution === "json";
  if (dh !== meta.ldh && oh === meta.loh) {
    applyBoxModelTransformToObject3D(object3D);
  } else if (oh !== meta.loh && dh === meta.ldh) {
    syncBoxModelTransformFromObject3D(object3D);
  } else if (dh !== meta.ldh && oh !== meta.loh) {
    if (preferJson) {
      applyBoxModelTransformToObject3D(object3D);
    } else {
      syncBoxModelTransformFromObject3D(object3D);
    }
  }
  meta.ldh = transformSignatureFromDescriptor(descriptor);
  meta.loh = transformSignatureFromObject3D(object3D);
}

/**
 * @param {import("three").Scene} scene
 * @param {ReturnType<typeof normalizeBindingConfig>} cfg
 */
function tickBinding(scene, cfg) {
  if (!scene || typeof scene.traverse !== "function") {
    return;
  }
  const { jsonDirtyIds } = resolveStore(scene);
  scene.traverse((obj) => {
    if (!obj || obj === scene) {
      return;
    }
    const descriptor = linkedDescriptorFromUserData(obj);
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
      return;
    }
    if (!isDescriptorBindingEnabled(descriptor, obj, cfg)) {
      return;
    }
    syncTransformsForObject(obj, descriptor, cfg, jsonDirtyIds);
  });
}

/**
 * @param {object|null|undefined} wi
 */
function hasAnySelectiveBinding(cfg, wi) {
  if (cfg.byId || cfg.byIds?.length || cfg.byName || cfg.byNames?.length) {
    return true;
  }
  if (!wi || typeof wi !== "object") {
    return false;
  }
  /** @type {any[]} */
  const lists = [
    wi.boxModelList,
    wi.sphereModelList,
    wi.groupList,
    wi.lineList,
    wi.infoPanelList,
    wi.css3dPanelList,
    wi.heatList,
    wi.windList,
    wi.shaderSurfaceList,
    wi.planeList,
    wi.particleList,
    wi.spriteList,
    wi.tubeList,
    wi.instancedList,
    wi.skinnedList,
    wi.externalModelList,
    wi.objModelList,
    wi.modelList,
    wi.objectList,
    wi.domainModelList
  ];
  for (let i = 0; i < lists.length; i++) {
    const L = lists[i];
    if (!Array.isArray(L)) {
      continue;
    }
    for (let j = 0; j < L.length; j++) {
      if (coerceDescriptorBindingFlag(L[j]) !== null) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Start the descriptor transform binding loop.
 *
 * @param {import("three").Scene} scene
 * @param {object} [worldInfo] Reads `worldInfo.descriptorBinding`; a flattened binding object is also accepted (must match normalized shape)
 * @param {{ getWorldInfo?: () => object | null }} [options] When `getWorldInfo` is provided, re-read config each frame (hot reload)
 * @returns {{ stop: Function, flush: Function }}
 */
export function startDescriptorBinding(scene, worldInfo, options = {}) {
  let running = true;
  let rafId = 0;
  let lastIntervalTick = 0;

  const getCfg = () => {
    if (typeof options.getWorldInfo === "function") {
      return normalizeBindingConfig(options.getWorldInfo()?.descriptorBinding);
    }
    return readDescriptorBindingConfig(worldInfo || {});
  };

  const wi0 = typeof options.getWorldInfo === "function" ? options.getWorldInfo() : worldInfo;
  const cfg0 = getCfg();
  const missingBindingSection =
    typeof options.getWorldInfo !== "function" &&
    (wi0 == null || !Object.prototype.hasOwnProperty.call(wi0, "descriptorBinding"));
  if (missingBindingSection && !hasAnySelectiveBinding(cfg0, wi0)) {
    return {
      stop() {},
      flush() {
        tickBinding(scene, getCfg());
      }
    };
  }

  const loop = (t) => {
    if (!running) {
      return;
    }
    const cfg = getCfg();
    const interval = cfg.objectToJsonIntervalMs || 0;
    if (interval > 0 && t - lastIntervalTick < interval) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    lastIntervalTick = t;
    tickBinding(scene, cfg);
    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);

  return {
    stop() {
      running = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    },
    flush() {
      tickBinding(scene, getCfg());
    }
  };
}
