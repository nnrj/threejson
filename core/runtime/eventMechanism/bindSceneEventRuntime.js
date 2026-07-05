/**
 * Scene-level event runtime wiring — call from onSceneReady; dispose on teardown.
 */

import { log } from "../../util/logger.js";
import { clearBindingsForScene, getThreeJsonIdsWithBindingsForEvent } from "./eventBindingRegistry.js";
import {
  attachEventListenerManager,
  detachEventListenerManager,
  getActiveEventListenerManager
} from "./bindEventRuntime.js";
import { bindEventsFromRecord, bindEventsFromScene } from "./bindEventsFromRecord.js";
import { createEventListenerManager } from "./eventListenerManager.js";
import { invokeAllDomainBindSceneEvents } from "./eventDomainContract.js";
import { createCoreBindingExecutor } from "./createCoreBindingExecutor.js";
import { wireInfoPanelDismissTriggers } from "./wireInfoPanelDismissTriggers.js";
import { replayObjectReadyBindingsAfterBind } from "../objectLifecycle/objectLifecycleReplay.js";

let sceneTokenSeq = 0;

function nextSceneToken() {
  sceneTokenSeq += 1;
  return `scene-events-${sceneTokenSeq}`;
}

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function listRecords(ctx) {
  if (Array.isArray(ctx.records)) {
    return ctx.records;
  }
  if (Array.isArray(ctx.objectList)) {
    return ctx.objectList;
  }
  if (Array.isArray(ctx.payload?.objectList)) {
    return ctx.payload.objectList;
  }
  if (Array.isArray(ctx.sceneJsonRoot?.objectList)) {
    return ctx.sceneJsonRoot.objectList;
  }
  if (Array.isArray(ctx.jsonData?.objectList)) {
    return ctx.jsonData.objectList;
  }
  return [];
}

function findFirstRecordByObjType(records, objType) {
  const key = normalizeObjType(objType);
  return records.find((record) => normalizeObjType(record?.objType || record?.type) === key) ?? null;
}

function ensureRuntimeObjectDescriptor(object3D, record, fallback) {
  if (!object3D || !record || typeof record !== "object" || Array.isArray(record)) {
    return false;
  }
  const existing = object3D.userData?.objJson;
  const threeJsonId =
    normalizeText(record.threeJsonId) ||
    normalizeText(record.id) ||
    normalizeText(existing?.threeJsonId) ||
    fallback;
  if (!threeJsonId) {
    return false;
  }
  object3D.userData = {
    ...(object3D.userData ?? {}),
    objJson: {
      ...(existing && typeof existing === "object" ? existing : {}),
      ...record,
      objType: normalizeObjType(record.objType || record.type || existing?.objType),
      threeJsonId
    }
  };
  return true;
}

async function bindRuntimeObjectEvents(ctx, bindOptions) {
  const records = listRecords({ ...ctx, records: bindOptions.records });
  const ids = [];
  const sceneRecord = findFirstRecordByObjType(records, "scene");
  if (ensureRuntimeObjectDescriptor(ctx.scene, sceneRecord, "threejson-scene-root")) {
    ids.push(...await bindEventsFromRecord(ctx.scene, bindOptions));
  }
  const cameraRecord = findFirstRecordByObjType(records, "camera");
  if (ensureRuntimeObjectDescriptor(ctx.camera, cameraRecord, "threejson-camera")) {
    ids.push(...await bindEventsFromRecord(ctx.camera, bindOptions));
  }
  return ids;
}

/**
 * @typedef {object} SceneEventRuntimeHandle
 * @property {string} sceneToken
 * @property {ReturnType<createEventListenerManager>} manager
 * @property {string[]} bindingIds
 * @property {() => Promise<void>} dispose
 * @property {() => Promise<string[]>} rebind
 */

/**
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object} [ctx]
 * @returns {Promise<SceneEventRuntimeHandle>}
 */
