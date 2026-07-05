import { log } from "../util/logger.js";
/**
 * subScene hierarchy: pre-normalization (nested canonical) and layout conversion (nested | flat | subSceneList).
 */

const RUNTIME_OBJ_TYPES = new Set([
  "scene",
  "camera",
  "renderer",
  "controls",
  "light",
  "renderloop"
]);

const DEFAULT_MAX_DEPTH = 32;

function cloneJson(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getThreeJsonId(record) {
  const id = record?.threeJsonId;
  return typeof id === "string" ? id.trim() : "";
}

function isRuntimeRecord(record) {
  return RUNTIME_OBJ_TYPES.has(normalizeObjType(record?.objType));
}

function warn(policy, warnings, message) {
  if (policy === "strict") {
    throw new Error(message);
  }
  warnings.push(message);
  log.warn(`[subScene] ${message}`);
}

function stripLegacyGroupChildFields(record) {
  if (!record || typeof record !== "object") {
    return;
  }
  delete record.boxModelList;
  delete record.subGroup;
  if (Array.isArray(record.infoPanelList)) {
    delete record.infoPanelList;
  }
}

function ensureSubSceneArray(record) {
  if (!Array.isArray(record.subScene)) {
    record.subScene = [];
  }
  return record.subScene;
}

/**
 * @param {object} record
 * @param {Set<string>} seenIds
 * @param {string} policy
 * @param {string[]} warnings
 * @param {number} depth
 */
function normalizeRecordTree(record, seenIds, policy, warnings, depth) {
  if (!record || typeof record !== "object" || depth > DEFAULT_MAX_DEPTH) {
    if (depth > DEFAULT_MAX_DEPTH) {
      warn(policy, warnings, `max subScene depth exceeded (${DEFAULT_MAX_DEPTH})`);
    }
    return;
  }
  stripLegacyGroupChildFields(record);
  const id = getThreeJsonId(record);
  if (id) {
    if (seenIds.has(id)) {
      warn(policy, warnings, `duplicate threeJsonId "${id}" — keeping first occurrence`);
      return;
    }
    seenIds.add(id);
  }
  delete record.parentThreeJsonId;
  const children = Array.isArray(record.subScene) ? record.subScene : [];
  record.subScene = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child || typeof child !== "object") {
      continue;
    }
    const cloned = cloneJson(child);
    normalizeRecordTree(cloned, seenIds, policy, warnings, depth + 1);
    record.subScene.push(cloned);
  }
}

/**
 * @param {object[]} objectList
 * @param {string} sceneDocId
 * @param {string} policy
 * @param {string[]} warnings
 * @returns {object[]}
 */
function normalizeFlatParents(objectList, sceneDocId, policy, warnings) {
  const roots = [];
  const idToRecord = new Map();
  const pending = [];

  for (let i = 0; i < objectList.length; i++) {
    const record = objectList[i];
    if (!record || typeof record !== "object") {
      continue;
    }
    const id = getThreeJsonId(record);
    if (id) {
      if (idToRecord.has(id)) {
        warn(policy, warnings, `duplicate threeJsonId "${id}" in objectList — keeping first`);
        continue;
      }
      idToRecord.set(id, record);
    }
    pending.push(record);
  }

  for (let i = 0; i < pending.length; i++) {
    const record = pending[i];
    const parentId = typeof record.parentThreeJsonId === "string" ? record.parentThreeJsonId.trim() : "";
    delete record.parentThreeJsonId;
    if (!parentId || parentId === sceneDocId) {
      roots.push(record);
      continue;
    }
    const parent = idToRecord.get(parentId);
    if (!parent) {
      warn(policy, warnings, `parentThreeJsonId "${parentId}" not found — keeping child at scene root`);
      roots.push(record);
      continue;
    }
    ensureSubSceneArray(parent).push(record);
  }

  return roots;
}

/**
 * @param {object[]} objectList
 * @param {object[]} subSceneList
 * @param {string} policy
 * @param {string[]} warnings
 */
