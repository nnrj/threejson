/**
 * Per-object lifecycle dispatch (object.ready / object.dispose) + optional host hooks.
 */

import { log } from "../../util/logger.js";
import { getObjectByThreeJsonId } from "../../handler/objectRegistry.js";
import {
  getActiveEventListenerManager,
  getActiveEventSceneToken
} from "../eventMechanism/bindEventRuntime.js";
import { bindEventsFromRecord } from "../eventMechanism/bindEventsFromRecord.js";
import { getBindings } from "../eventMechanism/eventBindingRegistry.js";
import { listValidEventEntries } from "../eventMechanism/eventRecordValidation.js";
import {
  isLifecycleEligibleRecord,
  normalizeObjType
} from "./objectLifecycleEligibility.js";
import { resolveEnableObjectLifecycle } from "./resolveEnableObjectLifecycle.js";
import { scenePayloadHasLifecycleEventBindings } from "./objectLifecycleSceneScan.js";

export const OBJECT_LIFECYCLE_READY = "object.ready";
export const OBJECT_LIFECYCLE_DISPOSE = "object.dispose";

/**
 * @typedef {object} ObjectLifecycleCallbacks
 * @property {(ctx: object) => void|Promise<void>|null} [onObjectBeforeCreate]
 * @property {(ctx: object) => void|Promise<void>|null} [onObjectDeployed]
 * @property {(ctx: object) => void|Promise<void>|null} [onObjectBeforeRemove]
 * @property {(ctx: object) => void|Promise<void>|null} [onObjectDeployFailed]
 */

/**
 * @typedef {object} ObjectLifecycleContext
 * @property {ObjectLifecycleCallbacks} callbacks
 * @property {boolean} [elmDispatchEnabled]
 */

/**
 * @param {object} [options]
 * @returns {ObjectLifecycleCallbacks}
 */
export function resolveObjectLifecycleCallbacks(options = {}) {
  return {
    onObjectBeforeCreate:
      typeof options.onObjectBeforeCreate === "function" ? options.onObjectBeforeCreate : null,
    onObjectDeployed:
      typeof options.onObjectDeployed === "function" ? options.onObjectDeployed : null,
    onObjectBeforeRemove:
      typeof options.onObjectBeforeRemove === "function" ? options.onObjectBeforeRemove : null,
    onObjectDeployFailed:
      typeof options.onObjectDeployFailed === "function" ? options.onObjectDeployFailed : null
  };
}

/**
 * @param {object} [options]
 * @returns {ObjectLifecycleContext}
 */
export function createObjectLifecycleContext(options = {}) {
  return {
    callbacks: resolveObjectLifecycleCallbacks(options),
    elmDispatchEnabled: options.bindSceneEvents !== false,
    sceneJsonRoot: options.sceneJsonRoot ?? options.jsonData ?? null,
    assetLibrary: options.assetLibrary ?? options.sceneJsonRoot?.assetLibrary ?? options.jsonData?.assetLibrary ?? null
  };
}

/**
 * Resolve lifecycle context only when explicitly configured (scene load, host hooks, or injected ctx).
 * Returns null for ad-hoc deploy/delete paths so sync handlers stay synchronous.
 * @param {object} [options]
 * @returns {ObjectLifecycleContext|null}
 */
export function resolveObjectLifecycleContext(options = {}) {
  if (options.objectLifecycle && typeof options.objectLifecycle === "object") {
    return options.objectLifecycle;
  }
  if (options._objectLifecycle) {
    return options._objectLifecycle;
  }
  const callbacks = resolveObjectLifecycleCallbacks(options);
  if (
    callbacks.onObjectBeforeCreate ||
    callbacks.onObjectDeployed ||
    callbacks.onObjectBeforeRemove ||
    callbacks.onObjectDeployFailed
  ) {
    return createObjectLifecycleContext(options);
  }
  return null;
}

/**
 * Scene-load lifecycle: host hooks, injected ctx, enableObjectLifecycle flag, or JSON lifecycle bindings.
 * @param {object} [options]
 * @param {unknown} [scenePayload]
 * @returns {ObjectLifecycleContext|null}
 */
