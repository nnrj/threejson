import * as THREE from "three";

import {
  createObjectFromRecord,
  deployObjectRecord,
  deployObjectRecordAsync,
  deploySubSceneUnderParent,
  isObjectRecordLike
} from "./objectDispatchHandler.js";
import { createGroup } from "../builder/modelBuilder.js";
import { migrateGroupDescriptorToSubScene, normalizeSubSceneOnRecord } from "./subSceneHierarchy.js";
import { deploySubSceneChildren, deploySubSceneChildrenAsync } from "./subSceneDeploy.js";
import {
  createObjectLifecycleContext,
  resolveObjectLifecycleContext,
  scenePayloadHasLifecycleEventBindings,
  runRecordDeployWithLifecycle
} from "../runtime/objectLifecycle/index.js";

function resolveDeployTarget(target) {
  if (target?.isObject3D === true && target?.isScene !== true) {
    return { scene: null, root: target };
  }
  if (target?.isScene === true) {
    return { scene: target, root: target };
  }
  if (target?.scene?.isScene === true) {
    return { scene: target.scene, root: target.scene };
  }
  throw new Error("deployJsonObject: target must be THREE.Scene / THREE.Object3D / { scene: THREE.Scene }");
}

function resolveDeployObjectLifecycle(options = {}, record = null) {
  const explicit = resolveObjectLifecycleContext(options);
  if (explicit) {
    return explicit;
  }
  if (options.enableObjectLifecycle === true) {
    return createObjectLifecycleContext(options);
  }
  if (scenePayloadHasLifecycleEventBindings(record)) {
    return createObjectLifecycleContext(options);
  }
  return null;
}

function buildDeployContext(options = {}, targetInfo = {}, record = null) {
  return {
    scene: targetInfo.scene ?? null,
    objectLifecycle: resolveDeployObjectLifecycle(options, record),
    dynamicLifecycleDispatch: options.dynamicLifecycleDispatch === true,
    ...(options.context && typeof options.context === "object" ? options.context : {})
  };
}

function assertRecordMode(options = {}) {
  if (options.mode && options.mode !== "record") {
    const error = new Error("E_OBJECT_MODE_MISMATCH: objectLoadHandler only supports record mode");
    error.code = "E_OBJECT_MODE_MISMATCH";
    throw error;
  }
}

function assertObjectRecord(record) {
  if (isObjectRecordLike(record)) {
    return;
  }
  const error = new Error("E_OBJECT_RECORD_INVALID: expected object record with objType");
  error.code = "E_OBJECT_RECORD_INVALID";
  throw error;
}

function resolveDeployRecord(record, options = {}) {
  const policy = options.subSceneNormalizePolicy === "strict" ? "strict" : "warn";
  const { record: normalized } = normalizeSubSceneOnRecord(record, { policy });
  return normalized;
}

function createJsonObject(record, options = {}) {
  assertRecordMode(options);
  assertObjectRecord(record);
  const normalized = resolveDeployRecord(record, options);
  return createObjectFromRecord(normalized, buildDeployContext(options));
}

function deployJsonObject(target, record, options = {}) {
  assertRecordMode(options);
  assertObjectRecord(record);
  const normalized = resolveDeployRecord(record, options);
  const targetInfo = resolveDeployTarget(target);
  const ctx = buildDeployContext({ ...options, dynamicLifecycleDispatch: true }, targetInfo, normalized);
  let created = null;
  runRecordDeployWithLifecycle(normalized, ctx.objectLifecycle, () => {
    created = createObjectFromRecord(normalized, ctx);
    if (created) {
      targetInfo.root.add(created);
      return deploySubSceneAfterCreate(targetInfo.root, normalized, ctx, created);
    }
    return deployObjectRecord(targetInfo.root, normalized, ctx);
  }, { dynamicReadyElm: true });
  return created;
}

