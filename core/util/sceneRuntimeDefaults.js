/**
 * Runtime defaults for scene load: lights, camera, controls, background, extent estimation.
 * Used by createJsonScene* and by editor/player via re-exports.
 */
import * as THREE from "three";
import { fitPerspectiveCameraToContentBoundsTHREE } from "./util.js";

const NEUTRAL_SCENE_BACKGROUND = "#1a1d24";

/** Lists scanned for extent by default (friendly worldInfo). */
const DEFAULT_EXTENT_LIST_NAMES = [
  "boxModelList",
  "sphereModelList",
  "modelList",
  "groupList",
  "domainModelList",
  "planeList",
  "lineList"
];

const AUTO_FIT_CAMERA_MODES = new Set(["targetOnly", "positionAndTarget"]);

/** Engine defaults when JSON / caller do not override. */
const ENGINE_RUNTIME_DEFAULTS = Object.freeze({
  autoFillLights: true,
  fillLightsWhenExplicitEmpty: false,
  autoFillCamera: false,
  autoFitCamera: false,
  autoFillSceneBackground: false,
  autoFitCameraMode: "positionAndTarget"
});

const RUNTIME_DEFAULT_OPTION_KEYS = [
  "autoFillLights",
  "fillLightsWhenExplicitEmpty",
  "autoFillCamera",
  "autoFitCamera",
  "autoFillSceneBackground",
  "autoFitCameraMode",
  "extentInclude",
  "cameraFallbackPosition",
  "defaultFov",
  "orbitDampingFactor",
  "orbitMaxPolarAngle",
  "sceneAutoRotate",
  "aspectHints",
  "viewDirection"
];

function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function listOr(value) {
  return Array.isArray(value) ? value : [];
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * @param {object} entry
 * @param {object} gx
 * @returns {{ halfW: number, halfH: number, halfD: number }}
 */
function halfExtentsFromGeometry(entry, gx) {
  const objType = normalizeObjType(entry?.objType || entry?.boxType);
  if (objType === "sphere" || entry?.boxType === "sphere") {
    const r = gx.radius || gx.width || gx.height || 8;
    const h = Math.max(r, 0.5);
    return { halfW: h, halfH: h, halfD: h };
  }
  const wRaw = gx.width || gx.radius || gx.size || gx.x || gx.length || gx.depth || gx.height || gx.z || gx.y;
  const halfW = 0.5 * Math.abs(isFiniteNumber(wRaw) ? wRaw : gx.width || 24);
  const hRaw = gx.height ?? gx.depth ?? gx.width ?? gx.length ?? gx.radius;
  const halfH = 0.5 * Math.abs(isFiniteNumber(hRaw) ? hRaw : 12);
  const dRaw = gx.depth ?? gx.length ?? gx.height ?? gx.width ?? gx.radius;
  const halfD = 0.5 * Math.abs(isFiniteNumber(dRaw) ? dRaw : 36);
  return { halfW, halfH, halfD };
}

/**
 * @param {object} item
 * @returns {{ minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number } | null}
 */
function boundsFromItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const points = listOr(item.points);
  if (points.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      const px = Number(p?.x) || 0;
      const py = Number(p?.y) || 0;
      const pz = Number(p?.z) || 0;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
      minZ = Math.min(minZ, pz);
      maxZ = Math.max(maxZ, pz);
    }
    if (!Number.isFinite(minX)) {
      return null;
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }
  const pos = item.position || {};
  const gx = item.geometry || {};
  if (!item.geometry && !item.position) {
    return null;
  }
  const { halfW, halfH, halfD } = halfExtentsFromGeometry(item, gx);
  const px = Number(pos.x) || 0;
  const py = Number(pos.y) || 0;
  const pz = Number(pos.z) || 0;
  return {
    minX: px - halfW,
    maxX: px + halfW,
    minY: py - halfH,
    maxY: py + halfH,
    minZ: pz - halfD,
    maxZ: pz + halfD
  };
}

/**
 * @param {object|null} bounds
 * @param {object|null} add
 * @returns {object|null}
 */
function mergeBounds(bounds, add) {
  if (!add) {
    return bounds;
  }
  if (!bounds) {
    return { ...add };
  }
  return {
    minX: Math.min(bounds.minX, add.minX),
    minY: Math.min(bounds.minY, add.minY),
    minZ: Math.min(bounds.minZ, add.minZ),
    maxX: Math.max(bounds.maxX, add.maxX),
    maxY: Math.max(bounds.maxY, add.maxY),
    maxZ: Math.max(bounds.maxZ, add.maxZ)
  };
}