export function resolveSceneLoadObjectLifecycle(options = {}, scenePayload = null) {
  const explicit = resolveObjectLifecycleContext(options);
  if (explicit) {
    return explicit;
  }
  const payload =
    scenePayload && typeof scenePayload === "object" && !Array.isArray(scenePayload) ? scenePayload : {};
  const sceneConfig = options.sceneConfig ?? payload.sceneConfig ?? null;
  if (resolveEnableObjectLifecycle(payload, sceneConfig, options)) {
    return createObjectLifecycleContext(options);
  }
  if (scenePayload && scenePayloadHasLifecycleEventBindings(scenePayload)) {
    return createObjectLifecycleContext(options);
  }
  return null;
}

/**
 * @param {object} record
 * @param {string} [source]
 * @returns {object}
 */
export function buildObjectLifecyclePayload(record, source) {
  const threeJsonId = typeof record?.threeJsonId === "string" ? record.threeJsonId.trim() : "";
  const object3D = threeJsonId ? getObjectByThreeJsonId(threeJsonId) : null;
  /** @type {Record<string, unknown>} */
  const payload = {
    threeJsonId,
    record,
    object3D,
    objType: normalizeObjType(record?.objType)
  };
  if (source) {
    payload.source = source;
  }
  return payload;
}

/**
 * @param {object} record
 * @returns {boolean}
 */
export function recordHasObjectReadyBinding(record) {
  if (!record?.events || typeof record.events !== "object") {
    return false;
  }
  return listValidEventEntries(record.events).some((entry) => entry.eventName === OBJECT_LIFECYCLE_READY);
}

/**
 * @param {object|null|undefined} lifecycleCtx
 * @returns {ObjectLifecycleCallbacks}
 */
function resolveCallbacks(lifecycleCtx) {
  return lifecycleCtx?.callbacks ?? resolveObjectLifecycleCallbacks({});
}

/**
 * @param {import("../eventMechanism/eventListenerManager.js").ReturnType<createEventListenerManager>} manager
 * @param {string} threeJsonId
 * @param {string} eventName
 * @param {object} payload
 */
async function dispatchElmPlatformEvent(manager, threeJsonId, eventName, payload) {
  if (!manager || typeof manager.dispatchPlatformEvent !== "function") {
    return;
  }
  await manager.dispatchPlatformEvent(threeJsonId, eventName, payload);
}

/**
 * @param {import("../eventMechanism/eventListenerManager.js").ReturnType<createEventListenerManager>} manager
 * @param {object} record
 * @param {object} lifecycleCtx
 * @param {object} payload
 */
async function bindRecordEventsIfNeeded(manager, record, lifecycleCtx, payload, eventName) {
  if (!manager || getBindings(payload.threeJsonId, eventName).length > 0) {
    return;
  }
  const object3D = payload.object3D ?? getObjectByThreeJsonId(payload.threeJsonId);
  if (!object3D) {
    return;
  }
  await bindEventsFromRecord(object3D, {
    manager,
    sceneToken: getActiveEventSceneToken(),
    sceneJsonRoot: lifecycleCtx?.sceneJsonRoot ?? record,
    assetLibrary: lifecycleCtx?.assetLibrary ?? lifecycleCtx?.sceneJsonRoot?.assetLibrary
  });
}

/**
 * @param {object} record
 * @param {ObjectLifecycleContext|null|undefined} lifecycleCtx
 * @param {string} eventName
 * @param {string} [source]
 */
