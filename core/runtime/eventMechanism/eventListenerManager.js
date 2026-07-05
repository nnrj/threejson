/**
 * EventListenerManager (ELM) skeleton:
 * - lazy listener activation via binding refcount
 * - platform event dispatch to core/domain executors
 * - optional global listeners
 */

import { log } from "../../util/logger.js";
import { getObjectByThreeJsonId } from "../../handler/objectRegistry.js";
import {
  getBindings,
  getThreeJsonIdsWithBindingsForEvent
} from "./eventBindingRegistry.js";
import { invokeDomainExecuteBoundEvent } from "./eventDomainContract.js";
import { isPlatformEventName, normalizePlatformEventName } from "./platformEvents.js";
import {
  bindingHasActionPayload,
  bindingHasRuntimeHandler,
  bindingHasScriptPayload,
  partitionBindingsForExecution
} from "./bindingPayload.js";
import { executeScriptBinding } from "./createCoreBindingExecutor.js";
import { executeActionBinding } from "./coreActions/index.js";

/** @typedef {object} EventDispatchContext
 * @property {import("three").Object3D|null} [object]
 * @property {string} [threeJsonId]
 * @property {string} [eventName]
 * @property {unknown} [nativeEvent]
 * @property {object} [sceneRuntime]
 */

/** @typedef {(ctx: EventDispatchContext) => void|Promise<void>} CoreBindingExecutor */

/** @typedef {object} EventListenerHost
 * @property {EventTarget|null|undefined} [canvas]
 * @property {Document|null|undefined} [document]
 * @property {(eventName: string, nativeEvent: Event) => string|null|undefined|Promise<string|null|undefined>} [resolvePickThreeJsonId]
 * @property {(nativeEvent: Event) => boolean} [isCanvasPickEvent]
 * @property {(eventName: string, nativeEvent: Event) => void|Promise<void>} [dispatchFromNativeEvent]
 * @property {(manager: ReturnType<typeof createEventListenerManager>) => (() => void)|null|undefined} [createPointerHoverListener]
 */

/** @typedef {object} EventListenerManagerOptions
 * @property {EventListenerHost} [host]
 * @property {CoreBindingExecutor} [coreBindingExecutor]
 * @property {string} [logPrefix]
 */

/**
 * @param {import("./eventBindingRegistry.js").EventBindingEntry} binding
 * @param {EventDispatchContext} ctx
 * @param {CoreBindingExecutor|undefined} coreBindingExecutor
 */
async function executeDomainBinding(binding, ctx, coreBindingExecutor) {
  const object = ctx.object ?? getObjectByThreeJsonId(binding.threeJsonId);
  const dispatchCtx = {
    ...ctx,
    object,
    threeJsonId: binding.threeJsonId,
    binding
  };
  await invokeDomainExecuteBoundEvent({
    ...dispatchCtx,
    domainKey: binding.domainKey,
    payload: binding.payload,
    eventName: binding.eventName
  });
}

/**
 * @param {import("./eventBindingRegistry.js").EventBindingEntry} binding
 * @param {EventDispatchContext} ctx
 * @param {CoreBindingExecutor|undefined} coreBindingExecutor
 */
async function executeHandlerBinding(binding, ctx, coreBindingExecutor) {
  const object = ctx.object ?? getObjectByThreeJsonId(binding.threeJsonId);
  const dispatchCtx = {
    ...ctx,
    object,
    threeJsonId: binding.threeJsonId,
    binding
  };
  const payload = binding.payload;
  if (payload && typeof payload === "object" && typeof payload.handler === "function") {
    await payload.handler(dispatchCtx);
    return;
  }
  if (typeof coreBindingExecutor === "function") {
    await coreBindingExecutor(dispatchCtx);
  }
}

/**
 * Execute a single binding (legacy helper; prefer partitioned dispatch in ELM).
 * @param {import("./eventBindingRegistry.js").EventBindingEntry} binding
 * @param {EventDispatchContext} ctx
 * @param {CoreBindingExecutor|undefined} coreBindingExecutor
 */
async function executeBinding(binding, ctx, coreBindingExecutor) {
  const object = ctx.object ?? getObjectByThreeJsonId(binding.threeJsonId);
  const dispatchCtx = {
    ...ctx,
    object,
    threeJsonId: binding.threeJsonId,
    binding
  };
  const didExecuteDomain =
    binding.executorKind === "domain" &&
    !bindingHasActionPayload(binding) &&
    !bindingHasScriptPayload(binding);
  if (didExecuteDomain) {
    await executeDomainBinding(binding, dispatchCtx, coreBindingExecutor);
  }
  if (bindingHasActionPayload(binding)) {
    await executeActionBinding(binding, dispatchCtx);
  }
  if (bindingHasScriptPayload(binding) || binding.executorKind === "core") {
    await executeScriptBinding(binding, dispatchCtx, coreBindingExecutor);
    return;
  }
  if (bindingHasRuntimeHandler(binding)) {
    await executeHandlerBinding(binding, dispatchCtx, coreBindingExecutor);
    return;
  }
  if (didExecuteDomain) {
    return;
  }
  log.warn("[eventMechanism] core binding has no executor", {
    threeJsonId: binding.threeJsonId,
    eventName: binding.eventName,
    bindingId: binding.id
  });
}

