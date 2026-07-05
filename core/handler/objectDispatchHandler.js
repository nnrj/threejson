import * as THREE from "three";
import { log } from "../util/logger.js";

import { deployByObjTypeExtension, tryDeploySubSceneChildByExtension } from "./sceneExtensionRegistry.js";
import { invokeDomainModel } from "./businessDomainModelDispatch.js";
import { deployMeshWithDomains } from "./businessDomainRegistry.js";
import {
  createGroup,
  deployMesh,
  createHeatmap,
  createHeatmapVolume,
  createLine,
  createLine2,
  createPlane,
  createPoints,
  createSprite,
  createTube,
  deployInstancedMesh,
  loadExternalModel,
  loadExternalModelAsync,
  loadSkinnedModel
} from "../builder/modelBuilder.js";
import { createShapePlane } from "../builder/shapePlaneBuilder.js";
import { createShapeExtrude } from "../builder/shapeExtrudeBuilder.js";
import { createBufferMesh } from "../builder/bufferMeshBuilder.js";
import { createIrregularPlane } from "../builder/irregularPlaneBuilder.js";
import { createIrregularGeometry } from "../builder/irregularGeometryBuilder.js";
import { deployInfoPanel } from "../builder/infoPanelBuilder.js";
import { createText, createTextAsync } from "../builder/textBuilder.js";
import { deploySceneAudio } from "../builder/audioBuilder.js";
import {
  deployNativeObjectRecordWithFallback
} from "./nativeObjectDispatch.js";
import { shouldDeployNativeOnly } from "./nativeParseMode.js";
import { deploySubSceneChildren, deploySubSceneChildrenAsync } from "./subSceneDeploy.js";
import { runRecordDeployWithLifecycle } from "../runtime/objectLifecycle/index.js";

const ARCHIVE_MODEL_FILE_TYPES = new Set(["tjz", "threejson", "tjson", "zip"]);
const RUNTIME_OBJ_TYPES = new Set(["scene", "camera", "renderer", "controls", "light", "renderloop"]);

let _archiveExternalDeployer = null;

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function inferModelFileTypeFromPath(modelPath) {
  if (typeof modelPath !== "string") {
    return "";
  }
  const normalized = modelPath.trim().split(/[?#]/)[0];
  const m = normalized.match(/\.([a-z0-9]+)$/i);
  return m ? String(m[1]).toLowerCase() : "";
}

function resolveExternalModelFileType(record) {
  const candidates = [
    normalizeObjType(record?.modelFileType),
    normalizeObjType(record?.fileType),
    inferModelFileTypeFromPath(record?.modelPath)
  ];
  for (let i = 0; i < candidates.length; i++) {
    const one = candidates[i];
    if (one && one !== "externalmodel") {
      return one;
    }
  }
  return "";
}

function isArchiveExternalModelRecord(record) {
  return ARCHIVE_MODEL_FILE_TYPES.has(resolveExternalModelFileType(record));
}

function isObjectRecordLike(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && normalizeObjType(value.objType));
}

function flushHolderChildren(holder, parent) {
  while (holder.children.length > 0) {
    parent.add(holder.children[0]);
  }
}

function isThenable(value) {
  return Boolean(value && typeof value.then === "function");
}

/** Dedicated deployers; never fall back to primitive deployMesh when holder is still empty. */
const SUBSCENE_NO_MESH_FALLBACK_TYPES = new Set(["text", "infopanel"]);

function shouldFallbackDeployMesh(record, deployResult) {
  if (isThenable(deployResult)) {
    return false;
  }
  const objType = normalizeObjType(record?.objType);
  return !SUBSCENE_NO_MESH_FALLBACK_TYPES.has(objType);
}

function finalizeSubSceneChildDeploy(holder, parent, child, deployResult) {
  if (holder.children.length > 0) {
    flushHolderChildren(holder, parent);
    return deployResult;
  }
  if (isThenable(deployResult)) {
    return deployResult.then(() => {
      flushHolderChildren(holder, parent);
    });
  }
  if (shouldFallbackDeployMesh(child, deployResult)) {
    deployMesh(child, parent);
  }
  return deployResult;
}

/**
 * Attach record.subScene directly under an already-created parent (no threeJsonId lookup).
 * @param {import("three").Object3D} parent
 * @param {object} record
 * @param {object} ctx
 */
function deploySubSceneUnderParent(parent, record, ctx = {}) {
  const children = Array.isArray(record?.subScene) ? record.subScene : [];
  if (!parent || children.length === 0) {
    return;
  }
  const pending = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child || typeof child !== "object") {
      continue;
    }
    const childType = normalizeObjType(child.objType);
    const isNestedContainer = Array.isArray(child.subScene) && child.subScene.length > 0;
    if (isNestedContainer) {
      const result = runRecordDeployWithLifecycle(child, ctx?.objectLifecycle ?? null, () => {
        const group = createGroup(child);
        if (group) {
          parent.add(group);
          return deploySubSceneUnderParent(group, child, ctx);
        }
      }, { dynamicReadyElm: ctx?.dynamicLifecycleDispatch === true });
      if (result && typeof result.then === "function") {
        pending.push(result);
      }
      continue;
    }
    if (tryDeploySubSceneChildByExtension(parent, child, ctx)) {
      continue;
    }
    const result = deploySubSceneChildRecord(parent, child, ctx);
    if (result && typeof result.then === "function") {
      pending.push(result);
    }
  }
  return pending.length > 0 ? Promise.all(pending).then(() => undefined) : undefined;
}