/**
 * @param {object} record
 * @param {object} [filter]
 * @returns {boolean}
 */
function recordMatchesExtentFilter(record, filter) {
  if (!filter || typeof filter !== "object") {
    return true;
  }
  const objTypes = listOr(filter.objTypes).map(normalizeObjType).filter(Boolean);
  const threeJsonIds = listOr(filter.threeJsonIds).map((id) => String(id));
  const hasObjFilter = objTypes.length > 0;
  const hasIdFilter = threeJsonIds.length > 0;
  if (!hasObjFilter && !hasIdFilter) {
    return true;
  }
  const recordType = normalizeObjType(record?.objType || record?.boxType);
  if (hasObjFilter && objTypes.includes(recordType)) {
    return true;
  }
  const id = record?.threeJsonId != null ? String(record.threeJsonId) : "";
  if (hasIdFilter && id && threeJsonIds.includes(id)) {
    return true;
  }
  return false;
}

/**
 * @param {object[]} items
 * @param {object|null} bounds
 * @param {object} [filter]
 * @returns {object|null}
 */
function accumulateItemsBounds(items, bounds, filter) {
  let next = bounds;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!recordMatchesExtentFilter(item, filter)) {
      continue;
    }
    next = mergeBounds(next, boundsFromItem(item));
    const nested = listOr(item?.boxModelList);
    if (nested.length > 0) {
      next = accumulateItemsBounds(nested, next, filter);
    }
    const subGroup = listOr(item?.subGroup);
    for (let j = 0; j < subGroup.length; j += 1) {
      const group = subGroup[j];
      next = accumulateItemsBounds(listOr(group?.boxModelList), next, filter);
    }
  }
  return next;
}

/**
 * @param {object} payload
 * @param {object} [options]
 * @param {object} [options.extentInclude] optional { objTypes?, threeJsonIds?, listNames? }
 * @returns {{ center: {x,y,z}, maxDim: number } | null}
 */
function estimateSceneExtentFromPayload(payload, options = {}) {
  const wi = payload?.worldInfo;
  if (!wi || typeof wi !== "object") {
    return null;
  }
  const filter = options.extentInclude;
  const listNames = listOr(filter?.listNames);
  const scanLists =
    listNames.length > 0
      ? listNames.filter((name) => hasOwn(wi, name))
      : DEFAULT_EXTENT_LIST_NAMES;

  let raw = null;
  for (let i = 0; i < scanLists.length; i += 1) {
    const listName = scanLists[i];
    raw = accumulateItemsBounds(listOr(wi[listName]), raw, filter);
  }

  if (!raw || !Number.isFinite(raw.minX)) {
    return null;
  }
  const center = {
    x: (raw.minX + raw.maxX) / 2,
    y: (raw.minY + raw.maxY) / 2,
    z: (raw.minZ + raw.maxZ) / 2
  };
  const sizeX = Math.max(raw.maxX - raw.minX, 0.001);
  const sizeY = Math.max(raw.maxY - raw.minY, 0.001);
  const sizeZ = Math.max(raw.maxZ - raw.minZ, 0.001);
  return { center, maxDim: Math.max(sizeX, sizeY, sizeZ) };
}

/**
 * @param {object} sceneConfig
 * @param {object} worldInfo
 * @returns {boolean}
 */
function hasExplicitCameraConfig(sceneConfig = {}, worldInfo = {}) {
  const cam = sceneConfig?.camera;
  if (cam && typeof cam === "object" && Object.keys(cam).length > 0) {
    return true;
  }
  return false;
}

/**
 * @param {{ center: object, maxDim: number }|null} extentGuess
 * @param {{ x: number, y: number, z: number }} [configuredFallback]
 * @returns {{ x: number, y: number, z: number }}
 */
function cameraPositionFallbackFromExtent(extentGuess, configuredFallback) {
  if (!extentGuess) {
    const fb = configuredFallback || { x: 21, y: 63.8, z: 100.8 };
    return { x: fb.x, y: fb.y, z: fb.z };
  }
  const offset = Math.max(extentGuess.maxDim * 1.38, 32);
  return {
    x: extentGuess.center.x + offset * 0.82,
    y: extentGuess.center.y + offset * 0.52,
    z: extentGuess.center.z + offset * 0.9
  };
}

