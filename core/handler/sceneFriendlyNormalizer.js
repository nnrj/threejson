import { resolveLegacyDomainHandlerForBoxModel } from "./businessDomainRegistry.js";
import { log } from "../util/logger.js";
import { shouldDeferBoxCoerce } from "./nativeParseMode.js";
import { extractDefaultModelFromScenePayload } from "./defaultModelDescriptor.js";
import { coalesceBoxModelList } from "./boxModelListCoalescer.js";
import {
  applyFriendlySceneDefaults,
  getFriendlySceneListEntries,
  resolveFriendlySceneMap
} from "./sceneFriendlyMap.js";
import { ensureThreeJsonIdsOnScenePayload, hasValue, listOr } from "../util/util.js";
import { normalizeSubSceneHierarchy } from "./subSceneHierarchy.js";
import { applyLegacyGeometryObjTypeAlias } from "./legacyGeometryAlias.js";
import { normalizeLightsConfigWithMeta } from "../util/sceneRuntimeDefaults.js";
import { mergeExtensionMaps } from "../util/extensionsUtil.js";
import {
  canonicalizeHelpersForSceneConfig,
  normalizeHelpersConfig
} from "../builder/sceneHelperBuilder.js";
import { normalizeIntroConfig } from "../runtime/sceneIntroConfig.js";
import {
  JSON_ORIGIN_CONFIG,
  JSON_ORIGIN_LIST,
  buildConfigRuntimeDedupKeySet,
  ensureJsonOrigin,
  shouldDropDuplicateObjectListRuntime
} from "../util/sceneJsonOrigin.js";

const AUTO_HEAT_OBJ_TYPES = new Set(["heat", "heatmap", "heatmapvolume", "heatmap3d"]);
const CANONICAL_RUNTIME_OBJ_TYPES = new Set(["scene", "camera", "renderer", "controls", "light", "renderloop"]);
const CANONICAL_PRIMITIVE_OBJ_TYPES = new Set(["box", "sphere", "cylinder", "cone", "ring", "torus", "capsule"]);
const LEGACY_EXTERNAL_MODEL_TYPES = new Set([
  "obj",
  "gltf",
  "glb",
  "stl",
  "ply",
  "fbx",
  "usdz",
  "usd",
  "three",
  "threejson",
  "object"
]);

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch (_error) {
    return { ...payload };
  }
}

function mergeVector3Config(baseValue, overrideValue, legacyValue, defaultValue = { x: 0, y: 0, z: 0 }) {
  const base = baseValue && typeof baseValue === "object" ? baseValue : {};
  const override = overrideValue && typeof overrideValue === "object" ? overrideValue : {};
  const legacy = legacyValue && typeof legacyValue === "object" ? legacyValue : {};
  return {
    x: hasValue(override.x) ? Number(override.x) : hasValue(legacy.x) ? Number(legacy.x) : hasValue(base.x) ? Number(base.x) : defaultValue.x,
    y: hasValue(override.y) ? Number(override.y) : hasValue(legacy.y) ? Number(legacy.y) : hasValue(base.y) ? Number(base.y) : defaultValue.y,
    z: hasValue(override.z) ? Number(override.z) : hasValue(legacy.z) ? Number(legacy.z) : hasValue(base.z) ? Number(base.z) : defaultValue.z
  };
}

function normalizeCameraConfig(sceneConfig = {}) {
  const base = sceneConfig && typeof sceneConfig === "object" ? { ...sceneConfig } : {};
  const next = { ...base };
  next.position = mergeVector3Config(base.position, null, null, { x: 0, y: 0, z: 5 });
  return next;
}

function normalizeControlsConfig(sceneConfig = {}) {
  const base = sceneConfig && typeof sceneConfig === "object" ? { ...sceneConfig } : {};
  const next = { ...base };
  next.target = mergeVector3Config(base.target, null, null, { x: 0, y: 0, z: 0 });
  return next;
}

function liftWorldInfoRuntimeSugarToSceneConfig(payload = {}) {
  if (!isPlainObject(payload)) {
    return payload;
  }
  const wi = isPlainObject(payload.worldInfo) ? payload.worldInfo : null;
  if (!wi) {
    return payload;
  }

  if (!isPlainObject(payload.sceneConfig)) {
    payload.sceneConfig = {};
  }
  const sc = payload.sceneConfig;

  const scCamera = isPlainObject(sc.camera) ? sc.camera : {};
  const worldCamera = isPlainObject(wi.camera) ? wi.camera : null;
  const legacyPosition = isPlainObject(wi.cameraPosition) ? wi.cameraPosition : null;
  if (worldCamera || legacyPosition) {
    const nextCamera = {
      ...(worldCamera || {}),
      ...scCamera
    };
    nextCamera.position = mergeVector3Config(
      worldCamera?.position,
      scCamera.position,
      legacyPosition,
      { x: 0, y: 0, z: 5 }
    );
    sc.camera = nextCamera;
    delete wi.camera;
    delete wi.cameraPosition;
  }

  const scControls = isPlainObject(sc.controls) ? sc.controls : {};
  const worldOrbitControls = isPlainObject(wi.orbitControls) ? wi.orbitControls : {};
  const worldControls = isPlainObject(wi.controls) ? wi.controls : {};
  if (Object.keys(worldOrbitControls).length > 0 || Object.keys(worldControls).length > 0) {
    const controlsSugar = {
      ...worldOrbitControls,
      ...worldControls
    };
    const nextControls = {
      ...controlsSugar,
      ...scControls
    };
    nextControls.target = mergeVector3Config(
      controlsSugar.target,
      scControls.target,
      null,
      { x: 0, y: 0, z: 0 }
    );
    sc.controls = nextControls;
    delete wi.orbitControls;
    delete wi.controls;
  }

  return payload;
}

function normalizeLightsConfig(sceneConfig = {}, worldInfo = {}) {
  const meta = normalizeLightsConfigWithMeta(sceneConfig, worldInfo);
  return {
    hasExplicitLights: meta.hasExplicitLights,
    lights: meta.lights,
    lightsMeta: meta.lightsMeta
  };
}

function normalizeNativeSceneEntry(worldInfo = {}) {
  const nativeSceneList = listOr(worldInfo.nativeSceneList);
  for (let i = 0; i < nativeSceneList.length; i++) {
    const record = nativeSceneList[i];
    if (!record || typeof record !== "object" || !hasOwn(record, "jsonData")) {
      continue;
    }
    const source = record.jsonData;
    if (typeof source === "string") {
      const trimmed = source.trim();
      if (!trimmed) {
        continue;
      }
      return {
        source: record,
        json: JSON.parse(trimmed)
      };
    }
    if (source && typeof source === "object") {
      return {
        source: record,
        json: source
      };
    }
  }
  return null;
}

