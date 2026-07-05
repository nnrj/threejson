import * as THREE from "three";
import { log } from "../util/logger.js";

import {
  resolveLightIntensityForContext,
  warnIfUnsupportedThreeRevision
} from "../compat/index.js";
import { applyControlsConfig } from "../builder/controlsBuilder.js";
import { attachCameraToPlayerRig } from "./controls/playerRigAttach.js";
import { createSceneRuntime } from "./sceneRuntimeHandler.js";
import {
  applySceneBackdropFromHints,
  applySceneBackdropSimpleFromHints,
  disposeThreeJsonSceneBackdrop,
  sceneConfigNeedsAsyncBackdrop
} from "./sceneBackdropResolver.js";
import {
  buildDeployJobs,
  cancelActiveDeployScheduler,
  resolveDeploySchedulerConfig,
  runDeployJobs,
  runDeployJobsImmediate,
  runDeployJobsScheduled
} from "../runtime/deployScheduler.js";
import { deployByObjTypeExtension } from "./sceneExtensionRegistry.js";
import { invokeDomainModel } from "./businessDomainModelDispatch.js";
import { deployMeshWithDomains } from "./businessDomainRegistry.js";
import { normalizeScenePayload } from "./sceneFriendlyNormalizer.js";
import {
  applyAutoFitCameraToRuntime,
  applySceneRuntimeDefaults,
  ensureDefaultSceneLightsInScene,
  mergeRuntimeDefaultOptions
} from "../util/sceneRuntimeDefaults.js";
import { resolveRenderLoopFpsPolicy } from "../util/renderLoopPolicy.js";
import { runScenePostLoadIntroIfConfigured } from "../runtime/sceneIntroOverlay.js";
import { warnIntroSkippedOnSyncPath } from "../runtime/sceneIntroConfig.js";
import { unregisterObject, registerObject, rebuildObjectRegistryFromScene, getObjectByThreeJsonId } from "./objectRegistry.js";
import { disposeObjectTree, detachObjectTree } from "./disposeObjectTree.js";
import { getThreeJsonIdsInSystemBucket } from "./bucketIndex.js";
import {
  createGroup,
  createLine,
  createLine2,
  createHeatmap,
  createHeatmapVolume,
  createPlane,
  createPoints,
  createSprite,
  createTube,
  loadSkinnedModel,
  deployInstancedMesh,
  loadExternalModel,
  loadExternalModelAsync
} from "../builder/modelBuilder.js";
import { createShapePlane } from "../builder/shapePlaneBuilder.js";
import { createShapeExtrude } from "../builder/shapeExtrudeBuilder.js";
import { createBufferMesh } from "../builder/bufferMeshBuilder.js";
import { createIrregularPlane } from "../builder/irregularPlaneBuilder.js";
import { createIrregularGeometry } from "../builder/irregularGeometryBuilder.js";
import { deployInfoPanel } from "../builder/infoPanelBuilder.js";
import { createText, createTextAsync, preloadSceneTextFonts } from "../builder/textBuilder.js";
import { deployCss3dPanel } from "../builder/css3d/css3dPanelBuilder.js";
import { integrateCss3dIntoSceneLoad } from "../builder/css3d/attachSceneRuntime.js";
import { integrateEventMechanismIntoSceneLoad } from "../runtime/eventMechanism/attachSceneEventRuntime.js";
import {
  resolveSceneLoadObjectLifecycle,
  runRecordDeployWithLifecycle
} from "../runtime/objectLifecycle/index.js";
import {
  LOAD_PHASE,
  TEARDOWN_PHASE,
  FRAME_PHASE,
  createSceneLifecycleContext,
  createFrameContext,
  resolveLifecycleHooks,
  buildSceneReadyFields,
  buildRuntimeReadyFields
} from "../runtime/sceneLoadLifecycle.js";
import {
  parseThreeNativeObjectJsonAndAdd,
  resolveScenePayloadForLoad
} from "../builder/nativeObjectLoader.js";
import {
  cleanupThreeJsonAudioAttachments,
  deploySceneAudio
} from "../builder/audioBuilder.js";
import {
  deployNativeObjectRecordWithFallback
} from "./nativeObjectDispatch.js";
import { shouldDeployNativeOnly } from "./nativeParseMode.js";
import { hasValue, listOr } from "../util/util.js";
import {
  deployPassRecordsFromObjectList,
  filterNonPassRecords
} from "./postProcessPassDeploy.js";
import { deployBoundBoxHelpersFromPayload } from "./boxHelperDeploy.js";
import {
  mountSceneHelpers
} from "../builder/sceneHelperBuilder.js";
import { clearAssetRegistry, registerAssetLibrary } from "../cache/assetRegistry.js";
import { configureTextureUrlCacheForDeploy } from "../cache/textureUrlCache.js";
import { configureInfoPanelForDeploy } from "../builder/infoPanelBuilder.js";
import { configureTextureDefaultsForDeploy } from "../util/textureSampling.js";
import {
  collectRequiredNativeGeometries,
  ensureNativeGeometriesRegistered
} from "../util/nativeGeometryRegistry.js";
import {
  collectRequiredNativeMaterials,
  ensureNativeMaterialsLoaded
} from "../util/nativeMaterialRegistry.js";
import {
  createCameraFromDescriptor,
  applyCameraDescriptor
} from "../util/cameraFactory.js";
import { deploySubSceneChildren, deploySubSceneChildrenAsync } from "./subSceneDeploy.js";
import { deploySubSceneUnderParent } from "./objectDispatchHandler.js";

const CONTENT_CLEAR_SYSTEM_TAGS = [
  "objects",
  "domain",
  "models",
  "native-record",
  "native-scene",
  "temp",
  "environment",
  "assist"
];
const NATIVE_EMBED_FLAG = "__threeJsonNativeEmbed";
const NATIVE_SCENE_ROOT_ID = "__threejson_native_scene__";
const AUTO_HEAT_OBJ_TYPES = new Set(["heat", "heatmap", "heatmapvolume", "heatmap3d"]);
const CANONICAL_RUNTIME_OBJ_TYPES = new Set(["scene", "camera", "renderer", "controls", "light", "renderloop"]);
const ARCHIVE_MODEL_FILE_TYPES = new Set(["tjz", "threejson", "tjson", "zip"]);
let _parseTjzArchiveForScenePromise = null;
let _inspectTjzArchiveEntryPromise = null;
let _objectLoadHandlerPromise = null;

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function getWindowSizeFallback() {
  if (typeof window === "undefined") {
    return { width: 1, height: 1 };
  }
  return {
    width: window.innerWidth || 1,
    height: window.innerHeight || 1
  };
}

function disposeObjectsInSystemBuckets(tags) {
  const seen = new Set();
  for (let ti = 0; ti < tags.length; ti++) {
    const ids = getThreeJsonIdsInSystemBucket(tags[ti]);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      const obj = getObjectByThreeJsonId(id);
      if (obj) {
        disposeObjectTree(obj);
      }
    }
  }
}

function clearDeployedContentBuckets() {
  disposeObjectsInSystemBuckets(CONTENT_CLEAR_SYSTEM_TAGS);
}

function resolveResourcePolicy(normalized = {}, options = {}) {
  const candidates = [
    options?.resourcePolicy,
    normalized?.sceneConfig?.runtimeDefaults?.resourcePolicy,
    normalized?.sceneConfig?.resourcePolicy,
    normalized?.worldInfo?.runtimeDefaults?.resourcePolicy,
    normalized?.sourcePayload?.sysConfig?.resourcePolicy
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const one = candidates[i];
    if (one && typeof one === "object") {
      return one;
    }
  }
  return {};
}

function isAutoResourceCleanupEnabled(normalized = {}, options = {}) {
  const policy = resolveResourcePolicy(normalized, options);
  if (typeof policy.enabled === "boolean") {
    return policy.enabled;
  }
  if (typeof policy.autoCleanup === "boolean") {
    return policy.autoCleanup;
  }
  return true;
}