/**
 * @param {EventListenerManagerOptions} [options]
 */
export function createEventListenerManager(options = {}) {
  const host = options.host ?? {};
  const coreBindingExecutor = options.coreBindingExecutor;
  const logPrefix = options.logPrefix ?? "[eventMechanism]";

  /** @type {Map<string, number>} */
  const activationRefcount = new Map();

  /** @type {Map<string, Set<(ctx: EventDispatchContext) => void|Promise<void>>>} */
  const globalHandlers = new Map();

  /** @type {Map<string, () => void>} */
  const activeListenerTeardown = new Map();

  let disposed = false;

  function normalizeEventName(eventName) {
    return normalizePlatformEventName(eventName);
  }

  function getRefcount(eventName) {
    return activationRefcount.get(eventName) ?? 0;
  }

  function setRefcount(eventName, value) {
    if (value <= 0) {
      activationRefcount.delete(eventName);
    } else {
      activationRefcount.set(eventName, value);
    }
  }

  function resolveDomListenerTarget(eventName) {
    const doc = host.document ?? (typeof document !== "undefined" ? document : null);
    const canvas = host.canvas ?? null;
    if (isPointerHoverEvent(eventName) && canvas) {
      return canvas;
    }
    // Bubbled document listener matches legacy host pages (room-show) and still raycasts via canvas rect.
    return doc ?? canvas;
  }

  function createDomListener(eventName) {
    const target = resolveDomListenerTarget(eventName);
    if (!target || typeof target.addEventListener !== "function") {
      return null;
    }
    const handler = (nativeEvent) => {
      if (typeof host.isCanvasPickEvent === "function" && !host.isCanvasPickEvent(nativeEvent)) {
        return;
      }
      if (typeof host.dispatchFromNativeEvent === "function") {
        void Promise.resolve(host.dispatchFromNativeEvent(eventName, nativeEvent));
        return;
      }
      if (typeof host.resolvePickThreeJsonId === "function") {
        void Promise.resolve(host.resolvePickThreeJsonId(eventName, nativeEvent)).then((threeJsonId) => {
          const id = typeof threeJsonId === "string" ? threeJsonId.trim() : "";
          if (!id) {
            return;
          }
          const dispatchCtx = typeof host.getDispatchContext === "function"
            ? host.getDispatchContext()
            : {};
          return manager.dispatchPlatformEvent(id, eventName, { ...dispatchCtx, nativeEvent });
        });
        return;
      }
      // Canvas/document listener without pick wiring must not broadcast to every binding.
    };
    target.addEventListener(eventName, handler);
    return () => {
      target.removeEventListener(eventName, handler);
    };
  }

  function isPointerHoverEvent(eventName) {
    return eventName === "pointerover" || eventName === "pointerout";
  }

  function getPointerHoverRefcount() {
    return getRefcount("pointerover") + getRefcount("pointerout");
  }

  function activateListener(eventName) {
    if (isPointerHoverEvent(eventName) && typeof host.createPointerHoverListener === "function") {
      const hoverKey = "__pointerhover";
      if (!activeListenerTeardown.has(hoverKey)) {
        const teardown = host.createPointerHoverListener(manager);
        if (typeof teardown === "function") {
          activeListenerTeardown.set(hoverKey, teardown);
        }
      }
      return;
    }
    if (activeListenerTeardown.has(eventName)) {
      return;
    }
    const teardown = createDomListener(eventName);
    if (typeof teardown === "function") {
      activeListenerTeardown.set(eventName, teardown);
    }
  }

  function deactivateListener(eventName) {
    if (isPointerHoverEvent(eventName) && typeof host.createPointerHoverListener === "function") {
      if (getPointerHoverRefcount() > 0) {
        return;
      }
      const hoverKey = "__pointerhover";
      const teardown = activeListenerTeardown.get(hoverKey);
      if (typeof teardown === "function") {
        teardown();
      }
      activeListenerTeardown.delete(hoverKey);
      return;
    }
    const teardown = activeListenerTeardown.get(eventName);
    if (typeof teardown === "function") {
      teardown();
    }
    activeListenerTeardown.delete(eventName);
  }

  function resolveDispatchObject(id, ctx = {}) {
    const trimmedId = typeof id === "string" ? id.trim() : "";
    if (trimmedId) {
      const registered = getObjectByThreeJsonId(trimmedId);
      if (registered) {
        return registered;
      }
    }
    const runtimeObjects = [ctx.scene, ctx.camera, ctx.controls].filter(Boolean);
    for (let i = 0; i < runtimeObjects.length; i++) {
      const object = runtimeObjects[i];
      if (object?.userData?.objJson?.threeJsonId === trimmedId) {
        return object;
      }
    }
    if (ctx.object && trimmedId) {
      let node = ctx.object;
      while (node) {
        const nodeId =
          typeof node.userData?.objJson?.threeJsonId === "string"
            ? node.userData.objJson.threeJsonId.trim()
            : "";
        if (nodeId === trimmedId) {
          return node;
        }
        node = node.parent ?? null;
      }
    }
    return ctx.object ?? null;
  }

  function notifyBindingAdded(eventName) {
    const key = normalizeEventName(eventName);
    if (!isPlatformEventName(key) || disposed) {
      return;
    }
    const next = getRefcount(key) + 1;
    setRefcount(key, next);
    if (next === 1) {
      activateListener(key);
    }
  }

  function notifyBindingRemoved(eventName) {
    const key = normalizeEventName(eventName);
    if (!isPlatformEventName(key) || disposed) {
      return;
    }
    const next = Math.max(0, getRefcount(key) - 1);
    setRefcount(key, next);
    if (next === 0) {
      deactivateListener(key);
    }
  }

  async function dispatchBindingsForTarget(threeJsonId, eventName, ctx = {}) {
    const id = typeof threeJsonId === "string" ? threeJsonId.trim() : "";
    const key = normalizeEventName(eventName);
    if (!id || !isPlatformEventName(key)) {
      return false;
    }
    const bindings = getBindings(id, key);
    if (bindings.length === 0) {
      return false;
    }
    const object = resolveDispatchObject(id, ctx);
    const dispatchBase = { ...ctx, object, threeJsonId: id, eventName: key };
    const { domainBindings, actionBindings, scriptBindings, handlerBindings } = partitionBindingsForExecution(bindings);
    for (let i = 0; i < domainBindings.length; i++) {
      await executeDomainBinding(domainBindings[i], dispatchBase, coreBindingExecutor);
    }
    for (let i = 0; i < actionBindings.length; i++) {
      await executeActionBinding(actionBindings[i], dispatchBase);
    }
    for (let i = 0; i < scriptBindings.length; i++) {
      await executeScriptBinding(scriptBindings[i], dispatchBase, coreBindingExecutor);
    }
    for (let i = 0; i < handlerBindings.length; i++) {
      await executeHandlerBinding(handlerBindings[i], dispatchBase, coreBindingExecutor);
    }
    return true;
  }

  async function dispatchGlobalHandlers(eventName, ctx = {}) {
    const key = normalizeEventName(eventName);
    const handlers = globalHandlers.get(key);
    if (!handlers || handlers.size === 0) {
      return;
    }
    for (const handler of handlers) {
      await handler({ ...ctx, eventName: key });
    }
  }

  const manager = {
    notifyBindingAdded,
    notifyBindingRemoved,

    /**
     * @param {string|null|undefined} threeJsonId
     * @param {string} eventName
     * @param {EventDispatchContext} [ctx]
     */
    async dispatchPlatformEvent(threeJsonId, eventName, ctx = {}) {
      if (disposed) {
        return false;
      }
      const key = normalizeEventName(eventName);
      if (!isPlatformEventName(key)) {
        log.warn(`${logPrefix} dispatch rejected: unknown platform event`, { eventName });
        return false;
      }
      await dispatchGlobalHandlers(key, ctx);
      if (threeJsonId) {
        return dispatchBindingsForTarget(threeJsonId, key, ctx);
      }
      const ids = getThreeJsonIdsWithBindingsForEvent(key);
      let handled = false;
      for (let i = 0; i < ids.length; i++) {
        const didHandle = await dispatchBindingsForTarget(ids[i], key, ctx);
        handled = handled || didHandle;
      }
      return handled;
    },

    /**
     * @param {string} eventName
     * @param {(ctx: EventDispatchContext) => void|Promise<void>} handler
     */
    registerGlobalListener(eventName, handler) {
      const key = normalizeEventName(eventName);
      if (!isPlatformEventName(key) || typeof handler !== "function" || disposed) {
        return false;
      }
      let bucket = globalHandlers.get(key);
      if (!bucket) {
        bucket = new Set();
        globalHandlers.set(key, bucket);
      }
      bucket.add(handler);
      if (getRefcount(key) === 0 && !activeListenerTeardown.has(key)) {
        activateListener(key);
      }
      return true;
    },

    /**
     * @param {string} eventName
     * @param {(ctx: EventDispatchContext) => void|Promise<void>} handler
     */
    unregisterGlobalListener(eventName, handler) {
      const key = normalizeEventName(eventName);
      const bucket = globalHandlers.get(key);
      if (!bucket) {
        return false;
      }
      bucket.delete(handler);
      if (bucket.size === 0) {
        globalHandlers.delete(key);
      }
      if (getRefcount(key) === 0 && (!globalHandlers.get(key) || globalHandlers.get(key).size === 0)) {
        deactivateListener(key);
      }
      return true;
    },

    getActivationRefcount(eventName) {
      return getRefcount(normalizeEventName(eventName));
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const teardown of activeListenerTeardown.values()) {
        teardown();
      }
      activeListenerTeardown.clear();
      activationRefcount.clear();
      globalHandlers.clear();
    }
  };

  return manager;
}