function hasKeys(value) {
  return Boolean(value) && typeof value === "object" && Object.keys(value).length > 0;
}

function cloneRecord(record) {
  return record && typeof record === "object" ? { ...record } : null;
}

function normalizeSceneObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizePrimitiveShapeType(value) {
  const normalized = normalizeSceneObjType(value);
  if (normalized === "boxgeometry") {
    return "box";
  }
  if (normalized === "spheregeometry") {
    return "sphere";
  }
  if (normalized === "cylindergeometry") {
    return "cylinder";
  }
  if (normalized === "conegeometry") {
    return "cone";
  }
  if (normalized === "ringgeometry") {
    return "ring";
  }
  if (normalized === "torusgeometry") {
    return "torus";
  }
  if (normalized === "capsulegeometry") {
    return "capsule";
  }
  return normalized;
}

function applyCanonicalObjType(record, canonicalObjType) {
  const next = cloneRecord(record);
  if (!next) {
    return null;
  }
  next.objType = canonicalObjType;
  return next;
}

function isRuntimeObjType(value) {
  return CANONICAL_RUNTIME_OBJ_TYPES.has(normalizeSceneObjType(value));
}

function resolveDeclaredExternalModelType(record) {
  const explicitModelFileType = normalizeSceneObjType(record?.modelFileType);
  if (explicitModelFileType && explicitModelFileType !== "externalmodel") {
    return explicitModelFileType;
  }
  const legacyFileType = normalizeSceneObjType(record?.fileType);
  if (legacyFileType && legacyFileType !== "externalmodel") {
    return legacyFileType;
  }
  const declaredObjType = normalizeSceneObjType(record?.objType);
  if (LEGACY_EXTERNAL_MODEL_TYPES.has(declaredObjType)) {
    return declaredObjType;
  }
  return "";
}

function isGroupRecord(record) {
  const objType = normalizeSceneObjType(record?.objType);
  if (objType === "group") {
    return true;
  }
  return Array.isArray(record?.subScene) && record.subScene.length > 0;
}

function isInfoPanelRecord(record) {
  const objType = normalizeSceneObjType(record?.objType);
  if (objType === "infopanel" || objType === "panel") {
    return true;
  }
  if (objType === "css3dpanel") {
    return false;
  }
  return Boolean(
    record
    && (record.panel || record.panelWidth || record.panelHeight)
    && (record.type === "text" || record.type === "html" || record.type === "img")
  );
}

function isCss3dPanelRecord(record) {
  const objType = normalizeSceneObjType(record?.objType);
  if (objType === "css3dpanel") {
    return true;
  }
  const content = record?.content;
  if (!content || typeof content !== "object") {
    return false;
  }
  const contentType = String(content.type || "").trim().toLowerCase();
  return contentType === "html" || contentType === "url";
}

function isLineRecord(record) {
  return normalizeSceneObjType(record?.objType) === "line"
    || (Array.isArray(record?.points) && record.points.length > 0);
}

function isHeatRecord(record) {
  const objType = normalizeSceneObjType(record?.objType);
  return AUTO_HEAT_OBJ_TYPES.has(objType) || Array.isArray(record?.heatMap);
}

function isWindRecord(record) {
  return normalizeSceneObjType(record?.objType) === "wind";
}

function isShaderSurfaceRecord(record) {
  return normalizeSceneObjType(record?.objType) === "shadersurface";
}

function isPlaneRecord(record) {
  return normalizeSceneObjType(record?.objType) === "plane";
}

function isPointsRecord(record) {
  const objType = normalizeSceneObjType(record?.objType);
  return objType === "points" || objType === "particles" || objType === "particle";
}

function isSpriteRecord(record) {
  return normalizeSceneObjType(record?.objType) === "sprite";
}

function isTubeRecord(record) {
  return normalizeSceneObjType(record?.objType) === "tube";
}

function isInstancedRecord(record) {
  return normalizeSceneObjType(record?.objType) === "instanced";
}

function isSkinnedRecord(record) {
  return normalizeSceneObjType(record?.objType) === "skinned";
}

function isAudioRecord(record) {
  return normalizeSceneObjType(record?.objType) === "audio";
}

function isPassRecord(record) {
  return normalizeSceneObjType(record?.objType) === "pass";
}

function isExternalModelRecord(record) {
  if (!record?.modelPath) {
    return false;
  }
  const objType = normalizeSceneObjType(record?.objType);
  if (objType === "skinned") {
    return false;
  }
  return objType === "externalmodel"
    || resolveDeclaredExternalModelType(record) !== ""
    || objType === "";
}

function resolveCanonicalPrimitiveObjType(record, fallbackObjType = "box", options = {}) {
  if (shouldDeferBoxCoerce(record, options)) {
    const raw = normalizeSceneObjType(record?.objType);
    if (raw) {
      return raw;
    }
  }
  const candidates = [
    record?.objType,
    record?.boxType,
    record?.geometry?.type,
    fallbackObjType
  ];
  for (let i = 0; i < candidates.length; i++) {
    const normalized = normalizePrimitiveShapeType(candidates[i]);
    if (CANONICAL_PRIMITIVE_OBJ_TYPES.has(normalized)) {
      return normalized;
    }
  }
  const geometry = record?.geometry && typeof record.geometry === "object" ? record.geometry : {};
  if (hasValue(geometry.innerRadius) || hasValue(geometry.outerRadius)) {
    return "ring";
  }
  if (hasValue(geometry.radiusTop) || hasValue(geometry.radiusBottom)) {
    return "cylinder";
  }
  if (hasValue(geometry.tube)) {
    return "torus";
  }
  if (hasValue(geometry.capSegments)) {
    return "capsule";
  }
  if (
    hasValue(geometry.radius)
    && !hasValue(geometry.width)
    && !hasValue(geometry.depth)
    && !hasValue(geometry.length)
    && !hasValue(geometry.height)
  ) {
    return "sphere";
  }
  return "box";
}

function normalizeInfoPanelRecord(record) {
  const next = applyCanonicalObjType(record, "infoPanel");
  if (!next) {
    return null;
  }
  next.panelBoxType = next.panelBoxType || next.boxType || "box";
  delete next.boxType;
  return next;
}

function normalizeCss3dPanelRecord(record) {
  return applyCanonicalObjType(record, "css3dPanel");
}