function clearLegacyNativeEmbedRoots(scene) {
  if (!scene || typeof scene.traverse !== "function") {
    return;
  }
  const toRemove = [];
  scene.traverse((child) => {
    if (child !== scene && child?.userData?.[NATIVE_EMBED_FLAG] === true) {
      toRemove.push(child);
    }
  });
  for (let i = 0; i < toRemove.length; i++) {
    disposeObjectTree(toRemove[i]);
  }
}

function cloneIfPossible(value) {
  if (!value) {
    return value ?? null;
  }
  if (typeof value.clone === "function") {
    return value.clone();
  }
  return value;
}

/**
 * Populate assetRegistry before deploy (phase 0); cleared and rebuilt on resetScene.
 * @param {object} normalized
 * @param {boolean} resetScene
 */
function bootstrapAssetRegistryForDeploy(normalized, resetScene) {
  if (resetScene !== false) {
    clearAssetRegistry();
  }
  configureTextureUrlCacheForDeploy(normalized);
  configureTextureDefaultsForDeploy(normalized);
  configureInfoPanelForDeploy(normalized);
  const lib =
    normalized.assetLibrary ??
    normalized.worldInfo?.assetLibrary ??
    normalized.payload?.assetLibrary ??
    normalized.sourcePayload?.assetLibrary;
  registerAssetLibrary(lib);
}

/**
 * Phase 0: asset registry + on-demand jsm geometry/material register (failures isolated; do not block the whole scene).
 * @param {object} normalized
 * @param {boolean} resetScene
 */
async function bootstrapSceneAssetsForDeploy(normalized, resetScene) {
  bootstrapAssetRegistryForDeploy(normalized, resetScene);
  const geometryNames = collectRequiredNativeGeometries(normalized);
  const materialNames = collectRequiredNativeMaterials(normalized);
  await ensureNativeGeometriesRegistered(geometryNames);
  await ensureNativeMaterialsLoaded(materialNames);
}

function toVector3(value, defaultValue = { x: 0, y: 0, z: 0 }) {
  return {
    x: hasValue(value?.x) ? Number(value.x) : defaultValue.x,
    y: hasValue(value?.y) ? Number(value.y) : defaultValue.y,
    z: hasValue(value?.z) ? Number(value.z) : defaultValue.z
  };
}

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function getParseTjzArchiveForScene() {
  if (!_parseTjzArchiveForScenePromise) {
    _parseTjzArchiveForScenePromise = import("../archive/tjzArchive.js")
      .then((mod) => mod.parseTjzArchiveForScene);
  }
  return _parseTjzArchiveForScenePromise;
}

async function getInspectTjzArchiveEntry() {
  if (!_inspectTjzArchiveEntryPromise) {
    _inspectTjzArchiveEntryPromise = import("../archive/tjzArchive.js")
      .then((mod) => mod.inspectTjzArchiveEntry);
  }
  return _inspectTjzArchiveEntryPromise;
}

async function getObjectLoadHandler() {
  if (!_objectLoadHandlerPromise) {
    _objectLoadHandlerPromise = import("./objectLoadHandler.js");
  }
  return _objectLoadHandlerPromise;
}

function isObjectRecordEntry(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && normalizeObjType(value.objType));
}

function resolveArchiveObjectEntryMode(options = {}) {
  const mode = normalizeObjType(options.objectEntryMode);
  if (mode === "replace" || mode === "replacewithrelight" || mode === "replacewithlight") {
    return "replace";
  }
  return "append";
}