function deploySubSceneChildRecord(parent, child, ctx) {
  return runRecordDeployWithLifecycle(child, ctx?.objectLifecycle ?? null, () => {
    const holder = new THREE.Group();
    const deployResult = deployObjectRecord(holder, child, ctx);
    return finalizeSubSceneChildDeploy(holder, parent, child, deployResult);
  }, { dynamicReadyElm: ctx?.dynamicLifecycleDispatch === true });
}

async function deploySubSceneChildRecordAsync(parent, child, ctx) {
  await runRecordDeployWithLifecycle(child, ctx?.objectLifecycle ?? null, async () => {
    const holder = new THREE.Group();
    let deployResult = deployObjectRecord(holder, child, ctx);
    if (isThenable(deployResult)) {
      await deployResult;
      deployResult = null;
    }
    if (holder.children.length > 0) {
      flushHolderChildren(holder, parent);
      return;
    }
    if (shouldFallbackDeployMesh(child, deployResult)) {
      deployMesh(child, parent);
    }
  }, { awaitSideEffects: true, dynamicReadyElm: ctx?.dynamicLifecycleDispatch === true });
}

function getDeploymentPhase(record) {
  const objType = normalizeObjType(record?.objType);
  if (!objType || RUNTIME_OBJ_TYPES.has(objType)) {
    return 0;
  }
  if (objType === "externalmodel") {
    return 3;
  }
  if (objType === "domain") {
    return 4;
  }
  return 2;
}

function createObjectFromRecord(record) {
  if (!isObjectRecordLike(record)) {
    return null;
  }
  const objType = normalizeObjType(record.objType);
  if (objType === "group") {
    return createGroup(record) ?? null;
  }
  if (objType === "line") {
    return (record.material?.linewidth ? createLine2(record) : createLine(record)) ?? null;
  }
  // Side-effect or async-first objTypes are intentionally excluded.
  if (objType === "externalmodel" || objType === "skinned" || objType === "audio" || objType === "domain") {
    return null;
  }
  const holder = new THREE.Group();
  deployObjectRecord(holder, record, {});
  const child = holder.children[0] ?? null;
  if (child) {
    holder.remove(child);
    return child;
  }
  return null;
}

function setArchiveExternalDeployer(fn) {
  _archiveExternalDeployer = typeof fn === "function" ? fn : null;
}

