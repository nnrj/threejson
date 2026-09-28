import { log } from "../../../util/logger.js";
import { validateCommandSchema } from "../../../command/contracts.js";

/** @type {Map<string, Function>} */
const registry = new Map();
const contracts = new WeakMap();

function normalizeType(type) {
  return typeof type === "string" ? type.trim() : "";
}

/**
 * @param {string} type
 * @param {(action: object, ctx: object) => unknown|Promise<unknown>} executor
 * @returns {boolean}
 */
export function registerEventAction(type, executor, contract) {
  const key = normalizeType(type);
  if (!key || typeof executor !== "function") {
    return false;
  }
  const existing = registry.get(key);
  if (existing && existing !== executor) {
    log.warn("[eventMechanism] registerEventAction replaced existing executor", { type: key });
  }
  if (contract) {
    if (!contract.inputSchema) throw new TypeError("Agent-discoverable actions require an inputSchema.");
    contracts.set(executor, structuredClone({ ...contract, type: key, effects: "runtime-only", transactional: false, undoable: false }));
  }
  registry.set(key, executor);
  return true;
}

/** Existing event executors opt into discovery with a schema; untyped callbacks stay private. */
export function listEventActionSpecs() {
  return [...registry].flatMap(([type, executor]) => contracts.has(executor) ? [{ ...structuredClone(contracts.get(executor)), type }] : []);
}
export async function invokeContractedEventAction(type, params, ctx) {
  const executor = registry.get(type), spec = executor && contracts.get(executor);
  if (!spec) throw Object.assign(new Error(`Action is not registered with a machine-readable contract: ${type}`), { code: "ACTION_UNAVAILABLE" });
  validateCommandSchema(params, spec.inputSchema);
  if (spec.targets?.length && !spec.targets.some((t) => t.toLowerCase() === String(ctx.object?.userData?.objJson?.objType).toLowerCase())) throw Object.assign(new Error("Action target type does not match its contract."), { code: "INVALID_ACTION_TARGET" });
  ctx.signal?.throwIfAborted();
  return executor({ ...params, type }, ctx);
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
