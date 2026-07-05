/**
 * JSON-declared bound BoxHelper: two-phase deploy (content object, then after registry is ready).
 * Unrelated to editor selection outline (boxEdgeHelper.js); do not mix the two.
 */
import * as THREE from "three";
import { log } from "../util/logger.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject, getObjectByThreeJsonId, rebuildObjectRegistryFromScene } from "./objectRegistry.js";
import { listOr } from "../util/util.js";

const DEFAULT_BOX_HELPER_COLOR = 0xffff00;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {string|number|undefined|null} color
 * @returns {number|undefined}
 */
function resolveBoxHelperColor(color) {
  if (color === undefined || color === null || color === "") {
    return undefined;
  }
  if (typeof color === "number" && Number.isFinite(color)) {
    return color;
  }
  if (typeof color === "string") {
    try {
      return new THREE.Color(color).getHex();
    } catch (_e) {
      return DEFAULT_BOX_HELPER_COLOR;
    }
  }
  return undefined;
}

/**
 * @param {object} record
 * @returns {string[]}
 */
export function collectBoxHelperTargetIds(record) {
  if (!record || typeof record !== "object") {
    return [];
  }
  const ids = [];
  const seen = new Set();

  function pushId(value) {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    ids.push(trimmed);
  }

  if (Array.isArray(record.targetThreeJsonIds)) {
    for (let i = 0; i < record.targetThreeJsonIds.length; i++) {
      pushId(record.targetThreeJsonIds[i]);
    }
  }
  if (typeof record.targetThreeJsonId === "string") {
    pushId(record.targetThreeJsonId);
  }
  return ids;
}

/**
 * @param {object} normalized
 * @returns {Array<{
 *   helperThreeJsonId: string,
 *   targetThreeJsonId: string,
 *   sourceRecordId: string,
 *   source: "inline"|"record",
 *   color?: string|number,
 *   visible: boolean
 * }>}
 */
export function collectBoxHelperBindings(normalized) {
  const objectList = listOr(normalized?.objectList);
  /** @type {Map<string, object>} */
  const byHelperId = new Map();

  function upsertBinding(binding) {
    if (!binding?.helperThreeJsonId || !binding?.targetThreeJsonId) {
      return;
    }
    byHelperId.set(binding.helperThreeJsonId, binding);
  }

  for (let i = 0; i < objectList.length; i++) {
    const record = objectList[i];
    if (!record || typeof record !== "object") {
      continue;
    }
    const objType = normalizeObjType(record.objType);

    if (objType === "boxhelper") {
      const sourceRecordId =
        typeof record.threeJsonId === "string" && record.threeJsonId.trim()
          ? record.threeJsonId.trim()
          : "";
      if (!sourceRecordId) {
        log.warn("[boxHelper] objType boxHelper record missing threeJsonId; skipped");
        continue;
      }
      const targetIds = collectBoxHelperTargetIds(record);
      if (targetIds.length === 0) {
        log.warn(`[boxHelper] record "${sourceRecordId}" has no targetThreeJsonIds; skipped`);
        continue;
      }
      const visible = record.visible !== false;
      const color = record.color;
      for (let ti = 0; ti < targetIds.length; ti++) {
        const targetId = targetIds[ti];
        upsertBinding({
          helperThreeJsonId: `${sourceRecordId}@${targetId}`,
          targetThreeJsonId: targetId,
          sourceRecordId,
          source: "record",
          color,
          visible
        });
      }
      continue;
    }

    const hostId =
      typeof record.threeJsonId === "string" && record.threeJsonId.trim()
        ? record.threeJsonId.trim()
        : "";
    const inline = record.boxHelper;
    if (!hostId || !isPlainObject(inline)) {
      continue;
    }
    upsertBinding({
      helperThreeJsonId: `${hostId}@boxHelper`,
      targetThreeJsonId: hostId,
      sourceRecordId: hostId,
      source: "inline",
      color: inline.color,
      visible: inline.visible !== false
    });
  }

  return [...byHelperId.values()];
}

/**
 * @param {import("three").Object3D} target
 * @param {object} binding
 * @returns {THREE.BoxHelper|null}
 */
function createJsonBoundBoxHelper(target, binding) {
  if (!target) {
    return null;
  }
  const color = resolveBoxHelperColor(binding.color);
  const helper =
    color !== undefined ? new THREE.BoxHelper(target, color) : new THREE.BoxHelper(target);
  helper.visible = binding.visible !== false;
  trackDisposableResource(helper);
  helper.userData = {
    ...(typeof helper.userData === "object" && helper.userData ? helper.userData : {}),
    objJson: {
      objType: "boxHelper",
      threeJsonId: binding.helperThreeJsonId,
      sourceRecordId: binding.sourceRecordId,
      targetThreeJsonId: binding.targetThreeJsonId,
      ...(binding.color !== undefined && binding.color !== null ? { color: binding.color } : {}),
      visible: binding.visible !== false
    }
  };
  helper.setFromObject(target);
  return helper;
}

/**
 * @param {import("three").Scene|import("three").Object3D|null|undefined} scene
 * @param {object} normalized
 * @param {{ onMissingTarget?: (targetId: string, binding: object) => void }} [hooks]
 * @returns {THREE.BoxHelper[]}
 */
export function deployBoundBoxHelpersFromPayload(scene, normalized, hooks = {}) {
  if (!scene) {
    return [];
  }
  rebuildObjectRegistryFromScene(scene);
  const bindings = collectBoxHelperBindings(normalized);
  const onMissing =
    typeof hooks.onMissingTarget === "function" ? hooks.onMissingTarget : null;
  const deployed = [];

  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    const target = getObjectByThreeJsonId(binding.targetThreeJsonId);
    if (!target) {
      const message = `[boxHelper] target not found: ${binding.targetThreeJsonId} (helper ${binding.helperThreeJsonId})`;
      log.warn(message);
      if (onMissing) {
        onMissing(binding.targetThreeJsonId, binding);
      }
      continue;
    }
    const helper = createJsonBoundBoxHelper(target, binding);
    if (!helper) {
      continue;
    }
    scene.add(helper);
    registerObject(helper, helper.userData?.objJson, { recursive: false });
    deployed.push(helper);
  }

  return deployed;
}
