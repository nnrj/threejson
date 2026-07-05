import { log } from "../../../util/logger.js";

/** @type {Map<string, Function>} */
const registry = new Map();

function normalizeType(type) {
  return typeof type === "string" ? type.trim() : "";
}

/**
 * @param {string} type
 * @param {(action: object, ctx: object) => unknown|Promise<unknown>} executor
 * @returns {boolean}
 */
export function registerEventAction(type, executor) {
  const key = normalizeType(type);
  if (!key || typeof executor !== "function") {
    return false;
  }
  const existing = registry.get(key);
  if (existing && existing !== executor) {
    log.warn("[eventMechanism] registerEventAction replaced existing executor", { type: key });
  }
  registry.set(key, executor);
  return true;
}

/**
 * @param {string} type
 * @returns {boolean}
 */
export function unregisterEventAction(type) {
  const key = normalizeType(type);
  return key ? registry.delete(key) : false;
}

/**
 * @param {string} type
 * @returns {boolean}
 */
export function hasEventAction(type) {
  const key = normalizeType(type);
  return key ? registry.has(key) : false;
}

/**
 * @param {object} action
 * @param {object} ctx
 * @returns {Promise<{ ok: boolean, skipped?: boolean, result?: unknown }>}
 */
export async function executeRegisteredEventAction(action, ctx = {}) {
  const type = normalizeType(action?.type);
  const executor = type ? registry.get(type) : null;
  if (!executor) {
    log.warn("[eventMechanism] action skipped: unregistered type", {
      type,
      threeJsonId: ctx.threeJsonId,
      eventName: ctx.eventName
    });
    return { ok: false, skipped: true };
  }
  const result = await executor(action, ctx);
  return { ok: true, result };
}

export function _clearEventActionRegistryForTests() {
  registry.clear();
}

export function _snapshotEventActionRegistryForTests() {
  return new Map(registry);
}

export function _restoreEventActionRegistryForTests(snapshot) {
  registry.clear();
  if (!snapshot) {
    return;
  }
  for (const [type, executor] of snapshot.entries()) {
    registry.set(type, executor);
  }
}
