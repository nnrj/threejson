/**
 * Runtime bind/unbind API (M1 spike + foundation for M2 JSON binding).
 *
 * The "active" event listener manager slot is per RuntimeContext (see
 * core/runtime/runtimeContext.js) so attaching a manager for one scene never
 * disposes a different scene's still-active manager. `attachEventListenerManager`/
 * `getActiveEventListenerManager`/`detachEventListenerManager`/`bindEvent`/`unbindEvent`
 * take an optional trailing `runtimeScope` (Scene/RuntimeContext/ctx bag); omitting it
 * falls back to one shared default slot, matching today's single-scene behavior.
 */

import { log } from "../../util/logger.js";
import { buildBindingMetadataFromObject } from "./bindingDescriptor.js";
import { addBinding, removeBinding } from "./eventBindingRegistry.js";
import { createEventListenerManager } from "./eventListenerManager.js";
import { isEventAllowedForObjType } from "./objTypeEventCapabilities.js";
import { isPlatformEventName, normalizePlatformEventName } from "./platformEvents.js";
import { resolveEventTarget, resolveEventTargets } from "./resolveEventTarget.js";
import { resolveRuntimeContext } from "../runtimeContext.js";

export function createEventManagerSlotStore() {
  /** @type {import("./eventListenerManager.js").ReturnType<createEventListenerManager>|null} */
  let activeManager = null;
  /** @type {string} */
  let activeSceneToken = "";

  function attachEventListenerManager(manager, sceneToken = "") {
    if (activeManager && activeManager !== manager) {
      activeManager.dispose();
    }
    activeManager = manager;
    activeSceneToken = typeof sceneToken === "string" ? sceneToken.trim() : "";
  }

  function getActiveEventListenerManager() {
    return activeManager;
  }

  function getActiveEventSceneToken() {
    return activeSceneToken;
  }

  function detachEventListenerManager() {
    if (activeManager) {
      activeManager.dispose();
      activeManager = null;
    }
    activeSceneToken = "";
  }

  return {
    attachEventListenerManager,
    getActiveEventListenerManager,
    getActiveEventSceneToken,
    detachEventListenerManager,
    dispose: detachEventListenerManager
  };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).eventManagerSlot;
}

/**
 * @param {import("./eventListenerManager.js").ReturnType<createEventListenerManager>} manager
 * @param {string} [sceneToken]
 * @param {*} [runtimeScope]
 */
export function attachEventListenerManager(manager, sceneToken = "", runtimeScope) {
  return resolveStore(runtimeScope).attachEventListenerManager(manager, sceneToken);
}

export function getActiveEventListenerManager(runtimeScope) {
  return resolveStore(runtimeScope).getActiveEventListenerManager();
}

export function getActiveEventSceneToken(runtimeScope) {
  return resolveStore(runtimeScope).getActiveEventSceneToken();
}

export function detachEventListenerManager(runtimeScope) {
  return resolveStore(runtimeScope).detachEventListenerManager();
}

/**
 * @param {object|string|null|undefined} targetSelector
 * @param {string} eventName
 * @param {Function|object|string|null|undefined} handlerOrPayload
 * @param {object} [options]
 * @returns {string|null} binding id
 */
export function bindEvent(targetSelector, eventName, handlerOrPayload, options = {}) {
  if (Array.isArray(targetSelector)) {
    /** @type {string[]} */
    const bindingIds = [];
    for (let i = 0; i < targetSelector.length; i++) {
      const bindingId = bindEvent(targetSelector[i], eventName, handlerOrPayload, options);
      if (bindingId) {
        bindingIds.push(bindingId);
      }
    }
    return bindingIds.length > 0 ? bindingIds : null;
  }
  const runtimeScope = options.runtimeScope;
  const manager = options.manager ?? getActiveEventListenerManager(runtimeScope);
  const eventKey = normalizePlatformEventName(eventName);
  if (!isPlatformEventName(eventKey)) {
    log.warn("[eventMechanism] bindEvent rejected: invalid platform event", { eventName });
    return null;
  }
  const targets = resolveEventTargets(targetSelector, runtimeScope);
  if (targets.length === 0) {
    log.warn("[eventMechanism] bindEvent rejected: target not found", { targetSelector });
    return null;
  }
  const object = targets[0];
  const metadata = buildBindingMetadataFromObject(object);
  if (!metadata) {
    log.warn("[eventMechanism] bindEvent rejected: missing descriptor metadata", { targetSelector });
    return null;
  }
  if (!isEventAllowedForObjType(metadata.objType, eventKey)) {
    log.warn("[eventMechanism] bindEvent rejected: event not allowed for objType", {
      objType: metadata.objType,
      eventName: eventKey
    });
    return null;
  }
  let payload = handlerOrPayload;
  if (typeof handlerOrPayload === "function") {
    payload = { handler: handlerOrPayload };
  } else if (typeof handlerOrPayload === "string") {
    payload = { scriptText: handlerOrPayload };
  }
  const entry = addBinding({
    threeJsonId: metadata.threeJsonId,
    eventName: eventKey,
    source: "runtime",
    objType: metadata.objType,
    domainKey: metadata.domainKey,
    executorKind: metadata.executorKind,
    payload,
    sceneToken: options.sceneToken ?? getActiveEventSceneToken(runtimeScope)
  }, runtimeScope ?? object);
  if (!entry) {
    return null;
  }
  manager?.notifyBindingAdded(eventKey);
  return entry.id;
}

/**
 * @param {string} bindingId
 * @param {object} [options]
 * @returns {boolean}
 */
export function unbindEvent(bindingId, options = {}) {
  const runtimeScope = options.runtimeScope;
  const manager = options.manager ?? getActiveEventListenerManager(runtimeScope);
  const removed = removeBinding(bindingId, runtimeScope);
  if (!removed) {
    return false;
  }
  manager?.notifyBindingRemoved(removed.eventName);
  return true;
}

export { createEventListenerManager };