function clearTargetForObjectArchiveEntry(target) {
  const runtime = extractDeploymentTarget(target);
  const scene = runtime.scene;
  if (runtime.camera) {
    cleanupThreeJsonAudioAttachments(runtime.camera);
  }
  clearDeployedContentBuckets();
  clearLegacyNativeEmbedRoots(scene);
  const children = Array.isArray(scene?.children) ? [...scene.children] : [];
  for (let i = 0; i < children.length; i++) {
    disposeObjectTree(children[i]);
  }
  disposeThreeJsonSceneBackdrop(scene);
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

function applyRecordTransformToObject3D(object3D, record = {}) {
  if (!object3D || !record || typeof record !== "object") {
    return;
  }
  const p = toVector3(record.position, { x: 0, y: 0, z: 0 });
  object3D.position.set(p.x, p.y, p.z);
  const r = record.rotation && typeof record.rotation === "object" ? record.rotation : {};
  object3D.rotation.set(
    Number.isFinite(r.rotationX) ? Number(r.rotationX) : 0,
    Number.isFinite(r.rotationY) ? Number(r.rotationY) : 0,
    Number.isFinite(r.rotationZ) ? Number(r.rotationZ) : 0
  );
  const s = record.scale && typeof record.scale === "object" ? record.scale : {};
  object3D.scale.set(
    Number.isFinite(s.scaleX) ? Number(s.scaleX) : 1,
    Number.isFinite(s.scaleY) ? Number(s.scaleY) : 1,
    Number.isFinite(s.scaleZ) ? Number(s.scaleZ) : 1
  );
  object3D.visible = record.visible !== false;
}

function getArchiveLoadContext(ctx = {}) {
  const state = ctx.__archiveLoadState && typeof ctx.__archiveLoadState === "object"
    ? ctx.__archiveLoadState
    : {};
  return {
    depth: Number.isFinite(state.depth) ? state.depth : 0,
    maxDepth: Number.isFinite(state.maxDepth) ? state.maxDepth : 3,
    visitedModelPaths: state.visitedModelPaths instanceof Set ? state.visitedModelPaths : new Set(),
    strictRecursion: state.strictRecursion === true
  };
}

async function deployArchiveExternalModel(record, overlayRoot, ctx = {}) {
  if (!record?.modelPath || !overlayRoot) {
    return null;
  }
  const archiveCtx = getArchiveLoadContext(ctx);
  const pathKey = String(record.modelPath).trim();
  if (archiveCtx.depth >= archiveCtx.maxDepth) {
    const msg = `[archive] maxArchiveDepth reached (${archiveCtx.maxDepth}): ${pathKey}`;
    if (archiveCtx.strictRecursion) {
      throw new Error(msg);
    }
    log.warn(msg);
    return null;
  }
  if (archiveCtx.visitedModelPaths.has(pathKey)) {
    const msg = `[archive] recursive archive reference detected: ${pathKey}`;
    if (archiveCtx.strictRecursion) {
      throw new Error(msg);
    }
    log.warn(msg);
    return null;
  }
  archiveCtx.visitedModelPaths.add(pathKey);
  const parseTjzArchiveForScene = await getParseTjzArchiveForScene();
  const parsed = await parseTjzArchiveForScene(record.modelPath, {
    missingAssetPolicy: ctx.missingAssetPolicy,
    onWarning: ctx.onWarning
  });
  const payload = resolveScenePayloadForLoad(parsed.payload, {
    label: record.name || record.modelPath
  });
  const container = new THREE.Group();
  container.name = record.name || "archive-model";
  applyRecordTransformToObject3D(container, record);
  overlayRoot.add(container);
  const nextCtx = {
    ...ctx,
    __archiveLoadState: {
      ...archiveCtx,
      depth: archiveCtx.depth + 1,
      visitedModelPaths: new Set([...archiveCtx.visitedModelPaths])
    }
  };
  try {
    await deployJsonScene(container, payload, {
      resetScene: false,
      context: nextCtx
    });
    if (!ctx.__archiveDisposeList) {
      ctx.__archiveDisposeList = [];
    }
    ctx.__archiveDisposeList.push(parsed.dispose);
    return container;
  } finally {
    archiveCtx.visitedModelPaths.delete(pathKey);
  }
}

function getCanonicalDeploymentPhase(record) {
  const objType = normalizeObjType(record?.objType);
  if (!objType || CANONICAL_RUNTIME_OBJ_TYPES.has(objType)) {
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

function deployCanonicalRecord(overlayRoot, record, ctx) {
  if (!record || typeof record !== "object") {
    return;
  }
  const objType = normalizeObjType(record.objType);
  if (shouldDeployNativeOnly(record, ctx)) {
    deployNativeObjectRecordWithFallback(overlayRoot, record, ctx);
    return;
  }
  if (objType === "group") {
    const group = createGroup(record);
    if (group) {
      overlayRoot.add(group);
      return deploySubSceneUnderParent(group, record, ctx);
    }
    return;
  }
  if (objType === "infopanel") {
    return deployInfoPanel(overlayRoot, record);
  }
  if (objType === "text") {
    return ctx.awaitTextDeploy
      ? createTextAsync(overlayRoot, record, ctx)
      : createText(overlayRoot, record, ctx);
  }
  if (objType === "css3dpanel") {
    deployCss3dPanel(record, overlayRoot);
    return;
  }
  if (objType === "line") {
    const line = record.material?.linewidth ? createLine2(record) : createLine(record);
    if (line) {
      overlayRoot.add(line);
    }
    return;
  }
  if (objType === "heatmap") {
    const depth = Number(record?.geometry?.depth);
    if (Number.isFinite(depth) && depth > 0) {
      createHeatmapVolume(record, overlayRoot);
    } else {
      createHeatmap(record, overlayRoot);
    }
    return;
  }
  if (objType === "wind") {
    if (deployByObjTypeExtension(record, overlayRoot, ctx)) {
      return;
    }
    log.warn("[sceneLoad] objType wind: no deployer registered (import from \"threejson\")");
    return;
  }
  if (objType === "shadersurface") {
    if (deployByObjTypeExtension(record, overlayRoot, ctx)) {
      return;
    }
    log.warn("[sceneLoad] objType shaderSurface: no deployer registered (import from \"threejson\")");
    return;
  }
  if (objType === "particleemitter") {
    if (deployByObjTypeExtension(record, overlayRoot, ctx)) {
      return;
    }
    log.warn("[sceneLoad] objType particleEmitter: no deployer registered (import from \"threejson\")");
    return;
  }
  if (objType === "plane") {
    createPlane(record, overlayRoot);
    return;
  }
  if (objType === "points" || objType === "particles") {
    createPoints(record, overlayRoot);
    return;
  }
  if (objType === "sprite") {
    createSprite(record, overlayRoot);
    return;
  }
  if (objType === "tube") {
    createTube(record, overlayRoot);
    return;
  }
  if (objType === "shapeplane") {
    createShapePlane(record, overlayRoot);
    return;
  }
  if (objType === "buffermesh") {
    createBufferMesh(record, overlayRoot);
    return;
  }
  if (objType === "irregularplane") {
    createIrregularPlane(record, overlayRoot);
    return;
  }
  if (objType === "shapeextrude") {
    createShapeExtrude(record, overlayRoot);
    return;
  }
  if (objType === "irregulargeometry") {
    createIrregularGeometry(record, overlayRoot);
    return;
  }
  if (objType === "instanced") {
    deployInstancedMesh(record, overlayRoot);
    return;
  }
  if (objType === "skinned") {
    loadSkinnedModel(record, overlayRoot, {
      camera: ctx.camera ?? null,
      scene: ctx.scene?.isScene ? ctx.scene : null
    });
    return;
  }
  if (objType === "audio") {
    deploySceneAudio(record, overlayRoot, ctx);
    return;
  }
  if (objType === "externalmodel") {
    if (isArchiveExternalModelRecord(record)) {
      void deployArchiveExternalModel(record, overlayRoot, ctx).catch((error) => {
        log.error("[archive] deploy external archive model failed:", error);
      });
      return;
    }
    loadExternalModel(record, overlayRoot, {
      camera: ctx.camera ?? null,
      scene: ctx.scene?.isScene ? ctx.scene : null
    });
    return;
  }
  if (objType === "domain") {
    invokeDomainModel(overlayRoot, record, ctx);
    return;
  }
  if (objType === "pass") {
    return;
  }
  if (objType === "boxhelper") {
    return;
  }
  if (objType === "default") {
    return;
  }
  if (deployByObjTypeExtension(record, overlayRoot, ctx)) {
    return;
  }
  deployMeshWithDomains(overlayRoot, record, ctx);
  return deploySubSceneChildren(overlayRoot, record, ctx, deployOneCanonicalRecordSync);
}

function deployOneCanonicalRecordSync(overlayRoot, record, ctx) {
  return runRecordDeployWithLifecycle(record, ctx?.objectLifecycle ?? null, () => {
    return deployCanonicalRecord(overlayRoot, record, ctx);
  });
}

/**
 * @param {import("three").Object3D} overlayRoot
 * @param {object} record
 * @param {object} ctx
 * @returns {void|Promise<void>}
 */
function deployOneCanonicalRecord(overlayRoot, record, ctx) {
  const lifecycleCtx = ctx?.objectLifecycle ?? null;
  const runDeploy = () => {
    if (getCanonicalDeploymentPhase(record) === 3) {
      const scene = ctx.scene?.isScene ? ctx.scene : null;
      if (!scene) {
        return Promise.reject(new Error("[deployCanonicalRecord] externalmodel requires scene context"));
      }
      if (isArchiveExternalModelRecord(record)) {
        return deployArchiveExternalModel(record, overlayRoot, ctx).then(() => {
          return deploySubSceneChildren(overlayRoot, record, ctx, deployOneCanonicalRecordSync);
        });
      }
      return loadExternalModelAsync(record, scene, {
        camera: ctx.camera ?? null,
        scene
      }).then(() => {
        return deploySubSceneChildren(overlayRoot, record, ctx, deployOneCanonicalRecordSync);
      });
    }
    return deployCanonicalRecord(overlayRoot, record, ctx);
  };
  return runRecordDeployWithLifecycle(record, lifecycleCtx, runDeploy, { awaitSideEffects: true });
}

function wrapRuntimeWithArchiveDispose(runtime, archiveDispose, nestedDisposeList = []) {
  if (!runtime || typeof archiveDispose !== "function") {
    return runtime;
  }
  const innerDispose = typeof runtime.dispose === "function" ? runtime.dispose.bind(runtime) : null;
  let cleaned = false;
  function cleanupArchiveUrlsOnce() {
    if (cleaned) {
      return;
    }
    cleaned = true;
    try {
      archiveDispose();
    } catch (error) {
      log.warn("[archive] dispose object URLs failed:", error);
    }
  }
  const disposeList = Array.isArray(nestedDisposeList) ? nestedDisposeList : [];
  return {
    ...runtime,
    dispose() {
      for (let i = 0; i < disposeList.length; i++) {
        try {
          disposeList[i]?.();
        } catch (error) {
          log.warn("[archive] nested archive dispose failed:", error);
        }
      }
      cleanupArchiveUrlsOnce();
      innerDispose?.();
    },
    disposeArchiveUrls: cleanupArchiveUrlsOnce
  };
}

function clearSceneChildren(scene, options = {}) {
  const children = Array.isArray(scene?.children) ? [...scene.children] : [];
  const shouldDispose = options.dispose !== false;
  for (let i = 0; i < children.length; i++) {
    if (shouldDispose) {
      disposeObjectTree(children[i]);
    } else {
      detachObjectTree(children[i]);
    }
  }
}

function removeLightNodes(root) {
  if (!root || typeof root.traverse !== "function") {
    return;
  }
  const lights = [];
  root.traverse((node) => {
    if (node?.isLight) {
      lights.push(node);
    }
  });
  for (let i = 0; i < lights.length; i++) {
    disposeObjectTree(lights[i]);
  }
}

function flattenNestedScene(parentRoot, parsedRoot) {
  if (!parsedRoot || parsedRoot.isScene !== true) {
    return {
      background: null,
      environment: null,
      fog: null
    };
  }
  const sceneState = {
    background: cloneIfPossible(parsedRoot.background),
    environment: cloneIfPossible(parsedRoot.environment),
    fog: cloneIfPossible(parsedRoot.fog)
  };
  const children = [...parsedRoot.children];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    parsedRoot.remove(child);
    parentRoot.add(child);
  }
  if (parsedRoot.parent) {
    parsedRoot.parent.remove(parsedRoot);
  }
  return sceneState;
}

function createStandaloneCamera(cameraConfig = {}, sizeHint = {}) {
  const width = Math.max(Number(sizeHint.width) || 1, 1);
  const height = Math.max(Number(sizeHint.height) || 1, 1);
  return createCameraFromDescriptor(cameraConfig, width, height);
}

async function applySceneStateAsync(scene, normalized, nativeSceneState = {}, renderer = null) {
  const sceneHints = normalized.sceneHints || {};
  scene.background = nativeSceneState.background ?? null;
  scene.environment = nativeSceneState.environment ?? null;
  scene.fog = nativeSceneState.fog ?? null;
  if (hasOwn(sceneHints, "background") || hasOwn(sceneHints, "environment")) {
    await applySceneBackdropFromHints(scene, sceneHints, renderer, {});
  }
}

function applyCameraConfig(camera, config = {}, renderer = null) {
  if (!camera) {
    return;
  }
  const domElement = renderer?.domElement;
  const width = domElement?.clientWidth || domElement?.width || getWindowSizeFallback().width;
  const height = domElement?.clientHeight || domElement?.height || getWindowSizeFallback().height;
  applyCameraDescriptor(camera, config, { width, height });
}

function applyRendererConfig(renderer, config = {}, sceneConfig = {}) {
  if (!renderer) {
    return;
  }
  if (hasOwn(config, "shadowMapEnabled")) {
    renderer.shadowMap.enabled = Boolean(config.shadowMapEnabled);
  }
  if (isFiniteNumber(config.clearAlpha)) {
    renderer.setClearAlpha(config.clearAlpha);
  }
  const width = sceneConfig.canvasWidth;
  const height = sceneConfig.canvasHeight;
  if (isFiniteNumber(width) && isFiniteNumber(height)) {
    renderer.setSize(width, height);
  }
  const ratioRate = isFiniteNumber(config.ratioRate) ? config.ratioRate : 1;
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  renderer.setPixelRatio(dpr * ratioRate);
}

/**
 * Resolve light intensity from the effective Three revision (declared / runtime / major version).
 * @param {object} entry
 * @param {{ three?: typeof import("three"), sceneJsonRoot?: object, sceneConfig?: object, worldInfo?: object }} [ctx]
 * @returns {number}
 */
export function resolveLightIntensity(entry, ctx) {
  return resolveLightIntensityForContext(entry, ctx);
}

/** @type {object|undefined} */
let activeSceneLoadContext;

/**
 * @param {object|undefined} ctx
 */
export function setSceneLoadCompatContext(ctx) {
  activeSceneLoadContext = ctx;
}

function createManagedLight(entry) {
  if (!entry || typeof entry !== "object" || !entry.type) {
    return [];
  }
  const intensity = resolveLightIntensity(entry, activeSceneLoadContext);
  const color = entry.color || "#ffffff";
  const created = [];

  let light = null;
  if (entry.type === "ambient") {
    light = new THREE.AmbientLight(color, intensity);
  } else if (entry.type === "directional") {
    light = new THREE.DirectionalLight(color, intensity);
  } else if (entry.type === "point") {
    light = new THREE.PointLight(
      color,
      intensity,
      isFiniteNumber(entry.distance) ? entry.distance : 0,
      isFiniteNumber(entry.decay) ? entry.decay : 2
    );
  } else if (entry.type === "spot") {
    light = new THREE.SpotLight(
      color,
      intensity,
      isFiniteNumber(entry.distance) ? entry.distance : 0,
      isFiniteNumber(entry.angle) ? entry.angle : Math.PI / 3,
      isFiniteNumber(entry.penumbra) ? entry.penumbra : 0,
      isFiniteNumber(entry.decay) ? entry.decay : 2
    );
  }
  if (!light) {
    return created;
  }

  const position = toVector3(entry.position, { x: 0, y: 0, z: 0 });
  if (entry.type !== "ambient" || position.x !== 0 || position.y !== 0 || position.z !== 0) {
    light.position.set(position.x, position.y, position.z);
  }
  if (entry.type !== "ambient" && light.shadow && entry.shadow !== false) {
    light.castShadow = true;
    const shadowHints = entry.shadow && typeof entry.shadow === "object" ? entry.shadow : {};
    const shadowNear = isFiniteNumber(shadowHints.cameraNear) ? shadowHints.cameraNear : entry.shadowCameraNear;
    const shadowFar = isFiniteNumber(shadowHints.cameraFar) ? shadowHints.cameraFar : entry.shadowCameraFar;
    if (isFiniteNumber(shadowNear)) {
      light.shadow.camera.near = shadowNear;
    }
    if (isFiniteNumber(shadowFar)) {
      light.shadow.camera.far = shadowFar;
    }
  }
  light.userData = {
    ...light.userData,
    objJson: {
      ...entry,
      objType: "light",
      threeJsonId: hasValue(entry.threeJsonId)
        ? String(entry.threeJsonId).trim()
        : (hasValue(entry.id) ? String(entry.id).trim() : `sys-light-${light.uuid}`),
      type: entry.type,
      color,
      intensity
    }
  };
  created.push(light);

  if (entry.type === "spot" && entry.target && typeof entry.target === "object") {
    const targetObject = new THREE.Object3D();
    const targetPosition = toVector3(entry.target, { x: 0, y: 0, z: 0 });
    targetObject.position.set(targetPosition.x, targetPosition.y, targetPosition.z);
    light.target = targetObject;
    created.push(targetObject);
  }
  return created;
}

function mountSceneLights(scene, lightsConfig = []) {
  if (!scene) {
    return;
  }
  for (let i = 0; i < lightsConfig.length; i++) {
    const bundle = createManagedLight(lightsConfig[i]);
    for (let j = 0; j < bundle.length; j++) {
      const node = bundle[j];
      scene.add(node);
      if (node?.isLight === true) {
        registerObject(node, node.userData?.objJson, { recursive: false });
      }
    }
  }
}

async function deployNativeSceneBase(scene, normalized) {
  const nativeEntry = normalized.nativeSceneEntry;
  if (!nativeEntry || !nativeEntry.json) {
    return {
      background: null,
      environment: null,
      fog: null
    };
  }
  clearLegacyNativeEmbedRoots(scene);

  const embedRoot = new THREE.Group();
  embedRoot.name = NATIVE_SCENE_ROOT_ID;
  embedRoot.userData = {
    ...(typeof embedRoot.userData === "object" && embedRoot.userData ? embedRoot.userData : {}),
    [NATIVE_EMBED_FLAG]: true,
    objJson: {
      objType: "native",
      threeJsonId: NATIVE_SCENE_ROOT_ID
    }
  };
  scene.add(embedRoot);
  registerObject(embedRoot, embedRoot.userData.objJson, {
    recursive: false,
    bucketCtx: { deployKind: "native-scene" }
  });

  const parsedRoot = await parseThreeNativeObjectJsonAndAdd(nativeEntry.json, embedRoot);
  if (normalized.hasExplicitLights) {
    removeLightNodes(parsedRoot);
  }
  const sceneState = flattenNestedScene(embedRoot, parsedRoot);
  if (parsedRoot && parsedRoot.isScene !== true && parsedRoot.parent !== embedRoot) {
    embedRoot.add(parsedRoot);
  }
  if (parsedRoot?.isScene === true && parsedRoot.parent) {
    parsedRoot.parent.remove(parsedRoot);
  }
  registerObject(embedRoot, embedRoot.userData.objJson, {
    recursive: true,
    bucketCtx: { deployKind: "native-scene" }
  });
  return sceneState;
}

function buildDeployContext(normalized, options = {}, runtimeHints = {}) {
  const objectLifecycle =
    options._objectLifecycle ??
    (options.objectLifecycle && typeof options.objectLifecycle === "object"
      ? options.objectLifecycle
      : null);
  return {
    sceneJsonRoot: normalized.compatPayload,
    jsonData: normalized.compatPayload,
    standardSceneJsonRoot: normalized.payload,
    sourceSceneJsonRoot: normalized.sourcePayload,
    worldInfo: normalized.worldInfo,
    sceneConfig: normalized.sceneConfig ?? null,
    defaultModelTemplate: normalized.defaultModelTemplate ?? null,
    scene: runtimeHints.scene ?? null,
    camera: runtimeHints.camera ?? null,
    renderer: runtimeHints.renderer ?? null,
    objectLifecycle,
    ...(options.context && typeof options.context === "object" ? options.context : {})
  };
}

/**
 * @param {import("three").Object3D} overlayRoot
 * @param {object} normalized
 * @param {object} options
 * @param {object} runtimeHints
 * @param {{ forceImmediate?: boolean }} [schedulerHints]
 * @returns {Promise<void>}
 */
function deployPostProcessPassesForScene(normalized, runtimeHints, options = {}) {
  const composer = runtimeHints.composer ?? options.composer ?? null;
  if (!composer) {
    return [];
  }
  rebuildObjectRegistryFromScene(runtimeHints.scene);
  return deployPassRecordsFromObjectList(normalized, {
    scene: runtimeHints.scene ?? null,
    camera: runtimeHints.camera ?? null,
    renderer: runtimeHints.renderer ?? null,
    composer
  });
}

async function runCanonicalObjectDeploy(overlayRoot, normalized, options = {}, runtimeHints = {}, schedulerHints = {}) {
  const ctx = buildDeployContext(normalized, options, runtimeHints);
  ctx.awaitTextDeploy = true;
  const records = filterNonPassRecords(normalized.objectList);
  const jobs = buildDeployJobs(
    records,
    (record) => deployOneCanonicalRecord(overlayRoot, record, ctx),
    getCanonicalDeploymentPhase,
    normalized.sceneConfig ?? {}
  );
  const schedulerConfig = schedulerHints.forceImmediate
    ? { mode: "immediate" }
    : resolveDeploySchedulerConfig(normalized.sceneConfig);
  const bus = options._lifecycleBus ?? null;
  const lifecycleBaseCtx = options._lifecycleBaseCtx ?? null;
  let onProgress = null;
  if (bus && lifecycleBaseCtx && bus.has(LOAD_PHASE.onDeployProgress)) {
    onProgress = bus.createDeployProgressEmitter(lifecycleBaseCtx);
  }
  if (schedulerConfig.mode === "immediate") {
    await runDeployJobs(jobs, { onProgress });
    return;
  }
  await runDeployJobsScheduled(jobs, schedulerConfig, { onProgress });
}

function deployCanonicalObjectList(overlayRoot, normalized, options = {}, runtimeHints = {}) {
  runDeployJobsImmediate(
    buildDeployJobs(
      filterNonPassRecords(normalized.objectList),
      (record) =>
        deployOneCanonicalRecord(
          overlayRoot,
          record,
          buildDeployContext(normalized, options, runtimeHints)
        ),
      getCanonicalDeploymentPhase,
      normalized.sceneConfig ?? {}
    )
  );
}

function extractDeploymentTarget(target) {
  if (target?.isScene === true) {
    return {
      scene: target,
      camera: null,
      renderer: null,
      controls: null,
      renderLoop: null,
      start: null,
      stop: null,
      resize: null,
      dispose: null
    };
  }
  if (target && target.scene?.isScene === true) {
    return target;
  }
  throw new Error("deployJsonScene: target must be THREE.Scene or a runtime object containing scene");
}

async function deployIntoTarget(target, normalized, options = {}) {
  setSceneLoadCompatContext({
    three: THREE,
    sceneJsonRoot: normalized.compatPayload ?? normalized.sourcePayload ?? options.sceneJsonRoot,
    sceneConfig: normalized.sceneConfig,
    worldInfo: normalized.worldInfo
  });
  const runtime = extractDeploymentTarget(target);
  const scene = runtime.scene;
  const resetScene = options.resetScene !== false;
  const autoCleanupEnabled = isAutoResourceCleanupEnabled(normalized, options);
  await bootstrapSceneAssetsForDeploy(normalized, resetScene);

  if (resetScene && runtime.camera) {
    cleanupThreeJsonAudioAttachments(runtime.camera);
  }

  if (resetScene) {
    clearSceneChildren(scene, { dispose: autoCleanupEnabled });
    if (autoCleanupEnabled) {
      disposeThreeJsonSceneBackdrop(scene);
    }
  } else {
    clearDeployedContentBuckets();
    clearLegacyNativeEmbedRoots(scene);
  }

  const nativeSceneState = await deployNativeSceneBase(scene, normalized);
  await applySceneStateAsync(scene, normalized, nativeSceneState, runtime.renderer);

  applyCameraConfig(runtime.camera, normalized.cameraConfig, runtime.renderer);
  applyRendererConfig(runtime.renderer, normalized.rendererConfig, normalized.sceneConfig);
  applyControlsConfig(runtime.controls, normalized.controlsConfig);

  mountSceneLights(scene, normalized.lightsConfig);
  mountSceneHelpers(scene, normalized.helpersConfig);
  const deployHints = {
    scene: runtime.scene ?? null,
    camera: runtime.camera ?? null,
    renderer: runtime.renderer ?? null,
    composer: runtime.composer ?? options.composer ?? null
  };
  await preloadSceneTextFonts(normalized.sceneConfig, normalized.objectList);
  await runCanonicalObjectDeploy(scene, normalized, options, deployHints);

  deployBoundBoxHelpersFromPayload(scene, normalized);
  deployPostProcessPassesForScene(normalized, deployHints, options);

  if (runtime.camera && normalized.cameraConfig?.attachTo) {
    attachCameraToPlayerRig(
      scene,
      runtime.camera,
      runtime.controls,
      normalized.cameraConfig
    );
  }

  return {
    ...runtime,
    normalizedPayload: normalized.payload
  };
}

/**
 * Sync deploy: skip native embed and async backdrop; deploy objectList immediately (no scheduled queue).
 * @param {*} target
 * @param {object} normalized
 * @param {object} [options]
 * @returns {object}
 */
function deployIntoTargetSimple(target, normalized, options = {}) {
  setSceneLoadCompatContext({
    three: THREE,
    sceneJsonRoot: normalized.compatPayload ?? normalized.sourcePayload ?? options.sceneJsonRoot,
    sceneConfig: normalized.sceneConfig,
    worldInfo: normalized.worldInfo
  });
  const runtime = extractDeploymentTarget(target);
  const scene = runtime.scene;
  const resetScene = options.resetScene !== false;
  const autoCleanupEnabled = isAutoResourceCleanupEnabled(normalized, options);
  const strict = options.strict === true;
  bootstrapAssetRegistryForDeploy(normalized, resetScene);

  if (resetScene && runtime.camera) {
    cleanupThreeJsonAudioAttachments(runtime.camera);
  }

  if (resetScene) {
    clearSceneChildren(scene, { dispose: autoCleanupEnabled });
    if (autoCleanupEnabled) {
      disposeThreeJsonSceneBackdrop(scene);
    }
  } else {
    clearDeployedContentBuckets();
    clearLegacyNativeEmbedRoots(scene);
  }

  if (normalized.nativeSceneEntry?.json) {
    if (strict) {
      throw new Error(
        "[createJsonSceneSimple] embedded native Three JSON present; use createJsonScene or remove nativeSceneList"
      );
    }
    log.warn("[createJsonSceneSimple] skipped nativeSceneEntry / nativeSceneList");
  }

  const sceneHints = normalized.sceneHints || {};
  const sceneCfg = sceneHints && typeof sceneHints === "object" ? sceneHints : {};
  if (sceneConfigNeedsAsyncBackdrop(sceneCfg)) {
    if (strict) {
      throw new Error(
        "[createJsonSceneSimple] scene background/environment requires async loading; use createJsonScene or a solid-color background"
      );
    }
    log.warn("[createJsonSceneSimple] skipped async background/environment");
  } else {
    applySceneBackdropSimpleFromHints(scene, sceneHints, { strict });
  }

  applyCameraConfig(runtime.camera, normalized.cameraConfig, runtime.renderer);
  applyRendererConfig(runtime.renderer, normalized.rendererConfig, normalized.sceneConfig);
  applyControlsConfig(runtime.controls, normalized.controlsConfig);

  mountSceneLights(scene, normalized.lightsConfig);
  mountSceneHelpers(scene, normalized.helpersConfig);
  const deployHints = {
    scene: runtime.scene ?? null,
    camera: runtime.camera ?? null,
    renderer: runtime.renderer ?? null,
    composer: runtime.composer ?? options.composer ?? null
  };
  void preloadSceneTextFonts(normalized.sceneConfig, normalized.objectList);
  deployCanonicalObjectList(scene, normalized, options, deployHints);

  deployBoundBoxHelpersFromPayload(scene, normalized);
  deployPostProcessPassesForScene(normalized, deployHints, options);

  if (runtime.camera && normalized.cameraConfig?.attachTo) {
    attachCameraToPlayerRig(
      scene,
      runtime.camera,
      runtime.controls,
      normalized.cameraConfig
    );
  }

  return {
    ...runtime,
    normalizedPayload: normalized.payload
  };
}

function createSceneRuntimeFromNormalized(normalized, options = {}, lifecycleBus = null) {
  const mergedRenderLoopConfig = resolveRenderLoopFpsPolicy(
    normalized.renderLoopConfig || {},
    options.renderLoopUserPolicy || {}
  );
  const sizeHint = {
    width: normalized.canvasWidth || getWindowSizeFallback().width,
    height: normalized.canvasHeight || getWindowSizeFallback().height
  };
  if (options.canvas) {
    /** @type {object|null} */
    let runtimeRef = null;
    const frameHooks =
      buildFrameHookWrappers(lifecycleBus ?? options._lifecycleBus ?? null, () => runtimeRef) ?? {
        beforeFrame: options.beforeFrame,
        beforeRender: options.beforeRender,
        afterRender: options.afterRender
      };
    runtimeRef = createSceneRuntime({
      canvas: options.canvas,
      config: {
        canvasWidth: normalized.canvasWidth,
        canvasHeight: normalized.canvasHeight,
        scene: {},
        camera: normalized.cameraConfig,
        renderer: normalized.rendererConfig,
        controls: normalized.controlsConfig,
        lights: [],
        renderLoop: mergedRenderLoopConfig
      },
      composer: options.composer,
      beforeFrame: frameHooks.beforeFrame,
      beforeRender: frameHooks.beforeRender,
      afterRender: frameHooks.afterRender
    });
    return runtimeRef;
  }
  const scene = new THREE.Scene();
  const camera = createStandaloneCamera(normalized.cameraConfig, sizeHint);
  const autoCleanupEnabled = isAutoResourceCleanupEnabled(normalized, options);
  return {
    scene,
    camera,
    renderer: null,
    controls: null,
    renderLoop: null,
    start: () => {},
    stop: () => {},
    resize: () => {},
    dispose: () => {
      if (autoCleanupEnabled) {
        disposeThreeJsonSceneBackdrop(scene);
      }
      clearSceneChildren(scene, { dispose: autoCleanupEnabled });
      scene.background = null;
      scene.environment = null;
      scene.fog = null;
    }
  };
}

function bindPluginHostToLifecycleBus(loadOptions, bus) {
  const pluginHost = loadOptions.pluginHost ?? loadOptions.context?.pluginHost ?? null;
  if (pluginHost && typeof pluginHost.bindLifecycleBus === "function") {
    pluginHost.bindLifecycleBus(bus);
  }
}

function buildFrameHookWrappers(lifecycleBus, getRuntimeRef) {
  if (!lifecycleBus) {
    return null;
  }
  let lastFrameNow = 0;
  const make = (phase) => (now) => {
    if (!lifecycleBus.has(phase)) {
      return;
    }
    const runtime = typeof getRuntimeRef === "function" ? getRuntimeRef() : getRuntimeRef;
    const deltaSeconds = lastFrameNow > 0 ? (now - lastFrameNow) / 1000 : 0;
    lastFrameNow = now;
    lifecycleBus.emitSync(
      phase,
      createFrameContext(phase, {
        now,
        deltaSeconds,
        scene: runtime?.scene ?? null,
        camera: runtime?.camera ?? null,
        renderer: runtime?.renderer ?? null,
        renderLoop: runtime?.renderLoop ?? null
      })
    );
  };
  return {
    beforeFrame: make(FRAME_PHASE.beforeFrame),
    beforeRender: make(FRAME_PHASE.beforeRender),
    afterRender: make(FRAME_PHASE.afterRender)
  };
}

function attachLifecycleBusToRuntime(runtime, bus) {
  if (!runtime || !bus) {
    return;
  }
  runtime.lifecycleBus = bus;
  const innerDispose = typeof runtime.dispose === "function" ? runtime.dispose.bind(runtime) : null;
  runtime.dispose = () => {
    bus.emitLoadSync(TEARDOWN_PHASE.beforeDispose, createSceneLifecycleContext(TEARDOWN_PHASE.beforeDispose, {
      options: bus.loadOptions ?? {},
      runtime
    }));
    innerDispose?.();
    bus.emitLoadSync(TEARDOWN_PHASE.onDisposed, createSceneLifecycleContext(TEARDOWN_PHASE.onDisposed, {
      options: bus.loadOptions ?? {},
      runtime
    }));
  };
}

async function emitTeardownBeforeCancel(bus, ctx = {}) {
  if (!bus?.has?.(TEARDOWN_PHASE.beforeCancel)) {
    return;
  }
  await bus.emit(TEARDOWN_PHASE.beforeCancel, createSceneLifecycleContext(TEARDOWN_PHASE.beforeCancel, ctx));
}

function emitSyncLoadPhase(bus, phase, ctx) {
  if (!bus?.has?.(phase)) {
    return;
  }
  bus.emitLoadSync(phase, { ...ctx, phase });
}

/**
 * Create the Scene for full JSON; when canvas is passed, also create the runtime.
 * @param {object} payload
 * @param {{
 *   canvas?: HTMLCanvasElement,
 *   composer?: *,
 *   beforeFrame?: (ctx: object) => void,
 *   beforeRender?: (ctx: object) => void,
 *   afterRender?: (ctx: object) => void,
 *   onSceneReady?: (ctx: object) => void|Promise<void>,
 *   onRuntimeReady?: (ctx: object) => void|Promise<void>,
 *   onDeployProgress?: (ctx: object) => void,
 *   lifecycle?: object,
 *   pluginHost?: object,
 *   resetScene?: boolean,
 *   context?: object,
 *   autoFillLights?: boolean,
 *   fillLightsWhenExplicitEmpty?: boolean,
 *   autoFillCamera?: boolean,
 *   autoFitCamera?: boolean,
 *   autoFitCameraMode?: 'positionAndTarget'|'targetOnly',
 *   autoFillSceneBackground?: boolean,
 *   extentInclude?: { objTypes?: string[], threeJsonIds?: string[], listNames?: string[] }
 * }} [options]
 */
function normalizeScenePayloadWithRuntimeDefaults(payload, options = {}) {
  const runtimeOptions = mergeRuntimeDefaultOptions(payload, options);
  const normalizeOpts = {};
  if (options.subSceneNormalizePolicy === "strict" || options.subSceneNormalizePolicy === "warn") {
    normalizeOpts.subSceneNormalizePolicy = options.subSceneNormalizePolicy;
  }
  const normalized = normalizeScenePayload(payload, normalizeOpts);
  applySceneRuntimeDefaults(normalized, runtimeOptions);
  normalized.runtimeLoadOptions = runtimeOptions;
  return normalized;
}

function resolveRuntimeLoadOptions(normalized, callerOptions = {}) {
  if (normalized?.runtimeLoadOptions) {
    return normalized.runtimeLoadOptions;
  }
  const payload = normalized?.sourcePayload || normalized?.compatPayload || {};
  return mergeRuntimeDefaultOptions(payload, callerOptions);
}

async function createJsonScene(payload, options = {}) {
  const css3dIntegration = integrateCss3dIntoSceneLoad(options);
  const eventIntegration = integrateEventMechanismIntoSceneLoad(css3dIntegration.loadOptions);
  const mergedLoadOptions = eventIntegration.loadOptions;
  const { bus } = resolveLifecycleHooks(mergedLoadOptions);
  css3dIntegration.wireCss3d(bus);
  eventIntegration.wireEventMechanism(bus);
  bindPluginHostToLifecycleBus(mergedLoadOptions, bus);

  const loadOptions = {
    ...mergedLoadOptions,
    _lifecycleBus: bus
  };
  loadOptions._objectLifecycle = resolveSceneLoadObjectLifecycle(mergedLoadOptions, payload);

  await emitTeardownBeforeCancel(bus, { options: loadOptions, payload });
  cancelActiveDeployScheduler();

  const baseCtx = createSceneLifecycleContext(LOAD_PHASE.beforeNormalize, {
    options: loadOptions,
    payload
  });

  try {
    await bus.emit(LOAD_PHASE.beforeNormalize, baseCtx);

    const normalized = normalizeScenePayloadWithRuntimeDefaults(payload, loadOptions);
    Object.assign(baseCtx, { normalized, payload });
    await bus.emit(LOAD_PHASE.afterNormalize, { ...baseCtx, phase: LOAD_PHASE.afterNormalize });

    warnIfUnsupportedThreeRevision({
      three: THREE,
      sceneConfig: normalized.sceneConfig,
      worldInfo: normalized.worldInfo,
      sceneJsonRoot: normalized.compatPayload
    });

    await bus.emit(LOAD_PHASE.beforeRuntime, { ...baseCtx, phase: LOAD_PHASE.beforeRuntime });

    const runtime = createSceneRuntimeFromNormalized(normalized, loadOptions, bus);
    Object.assign(baseCtx, buildRuntimeReadyFields(runtime, normalized, loadOptions), { runtime });
    loadOptions._lifecycleBaseCtx = baseCtx;

    await bus.emit(LOAD_PHASE.onRuntimeReady, { ...baseCtx, phase: LOAD_PHASE.onRuntimeReady });

    await bus.emit(LOAD_PHASE.beforeDeploy, { ...baseCtx, phase: LOAD_PHASE.beforeDeploy });

    const deployed = await deployIntoTarget(runtime, normalized, {
      ...loadOptions,
      resetScene: true
    });

    await bus.emit(LOAD_PHASE.afterDeploy, {
      ...baseCtx,
      ...buildSceneReadyFields(deployed, normalized, loadOptions),
      phase: LOAD_PHASE.afterDeploy,
      deployed,
      runtime: deployed
    });

    applyAutoFitCameraToRuntime(
      deployed.camera,
      deployed.controls,
      normalized,
      resolveRuntimeLoadOptions(normalized, loadOptions)
    );

    await bus.emit(LOAD_PHASE.afterCameraFit, {
      ...baseCtx,
      ...buildSceneReadyFields(deployed, normalized, loadOptions),
      phase: LOAD_PHASE.afterCameraFit,
      deployed,
      runtime: deployed
    });

    await runScenePostLoadIntroIfConfigured(normalized, loadOptions);

    const sceneReadyCtx = createSceneLifecycleContext(LOAD_PHASE.onSceneReady, {
      ...baseCtx,
      ...buildSceneReadyFields(deployed, normalized, loadOptions),
      deployed,
      runtime: deployed
    });
    await bus.emit(LOAD_PHASE.onSceneReady, sceneReadyCtx);

    attachLifecycleBusToRuntime(deployed, bus);
    return deployed;
  } catch (error) {
    await bus.emit(LOAD_PHASE.onError, {
      ...baseCtx,
      phase: LOAD_PHASE.onError,
      error
    });
    throw error;
  }
}

/** Preset for demo/tooling: fill lights (when key missing), camera, and post-deploy fit. */
const CREATE_JSON_SCENE_FIT_DEFAULTS = Object.freeze({
  autoFillLights: true,
  autoFillCamera: true,
  autoFitCamera: true,
  autoFitCameraMode: "positionAndTarget"
});

/**
 * Same as {@link createJsonScene} with {@link CREATE_JSON_SCENE_FIT_DEFAULTS}; caller `options` override any field.
 * @param {object} payload
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function createJsonSceneFit(payload, options = {}) {
  return createJsonScene(payload, {
    ...CREATE_JSON_SCENE_FIT_DEFAULTS,
    ...options
  });
}

function buildArchiveDeployContext(options = {}) {
  return {
    ...(options.context && typeof options.context === "object" ? options.context : {}),
    __archiveLoadState: {
      depth: 0,
      maxDepth: Number.isFinite(options.maxArchiveDepth) ? Number(options.maxArchiveDepth) : 3,
      strictRecursion: options.strictArchiveRecursion === true,
      visitedModelPaths: new Set()
    },
    __archiveDisposeList: [],
    missingAssetPolicy: options.missingAssetPolicy,
    onWarning: options.onWarning
  };
}

/**
 * Deploy a single object record onto an existing Scene / runtime (append or replace).
 * @param {*} target
 * @param {object} record
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function deployObjectRecordIntoRuntime(target, record, options = {}) {
  if (!isObjectRecordEntry(record)) {
    throw new Error("deployObjectRecordIntoRuntime: expected object record with objType");
  }
  const { deployJsonObjectAsync } = await getObjectLoadHandler();
  if (resolveArchiveObjectEntryMode(options) === "replace") {
    clearTargetForObjectArchiveEntry(target);
  }
  await deployJsonObjectAsync(target, record, {
    ...options,
    mode: "record"
  });
  const runtimeLike = extractDeploymentTarget(target);
  ensureDefaultSceneLightsInScene(
    runtimeLike.scene,
    mergeRuntimeDefaultOptions(
      options?.sceneJsonRoot && typeof options.sceneJsonRoot === "object"
        ? options.sceneJsonRoot
        : {},
      options
    )
  );
  return {
    ...runtimeLike,
    importedRecord: record
  };
}

/**
 * Empty scene shell + single object record (shared by plain JSON or .tjz object entry).
 * @param {object} record
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function createJsonSceneFromObjectRecord(record, options = {}) {
  if (!isObjectRecordEntry(record)) {
    throw new Error("createJsonSceneFromObjectRecord: expected object record with objType");
  }
  const { bus } = resolveLifecycleHooks(options);
  bindPluginHostToLifecycleBus(options, bus);
  const loadOptions = { ...options, _lifecycleBus: bus };
  loadOptions._objectLifecycle = resolveSceneLoadObjectLifecycle(options, record);
  const normalized = normalizeScenePayloadWithRuntimeDefaults(
    { worldInfo: { boxModelList: [] } },
    loadOptions
  );
  const baseCtx = createSceneLifecycleContext(LOAD_PHASE.afterNormalize, {
    options: loadOptions,
    normalized,
    payload: { worldInfo: { boxModelList: [] } }
  });
  emitSyncLoadPhase(bus, LOAD_PHASE.afterNormalize, baseCtx);
  const runtime = createSceneRuntimeFromNormalized(normalized, loadOptions, bus);
  Object.assign(baseCtx, buildRuntimeReadyFields(runtime, normalized, loadOptions), { runtime });
  if (bus.has(LOAD_PHASE.onRuntimeReady)) {
    await bus.emit(LOAD_PHASE.onRuntimeReady, { ...baseCtx, phase: LOAD_PHASE.onRuntimeReady });
  }
  const deployed = await deployObjectRecordIntoRuntime(runtime, record, loadOptions);
  const runtimeOptions = resolveRuntimeLoadOptions(normalized, loadOptions);
  ensureDefaultSceneLightsInScene(runtime.scene, runtimeOptions);
  applyAutoFitCameraToRuntime(
    runtime.camera,
    runtime.controls,
    normalized,
    runtimeOptions
  );
  const result = {
    ...runtime,
    ...deployed,
    scene: runtime.scene,
    camera: runtime.camera,
    renderer: runtime.renderer,
    controls: runtime.controls,
    renderLoop: runtime.renderLoop
  };
  if (bus.has(LOAD_PHASE.onSceneReady)) {
    await bus.emit(LOAD_PHASE.onSceneReady, createSceneLifecycleContext(LOAD_PHASE.onSceneReady, {
      ...baseCtx,
      ...buildSceneReadyFields(result, normalized, loadOptions),
      deployed: result,
      runtime: result
    }));
  }
  attachLifecycleBusToRuntime(result, bus);
  return result;
}

async function createJsonSceneFromArchive(input, options = {}) {
  const parseTjzArchiveForScene = await getParseTjzArchiveForScene();
  const parsed = await parseTjzArchiveForScene(input, {
    missingAssetPolicy: options.missingAssetPolicy,
    onWarning: options.onWarning
  });
  const archiveContext = buildArchiveDeployContext(options);
  const entry = parsed.payload;
  const entryKind = parsed.entryKind;
  if (entryKind === "object" || isObjectRecordEntry(entry)) {
    const runtime = await createJsonSceneFromObjectRecord(entry, {
      ...options,
      context: archiveContext
    });
    return wrapRuntimeWithArchiveDispose(runtime, parsed.dispose, archiveContext.__archiveDisposeList);
  }
  const payload = resolveScenePayloadForLoad(parsed.payload, {
    label: options.archiveLabel || options.label,
    threeJsonId: options.archiveThreeJsonId
  });
  const runtime = await createJsonScene(payload, {
    ...options,
    context: archiveContext
  });
  return wrapRuntimeWithArchiveDispose(runtime, parsed.dispose, archiveContext.__archiveDisposeList);
}

/**
 * Create a scene synchronously (subset): no wait for HDR/panorama backdrop or native embed; objectList deploys immediately.
 * Same args as {@link createJsonScene}; returns a runtime object (not a Promise).
 * @param {object} payload
 * @param {object} [options]
 * @returns {object}
 */
function createJsonSceneSimple(payload, options = {}) {
  const { bus } = resolveLifecycleHooks(options);
  bindPluginHostToLifecycleBus(options, bus);
  const loadOptions = { ...options, _lifecycleBus: bus };
  loadOptions._objectLifecycle = resolveSceneLoadObjectLifecycle(options, payload);
  cancelActiveDeployScheduler();
  const normalized = normalizeScenePayloadWithRuntimeDefaults(payload, loadOptions);
  warnIntroSkippedOnSyncPath(normalized?.sceneConfig?.intro, "createJsonSceneSimple");
  const baseCtx = createSceneLifecycleContext(LOAD_PHASE.afterNormalize, {
    options: loadOptions,
    normalized,
    payload
  });
  emitSyncLoadPhase(bus, LOAD_PHASE.afterNormalize, baseCtx);
  warnIfUnsupportedThreeRevision({
    three: THREE,
    sceneConfig: normalized.sceneConfig,
    worldInfo: normalized.worldInfo,
    sceneJsonRoot: normalized.compatPayload
  });
  const runtime = createSceneRuntimeFromNormalized(normalized, loadOptions, bus);
  Object.assign(baseCtx, buildRuntimeReadyFields(runtime, normalized, loadOptions), { runtime });
  emitSyncLoadPhase(bus, LOAD_PHASE.onRuntimeReady, baseCtx);
  const deployed = deployIntoTargetSimple(runtime, normalized, {
    ...loadOptions,
    resetScene: true
  });
  applyAutoFitCameraToRuntime(
    deployed.camera,
    deployed.controls,
    normalized,
    resolveRuntimeLoadOptions(normalized, loadOptions)
  );
  if (bus.has(LOAD_PHASE.onSceneReady)) {
    bus.emitLoadSync(LOAD_PHASE.onSceneReady, createSceneLifecycleContext(LOAD_PHASE.onSceneReady, {
      ...baseCtx,
      ...buildSceneReadyFields(deployed, normalized, loadOptions),
      deployed,
      runtime: deployed
    }));
  }
  attachLifecycleBusToRuntime(deployed, bus);
  return deployed;
}

/**
 * Deploy full JSON onto an existing Scene / runtime.
 * @param {THREE.Scene|{scene: THREE.Scene, camera?: THREE.Camera, renderer?: THREE.WebGLRenderer, controls?: *, renderLoop?: *}} target
 * @param {object} payload
 * @param {{ resetScene?: boolean, context?: object }} [options]
 */
async function deployJsonScene(target, payload, options = {}) {
  cancelActiveDeployScheduler();
  const normalized = normalizeScenePayloadWithRuntimeDefaults(payload, options);
  const deployed = await deployIntoTarget(target, normalized, options);
  const runtime = extractDeploymentTarget(deployed);
  applyAutoFitCameraToRuntime(
    runtime.camera,
    runtime.controls,
    normalized,
    resolveRuntimeLoadOptions(normalized, options)
  );
  await runScenePostLoadIntroIfConfigured(normalized, options);
  return deployed;
}

async function deployJsonSceneFromArchive(target, input, options = {}) {
  const parseTjzArchiveForScene = await getParseTjzArchiveForScene();
  const parsed = await parseTjzArchiveForScene(input, {
    missingAssetPolicy: options.missingAssetPolicy,
    onWarning: options.onWarning
  });
  const archiveContext = buildArchiveDeployContext(options);
  const entry = parsed.payload;
  const entryKind = parsed.entryKind;
  if (entryKind === "object" || isObjectRecordEntry(entry)) {
    const runtimeLike = await deployObjectRecordIntoRuntime(target, entry, {
      ...options,
      context: archiveContext
    });
    return wrapRuntimeWithArchiveDispose(runtimeLike, parsed.dispose, archiveContext.__archiveDisposeList);
  }
  const payload = resolveScenePayloadForLoad(parsed.payload, {
    label: options.archiveLabel || options.label,
    threeJsonId: options.archiveThreeJsonId
  });
  const runtime = await deployJsonScene(target, payload, {
    ...options,
    context: archiveContext
  });
  return wrapRuntimeWithArchiveDispose(runtime, parsed.dispose, archiveContext.__archiveDisposeList);
}

async function inspectJsonSceneArchiveEntry(input) {
  const inspectTjzArchiveEntry = await getInspectTjzArchiveEntry();
  return inspectTjzArchiveEntry(input);
}

async function createJsonSceneFromInput(input, options = {}) {
  if (typeof input === "string") {
    const text = input.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      const parsed = JSON.parse(text);
      return createJsonScene(resolveScenePayloadForLoad(parsed), options);
    }
  }
  if (input && typeof input === "object" && !ArrayBuffer.isView(input) && !(input instanceof ArrayBuffer) && !(typeof Blob !== "undefined" && input instanceof Blob)) {
    return createJsonScene(resolveScenePayloadForLoad(input), options);
  }
  return createJsonSceneFromArchive(input, options);
}

/**
 * Same as {@link createJsonSceneFromInput} with {@link CREATE_JSON_SCENE_FIT_DEFAULTS} preset.
 * @param {*} input
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function createJsonSceneFromInputFit(input, options = {}) {
  return createJsonSceneFromInput(input, {
    ...CREATE_JSON_SCENE_FIT_DEFAULTS,
    ...options
  });
}

/**
 * @param {*} target
 * @param {object} payload
 * @param {object} [options]
 * @returns {object}
 */
function deployJsonSceneSimple(target, payload, options = {}) {
  cancelActiveDeployScheduler();
  const normalized = normalizeScenePayloadWithRuntimeDefaults(payload, options);
  warnIntroSkippedOnSyncPath(normalized?.sceneConfig?.intro, "deployJsonSceneSimple");
  const deployed = deployIntoTargetSimple(target, normalized, options);
  const runtime = extractDeploymentTarget(deployed);
  applyAutoFitCameraToRuntime(
    runtime.camera,
    runtime.controls,
    normalized,
    resolveRuntimeLoadOptions(normalized, options)
  );
  return deployed;
}

export {
  CREATE_JSON_SCENE_FIT_DEFAULTS,
  createJsonScene,
  createJsonSceneFit,
  createJsonSceneFromArchive,
  createJsonSceneFromObjectRecord,
  createJsonSceneFromInput,
  createJsonSceneFromInputFit,
  createJsonSceneSimple,
  deployJsonScene,
  deployJsonSceneFromArchive,
  deployJsonSceneSimple,
  deployObjectRecordIntoRuntime,
  inspectJsonSceneArchiveEntry,
  isObjectRecordEntry
};
