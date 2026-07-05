/**
 * Door toggle trigger JSON resolution (default dblclick; unlike device panel explicit opt-in).
 */

const DOOR_TOGGLE_TRIGGERS = new Set(["none", "click", "dblclick"]);

function hasOwn(record, key) {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

function normalizeTrigger(value, fallback) {
  const key = String(value == null || value === "" ? fallback : value).trim().toLowerCase();
  return DOOR_TOGGLE_TRIGGERS.has(key) ? key : fallback;
}

/**
 * @param {object|null|undefined} record
 * @returns {"none"|"click"|"dblclick"}
 */
export function resolveDoorToggleTrigger(record) {
  if (!record || typeof record !== "object") {
    return "dblclick";
  }
  if (hasOwn(record, "doorToggleTrigger")) {
    return normalizeTrigger(record.doorToggleTrigger, "dblclick");
  }
  return "dblclick";
}

/**
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function shouldBindDoorToggle(record) {
  return resolveDoorToggleTrigger(record) !== "none";
}

/**
 * @param {string} trigger
 * @returns {string}
 */
export function mapDoorTriggerToEventName(trigger) {
  if (trigger === "click" || trigger === "dblclick") {
    return trigger;
  }
  return "";
}

/**
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function isCabinetDeployRootRecord(record) {
  if (!record || typeof record !== "object") {
    return false;
  }
  const objType = String(record.objType || record.type || "").trim().toLowerCase();
  const domain = String(record.domain || "").trim();
  return objType === "domain" && domain === "device.cabinet";
}
