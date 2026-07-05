/**
 * Runtime registry and target operations for deployed post-processing passes (no business semantics).
 */

/** @type {Map<string, { pass: object, record: object, passType: string }>} */
const passesById = new Map();

/**
 * @param {string} passId
 * @param {object} pass
 * @param {object} record
 * @param {string} passType
 */
export function registerDeployedPass(passId, pass, record, passType) {
  const key = typeof passId === "string" ? passId.trim() : "";
  if (!key || !pass) {
    return;
  }
  passesById.set(key, {
    pass,
    record: record && typeof record === "object" ? record : {},
    passType: typeof passType === "string" ? passType : ""
  });
}

/**
 * @param {string} passId
 * @returns {{ pass: object, record: object, passType: string }|null}
 */
export function getDeployedPass(passId) {
  const key = typeof passId === "string" ? passId.trim() : "";
  return key ? passesById.get(key) ?? null : null;
}

/**
 * @param {object} pass
 */
export function syncPassActivity(pass) {
  if (!pass || !pass.selectedObjects) {
    return;
  }
  const n = pass.selectedObjects.length;
  if (typeof pass.enabled === "boolean") {
    pass.enabled = n > 0;
  }
}

/**
 * @param {string} passId
 * @param {import("three").Object3D[]} objects
 */
export function setPassTargets(passId, objects) {
  const entry = getDeployedPass(passId);
  if (!entry?.pass?.selectedObjects) {
    return;
  }
  entry.pass.selectedObjects = Array.isArray(objects) ? [...objects] : [];
  syncPassActivity(entry.pass);
}

/**
 * @param {string} passId
 * @param {import("three").Object3D[]} objects
 */
export function addPassTargets(passId, objects) {
  const entry = getDeployedPass(passId);
  if (!entry?.pass?.selectedObjects || !Array.isArray(objects)) {
    return;
  }
  const current = entry.pass.selectedObjects;
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj && !current.includes(obj)) {
      current.push(obj);
    }
  }
  syncPassActivity(entry.pass);
}

/**
 * @param {string} passId
 * @param {import("three").Object3D} object
 */
export function removePassTarget(passId, object) {
  const entry = getDeployedPass(passId);
  if (!entry?.pass?.selectedObjects) {
    return;
  }
  const list = entry.pass.selectedObjects;
  const idx = list.indexOf(object);
  if (idx >= 0) {
    list.splice(idx, 1);
  }
  syncPassActivity(entry.pass);
}

/**
 * @param {string} passId
 */
export function clearPassTargets(passId) {
  const entry = getDeployedPass(passId);
  if (!entry?.pass?.selectedObjects) {
    return;
  }
  entry.pass.selectedObjects = [];
  syncPassActivity(entry.pass);
}

export function clearPassRuntimeRegistry() {
  passesById.clear();
}

/**
 * @returns {string[]}
 */
export function listDeployedPassIds() {
  return Array.from(passesById.keys());
}