/**
 * @param {object} primaryPos
 * @param {object} legacyPos
 * @param {{ x: number, y: number, z: number }} fallbackPos
 * @returns {{ x: number, y: number, z: number }}
 */
function resolveCameraTriple(primaryPos, legacyPos, fallbackPos) {
  const pickAxis = (a, b, c) => (hasValue(a) ? Number(a) : hasValue(b) ? Number(b) : c);
  return {
    x: pickAxis(primaryPos?.x, legacyPos?.x, fallbackPos.x),
    y: pickAxis(primaryPos?.y, legacyPos?.y, fallbackPos.y),
    z: pickAxis(primaryPos?.z, legacyPos?.z, fallbackPos.z)
  };
}

/**
 * @param {object} payload
 * @param {{ center: object, maxDim: number }|null} extentGuess
 * @param {object} [options]
 * @returns {{ camera: object, controls: object }}
 */
function buildRuntimeCameraControlsFromPayload(payload, extentGuess, options = {}) {
  const data = payload || {};
  const sceneConfig = data.sceneConfig && typeof data.sceneConfig === "object" ? data.sceneConfig : {};
  const camCfg = sceneConfig.camera && typeof sceneConfig.camera === "object" ? sceneConfig.camera : {};
  const orbitCfg = sceneConfig.controls && typeof sceneConfig.controls === "object" ? sceneConfig.controls : {};
  const controlsType = typeof orbitCfg.type === "string" ? orbitCfg.type.trim() : "";
  const fallbackPos = cameraPositionFallbackFromExtent(
    extentGuess,
    options.cameraFallbackPosition
  );

  if (controlsType.toLowerCase() === "firstperson") {
    const position = resolveCameraTriple(camCfg.position, null, fallbackPos);
    return {
      camera: {
        fov: isFiniteNumber(camCfg.fov) ? camCfg.fov : options.defaultFov ?? 70,
        near: isFiniteNumber(camCfg.near) ? camCfg.near : 0.1,
        far: isFiniteNumber(camCfg.far) ? camCfg.far : 500,
        position
      },
      controls: {
        type: "firstPerson",
        moveSpeed: isFiniteNumber(orbitCfg.moveSpeed) ? orbitCfg.moveSpeed : 5,
        eyeHeight: isFiniteNumber(orbitCfg.eyeHeight) ? orbitCfg.eyeHeight : 1.6,
        lookSensitivity: isFiniteNumber(orbitCfg.lookSensitivity) ? orbitCfg.lookSensitivity : 0.001,
        lookSmoothing: isFiniteNumber(orbitCfg.lookSmoothing) ? orbitCfg.lookSmoothing : 0,
        lookSmoothTime: isFiniteNumber(orbitCfg.lookSmoothTime) ? orbitCfg.lookSmoothTime : 0.06,
        lookPitchLimit: isFiniteNumber(orbitCfg.lookPitchLimit) ? orbitCfg.lookPitchLimit : 1.396,
        maxLookDelta: isFiniteNumber(orbitCfg.maxLookDelta) ? orbitCfg.maxLookDelta : 120,
        ...(isFiniteNumber(orbitCfg.minPolarAngle) ? { minPolarAngle: orbitCfg.minPolarAngle } : {}),
        ...(isFiniteNumber(orbitCfg.maxPolarAngle) ? { maxPolarAngle: orbitCfg.maxPolarAngle } : {}),
        pointerLock: orbitCfg.pointerLock !== false,
        floorSnap: orbitCfg.floorSnap !== false
      }
    };
  }

  const position = resolveCameraTriple(camCfg.position, null, fallbackPos);
  const defNear = extentGuess ? Math.max(extentGuess.maxDim / 15000, 0.038) : 0.048;
  const defFarGuess = extentGuess
    ? Math.max(extentGuess.maxDim * 26, extentGuess.maxDim + 980, 640)
    : 2500;
  const near = isFiniteNumber(camCfg.near) ? camCfg.near : defNear;
  let far = isFiniteNumber(camCfg.far) ? camCfg.far : defFarGuess;
  far = Math.max(far, near * 200, extentGuess?.maxDim * 8 || 0);
  const fov = isFiniteNumber(camCfg.fov) ? camCfg.fov : options.defaultFov ?? 50;

  const targetFallbackCenter = extentGuess ? extentGuess.center : { x: 0, y: 14, z: 0 };
  const tSrc = orbitCfg.target;
  const orbitTarget = {
    x: hasValue(tSrc?.x) ? Number(tSrc.x) : targetFallbackCenter.x,
    y: hasValue(tSrc?.y) ? Number(tSrc.y) : targetFallbackCenter.y,
    z: hasValue(tSrc?.z) ? Number(tSrc.z) : targetFallbackCenter.z
  };

  const minDistDef = extentGuess ? Math.max(extentGuess.maxDim / 320, 0.48) : 0.54;
  const maxDistGuess = extentGuess
    ? Math.min(far * 0.93, extentGuess.maxDim * 22 + 820)
    : Math.min(2400, defFarGuess * 4);
  const orbitMinDistance = isFiniteNumber(orbitCfg.minDistance) ? orbitCfg.minDistance : minDistDef;
  let orbitMaxDistance = isFiniteNumber(orbitCfg.maxDistance)
    ? orbitCfg.maxDistance
    : Math.max(maxDistGuess, orbitMinDistance * 4);

  return {
    camera: { fov, near, far, position },
    controls: {
      listenToKeyEvents: true,
      enableDamping: true,
      dampingFactor: hasValue(orbitCfg.dampingFactor)
        ? orbitCfg.dampingFactor
        : options.orbitDampingFactor ?? 0.35,
      enableZoom: hasValue(orbitCfg.enableZoom) ? orbitCfg.enableZoom : true,
      autoRotate: options.sceneAutoRotate === true,
      minDistance: orbitMinDistance,
      maxDistance: Math.max(orbitMaxDistance, orbitMinDistance * 3),
      maxPolarAngle: isFiniteNumber(orbitCfg.maxPolarAngle)
        ? orbitCfg.maxPolarAngle
        : options.orbitMaxPolarAngle ?? Math.PI / 1.9,
      enablePan: hasValue(orbitCfg.enablePan) ? orbitCfg.enablePan : true,
      target: orbitTarget
    }
  };
}

