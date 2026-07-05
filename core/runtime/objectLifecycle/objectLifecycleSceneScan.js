/**
 * Scan scene payloads for object.ready / object.dispose JSON bindings (lazy lifecycle opt-in).
 */

import { listValidEventEntries } from "../eventMechanism/eventRecordValidation.js";
import { getFriendlySceneListEntries } from "../../handler/sceneFriendlyMap.js";

const OBJECT_LIFECYCLE_READY = "object.ready";
const OBJECT_LIFECYCLE_DISPOSE = "object.dispose";

/**
 * @param {object} record
 * @returns {boolean}
 */
export function recordHasObjectDisposeBinding(record) {
  if (!record?.events || typeof record.events !== "object") {
    return false;
  }
  return listValidEventEntries(record.events).some((entry) => entry.eventName === OBJECT_LIFECYCLE_DISPOSE);
}

/**
 * @param {object} record
 * @returns {boolean}
 */
export function recordHasObjectLifecycleEventBinding(record) {
  if (!record?.events || typeof record.events !== "object") {
    return false;
  }
  return listValidEventEntries(record.events).some(
    (entry) => entry.eventName === OBJECT_LIFECYCLE_READY || entry.eventName === OBJECT_LIFECYCLE_DISPOSE
  );
}

/**
 * @param {unknown} records
 * @returns {boolean}
 */
function walkRecordsForLifecycleBindings(records) {
  if (!Array.isArray(records)) {
    return false;
  }
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record || typeof record !== "object") {
      continue;
    }
    if (recordHasObjectLifecycleEventBinding(record)) {
      return true;
    }
    if (Array.isArray(record.subScene) && walkRecordsForLifecycleBindings(record.subScene)) {
      return true;
    }
  }
  return false;
}

function listOr(value) {
  return Array.isArray(value) ? value : [];
}

function readFriendlyListSource(payload, worldInfo, definition) {
  if (!definition || !definition.listName) {
    return [];
  }
  if (definition.scope === "topLevel") {
    return listOr(payload?.[definition.listName]);
  }
  if (definition.scope === "topLevelOrWorldInfo") {
    const topLevelList = listOr(payload?.[definition.listName]);
    if (topLevelList.length > 0) {
      return topLevelList;
    }
    return listOr(worldInfo?.[definition.listName]);
  }
  if (definition.scope === "worldInfoOrSceneConfig") {
    const fromWorld = listOr(worldInfo?.[definition.listName]);
    if (fromWorld.length > 0) {
      return fromWorld;
    }
    const sceneConfig =
      payload?.sceneConfig && typeof payload.sceneConfig === "object" ? payload.sceneConfig : {};
    return listOr(sceneConfig[definition.listName]);
  }
  return listOr(worldInfo?.[definition.listName]);
}

function friendlyPayloadHasLifecycleEventBindings(payload) {
  const worldInfo = payload?.worldInfo && typeof payload.worldInfo === "object" ? payload.worldInfo : {};
  const entries = getFriendlySceneListEntries(payload);
  for (let i = 0; i < entries.length; i++) {
    if (walkRecordsForLifecycleBindings(readFriendlyListSource(payload, worldInfo, entries[i]))) {
      return true;
    }
  }
  return false;
}

/**
 * @param {unknown} payload
 * @returns {boolean}
 */
export function scenePayloadHasLifecycleEventBindings(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  if (typeof payload.objType === "string" && typeof payload.threeJsonId === "string") {
    if (recordHasObjectLifecycleEventBinding(payload)) {
      return true;
    }
    if (Array.isArray(payload.subScene) && walkRecordsForLifecycleBindings(payload.subScene)) {
      return true;
    }
  }
  if (walkRecordsForLifecycleBindings(payload.objectList)) {
    return true;
  }
  const worldInfo = payload.worldInfo;
  if (worldInfo && typeof worldInfo === "object" && walkRecordsForLifecycleBindings(worldInfo.objectList)) {
    return true;
  }
  if (friendlyPayloadHasLifecycleEventBindings(payload)) {
    return true;
  }
  return false;
}