async function dispatchObjectLifecycleEvent(record, lifecycleCtx, eventName, source) {
  if (!isLifecycleEligibleRecord(record)) {
    return;
  }
  const payload = buildObjectLifecyclePayload(record, source);
  const callbacks = resolveCallbacks(lifecycleCtx);
  const hostHook =
    eventName === OBJECT_LIFECYCLE_READY
      ? callbacks.onObjectDeployed
      : eventName === OBJECT_LIFECYCLE_DISPOSE
        ? callbacks.onObjectBeforeRemove
        : null;

  if (source === "replay" || source === "dynamic") {
    if (lifecycleCtx?.elmDispatchEnabled === false) {
      return;
    }
    const manager = getActiveEventListenerManager();
    if (source === "dynamic") {
      await bindRecordEventsIfNeeded(manager, record, lifecycleCtx, payload, eventName);
    }
    await dispatchElmPlatformEvent(manager, payload.threeJsonId, eventName, payload);
    return;
  }

  if (hostHook) {
    try {
      await hostHook(payload);
    } catch (error) {
      log.warn("[objectLifecycle] host hook failed:", eventName, payload.threeJsonId, error);
    }
  }

  if (eventName === OBJECT_LIFECYCLE_DISPOSE && lifecycleCtx?.elmDispatchEnabled !== false) {
    const manager = getActiveEventListenerManager();
    await bindRecordEventsIfNeeded(manager, record, lifecycleCtx, payload, eventName);
    await dispatchElmPlatformEvent(manager, payload.threeJsonId, eventName, payload);
  }
}

/**
 * @param {object} record
 * @param {ObjectLifecycleContext|null|undefined} lifecycleCtx
 */
export async function notifyObjectBeforeCreate(record, lifecycleCtx) {
  if (!isLifecycleEligibleRecord(record)) {
    return;
  }
  const hook = resolveCallbacks(lifecycleCtx).onObjectBeforeCreate;
  if (!hook) {
    return;
  }
  try {
    await hook(buildObjectLifecyclePayload(record));
  } catch (error) {
    log.warn("[objectLifecycle] onObjectBeforeCreate failed:", record?.threeJsonId, error);
  }
}

/**
 * @param {object} record
 * @param {ObjectLifecycleContext|null|undefined} lifecycleCtx
 * @param {string} [source]
 */
export async function notifyObjectReady(record, lifecycleCtx, source) {
  await dispatchObjectLifecycleEvent(record, lifecycleCtx, OBJECT_LIFECYCLE_READY, source);
}

/**
 * @param {object} record
 * @param {ObjectLifecycleContext|null|undefined} lifecycleCtx
 */
export async function notifyObjectDispose(record, lifecycleCtx) {
  await dispatchObjectLifecycleEvent(record, lifecycleCtx, OBJECT_LIFECYCLE_DISPOSE);
}

/**
 * @param {object} record
 * @param {unknown} error
 * @param {ObjectLifecycleContext|null|undefined} lifecycleCtx
 */
export async function notifyObjectDeployFailed(record, error, lifecycleCtx) {
  if (!isLifecycleEligibleRecord(record)) {
    return;
  }
  const hook = resolveCallbacks(lifecycleCtx).onObjectDeployFailed;
  if (!hook) {
    return;
  }
  try {
    await hook({
      ...buildObjectLifecyclePayload(record),
      error
    });
  } catch (hookError) {
    log.warn("[objectLifecycle] onObjectDeployFailed hook failed:", record?.threeJsonId, hookError);
  }
}

function isThenable(value) {
  return Boolean(value && typeof value.then === "function");
}

function catchAsyncHook(value, label, id) {
  if (!isThenable(value)) {
    return;
  }
  void value.catch((error) => {
    log.warn(`[objectLifecycle] ${label} failed:`, id, error);
  });
}

function notifyObjectBeforeCreateSync(record, callbacks) {
  const hook = callbacks.onObjectBeforeCreate;
  if (!hook) {
    return;
  }
  try {
    catchAsyncHook(hook(buildObjectLifecyclePayload(record)), "onObjectBeforeCreate", record?.threeJsonId);
  } catch (error) {
    log.warn("[objectLifecycle] onObjectBeforeCreate failed:", record?.threeJsonId, error);
  }
}

function notifyObjectDeployedSync(record, callbacks) {
  const hook = callbacks.onObjectDeployed;
  if (!hook) {
    return;
  }
  try {
    catchAsyncHook(hook(buildObjectLifecyclePayload(record)), "onObjectDeployed", record?.threeJsonId);
  } catch (error) {
    log.warn("[objectLifecycle] onObjectDeployed failed:", record?.threeJsonId, error);
  }
}