function deployObjectRecord(targetRoot, record, ctx = {}) {
  if (!targetRoot || !record || typeof record !== "object") {
    return;
  }
  const objType = normalizeObjType(record.objType);
  if (!objType || RUNTIME_OBJ_TYPES.has(objType) || objType === "default" || objType === "pass" || objType === "boxhelper") {
    return;
  }
  if (shouldDeployNativeOnly(record, ctx)) {
    deployNativeObjectRecordWithFallback(targetRoot, record, ctx);
    return;
  }
  if (objType === "group") {
    const group = createGroup(record);
    if (group) {
      targetRoot.add(group);
      return deploySubSceneUnderParent(group, record, ctx);
    }
    return;
  }
  if (objType === "infopanel") {
    return deployInfoPanel(targetRoot, record);
  }
  if (objType === "text") {
    return ctx.awaitTextDeploy
      ? createTextAsync(targetRoot, record, ctx)
      : createText(targetRoot, record, ctx);
  }
  if (objType === "line") {
    const line = record.material?.linewidth ? createLine2(record) : createLine(record);
    if (line) {
      targetRoot.add(line);
    }
    return;
  }
  if (objType === "heatmap") {
    const depth = Number(record?.geometry?.depth);
    if (Number.isFinite(depth) && depth > 0) {
      createHeatmapVolume(record, targetRoot);
    } else {
      createHeatmap(record, targetRoot);
    }
    return;
  }
  if (objType === "wind") {
    if (deployByObjTypeExtension(record, targetRoot, ctx)) {
      return;
    }
    log.warn("[sceneLoad] objType wind: no deployer registered (import from \"threejson\")");
    return;
  }
  if (objType === "shadersurface") {
    if (deployByObjTypeExtension(record, targetRoot, ctx)) {
      return;
    }
    log.warn("[sceneLoad] objType shaderSurface: no deployer registered (import from \"threejson\")");
    return;
  }
  if (objType === "plane") {
    createPlane(record, targetRoot);
    return;
  }
  if (objType === "points" || objType === "particles") {
    createPoints(record, targetRoot);
    return;
  }
  if (objType === "sprite") {
    createSprite(record, targetRoot);
    return;
  }
  if (objType === "tube") {
    createTube(record, targetRoot);
    return;
  }
  if (objType === "shapeplane") {
    createShapePlane(record, targetRoot);
    return;
  }
  if (objType === "buffermesh") {
    createBufferMesh(record, targetRoot);
    return;
  }
  if (objType === "irregularplane") {
    createIrregularPlane(record, targetRoot);
    return;
  }
  if (objType === "shapeextrude") {
    createShapeExtrude(record, targetRoot);
    return;
  }
  if (objType === "irregulargeometry") {
    createIrregularGeometry(record, targetRoot);
    return;
  }
  if (objType === "instanced") {
    deployInstancedMesh(record, targetRoot);
    return;
  }
  if (objType === "skinned") {
    loadSkinnedModel(record, targetRoot, {
      camera: ctx.camera ?? null,
      scene: ctx.scene?.isScene ? ctx.scene : null
    });
    return;
  }
  if (objType === "audio") {
    deploySceneAudio(record, targetRoot, ctx);
    return;
  }
  if (objType === "externalmodel") {
    if (isArchiveExternalModelRecord(record)) {
      if (!_archiveExternalDeployer) {
        throw new Error("[deployObjectRecord] archive external deployer is not configured");
      }
      void _archiveExternalDeployer(record, targetRoot, ctx).catch((error) => {
        log.error("[archive] deploy external archive model failed:", error);
      });
      return;
    }
    loadExternalModel(record, targetRoot, {
      camera: ctx.camera ?? null,
      scene: ctx.scene?.isScene ? ctx.scene : null
    });
    return;
  }
  if (objType === "domain") {
    invokeDomainModel(targetRoot, record, ctx);
    return;
  }
  deployMeshWithDomains(targetRoot, record, ctx);
  return deploySubSceneChildren(targetRoot, record, ctx, deploySubSceneChildRecord);
}

function deployObjectRecordAsync(targetRoot, record, ctx = {}) {
  if (getDeploymentPhase(record) === 3) {
    const scene = ctx.scene?.isScene ? ctx.scene : null;
    if (!scene) {
      return Promise.reject(new Error("[deployObjectRecordAsync] externalmodel requires scene context"));
    }
    if (isArchiveExternalModelRecord(record)) {
      if (!_archiveExternalDeployer) {
        return Promise.reject(new Error("[deployObjectRecordAsync] archive external deployer is not configured"));
      }
      return _archiveExternalDeployer(record, targetRoot, ctx).then(() =>
        deploySubSceneChildrenAsync(targetRoot, record, ctx, deploySubSceneChildRecordAsync)
      );
    }
    return loadExternalModelAsync(record, scene, {
      camera: ctx.camera ?? null,
      scene
    }).then(() => deploySubSceneChildrenAsync(targetRoot, record, ctx, deploySubSceneChildRecordAsync));
  }
  const asyncCtx = { ...ctx, awaitTextDeploy: true };
  const result = deployObjectRecord(targetRoot, record, asyncCtx);
  return Promise.resolve(result);
}

export {
  createObjectFromRecord,
  deployObjectRecord,
  deployObjectRecordAsync,
  deploySubSceneUnderParent,
  getDeploymentPhase,
  isObjectRecordLike,
  normalizeObjType,
  setArchiveExternalDeployer
};