function mergeSubSceneListBlocks(objectList, subSceneList, policy, warnings) {
  if (!Array.isArray(subSceneList) || subSceneList.length === 0) {
    return;
  }
  const idToRecord = new Map();
  for (let i = 0; i < objectList.length; i++) {
    const id = getThreeJsonId(objectList[i]);
    if (id) {
      idToRecord.set(id, objectList[i]);
    }
  }

  function indexNested(records) {
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec || typeof rec !== "object") {
        continue;
      }
      const id = getThreeJsonId(rec);
      if (id) {
        idToRecord.set(id, rec);
      }
      if (Array.isArray(rec.subScene)) {
        indexNested(rec.subScene);
      }
    }
  }
  indexNested(objectList);

  for (let b = 0; b < subSceneList.length; b++) {
    const block = subSceneList[b];
    if (!block || typeof block !== "object") {
      continue;
    }
    const parentId = typeof block.parentThreeJsonId === "string" ? block.parentThreeJsonId.trim() : "";
    const objects = Array.isArray(block.objects)
      ? block.objects
      : Array.isArray(block.subScene)
        ? block.subScene
        : [];
    if (!parentId) {
      warn(policy, warnings, "subSceneList block missing parentThreeJsonId — skipping block");
      continue;
    }
    const parent = idToRecord.get(parentId);
    if (!parent) {
      warn(policy, warnings, `subSceneList parent "${parentId}" not found — skipping block`);
      continue;
    }
    const target = ensureSubSceneArray(parent);
    for (let i = 0; i < objects.length; i++) {
      if (objects[i] && typeof objects[i] === "object") {
        target.push(cloneJson(objects[i]));
      }
    }
  }
}

/**
 * @param {object} payload
 * @param {{ policy?: "warn"|"strict", sceneDocId?: string, subSceneList?: object[] }} [options]
 * @returns {{ payload: object, warnings: string[] }}
 */
function normalizeSubSceneHierarchy(payload, options = {}) {
  const policy = options.policy === "strict" ? "strict" : "warn";
  const warnings = [];
  if (!payload || typeof payload !== "object") {
    return { payload, warnings };
  }

  const next = cloneJson(payload);
  const sceneDocId = options.sceneDocId
    || (typeof next.threeJsonId === "string" ? next.threeJsonId.trim() : "");

  const subSceneList = Array.isArray(options.subSceneList)
    ? options.subSceneList
    : Array.isArray(next.subSceneList)
      ? next.subSceneList
      : [];
  delete next.subSceneList;

  if (Array.isArray(next.objectList)) {
    const contentOnly = [];
    const runtime = [];
    for (let i = 0; i < next.objectList.length; i++) {
      const rec = next.objectList[i];
      if (isRuntimeRecord(rec)) {
        runtime.push(rec);
      } else {
        contentOnly.push(rec);
      }
    }
    mergeSubSceneListBlocks(contentOnly, subSceneList, policy, warnings);
    const roots = normalizeFlatParents(contentOnly, sceneDocId, policy, warnings);
    const seenIds = new Set();
    const normalizedContent = [];
    for (let i = 0; i < roots.length; i++) {
      const rec = roots[i];
      const id = getThreeJsonId(rec);
      if (id && seenIds.has(id)) {
        continue;
      }
      normalizeRecordTree(rec, seenIds, policy, warnings, 0);
      normalizedContent.push(rec);
    }
    next.objectList = [...runtime, ...normalizedContent];
  }

  return { payload: next, warnings };
}

/**
 * @param {object} record
 * @param {{ policy?: "warn"|"strict" }} [options]
 * @returns {{ record: object, warnings: string[] }}
 */
function normalizeSubSceneOnRecord(record, options = {}) {
  const policy = options.policy === "strict" ? "strict" : "warn";
  const warnings = [];
  if (!record || typeof record !== "object") {
    return { record, warnings };
  }
  const next = cloneJson(record);
  const seenIds = new Set();
  normalizeRecordTree(next, seenIds, policy, warnings, 0);
  return { record: next, warnings };
}

function collectFlatFromNested(records, parentId, out) {
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec || typeof rec !== "object") {
      continue;
    }
    const flat = cloneJson(rec);
    const children = Array.isArray(flat.subScene) ? flat.subScene : [];
    delete flat.subScene;
    if (parentId) {
      flat.parentThreeJsonId = parentId;
    }
    out.push(flat);
    const id = getThreeJsonId(rec);
    if (children.length > 0 && id) {
      collectFlatFromNested(children, id, out);
    }
  }
}

/**
 * @param {object} payload
 * @returns {object}
 */
function nestedToFlatPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const next = cloneJson(payload);
  if (!Array.isArray(next.objectList)) {
    delete next.subSceneList;
    return next;
  }
  const runtime = [];
  const flat = [];
  for (let i = 0; i < next.objectList.length; i++) {
    const rec = next.objectList[i];
    if (isRuntimeRecord(rec)) {
      runtime.push(rec);
      continue;
    }
    const copy = cloneJson(rec);
    const children = Array.isArray(copy.subScene) ? copy.subScene : [];
    delete copy.subScene;
    flat.push(copy);
    const id = getThreeJsonId(rec);
    if (children.length > 0 && id) {
      collectFlatFromNested(children, id, flat);
    }
  }
  next.objectList = [...runtime, ...flat];
  delete next.subSceneList;
  return next;
}

/**
 * @param {object} payload
 * @returns {object}
 */
function nestedToSubSceneListPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  const next = cloneJson(payload);
  if (!Array.isArray(next.objectList)) {
    return next;
  }
  const runtime = [];
  const roots = [];
  const blocks = [];

  for (let i = 0; i < next.objectList.length; i++) {
    const rec = next.objectList[i];
    if (isRuntimeRecord(rec)) {
      runtime.push(rec);
      continue;
    }
    const copy = cloneJson(rec);
    const children = Array.isArray(copy.subScene) ? copy.subScene : [];
    delete copy.subScene;
    roots.push(copy);
    const parentId = getThreeJsonId(rec);
    if (children.length > 0 && parentId) {
      blocks.push({
        parentThreeJsonId: parentId,
        objects: children.map((c) => cloneJson(c))
      });
    }
  }

  next.objectList = [...runtime, ...roots];
  if (blocks.length > 0) {
    next.subSceneList = blocks;
  } else {
    delete next.subSceneList;
  }
  return next;
}

/**
 * @param {object} payload
 * @param {"nested"|"flat"|"subSceneList"} layout
 * @returns {object}
 */
function applySubSceneLayout(payload, layout = "nested") {
  const mode = layout === "flat" || layout === "subSceneList" ? layout : "nested";
  if (mode === "flat") {
    return nestedToFlatPayload(payload);
  }
  if (mode === "subSceneList") {
    return nestedToSubSceneListPayload(payload);
  }
  return cloneJson(payload);
}

/**
 * Convert descriptors that still carry in-group boxModelList/subGroup/infoPanelList into subScene (for domain factories).
 * @param {object} groupObj
 * @returns {object}
 */
function ensureGroupObjTypeForNestedContainer(record) {
  if (!record || typeof record !== "object") {
    return;
  }
  const objType = normalizeObjType(record.objType);
  if (objType) {
    return;
  }
  const hasNested =
    (Array.isArray(record.subScene) && record.subScene.length > 0) ||
    (Array.isArray(record.boxModelList) && record.boxModelList.length > 0) ||
    (Array.isArray(record.subGroup) && record.subGroup.length > 0) ||
    (Array.isArray(record.infoPanelList) && record.infoPanelList.length > 0);
  if (hasNested) {
    record.objType = "group";
  }
}

function migrateGroupDescriptorToSubScene(groupObj) {
  if (!groupObj || typeof groupObj !== "object") {
    return groupObj;
  }
  ensureGroupObjTypeForNestedContainer(groupObj);
  const subScene = Array.isArray(groupObj.subScene) ? [...groupObj.subScene] : [];
  if (Array.isArray(groupObj.boxModelList) && groupObj.boxModelList.length > 0) {
    for (let i = 0; i < groupObj.boxModelList.length; i++) {
      subScene.push(cloneJson(groupObj.boxModelList[i]));
    }
    delete groupObj.boxModelList;
  }
  if (Array.isArray(groupObj.subGroup) && groupObj.subGroup.length > 0) {
    for (let i = 0; i < groupObj.subGroup.length; i++) {
      const child = cloneJson(groupObj.subGroup[i]);
      ensureGroupObjTypeForNestedContainer(child);
      migrateGroupDescriptorToSubScene(child);
      subScene.push(child);
    }
    delete groupObj.subGroup;
  }
  if (Array.isArray(groupObj.infoPanelList) && groupObj.infoPanelList.length > 0) {
    for (let i = 0; i < groupObj.infoPanelList.length; i++) {
      const panel = cloneJson(groupObj.infoPanelList[i]);
      if (!panel.objType) {
        panel.objType = "infopanel";
      }
      subScene.push(panel);
    }
    delete groupObj.infoPanelList;
  }
  if (subScene.length > 0) {
    groupObj.subScene = subScene;
  }
  return groupObj;
}

export {
  applySubSceneLayout,
  migrateGroupDescriptorToSubScene,
  normalizeSubSceneHierarchy,
  normalizeSubSceneOnRecord,
  nestedToFlatPayload,
  nestedToSubSceneListPayload
};