function normalizeExternalModelRecord(record) {
  const next = applyCanonicalObjType(record, "externalModel");
  if (!next) {
    return null;
  }
  const modelFileType = resolveDeclaredExternalModelType(next);
  if (modelFileType) {
    next.modelFileType = modelFileType;
  }
  delete next.fileType;
  return next;
}

function normalizeSkinnedModelRecord(record) {
  const next = applyCanonicalObjType(record, "skinned");
  if (!next) {
    return null;
  }
  const modelFileType = resolveDeclaredExternalModelType(next);
  if (modelFileType) {
    next.modelFileType = modelFileType;
  }
  delete next.fileType;
  return next;
}

function normalizeInstancedRecord(record) {
  const next = applyCanonicalObjType(record, "instanced");
  if (!next) {
    return null;
  }
  if (!Array.isArray(next.transforms)) {
    next.transforms = [];
  }
  next.instance = true;
  return next;
}

function normalizeDomainRecord(record, overrides = {}) {
  const next = applyCanonicalObjType(record, "domain");
  if (!next) {
    return null;
  }
  if (overrides.domain && !next.domain) {
    next.domain = overrides.domain;
  }
  if (overrides.handler && !next.handler) {
    next.handler = overrides.handler;
  }
  return next;
}

function normalizeCanonicalObjectRecord(record, options = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }
  record = applyLegacyGeometryObjTypeAlias(record) ?? record;
  if (normalizeSceneObjType(record.objType) === "default") {
    return null;
  }
  if (normalizeSceneObjType(record.objType) === "native") {
    return applyCanonicalObjType(record, "native");
  }
  if (options.forceObjType === "domain" || record.domain || normalizeSceneObjType(record.objType) === "domain") {
    return normalizeDomainRecord(record, options);
  }
  if (options.forceObjType === "group" || isGroupRecord(record)) {
    return applyCanonicalObjType(record, "group");
  }
  if (options.forceObjType === "infoPanel" || isInfoPanelRecord(record)) {
    return normalizeInfoPanelRecord(record);
  }
  if (options.forceObjType === "css3dPanel" || isCss3dPanelRecord(record)) {
    return normalizeCss3dPanelRecord(record);
  }
  if (options.forceObjType === "line" || isLineRecord(record)) {
    return applyCanonicalObjType(record, "line");
  }
  if (options.forceObjType === "heatMap" || isHeatRecord(record)) {
    return applyCanonicalObjType(record, "heatMap");
  }
  if (options.forceObjType === "wind" || isWindRecord(record)) {
    return applyCanonicalObjType(record, "wind");
  }
  if (options.forceObjType === "shaderSurface" || isShaderSurfaceRecord(record)) {
    return applyCanonicalObjType(record, "shaderSurface");
  }
  if (options.forceObjType === "plane" || isPlaneRecord(record)) {
    return applyCanonicalObjType(record, "plane");
  }
  if (options.forceObjType === "points" || isPointsRecord(record)) {
    return applyCanonicalObjType(record, "points");
  }
  if (options.forceObjType === "sprite" || isSpriteRecord(record)) {
    return applyCanonicalObjType(record, "sprite");
  }
  if (options.forceObjType === "tube" || isTubeRecord(record)) {
    return applyCanonicalObjType(record, "tube");
  }
  if (options.forceObjType === "instanced" || isInstancedRecord(record)) {
    return normalizeInstancedRecord(record);
  }
  if (options.forceObjType === "skinned" || isSkinnedRecord(record)) {
    return normalizeSkinnedModelRecord(record);
  }
  if (options.forceObjType === "audio" || isAudioRecord(record)) {
    return applyCanonicalObjType(record, "audio");
  }
  if (options.forceObjType === "pass" || isPassRecord(record)) {
    return applyCanonicalObjType(record, "pass");
  }
  if (options.forceObjType === "externalModel" || isExternalModelRecord(record)) {
    return normalizeExternalModelRecord(record);
  }
  const shapeType = normalizeSceneObjType(options.forceObjType || record.objType);
  if (shapeType === "shapeplane") {
    return applyCanonicalObjType(record, "shapePlane");
  }
  if (shapeType === "buffermesh") {
    return applyCanonicalObjType(record, "bufferMesh");
  }
  if (shapeType === "irregularplane") {
    return applyCanonicalObjType(record, "irregularPlane");
  }
  if (shapeType === "shapeextrude") {
    return applyCanonicalObjType(record, "shapeExtrude");
  }
  if (shapeType === "irregulargeometry") {
    return applyCanonicalObjType(record, "irregularGeometry");
  }
  if (isRuntimeObjType(options.forceObjType) || isRuntimeObjType(record.objType)) {
    return applyCanonicalObjType(record, options.forceObjType || record.objType);
  }
  const legacyDomain = resolveLegacyDomainHandlerForBoxModel(record);
  if (legacyDomain) {
    return normalizeDomainRecord(record, legacyDomain);
  }
  return applyCanonicalObjType(
    record,
    resolveCanonicalPrimitiveObjType(record, options.forceObjType, options)
  );
}

function appendCanonicalRecords(targetList, sourceList, options = {}) {
  const list = listOr(sourceList);
  for (let i = 0; i < list.length; i++) {
    const normalized = normalizeCanonicalObjectRecord(list[i], options);
    if (normalized) {
      targetList.push(normalized);
    }
  }
}

function buildCanonicalRuntimeObjectListFromFriendly(payload, sceneConfig, worldInfo) {
  const runtimeObjects = [];
  const sceneHints = sceneConfig?.scene && typeof sceneConfig.scene === "object" ? sceneConfig.scene : {};
  if (hasKeys(sceneHints)) {
    runtimeObjects.push({
      objType: "scene",
      ...sceneHints
    });
  }
  const hasCameraConfig = hasOwn(sceneConfig, "camera");
  if (hasCameraConfig) {
    runtimeObjects.push({
      objType: "camera",
      ...normalizeCameraConfig(sceneConfig.camera)
    });
  }
  if (sceneConfig?.renderer && typeof sceneConfig.renderer === "object") {
    runtimeObjects.push({
      objType: "renderer",
      ...sceneConfig.renderer
    });
  }
  const hasControlsConfig = hasOwn(sceneConfig, "controls");
  if (hasControlsConfig) {
    runtimeObjects.push({
      objType: "controls",
      ...normalizeControlsConfig(sceneConfig.controls)
    });
  }
  const lightConfig = normalizeLightsConfig(sceneConfig, worldInfo);
  for (let i = 0; i < lightConfig.lights.length; i++) {
    runtimeObjects.push({
      objType: "light",
      ...lightConfig.lights[i]
    });
  }
  if (sceneConfig?.renderLoop && typeof sceneConfig.renderLoop === "object") {
    runtimeObjects.push({
      objType: "renderLoop",
      ...sceneConfig.renderLoop
    });
  }
  return runtimeObjects;
}