/**
 * @param {{ center: object, maxDim: number }|null} extentGuess
 * @param {object} [options]
 * @returns {object[]}
 */
function buildDeclarativeLightsFromExtent(extentGuess, options = {}) {
  const scale = extentGuess ? Math.max(extentGuess.maxDim / 140, 0.54) : 1;
  const shadowFarHint = extentGuess ? Math.max(extentGuess.maxDim * 40, 520) : 500;
  return [
    {
      type: "directional",
      color: "#ffffff",
      intensity: 0.41,
      position: { x: -64 * scale, y: 10.6 * scale, z: 35 * scale },
      shadow: true,
      shadowCameraNear: Math.max(0.08, extentGuess?.maxDim / 18000 || 0.09),
      shadowCameraFar: shadowFarHint * 2.35
    },
    {
      type: "ambient",
      color: "#cccccc",
      intensity: 0.58,
      position: { x: 0, y: 0, z: 0 },
      shadow: false
    },
    {
      type: "point",
      color: "#cccccc",
      intensity: 0.54,
      position: { x: 0, y: 35 * scale, z: 0 },
      shadow: true,
      shadowCameraNear: 0.095,
      shadowCameraFar: Math.max(shadowFarHint * 2.05, shadowFarHint)
    }
  ];
}

/**
 * @param {object} normalized
 * @param {{ center: object, maxDim: number }|null} extentGuess
 * @param {object} options
 * @returns {{ lights: object[], injected: boolean, reason?: string }}
 */
function resolveLightsDefaults(normalized, extentGuess, options = {}) {
  const sceneConfig = normalized?.sceneConfig || {};
  const worldInfo = normalized?.worldInfo || {};
  const lightsMeta = normalized?.lightsMeta || {};

  const autoFillLights = options.autoFillLights !== false;
  const fillEmpty = options.fillLightsWhenExplicitEmpty === true;

  if (lightsMeta.hasExplicitNonEmpty) {
    return { lights: listOr(lightsMeta.explicitLights), injected: false };
  }

  if (lightsMeta.explicitEmpty && !fillEmpty) {
    return { lights: [], injected: false, reason: "explicit_empty_lights" };
  }

  if (!autoFillLights) {
    return { lights: [], injected: false, reason: "autoFillLights_disabled" };
  }

  if (!lightsMeta.lightsKeyPresent) {
    return {
      lights: buildDeclarativeLightsFromExtent(extentGuess, options),
      injected: true,
      reason: "missing_lights_key"
    };
  }

  if (lightsMeta.explicitEmpty && fillEmpty) {
    return {
      lights: buildDeclarativeLightsFromExtent(extentGuess, options),
      injected: true,
      reason: "explicit_empty_with_override"
    };
  }

  return { lights: [], injected: false };
}