export async function bindSceneEventRuntime(scene, ctx = {}) {
  if (!scene) {
    throw new Error("[eventMechanism] bindSceneEventRuntime requires scene");
  }

  const sceneToken =
    (typeof ctx.sceneToken === "string" && ctx.sceneToken.trim()) ||
    (typeof ctx.sceneSessionId === "string" && ctx.sceneSessionId.trim()) ||
    nextSceneToken();

  const replaceExisting = ctx.replaceExisting !== false;
  if (replaceExisting) {
    clearBindingsForScene(sceneToken);
  }

  const sceneConfig =
    ctx.sceneJsonRoot?.sceneConfig ?? ctx.jsonData?.sceneConfig ?? ctx.sceneConfig ?? null;
  const coreBindingExecutor =
    ctx.coreBindingExecutor ??
    createCoreBindingExecutor({
      sceneConfig,
      mutationOptions: ctx.mutationOptions
    });

  const manager =
    ctx.manager ??
    getActiveEventListenerManager() ??
    createEventListenerManager({
      host: ctx.host,
      coreBindingExecutor
    });
  attachEventListenerManager(manager, sceneToken);

  const bindOptions = {
    manager,
    sceneToken,
    sceneJsonRoot: ctx.sceneJsonRoot ?? ctx.jsonData,
    assetLibrary: ctx.assetLibrary ?? ctx.sceneJsonRoot?.assetLibrary ?? ctx.jsonData?.assetLibrary,
    records: listRecords(ctx)
  };

  const runtimeBindingIds = await bindRuntimeObjectEvents({ ...ctx, scene }, bindOptions);
  const jsonBindingIds = await bindEventsFromScene(scene, bindOptions);
  const dismissBindingIds = await wireInfoPanelDismissTriggers(scene, {
    manager,
    sceneToken
  });
  await invokeAllDomainBindSceneEvents(scene, {
    ...ctx,
    records: bindOptions.records ?? bindOptions.sceneJsonRoot?.objectList,
    sceneToken,
    manager
  });

  const domainBindingIds = [];
  // Domain bindSceneEvents registers via bindEvent/addBinding internally (M4+).

  const bindingIds = [...runtimeBindingIds, ...jsonBindingIds, ...dismissBindingIds, ...domainBindingIds];

  if (getThreeJsonIdsWithBindingsForEvent("scene.ready").length > 0) {
    await manager.dispatchPlatformEvent(null, "scene.ready", {
      scene,
      sceneToken,
      ...ctx
    });
  }

  const lifecycleCtx =
    ctx.objectLifecycle ??
    ctx.options?._objectLifecycle ??
    null;

  await replayObjectReadyBindingsAfterBind({
    sceneJsonRoot: bindOptions.sceneJsonRoot,
    objectList: bindOptions.records ?? bindOptions.sceneJsonRoot?.objectList,
    objectLifecycle: lifecycleCtx
  });

  log.info("[eventMechanism] bindSceneEventRuntime ready", {
    sceneToken,
    bindingCount: bindingIds.length
  });

  /** @type {SceneEventRuntimeHandle} */
  const handle = {
    sceneToken,
    manager,
    bindingIds,
    async rebind() {
      clearBindingsForScene(sceneToken);
      const runtimeIds = await bindRuntimeObjectEvents({ ...ctx, scene }, bindOptions);
      const ids = await bindEventsFromScene(scene, bindOptions);
      const dismissIds = await wireInfoPanelDismissTriggers(scene, { manager, sceneToken });
      await invokeAllDomainBindSceneEvents(scene, {
        ...ctx,
        records: bindOptions.records ?? bindOptions.sceneJsonRoot?.objectList,
        sceneToken,
        manager
      });
      handle.bindingIds = [...runtimeIds, ...ids, ...dismissIds];
      return handle.bindingIds;
    },
    async dispose() {
      clearBindingsForScene(sceneToken);
      if (getActiveEventListenerManager() === manager) {
        detachEventListenerManager();
      } else {
        manager.dispose();
      }
      log.info("[eventMechanism] bindSceneEventRuntime disposed", { sceneToken });
    }
  };

  return handle;
}

export async function disposeSceneEventRuntime(handle) {
  if (handle && typeof handle.dispose === "function") {
    await handle.dispose();
  }
}