function resolveCanvasMeta(payload, sceneConfig) {
  return {
    canvasWidth: isFiniteNumber(Number(payload?.canvasWidth)) ? Number(payload.canvasWidth) : sceneConfig?.canvasWidth,
    canvasHeight: isFiniteNumber(Number(payload?.canvasHeight)) ? Number(payload.canvasHeight) : sceneConfig?.canvasHeight
  };
}

function readFriendlyListSource(payload, worldInfo, definition) {
  if (!definition || !definition.listName) {
    return [];
  }
  if (definition.scope === "topLevel") {
    return listOr(payload?.[definition.listName]);
  }
  if (definition.scope === "topLevelOrWorldInfo") {
    const topLevelList = listOr(payload?.[definition.listName]);
    if (topLevelList.length > 0) {
      return topLevelList;
    }
    return listOr(worldInfo?.[definition.listName]);
  }
  if (definition.scope === "worldInfoOrSceneConfig") {
    const fromWorld = listOr(worldInfo?.[definition.listName]);
    if (fromWorld.length > 0) {
      return fromWorld;
    }
    const sceneConfig =
      payload?.sceneConfig && typeof payload.sceneConfig === "object" ? payload.sceneConfig : {};
    return listOr(sceneConfig[definition.listName]);
  }
  return listOr(worldInfo?.[definition.listName]);
}

function isMeshListAllowedRecord(record) {
  const objType = normalizeSceneObjType(record?.objType);
  return objType === "box" || objType === "sphere";
}

function appendFriendlyConfiguredList(targetList, payload, worldInfo, definition, sceneConfig = {}) {
  let sourceList = readFriendlyListSource(payload, worldInfo, definition);
  if (sourceList.length <= 0) {
    return;
  }
  if (definition.preprocess === "coalesceBoxModelList") {
    sourceList = coalesceBoxModelList(sourceList);
  }
  for (let i = 0; i < sourceList.length; i++) {
    const entry = sourceList[i];
    if (definition.listName === "meshList" && !isMeshListAllowedRecord(entry)) {
      log.warn(
        "[meshList] skipping entry: objType must be box or sphere:",
        entry?.objType,
        entry?.name || ""
      );
      continue;
    }
    const mergedRecord = applyFriendlySceneDefaults(entry, definition);
    const normalized = normalizeCanonicalObjectRecord(mergedRecord, {
      forceObjType: definition.objType,
      sceneConfig
    });
    if (normalized) {
      targetList.push(normalized);
    }
  }
}

function buildCanonicalScenePayloadFromFriendly(sourcePayload) {
  const worldInfo = sourcePayload.worldInfo && typeof sourcePayload.worldInfo === "object"
    ? sourcePayload.worldInfo
    : {};
  const sceneConfig = sourcePayload.sceneConfig && typeof sourcePayload.sceneConfig === "object"
    ? sourcePayload.sceneConfig
    : {};
  const objectList = buildCanonicalRuntimeObjectListFromFriendly(sourcePayload, sceneConfig, worldInfo);
  const friendlyListEntries = getFriendlySceneListEntries(sourcePayload);
  for (let i = 0; i < friendlyListEntries.length; i++) {
    appendFriendlyConfiguredList(objectList, sourcePayload, worldInfo, friendlyListEntries[i], sceneConfig);
  }
  const canvasMeta = resolveCanvasMeta(sourcePayload, sceneConfig);
  const canonicalPayload = {
    version: typeof sourcePayload.version === "string" && sourcePayload.version ? sourcePayload.version : "next",
    objectList
  };
  if (typeof sourcePayload.name === "string" && sourcePayload.name) {
    canonicalPayload.name = sourcePayload.name;
  } else if (typeof worldInfo.name === "string" && worldInfo.name) {
    canonicalPayload.name = worldInfo.name;
  }
  copySceneDocumentMetadata(sourcePayload, canonicalPayload, canvasMeta);
  return canonicalPayload;
}

function copySceneDocumentMetadata(sourcePayload, targetPayload, canvasMeta = {}) {
  if (typeof sourcePayload.threeJsonId === "string" && sourcePayload.threeJsonId) {
    targetPayload.threeJsonId = sourcePayload.threeJsonId;
  }
  if (isFiniteNumber(canvasMeta.canvasWidth)) {
    targetPayload.canvasWidth = Number(canvasMeta.canvasWidth);
  }
  if (isFiniteNumber(canvasMeta.canvasHeight)) {
    targetPayload.canvasHeight = Number(canvasMeta.canvasHeight);
  } else if (isFiniteNumber(Number(sourcePayload.canvasWidth))) {
    targetPayload.canvasWidth = Number(sourcePayload.canvasWidth);
  }
  if (!isFiniteNumber(targetPayload.canvasHeight) && isFiniteNumber(Number(sourcePayload.canvasHeight))) {
    targetPayload.canvasHeight = Number(sourcePayload.canvasHeight);
  }
}

function appendCanonicalObjectListWithDualChannel(targetList, sourceList, options = {}) {
  const sceneConfig = options.sceneConfig && typeof options.sceneConfig === "object"
    ? options.sceneConfig
    : {};
  const configRuntimeRecords = buildCanonicalRuntimeObjectListFromFriendly(
    options.sourcePayload || {},
    sceneConfig,
    {}
  ).map((record) => ensureJsonOrigin(record, JSON_ORIGIN_CONFIG));
  const configDedupKeys = buildConfigRuntimeDedupKeySet(configRuntimeRecords);

  const contentRecords = [];
  const listRuntimeRecords = [];
  const records = listOr(sourceList);
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const objType = normalizeSceneObjType(record?.objType);
    const normalized = normalizeCanonicalObjectRecord(record, { sceneConfig });
    if (!normalized) {
      continue;
    }
    if (CANONICAL_RUNTIME_OBJ_TYPES.has(objType)) {
      if (shouldDropDuplicateObjectListRuntime(normalized, configDedupKeys)) {
        continue;
      }
      listRuntimeRecords.push(ensureJsonOrigin(normalized, JSON_ORIGIN_LIST));
      continue;
    }
    contentRecords.push(normalized);
  }

  for (let i = 0; i < contentRecords.length; i++) {
    targetList.push(contentRecords[i]);
  }
  for (let i = 0; i < listRuntimeRecords.length; i++) {
    targetList.push(listRuntimeRecords[i]);
  }
  for (let i = 0; i < configRuntimeRecords.length; i++) {
    targetList.push(configRuntimeRecords[i]);
  }
}