async function deployJsonObjectAsync(target, record, options = {}) {
  assertRecordMode(options);
  assertObjectRecord(record);
  const normalized = resolveDeployRecord(record, options);
  const targetInfo = resolveDeployTarget(target);
  const ctx = buildDeployContext({ ...options, dynamicLifecycleDispatch: true }, targetInfo, normalized);
  let created = null;
  await runRecordDeployWithLifecycle(normalized, ctx.objectLifecycle, async () => {
    created = createObjectFromRecord(normalized, ctx);
    if (created) {
      targetInfo.root.add(created);
      await deploySubSceneAfterCreateAsync(targetInfo.root, normalized, ctx, created);
      return;
    }
    await deployObjectRecordAsync(targetInfo.root, normalized, ctx);
  }, { awaitSideEffects: true, dynamicReadyElm: true });
  return created;
}

function deploySubSceneAfterCreate(overlayRoot, record, ctx, createdParent = null) {
  if (!Array.isArray(record?.subScene) || record.subScene.length === 0) {
    return;
  }
  if (createdParent) {
    return deploySubSceneUnderParent(createdParent, record, ctx);
  }
  return deploySubSceneChildren(overlayRoot, record, ctx, (parent, child, childCtx) => {
    return deployObjectRecord(parent, child, childCtx);
  });
}

async function deploySubSceneAfterCreateAsync(overlayRoot, record, ctx, createdParent = null) {
  if (!Array.isArray(record?.subScene) || record.subScene.length === 0) {
    return;
  }
  if (createdParent) {
    return deploySubSceneUnderParent(createdParent, record, ctx);
  }
  await deploySubSceneChildrenAsync(overlayRoot, record, ctx, deployObjectRecordAsync);
}

function createJsonObjectBatch(records, options = {}) {
  const list = Array.isArray(records) ? records : [];
  return list.map((record) => createJsonObject(record, options));
}

function deployJsonObjectBatch(target, records, options = {}) {
  const list = Array.isArray(records) ? records : [];
  return list.map((record) => deployJsonObject(target, record, options));
}

async function deployJsonObjectBatchAsync(target, records, options = {}) {
  const list = Array.isArray(records) ? records : [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    out.push(await deployJsonObjectAsync(target, list[i], options));
  }
  return out;
}

function createJsonObjectAuto(input, options = {}) {
  return Array.isArray(input) ? createJsonObjectBatch(input, options) : createJsonObject(input, options);
}

function deployJsonObjectAuto(target, input, options = {}) {
  return Array.isArray(input) ? deployJsonObjectBatch(target, input, options) : deployJsonObject(target, input, options);
}

async function deployJsonObjectAutoAsync(target, input, options = {}) {
  return Array.isArray(input)
    ? deployJsonObjectBatchAsync(target, input, options)
    : deployJsonObjectAsync(target, input, options);
}

/**
 * Deploy a group descriptor with subScene (domain factories: cabinet/port, etc.).
 * Migrate in-group boxModelList/subGroup first, then createGroup + recursive deploy.
 * @param {import("three").Object3D} target
 * @param {object} record
 * @param {object} [options]
 * @returns {import("three").Group|null}
 */
function deployGroupDescriptor(target, record, options = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }
  migrateGroupDescriptorToSubScene(record);
  const normalized = resolveDeployRecord(record, options);
  const targetInfo = resolveDeployTarget(target);
  const ctx = buildDeployContext(options, targetInfo);
  ctx.awaitTextDeploy = true;
  const group = createGroup(normalized);
  if (!group) {
    return null;
  }
  targetInfo.root.add(group);
  deploySubSceneUnderParent(group, normalized, ctx);
  return group;
}

/**
 * @param {object} record
 * @param {object} [options]
 * @returns {import("three").Group|null}
 */
function createGroupFromDescriptor(record, options = {}) {
  const staging = new THREE.Group();
  const group = deployGroupDescriptor(staging, record, options);
  if (group) {
    staging.remove(group);
  }
  return group;
}

export {
  createGroupFromDescriptor,
  createJsonObject,
  createJsonObjectAuto,
  createJsonObjectBatch,
  deployGroupDescriptor,
  deployJsonObject,
  deployJsonObjectAsync,
  deployJsonObjectAuto,
  deployJsonObjectAutoAsync,
  deployJsonObjectBatch,
  deployJsonObjectBatchAsync
};