function notifyObjectDeployFailedSync(record, error, callbacks) {
  const hook = callbacks.onObjectDeployFailed;
  if (!hook) {
    return;
  }
  try {
    catchAsyncHook(
      hook({
        ...buildObjectLifecyclePayload(record),
        error
      }),
      "onObjectDeployFailed",
      record?.threeJsonId
    );
  } catch (hookError) {
    log.warn("[objectLifecycle] onObjectDeployFailed hook failed:", record?.threeJsonId, hookError);
  }
}

/**
 * @param {object} record
 * @param {ObjectLifecycleContext|null|undefined} lifecycleCtx
 * @param {{ dynamicReadyElm?: boolean }} [runOptions]
 * @returns {boolean}
 */
function shouldDispatchDynamicReadyElm(record, lifecycleCtx, runOptions = {}) {
  if (runOptions.dynamicReadyElm !== true || !lifecycleCtx || lifecycleCtx.elmDispatchEnabled === false) {
    return false;
  }
  if (!isLifecycleEligibleRecord(record) || !recordHasObjectReadyBinding(record)) {
    return false;
  }
  return Boolean(getActiveEventListenerManager());
}

function dispatchDynamicReadyElmSync(record, lifecycleCtx) {
  void notifyObjectReady(record, lifecycleCtx, "dynamic").catch((error) => {
    log.warn("[objectLifecycle] dynamic object.ready dispatch failed:", record?.threeJsonId, error);
  });
}

/**
 * @param {object} record
 * @param {ObjectLifecycleContext|null|undefined} lifecycleCtx
 * @param {() => void|Promise<void>} deployFn
 * @param {{ awaitSideEffects?: boolean, dynamicReadyElm?: boolean }} [runOptions]
 * @returns {void|Promise<void>}
 */
export function runRecordDeployWithLifecycle(record, lifecycleCtx, deployFn, runOptions = {}) {
  if (!lifecycleCtx) {
    return deployFn();
  }
  const callbacks = lifecycleCtx.callbacks ?? {};
  const hasDeployHostHooks =
    callbacks.onObjectBeforeCreate ||
    callbacks.onObjectDeployed ||
    callbacks.onObjectDeployFailed;
  const needsDynamicElm = shouldDispatchDynamicReadyElm(record, lifecycleCtx, runOptions);
  if (!hasDeployHostHooks && !needsDynamicElm) {
    return deployFn();
  }
  if (!isLifecycleEligibleRecord(record)) {
    return deployFn();
  }
  if (runOptions.awaitSideEffects !== true) {
    if (hasDeployHostHooks) {
      notifyObjectBeforeCreateSync(record, callbacks);
    }
    let result;
    try {
      result = deployFn();
    } catch (error) {
      if (hasDeployHostHooks) {
        notifyObjectDeployFailedSync(record, error, callbacks);
      }
      throw error;
    }
    const afterDeploy = () => {
      if (hasDeployHostHooks) {
        notifyObjectDeployedSync(record, callbacks);
      }
      if (needsDynamicElm) {
        dispatchDynamicReadyElmSync(record, lifecycleCtx);
      }
    };
    if (isThenable(result)) {
      return result.then(
        (value) => {
          afterDeploy();
          return value;
        },
        (error) => {
          if (hasDeployHostHooks) {
            notifyObjectDeployFailedSync(record, error, callbacks);
          }
          throw error;
        }
      );
    }
    afterDeploy();
    return result;
  }
  const run = async () => {
    if (hasDeployHostHooks) {
      await notifyObjectBeforeCreate(record, lifecycleCtx);
    }
    try {
      const result = deployFn();
      if (result && typeof result.then === "function") {
        await result;
      }
      if (hasDeployHostHooks) {
        await notifyObjectReady(record, lifecycleCtx);
      }
      if (needsDynamicElm) {
        await notifyObjectReady(record, lifecycleCtx, "dynamic");
      }
    } catch (error) {
      if (hasDeployHostHooks) {
        await notifyObjectDeployFailed(record, error, lifecycleCtx);
      }
      throw error;
    }
  };
  return run();
}