function buildCanonicalScenePayloadFromCanonical(sourcePayload) {
  const objectList = [];
  const sceneConfig =
    sourcePayload.sceneConfig && typeof sourcePayload.sceneConfig === "object"
      ? sourcePayload.sceneConfig
      : {};
  appendCanonicalObjectListWithDualChannel(objectList, sourcePayload.objectList, {
    sceneConfig,
    sourcePayload
  });
  const canonicalPayload = {
    version: typeof sourcePayload.version === "string" && sourcePayload.version ? sourcePayload.version : "next",
    objectList
  };
  if (typeof sourcePayload.name === "string" && sourcePayload.name) {
    canonicalPayload.name = sourcePayload.name;
  }
  copySceneDocumentMetadata(sourcePayload, canonicalPayload);
  return canonicalPayload;
}

function splitCanonicalObjectList(objectList) {
  const runtime = {
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    renderLoop: null,
    lights: []
  };
  const contentList = [];
  const records = listOr(objectList);
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const objType = normalizeSceneObjType(record?.objType);
    if (objType === "scene") {
      runtime.scene = record;
      continue;
    }
    if (objType === "camera") {
      runtime.camera = record;
      continue;
    }
    if (objType === "renderer") {
      runtime.renderer = record;
      continue;
    }
    if (objType === "controls") {
      runtime.controls = record;
      continue;
    }
    if (objType === "renderloop") {
      runtime.renderLoop = record;
      continue;
    }
    if (objType === "light") {
      runtime.lights.push(record);
      continue;
    }
    if (objType === "pass") {
      continue;
    }
    if (objType === "boxhelper") {
      continue;
    }
    contentList.push(record);
  }
  return {
    runtime,
    contentList
  };
}

function stripObjType(record) {
  if (!record || typeof record !== "object") {
    return {};
  }
  const { objType, ...rest } = record;
  return rest;
}

function shouldMirrorIntoCompatBoxModelList(record) {
  const objType = normalizeSceneObjType(record?.objType);
  if (objType === "domain") {
    return Boolean(record?.geometry || record?.boxModelList || record?.businessInfo);
  }
  return CANONICAL_PRIMITIVE_OBJ_TYPES.has(objType);
}