/**
 * @param {object} normalized
 * @param {object} options
 * @returns {object}
 */
function resolveSceneBackgroundDefaults(normalized, options = {}) {
  if (options.autoFillSceneBackground !== true) {
    return normalized.sceneHints || {};
  }
  const hints = { ...(normalized.sceneHints || {}) };
  if (!hasOwn(hints, "background") && !hasOwn(hints, "environment")) {
    hints.background = NEUTRAL_SCENE_BACKGROUND;
    hints.__defaultBackgroundInjected = true;
  }
  return hints;
}

/**
 * @param {object} [source]
 * @returns {object}
 */
function pickRuntimeDefaultFields(source) {
  if (!source || typeof source !== "object") {
    return {};
  }
  const picked = {};
  for (let i = 0; i < RUNTIME_DEFAULT_OPTION_KEYS.length; i += 1) {
    const key = RUNTIME_DEFAULT_OPTION_KEYS[i];
    if (hasOwn(source, key)) {
      picked[key] = source[key];
    }
  }
  return picked;
}

/**
 * Read optional overrides from friendly / standard payload.
 * @param {object} payload
 * @returns {object}
 */
function readRuntimeDefaultsFromPayload(payload = {}) {
  const worldInfo = payload.worldInfo && typeof payload.worldInfo === "object" ? payload.worldInfo : {};
  const sceneConfig =
    payload.sceneConfig && typeof payload.sceneConfig === "object" ? payload.sceneConfig : {};
  return {
    ...pickRuntimeDefaultFields(worldInfo.runtimeDefaults),
    ...pickRuntimeDefaultFields(sceneConfig.runtimeDefaults)
  };
}

/**
 * Merge engine defaults, JSON runtimeDefaults, and host createJsonScene options.
 * Priority (low → high): ENGINE_RUNTIME_DEFAULTS, payload JSON, callerOptions.
 * @param {object} payload scene JSON before normalize
 * @param {object} [callerOptions]
 * @returns {object}
 */
function mergeRuntimeDefaultOptions(payload = {}, callerOptions = {}) {
  return {
    ...ENGINE_RUNTIME_DEFAULTS,
    ...readRuntimeDefaultsFromPayload(payload),
    ...(callerOptions && typeof callerOptions === "object" ? callerOptions : {})
  };
}

/**
 * Apply lights / camera / controls / sceneHints defaults onto normalized payload before deploy.
 * @param {object} normalized
 * @param {object} [options]
 * @returns {object} same normalized reference
 */
function applySceneRuntimeDefaults(normalized, options = {}) {
  if (!normalized || typeof normalized !== "object") {
    return normalized;
  }
  const payload = normalized.sourcePayload || normalized.compatPayload || {};
  const extentGuess = estimateSceneExtentFromPayload(payload, options);

  const lightResult = resolveLightsDefaults(normalized, extentGuess, options);
  normalized.lightsConfig = lightResult.lights;
  normalized.hasExplicitLights = listOr(lightResult.lights).length > 0;
  normalized.defaultLightsInjected = lightResult.injected === true;
  normalized.defaultLightsInjectReason = lightResult.reason;

  const sceneConfig = normalized.sceneConfig || {};
  if (options.autoFillCamera === true && !hasExplicitCameraConfig(sceneConfig)) {
    const built = buildRuntimeCameraControlsFromPayload(payload, extentGuess, options);
    normalized.cameraConfig = { ...(normalized.cameraConfig || {}), ...built.camera };
    normalized.controlsConfig = {
      ...(normalized.controlsConfig || {}),
      ...built.controls
    };
    normalized.defaultCameraInjected = true;
  }

  normalized.sceneHints = resolveSceneBackgroundDefaults(normalized, options);

  return normalized;
}

/**
 * @param {THREE.Scene} rootScene
 * @param {object} [options]
 * @returns {boolean}
 */
function sceneHasAnyLight(rootScene) {
  if (!rootScene) {
    return false;
  }
  let hit = false;
  rootScene.traverse((obj) => {
    if (obj?.isLight === true) {
      hit = true;
    }
  });
  return hit;
}

/**
 * Object / single-record paths: add runtime lights when scene has none.
 * @param {THREE.Scene} rootScene
 * @param {object} [options]
 * @returns {boolean}
 */
