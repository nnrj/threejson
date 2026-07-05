import { deployJsonObject, deployJsonObjectAsync } from "../handler/objectLoadHandler.js";
import { getObjectByThreeJsonId } from "../handler/objectRegistry.js";
import {
  removeObjectByThreeJsonIdCore,
  removeObjectByThreeJsonIdCoreAsync,
  resolveParentThreeJsonId
} from "../handler/objectDeleteById.js";
import { markDescriptorBindingJsonDirty } from "../handler/sceneDescriptorBinding.js";
import { ensureThreeJsonIdOnRecord } from "../util/util.js";

const ASYNC_FIRST_OBJ_TYPES = new Set([
  "externalmodel",
  "domain",
  "skinned",
  "audio",
  "infopanel"
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function commandResult(base, extra = {}) {
  return {
    ok: Boolean(base.ok),
    error: base.error || null,
    threeJsonId: base.threeJsonId || "",
    object3D: base.object3D ?? null,
    needsAsync: false,
    ...extra
  };
}

function resolveAttachParent(scene, parentOption) {
  if (!scene?.isScene) {
    return { ok: false, error: "scene must be a THREE.Scene." };
  }
  if (parentOption == null || parentOption === scene) {
    return { ok: true, root: scene };
  }
  if (parentOption.isObject3D === true) {
    return { ok: true, root: parentOption };
  }
  if (typeof parentOption === "string") {
    const key = parentOption.trim();
    if (!key) {
      return { ok: false, error: "parent threeJsonId is empty." };
    }
    const object3D = getObjectByThreeJsonId(key);
    if (!object3D) {
      return { ok: false, error: `Parent not found for threeJsonId "${key}".` };
    }
    return { ok: true, root: object3D };
  }
  return { ok: false, error: "options.parent must be THREE.Scene, THREE.Object3D, or parent threeJsonId string." };
}

function recordImpliesAsyncDeploy(descriptor) {
  return ASYNC_FIRST_OBJ_TYPES.has(normalizeObjType(descriptor?.objType));
}

function maybeMarkDirty(descriptor, options = {}) {
  if (options.markBindingDirty === false || !descriptor) {
    return;
  }
  markDescriptorBindingJsonDirty(descriptor);
}

function buildDeployOptions(scene, options = {}) {
  const context = isObjectRecord(options.context) ? { ...options.context } : {};
  if (!context.scene && scene?.isScene) {
    context.scene = scene;
  }
  return {
    context,
    missingAssetPolicy: options.missingAssetPolicy,
    onWarning: options.onWarning,
    objectLifecycle: options.objectLifecycle,
    _objectLifecycle: options._objectLifecycle,
    bindSceneEvents: options.bindSceneEvents,
    sceneJsonRoot: options.sceneJsonRoot,
    jsonData: options.jsonData,
    assetLibrary: options.assetLibrary,
    onObjectBeforeCreate: options.onObjectBeforeCreate,
    onObjectDeployed: options.onObjectDeployed,
    onObjectBeforeRemove: options.onObjectBeforeRemove,
    onObjectDeployFailed: options.onObjectDeployFailed
  };
}

function assertObjectDescriptor(descriptor) {
  if (!isObjectRecord(descriptor)) {
    return { ok: false, error: "descriptor must be a non-array object." };
  }
  if (!normalizeObjType(descriptor.objType)) {
    return { ok: false, error: "descriptor.objType is required." };
  }
  return { ok: true };
}

function addObjectFromDescriptor(scene, descriptor, options = {}) {
  const sceneOk = scene?.isScene;
  if (!sceneOk) {
    return commandResult({ ok: false, error: "scene must be a THREE.Scene." });
  }
  const descCheck = assertObjectDescriptor(descriptor);
  if (!descCheck.ok) {
    return commandResult(descCheck);
  }

  const parentRes = resolveAttachParent(scene, options.parent);
  if (!parentRes.ok) {
    return commandResult(parentRes);
  }

  const record = cloneJson(descriptor);
  ensureThreeJsonIdOnRecord(record);
  const threeJsonId = String(record.threeJsonId || "").trim();
  if (!threeJsonId) {
    return commandResult({ ok: false, error: "threeJsonId could not be assigned." });
  }
  if (getObjectByThreeJsonId(threeJsonId)) {
    return commandResult({ ok: false, error: `duplicate threeJsonId "${threeJsonId}".` });
  }

  const deployOpts = buildDeployOptions(scene, options);
  let object3D = deployJsonObject(parentRes.root, record, deployOpts);
  if (!object3D) {
    object3D = getObjectByThreeJsonId(threeJsonId);
  }

  maybeMarkDirty(record, options);

  const needsAsync = !object3D && recordImpliesAsyncDeploy(record);
  if (!object3D && !needsAsync) {
    return commandResult({
      ok: false,
      error: `deploy produced no object for objType "${normalizeObjType(record.objType)}".`,
      threeJsonId
    });
  }
  return commandResult(
    { ok: true, threeJsonId, object3D: object3D || null },
    { needsAsync }
  );
}

async function addObjectFromDescriptorAsync(scene, descriptor, options = {}) {
  const sceneOk = scene?.isScene;
  if (!sceneOk) {
    return commandResult({ ok: false, error: "scene must be a THREE.Scene." });
  }
  const descCheck = assertObjectDescriptor(descriptor);
  if (!descCheck.ok) {
    return commandResult(descCheck);
  }

  const parentRes = resolveAttachParent(scene, options.parent);
  if (!parentRes.ok) {
    return commandResult(parentRes);
  }

  const record = cloneJson(descriptor);
  ensureThreeJsonIdOnRecord(record);
  const threeJsonId = String(record.threeJsonId || "").trim();
  if (!threeJsonId) {
    return commandResult({ ok: false, error: "threeJsonId could not be assigned." });
  }
  if (getObjectByThreeJsonId(threeJsonId)) {
    return commandResult({ ok: false, error: `duplicate threeJsonId "${threeJsonId}".` });
  }

  const deployOpts = buildDeployOptions(scene, options);
  await deployJsonObjectAsync(parentRes.root, record, deployOpts);
  const object3D = getObjectByThreeJsonId(threeJsonId);

  maybeMarkDirty(record, options);

  if (!object3D) {
    return commandResult({
      ok: false,
      error: `async deploy produced no object for objType "${normalizeObjType(record.objType)}".`,
      threeJsonId
    });
  }
  return commandResult({ ok: true, threeJsonId, object3D: object3D || null, needsAsync: false });
}

function removeObjectById(scene, threeJsonId, options = {}) {
  const core = removeObjectByThreeJsonIdCore(scene, threeJsonId, options);
  if (!core.ok) {
    const extra = core.protected ? { protected: true } : {};
    return commandResult(
      { ok: false, error: core.error, threeJsonId: core.threeJsonId },
      extra
    );
  }

  if (core.descriptor) {
    maybeMarkDirty(core.descriptor, options);
  }

  const extra = {
    removedDescriptor: core.removedDescriptor || null,
    removedParentThreeJsonId: core.removedParentThreeJsonId
  };
  if (core.removedSubtree) {
    extra.removedSubtree = core.removedSubtree;
  }
  return commandResult(
    { ok: true, threeJsonId: core.threeJsonId, object3D: null },
    extra
  );
}

async function removeObjectByIdAsync(scene, threeJsonId, options = {}) {
  const core = await removeObjectByThreeJsonIdCoreAsync(scene, threeJsonId, options);
  if (!core.ok) {
    const extra = core.protected ? { protected: true } : {};
    return commandResult(
      { ok: false, error: core.error, threeJsonId: core.threeJsonId },
      extra
    );
  }

  if (core.descriptor) {
    maybeMarkDirty(core.descriptor, options);
  }

  const extra = {
    removedDescriptor: core.removedDescriptor || null,
    removedParentThreeJsonId: core.removedParentThreeJsonId
  };
  if (core.removedSubtree) {
    extra.removedSubtree = core.removedSubtree;
  }
  return commandResult(
    { ok: true, threeJsonId: core.threeJsonId, object3D: null },
    extra
  );
}

export {
  addObjectFromDescriptor,
  addObjectFromDescriptorAsync,
  removeObjectById,
  removeObjectByIdAsync,
  resolveParentThreeJsonId
};