function shouldMirrorIntoCompatObjModelList(record) {
  const declaredType = resolveDeclaredExternalModelType(record);
  if (declaredType === "obj") {
    return true;
  }
  if (declaredType) {
    return false;
  }
  return typeof record?.modelPath === "string" && /\.obj(?:[?#].*)?$/i.test(record.modelPath);
}

function buildCompatPayloadFromCanonical(sourcePayload, canonicalPayload, splitState) {
  const nonRuntimeObjects = splitState.contentList;
  const worldInfoSource = sourcePayload.worldInfo && typeof sourcePayload.worldInfo === "object"
    ? sourcePayload.worldInfo
    : {};
  const worldInfo = {
    ...worldInfoSource,
    modelList: nonRuntimeObjects,
    objectList: nonRuntimeObjects,
    boxModelList: [],
    sphereModelList: [],
    meshList: [],
    groupList: [],
    lineList: [],
    infoPanelList: [],
    css3dPanelList: [],
    heatList: [],
    windList: [],
    shaderSurfaceList: [],
    planeList: [],
    particleList: [],
    spriteList: [],
    tubeList: [],
    instancedList: [],
    audioList: [],
    skinnedList: [],
    externalModelList: [],
    objModelList: [],
    domainModelList: [],
    shapePlaneList: [],
    irregularPlaneList: [],
    bufferMeshList: [],
    shapeExtrudeList: [],
    irregularGeometryList: []
  };

  for (let i = 0; i < nonRuntimeObjects.length; i++) {
    const record = nonRuntimeObjects[i];
    const objType = normalizeSceneObjType(record?.objType);
    if (objType === "sphere") {
      worldInfo.sphereModelList.push(record);
    } else if (objType === "box") {
      worldInfo.meshList.push(record);
    } else if (shouldMirrorIntoCompatBoxModelList(record)) {
      worldInfo.boxModelList.push(record);
    } else if (objType === "group") {
      worldInfo.groupList.push(record);
    } else if (objType === "line") {
      worldInfo.lineList.push(record);
    } else if (objType === "infopanel") {
      worldInfo.infoPanelList.push(record);
    } else if (objType === "css3dpanel") {
      worldInfo.css3dPanelList.push(record);
    } else if (objType === "heatmap") {
      worldInfo.heatList.push(record);
    } else if (objType === "wind") {
      worldInfo.windList.push(record);
    } else if (objType === "shadersurface") {
      worldInfo.shaderSurfaceList.push(record);
    } else if (objType === "plane") {
      worldInfo.planeList.push(record);
    } else if (objType === "points") {
      worldInfo.particleList.push(record);
    } else if (objType === "sprite") {
      worldInfo.spriteList.push(record);
    } else if (objType === "tube") {
      worldInfo.tubeList.push(record);
    } else if (objType === "instanced") {
      worldInfo.instancedList.push(record);
    } else if (objType === "audio") {
      worldInfo.audioList.push(record);
    } else if (objType === "skinned") {
      worldInfo.skinnedList.push(record);
    } else if (objType === "externalmodel") {
      worldInfo.externalModelList.push(record);
      if (shouldMirrorIntoCompatObjModelList(record)) {
        worldInfo.objModelList.push(record);
      }
    } else if (objType === "domain") {
      worldInfo.domainModelList.push(record);
    } else if (objType === "shapeplane") {
      if (!Array.isArray(worldInfo.shapePlaneList)) {
        worldInfo.shapePlaneList = [];
      }
      worldInfo.shapePlaneList.push(record);
    } else if (objType === "irregularplane") {
      if (!Array.isArray(worldInfo.irregularPlaneList)) {
        worldInfo.irregularPlaneList = [];
      }
      worldInfo.irregularPlaneList.push(record);
    } else if (objType === "buffermesh") {
      if (!Array.isArray(worldInfo.bufferMeshList)) {
        worldInfo.bufferMeshList = [];
      }
      worldInfo.bufferMeshList.push(record);
    } else if (objType === "shapeextrude") {
      if (!Array.isArray(worldInfo.shapeExtrudeList)) {
        worldInfo.shapeExtrudeList = [];
      }
      worldInfo.shapeExtrudeList.push(record);
    } else if (objType === "irregulargeometry") {
      if (!Array.isArray(worldInfo.irregularGeometryList)) {
        worldInfo.irregularGeometryList = [];
      }
      worldInfo.irregularGeometryList.push(record);
    }
  }

  const sceneConfig = {};
  if (isFiniteNumber(canonicalPayload.canvasWidth)) {
    sceneConfig.canvasWidth = Number(canonicalPayload.canvasWidth);
  }
  if (isFiniteNumber(canonicalPayload.canvasHeight)) {
    sceneConfig.canvasHeight = Number(canonicalPayload.canvasHeight);
  }
  if (splitState.runtime.scene) {
    sceneConfig.scene = stripObjType(splitState.runtime.scene);
  }
  if (splitState.runtime.camera) {
    sceneConfig.camera = stripObjType(splitState.runtime.camera);
  }
  if (splitState.runtime.renderer) {
    sceneConfig.renderer = stripObjType(splitState.runtime.renderer);
  }
  if (splitState.runtime.controls) {
    sceneConfig.controls = stripObjType(splitState.runtime.controls);
  }
  if (splitState.runtime.lights.length > 0) {
    sceneConfig.lights = splitState.runtime.lights.map(stripObjType);
  }
  if (splitState.runtime.renderLoop) {
    sceneConfig.renderLoop = stripObjType(splitState.runtime.renderLoop);
  }
  const helpersConfig = normalizeHelpersConfig(sourcePayload.sceneConfig, worldInfoSource);
  const canonicalHelpers = canonicalizeHelpersForSceneConfig(helpersConfig);
  if (canonicalHelpers) {
    sceneConfig.helpers = canonicalHelpers;
  }
  const introConfig = normalizeIntroConfig(sourcePayload.sceneConfig?.intro);
  if (introConfig) {
    sceneConfig.intro = introConfig;
  }

  const mergedExtensions = mergeExtensionMaps(
    isPlainObject(sourcePayload.extensions) ? sourcePayload.extensions : null
  );
  if (Object.keys(mergedExtensions).length > 0) {
    sceneConfig.extensions = mergedExtensions;
  }

  const compatPayload = {
    version: canonicalPayload.version,
    name: canonicalPayload.name,
    sceneConfig,
    worldInfo
  };
  if (typeof sourcePayload.threeJsonId === "string" && sourcePayload.threeJsonId) {
    compatPayload.threeJsonId = sourcePayload.threeJsonId;
  } else if (typeof canonicalPayload.threeJsonId === "string" && canonicalPayload.threeJsonId) {
    compatPayload.threeJsonId = canonicalPayload.threeJsonId;
  }
  if (isPlainObject(sourcePayload.friendlyMap)) {
    compatPayload.friendlyMap = sourcePayload.friendlyMap;
  }
  if (isFiniteNumber(canonicalPayload.canvasWidth)) {
    compatPayload.canvasWidth = Number(canonicalPayload.canvasWidth);
  }
  if (isFiniteNumber(canonicalPayload.canvasHeight)) {
    compatPayload.canvasHeight = Number(canonicalPayload.canvasHeight);
  }
  return compatPayload;
}

function clonePlainValue(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    if (Array.isArray(value)) {
      return value.slice();
    }
    return { ...value };
  }
}

function stripFriendlyDefaults(value, defaults) {
  if (defaults === undefined) {
    return clonePlainValue(value);
  }
  if (isPlainObject(value) && isPlainObject(defaults)) {
    const next = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const pruned = stripFriendlyDefaults(value[key], defaults[key]);
      if (pruned !== undefined) {
        next[key] = pruned;
      }
    }
    return Object.keys(next).length > 0 ? next : undefined;
  }
  if (Array.isArray(value) || Array.isArray(defaults)) {
    return clonePlainValue(value);
  }
  return Object.is(value, defaults) ? undefined : clonePlainValue(value);
}

function matchesFriendlyDefaults(recordValue, defaults) {
  if (defaults === undefined) {
    return true;
  }
  if (isPlainObject(defaults)) {
    if (!isPlainObject(recordValue)) {
      return false;
    }
    const keys = Object.keys(defaults);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!matchesFriendlyDefaults(recordValue[key], defaults[key])) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(defaults)) {
    return JSON.stringify(recordValue) === JSON.stringify(defaults);
  }
  return Object.is(recordValue, defaults);
}

function matchesFriendlyListDefinition(record, definition) {
  if (!definition || typeof definition !== "object") {
    return false;
  }
  if (definition.objType && normalizeSceneObjType(record?.objType) !== normalizeSceneObjType(definition.objType)) {
    return false;
  }
  if (isPlainObject(definition.defaults) && Object.keys(definition.defaults).length > 0) {
    return matchesFriendlyDefaults(record, definition.defaults);
  }
  return Boolean(definition.objType);
}

function pruneFriendlyExportRecord(record, definition = {}) {
  const next = clonePlainValue(record);
  if (!next || typeof next !== "object") {
    return next;
  }
  if (definition.objType && definition.allowObjTypeOmit
    && normalizeSceneObjType(next.objType) === normalizeSceneObjType(definition.objType)) {
    delete next.objType;
  }
  if (isPlainObject(definition.defaults) && Object.keys(definition.defaults).length > 0) {
    const pruned = stripFriendlyDefaults(next, definition.defaults);
    return pruned && typeof pruned === "object" ? pruned : next;
  }
  return next;
}