function ensureDefaultSceneLightsInScene(rootScene, options = {}) {
  if (options.autoFillLights === false) {
    return false;
  }
  if (!rootScene || sceneHasAnyLight(rootScene)) {
    return false;
  }
  const ambient = new THREE.AmbientLight("#ffffff", 0.7);
  const directional = new THREE.DirectionalLight("#ffffff", 0.85);
  directional.position.set(260, 420, 380);
  ambient.userData = {
    ...(ambient.userData || {}),
    objJson: { objType: "light", type: "ambient" },
    __threeJsonDefaultInjected: true
  };
  directional.userData = {
    ...(directional.userData || {}),
    objJson: { objType: "light", type: "directional" },
    __threeJsonDefaultInjected: true
  };
  rootScene.add(ambient);
  rootScene.add(directional);
  return true;
}

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {object} controls
 * @param {object} normalized
 * @param {object} [options]
 * @returns {boolean}
 */
function applyAutoFitCameraToRuntime(camera, controls, normalized, options = {}) {
  if (options.autoFitCamera !== true || !camera) {
    return false;
  }
  const modeRaw = String(options.autoFitCameraMode || "positionAndTarget").trim();
  const fitMode = AUTO_FIT_CAMERA_MODES.has(modeRaw) ? modeRaw : "positionAndTarget";
  const payload = normalized?.sourcePayload || normalized?.compatPayload || {};
  const extent = estimateSceneExtentFromPayload(payload, options);
  if (!extent) {
    return false;
  }
  const bounds = new THREE.Box3(
    new THREE.Vector3(
      extent.center.x - extent.maxDim / 2,
      extent.center.y - extent.maxDim / 2,
      extent.center.z - extent.maxDim / 2
    ),
    new THREE.Vector3(
      extent.center.x + extent.maxDim / 2,
      extent.center.y + extent.maxDim / 2,
      extent.center.z + extent.maxDim / 2
    )
  );
  if (fitMode === "targetOnly") {
    if (controls?.target) {
      controls.target.set(extent.center.x, extent.center.y, extent.center.z);
      controls.update?.();
      return true;
    }
    return false;
  }
  return fitPerspectiveCameraToContentBoundsTHREE(camera, controls, bounds, {
    aspectHints: options.aspectHints || {},
    viewDirection: options.viewDirection
  });
}

/**
 * Enhanced lights normalization metadata for deploy decisions.
 * @param {object} sceneConfig
 * @param {object} worldInfo
 * @returns {{ lights: object[], hasExplicitLights: boolean, lightsMeta: object }}
 */
function normalizeLightsConfigWithMeta(sceneConfig = {}, worldInfo = {}) {
  const worldHasKey = hasOwn(worldInfo, "lights") && Array.isArray(worldInfo.lights);
  const sceneHasKey = hasOwn(sceneConfig, "lights") && Array.isArray(sceneConfig.lights);
  const lightsKeyPresent = worldHasKey || sceneHasKey;
  let raw = [];
  if (worldHasKey) {
    raw = worldInfo.lights;
  } else if (sceneHasKey) {
    raw = sceneConfig.lights;
  }
  const explicitLights = raw.filter((entry) => entry && typeof entry === "object");
  const explicitEmpty = lightsKeyPresent && explicitLights.length === 0;
  return {
    lights: explicitLights,
    hasExplicitLights: explicitLights.length > 0,
    lightsMeta: {
      lightsKeyPresent,
      explicitEmpty,
      explicitLights,
      hasExplicitNonEmpty: explicitLights.length > 0
    }
  };
}

export {
  AUTO_FIT_CAMERA_MODES,
  DEFAULT_EXTENT_LIST_NAMES,
  ENGINE_RUNTIME_DEFAULTS,
  NEUTRAL_SCENE_BACKGROUND,
  accumulateItemsBounds,
  applyAutoFitCameraToRuntime,
  applySceneRuntimeDefaults,
  buildDeclarativeLightsFromExtent,
  buildRuntimeCameraControlsFromPayload,
  cameraPositionFallbackFromExtent,
  ensureDefaultSceneLightsInScene,
  estimateSceneExtentFromPayload,
  hasExplicitCameraConfig,
  mergeRuntimeDefaultOptions,
  normalizeLightsConfigWithMeta,
  pickRuntimeDefaultFields,
  readRuntimeDefaultsFromPayload,
  resolveCameraTriple,
  resolveLightsDefaults,
  resolveSceneBackgroundDefaults,
  sceneHasAnyLight
};