function resolveFriendlyFallbackListName(record) {
  const objType = normalizeSceneObjType(record?.objType);
  if (objType === "sphere") {
    return "sphereModelList";
  }
  if (objType === "group") {
    return "groupList";
  }
  if (objType === "line") {
    return "lineList";
  }
  if (objType === "infopanel") {
    return "infoPanelList";
  }
  if (objType === "css3dpanel") {
    return "css3dPanelList";
  }
  if (objType === "heatmap") {
    return "heatList";
  }
  if (objType === "wind") {
    return "windList";
  }
  if (objType === "shadersurface") {
    return "shaderSurfaceList";
  }
  if (objType === "plane") {
    return "planeList";
  }
  if (objType === "points") {
    return "particleList";
  }
  if (objType === "sprite") {
    return "spriteList";
  }
  if (objType === "tube") {
    return "tubeList";
  }
  if (objType === "instanced") {
    return "instancedList";
  }
  if (objType === "skinned") {
    return "skinnedList";
  }
  if (objType === "externalmodel") {
    return shouldMirrorIntoCompatObjModelList(record) ? "objModelList" : "externalModelList";
  }
  if (objType === "domain") {
    return "domainModelList";
  }
  if (objType === "shapeplane") {
    return "shapePlaneList";
  }
  if (objType === "irregularplane") {
    return "irregularPlaneList";
  }
  if (objType === "buffermesh") {
    return "bufferMeshList";
  }
  if (objType === "shapeextrude") {
    return "shapeExtrudeList";
  }
  if (objType === "irregulargeometry") {
    return "irregularGeometryList";
  }
  if (objType === "box") {
    return "meshList";
  }
  if (CANONICAL_PRIMITIVE_OBJ_TYPES.has(objType)) {
    return "boxModelList";
  }
  return "modelList";
}

function createFriendlyWorldInfoBase(sourceWorldInfo = {}) {
  const next = {};
  for (const key of Object.keys(sourceWorldInfo)) {
    if (key === "friendlyMap") {
      continue;
    }
    if (Array.isArray(sourceWorldInfo[key]) && /List$/u.test(key)) {
      continue;
    }
    next[key] = clonePlainValue(sourceWorldInfo[key]);
  }
  return next;
}

function buildFriendlyScenePayloadFromCanonical(sourcePayload = {}, canonicalPayload = {}, options = {}) {
  const splitState = splitCanonicalObjectList(canonicalPayload.objectList);
  const sourceWorldInfo = sourcePayload.worldInfo && typeof sourcePayload.worldInfo === "object"
    ? sourcePayload.worldInfo
    : {};
  const customFriendlyMap = isPlainObject(options.friendlyMap) ? clonePlainValue(options.friendlyMap) : {};
  const resolvedFriendlyMap = resolveFriendlySceneMap({ friendlyMap: customFriendlyMap });
  const customListNames = Object.keys(customFriendlyMap);
  const worldInfo = createFriendlyWorldInfoBase(sourceWorldInfo);

  for (let i = 0; i < splitState.contentList.length; i++) {
    const record = splitState.contentList[i];
    let targetListName = "";
    for (let j = 0; j < customListNames.length; j++) {
      const listName = customListNames[j];
      const definition = resolvedFriendlyMap[listName];
      if (matchesFriendlyListDefinition(record, definition)) {
        targetListName = listName;
        break;
      }
    }
    if (!targetListName) {
      targetListName = resolveFriendlyFallbackListName(record);
    }
    const definition = resolvedFriendlyMap[targetListName] || {};
    if (!Array.isArray(worldInfo[targetListName])) {
      worldInfo[targetListName] = [];
    }
    worldInfo[targetListName].push(pruneFriendlyExportRecord(record, definition));
  }

  const sceneConfig = {};
  if (isFiniteNumber(canonicalPayload.canvasWidth)) {
    sceneConfig.canvasWidth = Number(canonicalPayload.canvasWidth);
  }
  if (isFiniteNumber(canonicalPayload.canvasHeight)) {
    sceneConfig.canvasHeight = Number(canonicalPayload.canvasHeight);
  }
  if (splitState.runtime.scene) {
    sceneConfig.scene = stripObjType(splitState.runtime.scene);
  }
  if (splitState.runtime.camera) {
    sceneConfig.camera = stripObjType(splitState.runtime.camera);
  }
  if (splitState.runtime.renderer) {
    sceneConfig.renderer = stripObjType(splitState.runtime.renderer);
  }
  if (splitState.runtime.controls) {
    sceneConfig.controls = stripObjType(splitState.runtime.controls);
  }
  if (splitState.runtime.lights.length > 0) {
    sceneConfig.lights = splitState.runtime.lights.map(stripObjType);
  }
  if (splitState.runtime.renderLoop) {
    sceneConfig.renderLoop = stripObjType(splitState.runtime.renderLoop);
  }
  const helpersFromSource = normalizeHelpersConfig(sourcePayload?.sceneConfig, sourcePayload?.worldInfo);
  const canonicalHelpers = canonicalizeHelpersForSceneConfig(helpersFromSource);
  if (canonicalHelpers) {
    sceneConfig.helpers = canonicalHelpers;
  }
  const introFromSource = normalizeIntroConfig(sourcePayload?.sceneConfig?.intro);
  if (introFromSource) {
    sceneConfig.intro = introFromSource;
  }

  const mergedExtensions = mergeExtensionMaps(
    isPlainObject(worldInfo.extensions) ? worldInfo.extensions : null,
    isPlainObject(sceneConfig.extensions) ? sceneConfig.extensions : null
  );
  if (Object.keys(mergedExtensions).length > 0) {
    sceneConfig.extensions = mergedExtensions;
  }

  const friendlyPayload = {
    version: canonicalPayload.version || sourcePayload.version || "next",
    sceneConfig,
    worldInfo
  };
  if (typeof canonicalPayload.name === "string" && canonicalPayload.name) {
    friendlyPayload.name = canonicalPayload.name;
  }
  if (typeof sourcePayload.threeJsonId === "string" && sourcePayload.threeJsonId) {
    friendlyPayload.threeJsonId = sourcePayload.threeJsonId;
  } else if (typeof canonicalPayload.threeJsonId === "string" && canonicalPayload.threeJsonId) {
    friendlyPayload.threeJsonId = canonicalPayload.threeJsonId;
  }
  if (customListNames.length > 0) {
    friendlyPayload.friendlyMap = customFriendlyMap;
  }
  return friendlyPayload;
}

function applySubSceneNormalizationToCanonical(sourcePayload, canonicalPayload, options = {}) {
  const subSceneList = Array.isArray(sourcePayload?.subSceneList) ? sourcePayload.subSceneList : [];
  const policy = options.subSceneNormalizePolicy === "strict" ? "strict" : "warn";
  const sceneDocId = typeof canonicalPayload?.threeJsonId === "string"
    ? canonicalPayload.threeJsonId.trim()
    : typeof sourcePayload?.threeJsonId === "string"
      ? sourcePayload.threeJsonId.trim()
      : "";
  const { payload: normalizedCanonical } = normalizeSubSceneHierarchy(canonicalPayload, {
    policy,
    sceneDocId,
    subSceneList
  });
  return normalizedCanonical;
}

function buildNormalizedScenePayload(sourcePayload, canonicalPayload, defaultModelTemplate = null, options = {}) {
  ensureThreeJsonIdsOnScenePayload(canonicalPayload);
  const canonicalWithSubScene = applySubSceneNormalizationToCanonical(sourcePayload, canonicalPayload, options);
  const splitState = splitCanonicalObjectList(canonicalWithSubScene.objectList);
  const compatPayload = buildCompatPayloadFromCanonical(sourcePayload, canonicalWithSubScene, splitState);
  ensureThreeJsonIdsOnScenePayload(compatPayload);
  const helpersConfig = normalizeHelpersConfig(compatPayload.sceneConfig, compatPayload.worldInfo);
  const lightConfig =
    splitState.runtime.lights.length > 0
      ? {
        lights: splitState.runtime.lights.map(stripObjType),
        hasExplicitLights: true,
        lightsMeta: {
          lightsKeyPresent: true,
          explicitEmpty: false,
          explicitLights: splitState.runtime.lights.map(stripObjType),
          hasExplicitNonEmpty: true
        }
      }
      : normalizeLightsConfig(compatPayload.sceneConfig, compatPayload.worldInfo);
  return {
    sourcePayload,
    payload: canonicalWithSubScene,
    compatPayload,
    defaultModelTemplate,
    friendlyMap: resolveFriendlySceneMap(sourcePayload),
    worldInfo: compatPayload.worldInfo,
    sceneConfig: compatPayload.sceneConfig,
    sceneHints: stripObjType(splitState.runtime.scene),
    cameraConfig: stripObjType(splitState.runtime.camera),
    controlsConfig: stripObjType(splitState.runtime.controls),
    rendererConfig: stripObjType(splitState.runtime.renderer),
    renderLoopConfig: stripObjType(splitState.runtime.renderLoop),
    lightsConfig: lightConfig.lights,
    hasExplicitLights: lightConfig.hasExplicitLights,
    lightsMeta: lightConfig.lightsMeta,
    helpersConfig,
    objectList: canonicalWithSubScene.objectList,
    nativeSceneEntry: normalizeNativeSceneEntry(sourcePayload.worldInfo || compatPayload.worldInfo),
    canvasWidth: compatPayload.canvasWidth ?? compatPayload.sceneConfig.canvasWidth,
    canvasHeight: compatPayload.canvasHeight ?? compatPayload.sceneConfig.canvasHeight
  };
}

function isCanonicalScenePayload(payload = {}) {
  return Array.isArray(payload?.objectList)
    && !hasOwn(payload, "sceneConfig")
    && !hasOwn(payload, "worldInfo")
    && !hasOwn(payload, "friendlyMap")
    && !hasOwn(payload, "modelList");
}

function hasSceneConfigPrimaryRuntime(payload = {}) {
  const sceneConfig = payload.sceneConfig;
  if (!sceneConfig || typeof sceneConfig !== "object") {
    return false;
  }
  if (hasOwn(sceneConfig, "camera") || hasOwn(sceneConfig, "controls") || hasOwn(sceneConfig, "renderer")) {
    return true;
  }
  if (hasOwn(sceneConfig, "scene") || hasOwn(sceneConfig, "renderLoop")) {
    return true;
  }
  return Array.isArray(sceneConfig.lights) && sceneConfig.lights.length > 0;
}

function isLoadableScenePayload(payload = {}) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  if (payload.worldInfo && typeof payload.worldInfo === "object") {
    return true;
  }
  if (Array.isArray(payload.objectList) && payload.objectList.length > 0) {
    return true;
  }
  return hasSceneConfigPrimaryRuntime(payload);
}

function normalizeCanonicalScenePayload(payload = {}, options = {}) {
  const sourcePayload = cloneJsonPayload(payload);
  ensureThreeJsonIdsOnScenePayload(sourcePayload);
  const extracted = extractDefaultModelFromScenePayload(sourcePayload);
  const canonicalPayload = buildCanonicalScenePayloadFromCanonical(extracted.payload);
  return buildNormalizedScenePayload(sourcePayload, canonicalPayload, extracted.template, options);
}

function normalizeFriendlyScenePayload(payload = {}, options = {}) {
  const sourcePayload = cloneJsonPayload(payload);
  ensureThreeJsonIdsOnScenePayload(sourcePayload);
  const liftedPayload = liftWorldInfoRuntimeSugarToSceneConfig(sourcePayload);
  const extracted = extractDefaultModelFromScenePayload(liftedPayload);
  const canonicalPayload = buildCanonicalScenePayloadFromFriendly(extracted.payload);
  return buildNormalizedScenePayload(liftedPayload, canonicalPayload, extracted.template, options);
}

function hasNonEmptyObjectList(payload = {}) {
  return Array.isArray(payload?.objectList) && payload.objectList.length > 0;
}

function hasFriendlyWorldInfo(payload = {}) {
  return payload.worldInfo && typeof payload.worldInfo === "object";
}

function shouldNormalizeAsFriendly(payload = {}) {
  if (!hasFriendlyWorldInfo(payload)) {
    return false;
  }
  // When plan B (objectList + sceneConfig) coexists with friendly JSON, objectList wins
  if (hasNonEmptyObjectList(payload)) {
    return false;
  }
  return true;
}

/**
 * Decide which JSON form a scene package should show in editor/Code view.
 * @param {object} [payload]
 * @returns {"friendly"|"standard"}
 */
function detectScenePayloadViewFormat(payload = {}) {
  return shouldNormalizeAsFriendly(payload) ? "friendly" : "standard";
}

function normalizeScenePayload(payload = {}, options = {}) {
  if (shouldNormalizeAsFriendly(payload)) {
    return normalizeFriendlyScenePayload(payload, options);
  }
  // objectList-only, objectList + sceneConfig, and sceneConfig-only main runtime all use canonical normalization
  if (
    isCanonicalScenePayload(payload)
    || hasNonEmptyObjectList(payload)
    || hasSceneConfigPrimaryRuntime(payload)
  ) {
    return normalizeCanonicalScenePayload(payload, options);
  }
  return normalizeFriendlyScenePayload(payload, options);
}

export {
  CANONICAL_PRIMITIVE_OBJ_TYPES,
  buildFriendlyScenePayloadFromCanonical,
  detectScenePayloadViewFormat,
  hasSceneConfigPrimaryRuntime,
  isCanonicalScenePayload,
  isLoadableScenePayload,
  normalizeCanonicalObjectRecord,
  normalizeFriendlyScenePayload,
  normalizeSceneObjType,
  normalizeScenePayload,
  shouldNormalizeAsFriendly
};
