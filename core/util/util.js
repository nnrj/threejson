import * as THREE from 'three';

import { isThreeNativeJsonFileType } from '../builder/nativeObjectLoader.js';
import { sanitizePlainData } from '../handler/sceneJsonHandler.js';
import { sanitizeWorldInfoForExport } from './descriptorExportSanitize.js';
import { mergeWorldInfoModelListByIdentity } from './persistListMerge.js';
import { mergeDomainModelList } from './persistWorldInfoMerge.js';
import { INFO_PANEL_DEFAULT_OPACITY } from '../theme/runtimeVisualDefaults.js';

/**
 * Common `objJson.objType` values excluded from adaptive bounding boxes (lights, panels, etc.).
 */
const DEFAULT_ADAPTIVE_SKIP_OBJ_TYPES = new Set([
  'light',
  'infoPanel',
  'wind',
  'plane',
  'heatMap',
  'points',
  'leakLine'
]);

/**
 * Collect bounding boxes of visible Mesh/InstancedMesh nodes and suppress oversized planes via a volume percentile, for camera auto-fit.
 *
 * @param {THREE.Scene|THREE.Object3D} scene
 * @param {object} [options]
 * @param {THREE.Object3D|null} [options.ignoreHelper] Node to ignore (e.g. reference-equal BoxHelper)
 * @param {Iterable<string>} [options.skipObjTypes] Blacklist of userData.objJson.objType; defaults include lights, heat maps, etc.
 * @param {boolean} [options.excludeFloorByName=true] Whether to skip meshes with `name === "floor"`
 * @param {number} [options.percentileIndex=0.12] Fractional index into sorted side lengths used for baseline
 * @param {number} [options.sideCapLinScale=52] Per-side cap from baseline: `max(baseline*scale, baseline+sideCapAdditive)`
 * @param {number} [options.sideCapAdditive=6000]
 * @returns {THREE.Box3|null} `null` when no candidate meshes exist
 */
function buildAdaptiveContentBoundingBoxTHREE(scene, options = {}) {
  if (!scene || typeof scene.traverse !== 'function') {
    return null;
  }
  const ignoreHelper = options.ignoreHelper ?? null;
  const excludeFloorByName = options.excludeFloorByName !== false;
  const skipSource = options.skipObjTypes !== undefined && options.skipObjTypes !== null
    ? options.skipObjTypes
    : DEFAULT_ADAPTIVE_SKIP_OBJ_TYPES;
  const skip = skipSource instanceof Set ? skipSource : new Set(skipSource);
  const pct = Number.isFinite(options.percentileIndex) ? options.percentileIndex : 0.12;
  const sideScale = Number.isFinite(options.sideCapLinScale) ? options.sideCapLinScale : 52;
  const sideAdd = Number.isFinite(options.sideCapAdditive) ? options.sideCapAdditive : 6000;

  const tempBox = new THREE.Box3();
  const candidateBoxes = [];

  scene.traverse((node) => {
    if (!node.visible || !(node.isMesh || node.isInstancedMesh)) {
      return;
    }
    if (ignoreHelper && node === ignoreHelper) {
      return;
    }
    if (excludeFloorByName && node.name === 'floor') {
      return;
    }
    const od = node.userData?.objJson?.objType;
    if (od && skip.has(od)) {
      return;
    }
    tempBox.setFromObject(node);
    if (tempBox.isEmpty()) {
      return;
    }
    const sLocal = tempBox.getSize(new THREE.Vector3());
    candidateBoxes.push({
      box: tempBox.clone(),
      maxSide: Math.max(sLocal.x, sLocal.y, sLocal.z)
    });
  });

  if (!candidateBoxes.length) {
    return null;
  }

  const sidesSorted = candidateBoxes.map((c) => c.maxSide).sort((a, b) => a - b);
  const pct12Idx = Math.max(
    6,
    Math.min(candidateBoxes.length - 1, Math.floor(candidateBoxes.length * pct))
  );
  const baselineSide = sidesSorted[pct12Idx];
  const fitSideCap = Math.max(baselineSide * sideScale, baselineSide + sideAdd);

  let picks = candidateBoxes.filter((c) => c.maxSide <= fitSideCap);
  if (!picks.length) {
    picks = candidateBoxes;
  }

  const bounds = new THREE.Box3();
  bounds.makeEmpty();
  for (const chunk of picks) {
    bounds.union(chunk.box);
  }
  return bounds;
}

/**
 * Adjust perspective camera position, clipping planes, and OrbitControls distance range from a precomputed content bounding box.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {object} controls OrbitControls (must expose target, minDistance, maxDistance, update)
 * @param {THREE.Box3} bounds
 * @param {object} [options]
 * @param {object} [options.aspectHints] Fallback hints when resolving aspect ratio
 * @param {HTMLCanvasElement|undefined} [options.aspectHints.rendererDomElement]
 * @param {{width:number,height:number}} [options.aspectHints.mainViewRect]
 * @param {HTMLElement|undefined} [options.aspectHints.canvasWrap]
 * @param {boolean} [options.aspectHints.threeViewActive]
 * @param {THREE.Vector3} [options.viewDirection] Approximate world-space direction from target toward camera; normalized
 * @returns {boolean} `false` when `bounds` is empty
 */
function fitPerspectiveCameraFirstPersonToBoundsTHREE(camera, bounds, options = {}) {
  if (!camera || !bounds || bounds.isEmpty()) {
    return false;
  }

  const centerVec = bounds.getCenter(new THREE.Vector3());
  const sizeVec = bounds.getSize(new THREE.Vector3());
  const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z, 0);
  let radius = 0.5 * sizeVec.length();
  if (!Number.isFinite(radius) || radius < 1e-6) {
    radius = maxDim > 1e-6 ? maxDim * 0.5 : 15;
  }

  const eyeHeight = Number.isFinite(options.eyeHeight) ? options.eyeHeight : 1.6;
  camera.position.set(centerVec.x, centerVec.y + eyeHeight, centerVec.z + radius * 0.35);

  const camY = camera.position.y;
  camera.near = Math.max(0.048, radius * 0.02);
  camera.far = Math.max(
    radius * 80,
    maxDim * 14,
    camY + radius * 22,
    camera.near * 400
  );
  camera.updateProjectionMatrix();
  return true;
}

function fitPerspectiveCameraToContentBoundsTHREE(camera, controls, bounds, options = {}) {
  if (!camera || !bounds || bounds.isEmpty()) {
    return false;
  }

  const mode = options.mode
    || (controls?.threeJsonControlsKind === "firstPerson" ? "firstPerson" : "orbit");

  if (mode === "firstPerson" || !controls?.target) {
    return fitPerspectiveCameraFirstPersonToBoundsTHREE(camera, bounds, options);
  }

  const centerVec = bounds.getCenter(new THREE.Vector3());
  const sizeVec = bounds.getSize(new THREE.Vector3());
  const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z, 0);
  let radius = 0.5 * sizeVec.length();
  if (!Number.isFinite(radius) || radius < 1e-6) {
    radius = maxDim > 1e-6 ? maxDim * 0.5 : 15;
  }

  controls.target.copy(centerVec);

  const hints = options.aspectHints || {};
  let aspectFit = Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 1;
  const domEl = hints.rendererDomElement;

  if (!Number.isFinite(aspectFit) || aspectFit < 0.12 || aspectFit > 10) {
    if (domEl && domEl.clientWidth > 2 && domEl.clientHeight > 2) {
      aspectFit = domEl.clientWidth / domEl.clientHeight;
    } else if (hints.threeViewActive && hints.mainViewRect
      && hints.mainViewRect.width > 2 && hints.mainViewRect.height > 2) {
      aspectFit = hints.mainViewRect.width / hints.mainViewRect.height;
    } else if (hints.canvasWrap
      && hints.canvasWrap.clientWidth > 2 && hints.canvasWrap.clientHeight > 2) {
      aspectFit = hints.canvasWrap.clientWidth / hints.canvasWrap.clientHeight;
    }
  }
  aspectFit = THREE.MathUtils.clamp(Number(aspectFit) || 1, 0.2, 4);

  const vFovDeg = Number.isFinite(camera.fov) ? camera.fov : 50;
  const vFovRad = THREE.MathUtils.degToRad(vFovDeg);

  const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspectFit);
  const tanHalfV = Math.max(Math.tan(vFovRad / 2), 1e-4);
  const tanHalfH = Math.max(Math.tan(hFovRad / 2), 1e-4);

  const distV = radius / tanHalfV;
  const distH = radius / tanHalfH;
  let distance = Math.max(distV, distH) * 1.12 + radius * 0.08;
  distance = THREE.MathUtils.clamp(distance, radius * 1.03, radius * 80 + 600);

  const dir = options.viewDirection
    ? options.viewDirection.clone().normalize()
    : new THREE.Vector3(0.94, 0.58, 1.02).normalize();
  camera.position.copy(centerVec.clone().add(dir.multiplyScalar(distance)));

  const camToCenter = camera.position.distanceTo(centerVec);
  camera.near = Math.max(Math.min(camToCenter / 3800, radius * 0.02), 0.048);
  camera.far = Math.max(
    camToCenter + radius * 22,
    maxDim * 14,
    radius * 80,
    camToCenter * 6,
    camera.near * 400
  );
  controls.minDistance = Math.max(radius * 0.035, camera.near * 2);
  controls.maxDistance = camera.far * 0.9;

  camera.updateProjectionMatrix();
  if (typeof controls.update === 'function') {
    controls.update();
  }
  return true;
}

/**
 * General utilities: safe value access, list defaults, and info-panel JSON fragments.
 */

/**
 * Whether value is defined (not undefined and not null).
 * @param {*} value
 * @returns {boolean}
 */
function hasValue(value) {
  return value !== undefined && value !== null;
}

/**
 * Return value when defined, otherwise defaultValue.
 * @param {*} value
 * @param {*} defaultValue
 * @returns {*}
 */
function valueOr(value, defaultValue) {
  return hasValue(value) ? value : defaultValue;
}

/**
 * Return value when it is an array, otherwise defaultValue (empty array by default).
 * @param {*} value
 * @param {Array} [defaultValue=[]]
 * @returns {Array}
 */
function listOr(value, defaultValue = []) {
  return Array.isArray(value) ? value : defaultValue;
}

/**
 * Parse a path string into file info (file name, directory, extension).
 * Supports `/` and `\`, and strips query strings and hash fragments.
 * @param {string} fullPath
 * @returns {{ fileName: string, directoryPath: string, extension: string }}
 */
function parseFilePathParts(fullPath) {
  const raw = String(fullPath ?? '');
  const withoutQuery = raw.split(/[?#]/)[0];
  const normalized = withoutQuery.replace(/\\/g, '/');
  const slashAt = normalized.lastIndexOf('/');
  const fileName = slashAt >= 0 ? normalized.slice(slashAt + 1) : normalized;
  const baseDir = slashAt >= 0 ? normalized.slice(0, slashAt) : '';
  const directoryPath = baseDir ? `${baseDir}/` : '';
  const dotAt = fileName.lastIndexOf('.');
  const extension = dotAt > 0 ? fileName.slice(dotAt + 1) : '';
  return { fileName, directoryPath, extension };
}

/**
 * Extract file name from a path (including extension).
 * @param {string} fullPath
 * @returns {string}
 */
function getFileNameFromPath(fullPath) {
  return parseFilePathParts(fullPath).fileName;
}

/**
 * Extract directory from a path (trailing `/`; empty string when none).
 * @param {string} fullPath
 * @returns {string}
 */
function getDirectoryPathFromPath(fullPath) {
  return parseFilePathParts(fullPath).directoryPath;
}

/**
 * Extract extension from a path (without the leading `.`).
 * @param {string} fullPath
 * @returns {string}
 */
function getFileExtensionFromPath(fullPath) {
  return parseFilePathParts(fullPath).extension;
}

/**
 * Build a floating panel descriptor compatible with engine `infoPanel` JSON (often used when assembling data in scripts).
 * @param {string} text Primary label text
 * @param {{x?:number,y?:number,z?:number}} [position] Panel world position
 * @param {object} [options] Overrides for panelBoxType, colors, size, opacity, etc.
 * @returns {object} infoPanel-style object literal
 */
function buildFloatingInfoPanel(text, position, options = {}) {
  const panel = {
    objType: "infoPanel",
    panelBoxType: valueOr(options.panelBoxType, valueOr(options.boxType, "sprite")),
    type: valueOr(options.type, "text"),
    text: valueOr(text, ""),
    color: valueOr(options.color, "#ffffff"),
    backColor: valueOr(options.backColor, "#30465d"),
    panelWidth: valueOr(options.panelWidth, 160),
    panelHeight: valueOr(options.panelHeight, 90),
    panelDepth: valueOr(options.panelDepth, 1),
    transparent: valueOr(options.transparent, true),
    opacity: valueOr(options.opacity, INFO_PANEL_DEFAULT_OPACITY),
    ...(hasValue(options.borderRadius) ? { borderRadius: Number(options.borderRadius) || 0 } : {}),
    panel: {
      geometry: {
        width: valueOr(options.panelWidth, 160),
        height: valueOr(options.panelHeight, 90),
        depth: valueOr(options.panelDepth, 1)
      },
      position: {
        x: valueOr(position?.x, 0),
        y: valueOr(position?.y, 0),
        z: valueOr(position?.z, 0)
      },
      material: {
        color: valueOr(options.backColor, "#30465d"),
        transparent: valueOr(options.transparent, true),
        opacity: valueOr(options.opacity, INFO_PANEL_DEFAULT_OPACITY)
      },
      rotation: {
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0
      },
      scale: {
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1
      }
    }
  };
  if (options.fix === true || options.fix === false) {
    panel.fix = options.fix;
  }
  if (hasValue(options.dismissTrigger)) {
    panel.dismissTrigger = options.dismissTrigger;
  }
  return panel;
}

/**
 * examples/jsm wide lines: core toJSON for LineGeometry / LineMaterial is incomplete and often throws on serialize.
 * @param {THREE.Object3D|null|undefined} obj
 * @returns {boolean}
 */
function isFatLineExampleObject(obj) {
  return Boolean(
    obj
    && (obj.type === 'LineSegments2'
      || obj.type === 'Line2'
      || obj.isLineSegments2 === true
      || obj.isLine2 === true)
  );
}

/**
 * Remove nodes from an Object3D subgraph that break or incompletely serialize via `toJSON` (graph only; shared resources are not disposed).
 * - TransformControls (e.g. touchAction, internal refs)
 * - Editor BoxHelper: `userData.type === "helperBoxEdge"`
 * - Line2 / LineSegments2
 *
 * @param {THREE.Object3D} root
 */
function stripNonSerializableNodesForNativeExport(root) {
  if (!root || typeof root.traverse !== 'function') {
    return 0;
  }
  /** @type {THREE.Object3D[]} */
  const toRemove = [];
  root.traverse((obj) => {
    if (
      obj.isTransformControls === true
      || obj.userData?.type === 'helperBoxEdge'
      || isFatLineExampleObject(obj)
    ) {
      toRemove.push(obj);
    }
  });
  for (let i = 0; i < toRemove.length; i++) {
    const o = toRemove[i];
    const par = o.parent;
    if (par) {
      par.remove(o);
    }
  }
  return toRemove.length;
}

const IGNORED_OBJ_TYPE_AS_MODEL_FILE = new Set([
  'externalmodel',
  'skinned',
  'points',
  'particles',
  'particle',
  'plane',
  'wind',
  'line',
  'sprite',
  'tube',
  'instanced',
  'domain',
  'group',
  'audio'
]);

const EXTERNAL_FILE_MODEL_EXTENSIONS = new Set(['obj', 'gltf', 'glb', 'fbx', 'dae', 'stl', 'ply']);

/**
 * @param {string|undefined|null} modelPath
 * @returns {string}
 */
function inferExternalModelTypeFromPath(modelPath) {
  if (typeof modelPath !== 'string') {
    return '';
  }
  const normalized = modelPath.trim().split(/[?#]/)[0];
  const dotIndex = normalized.lastIndexOf('.');
  if (dotIndex < 0 || dotIndex >= normalized.length - 1) {
    return '';
  }
  return normalized.slice(dotIndex + 1).trim().toLowerCase();
}

/**
 * @param {object|null|undefined} modelInfo
 * @returns {string}
 */
function resolveExternalModelTypeForExport(modelInfo) {
  if (!modelInfo || typeof modelInfo !== 'object') {
    return '';
  }
  const candidates = [modelInfo.modelFileType, modelInfo.fileType, modelInfo.objType];
  for (let i = 0; i < candidates.length; i++) {
    if (typeof candidates[i] !== 'string') {
      continue;
    }
    const normalized = candidates[i].trim().toLowerCase();
    if (normalized && !IGNORED_OBJ_TYPE_AS_MODEL_FILE.has(normalized)) {
      return normalized;
    }
  }
  return inferExternalModelTypeFromPath(modelInfo.modelPath);
}

/**
 * @param {object|null|undefined} objJson
 * @returns {boolean}
 */
function isExternalFileModelDescriptor(objJson) {
  if (!objJson || typeof objJson !== 'object') {
    return false;
  }
  const objType = typeof objJson.objType === 'string' ? objJson.objType.trim().toLowerCase() : '';
  if (objType === 'externalmodel') {
    return typeof objJson.modelPath === 'string' && objJson.modelPath.trim() !== '';
  }
  const modelPath = objJson.modelPath;
  if (typeof modelPath !== 'string' || modelPath.trim() === '') {
    return false;
  }
  const fileType = resolveExternalModelTypeForExport(objJson);
  if (!fileType) {
    return false;
  }
  if (EXTERNAL_FILE_MODEL_EXTENSIONS.has(fileType) || isThreeNativeJsonFileType(fileType)) {
    return true;
  }
  return false;
}

/**
 * @param {THREE.Object3D|null|undefined} obj
 * @returns {boolean}
 */
function isExternalFileModelExportRoot(obj) {
  const box = obj?.userData?.objJson;
  if (!isExternalFileModelDescriptor(box)) {
    return false;
  }
  let par = obj.parent;
  while (par) {
    const parentBox = par.userData?.objJson;
    if (isExternalFileModelDescriptor(parentBox)) {
      const childPath = typeof box.modelPath === 'string' ? box.modelPath.trim() : '';
      const parentPath = typeof parentBox.modelPath === 'string' ? parentBox.modelPath.trim() : '';
      if (childPath && parentPath && childPath === parentPath) {
        return false;
      }
    }
    par = par.parent;
  }
  return true;
}

/**
 * @param {THREE.Object3D|null|undefined} obj
 * @returns {number}
 */
function countSubtreeTriangles(obj) {
  if (!obj || typeof obj.traverse !== 'function') {
    return 0;
  }
  let triangles = 0;
  obj.traverse((node) => {
    if (!node?.isMesh || !node.geometry) {
      return;
    }
    const geometry = node.geometry;
    if (geometry.index?.count) {
      triangles += Math.floor(geometry.index.count / 3);
      return;
    }
    const pos = geometry.attributes?.position;
    if (pos?.count) {
      triangles += Math.floor(pos.count / 3);
    }
  });
  return triangles;
}

/**
 * @param {THREE.Object3D|null|undefined} obj
 * @returns {{ objectCount: number, meshCount: number, triangleCount: number }}
 */
function measureNativeExportSubtreeComplexity(obj) {
  if (!obj || typeof obj.traverse !== 'function') {
    return { objectCount: 0, meshCount: 0, triangleCount: 0 };
  }
  let objectCount = 0;
  let meshCount = 0;
  let triangleCount = 0;
  obj.traverse((node) => {
    objectCount += 1;
    if (!node?.isMesh || !node.geometry) {
      return;
    }
    meshCount += 1;
    const geometry = node.geometry;
    if (geometry.index?.count) {
      triangleCount += Math.floor(geometry.index.count / 3);
      return;
    }
    const pos = geometry.attributes?.position;
    if (pos?.count) {
      triangleCount += Math.floor(pos.count / 3);
    }
  });
  return { objectCount, meshCount, triangleCount };
}

/**
 * @param {{ objectCount: number, meshCount: number, triangleCount: number }} complexity
 * @param {object} [options]
 * @returns {boolean}
 */
function shouldOmitExternalModelForNativeExport(complexity, options = {}) {
  const maxExternalSubtreeTriangles = Number.isFinite(options.maxExternalSubtreeTriangles)
    ? options.maxExternalSubtreeTriangles
    : 40000;
  const maxExternalSubtreeObjects = Number.isFinite(options.maxExternalSubtreeObjects)
    ? options.maxExternalSubtreeObjects
    : 800;
  const maxExternalSubtreeMeshes = Number.isFinite(options.maxExternalSubtreeMeshes)
    ? options.maxExternalSubtreeMeshes
    : 200;
  if (complexity.triangleCount > maxExternalSubtreeTriangles) {
    return true;
  }
  if (complexity.objectCount > maxExternalSubtreeObjects) {
    return true;
  }
  if (complexity.meshCount > maxExternalSubtreeMeshes) {
    return true;
  }
  return false;
}

/**
 * Before native JSON export, drop overweight external model subtrees (OBJ/GLTF, etc.) and oversized non-external subtrees to avoid toJSON + stringify limits.
 *
 * @param {THREE.Object3D} root Usually the return value of `cloneSceneGraphForNativeExport`
 * @param {object} [options]
 * @param {number} [options.maxSubtreeTriangles=100000] Also remove non-external subtrees above this triangle count (0 disables)
 * @param {number} [options.maxExternalSubtreeTriangles=40000]
 * @param {number} [options.maxExternalSubtreeObjects=800]
 * @param {number} [options.maxExternalSubtreeMeshes=200]
 * @returns {{ removedCount: number, omitted: Array<object> }}
 */
function omitExternalFileModelsForNativeExport(root, options = {}) {
  /** @type {Array<{ name: string, modelPath: string, reason: string }>} */
  const omitted = [];
  if (!root || typeof root.traverse !== 'function') {
    return { removedCount: 0, omitted };
  }

  const maxSubtreeTriangles = Number.isFinite(options.maxSubtreeTriangles)
    ? options.maxSubtreeTriangles
    : 100000;

  /** @type {THREE.Object3D[]} */
  const toRemove = [];

  /**
   * @param {THREE.Object3D} obj
   * @returns {boolean}
   */
  function isUnderPendingRemoval(obj) {
    for (let i = 0; i < toRemove.length; i++) {
      let p = obj.parent;
      while ( p) {
        if (p === toRemove[i]) {
          return true;
        }
        p = p.parent;
      }
    }
    return false;
  }

  root.traverse((obj) => {
    if (obj === root || isUnderPendingRemoval(obj)) {
      return;
    }
    if (isExternalFileModelExportRoot(obj)) {
      const complexity = measureNativeExportSubtreeComplexity(obj);
      if (shouldOmitExternalModelForNativeExport(complexity, options)) {
        toRemove.push(obj);
      }
      return;
    }
    if (maxSubtreeTriangles > 0 && countSubtreeTriangles(obj) > maxSubtreeTriangles) {
      toRemove.push(obj);
    }
  });

  const filtered = [];
  for (let i = 0; i < toRemove.length; i++) {
    const candidate = toRemove[i];
    let isChild = false;
    for (let j = 0; j < toRemove.length; j++) {
      if (i === j) {
        continue;
      }
      let p = candidate.parent;
      while (p) {
        if (p === toRemove[j]) {
          isChild = true;
          break;
        }
        p = p.parent;
      }
      if (isChild) {
        break;
      }
    }
    if (!isChild) {
      filtered.push(candidate);
    }
  }

  for (let i = 0; i < filtered.length; i++) {
    const obj = filtered[i];
    const box = obj.userData?.objJson;
    const isExternal = isExternalFileModelExportRoot(obj);
    const complexity = isExternal ? measureNativeExportSubtreeComplexity(obj) : null;
    omitted.push({
      name: obj.name || box?.name || obj.uuid.slice(0, 8),
      modelPath: typeof box?.modelPath === 'string' ? box.modelPath : '',
      reason: isExternal ? 'complexity' : 'triangleBudget',
      objectCount: complexity?.objectCount ?? 0,
      meshCount: complexity?.meshCount ?? 0,
      triangleCount: complexity?.triangleCount ?? countSubtreeTriangles(obj)
    });
    const par = obj.parent;
    if (par) {
      par.remove(obj);
    }
  }

  return { removedCount: filtered.length, omitted };
}

/** Rough estimate of serialized toJSON character count (export safety guard). */
const NATIVE_EXPORT_JSON_CHAR_SOFT_LIMIT = 50_000_000;

/**
 * @param {object|null|undefined} payload Root object from `Object3D.toJSON()`
 * @returns {number}
 */
function estimateThreeNativeJsonPayloadChars(payload) {
  if (!payload || typeof payload !== 'object') {
    return 0;
  }
  let rough = 4096;
  const geometries = Array.isArray(payload.geometries) ? payload.geometries : [];
  for (let gi = 0; gi < geometries.length; gi++) {
    const g = geometries[gi];
    const attrs = g?.data?.attributes || g?.attributes;
    if (!attrs || typeof attrs !== 'object') {
      continue;
    }
    const keys = Object.keys(attrs);
    for (let ki = 0; ki < keys.length; ki++) {
      const arr = attrs[keys[ki]]?.array;
      if (Array.isArray(arr)) {
        rough += arr.length * 10;
      }
    }
  }
  const images = Array.isArray(payload.images) ? payload.images : [];
  for (let ii = 0; ii < images.length; ii++) {
    const url = images[ii]?.url;
    if (typeof url === 'string') {
      rough += url.length;
    } else if (Array.isArray(url)) {
      for (let u = 0; u < url.length; u++) {
        if (typeof url[u] === 'string') {
          rough += url[u].length;
        }
      }
    }
  }
  return rough;
}

/**
 * Clone the scene graph for Three.js native JSON export (shared geometry/material) and strip non-serializable nodes.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.Object3D[]|null|undefined} [tempDetachDirectChildrenFromScene] Wraps only `scene.clone(true)`: if a direct child of scene, **briefly remove** it before clone and **add** back immediately after (success or failure). Avoids recursive `clone()` errors from `TransformControls` (e.g. touchAction).
 * @returns {THREE.Scene}
 */
/**
 * Fill in `threeJsonId` on a single object descriptor when missing.
 *
 * @param {object} record
 * @returns {object} Same record reference
 */
function ensureThreeJsonIdOnRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return record;
  }
  if (typeof record.threeJsonId === "string" && record.threeJsonId.trim().length > 0) {
    return record;
  }
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    record.threeJsonId = crypto.randomUUID();
  } else {
    record.threeJsonId = `tj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }
  return record;
}

/**
 * Assign stable string IDs to descriptor nodes missing `threeJsonId` (optional field; call before load/merge).
 * Does not change Three `Object3D.uuid`; IDs persist on JSON nodes alongside `objJson`.
 *
 * @param {object} payload Typically the ThreeJSON root object (includes worldInfo)
 * @returns {object} Same payload reference
 */
function ensureThreeJsonIdsOnScenePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const wi = payload.worldInfo && typeof payload.worldInfo === 'object' ? payload.worldInfo : {};
  const rootFriendlyMap = payload.friendlyMap && typeof payload.friendlyMap === 'object' ? payload.friendlyMap : {};
  const worldFriendlyMap = wi.friendlyMap && typeof wi.friendlyMap === 'object' ? wi.friendlyMap : {};

  const seen = new Set();

  function randomId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `tj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }

  function allocId() {
    let id;
    do {
      id = randomId();
    } while (seen.has(id));
    seen.add(id);
    return id;
  }

  function collectExisting(obj) {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        collectExisting(obj[i]);
      }
      return;
    }
    if (typeof obj.threeJsonId === 'string' && obj.threeJsonId.length > 0) {
      seen.add(obj.threeJsonId);
    }
    const nestedKeys = ['subScene', 'joins', 'inters', 'holes', 'css3dPanelList'];
    for (let nk = 0; nk < nestedKeys.length; nk++) {
      const arr = obj[nestedKeys[nk]];
      if (Array.isArray(arr)) {
        for (let j = 0; j < arr.length; j++) {
          collectExisting(arr[j]);
        }
      }
    }
  }

  const topLists = [
    'objectList',
    'modelList',
    'boxModelList',
    'sphereModelList',
    'groupList',
    'lineList',
    'heatList',
    'windList',
    'shaderSurfaceList',
    'planeList',
    'particleList',
    'spriteList',
    'tubeList',
    'instancedList',
    'skinnedList',
    'infoPanelList',
    'css3dPanelList',
    'objModelList',
    'externalModelList'
  ];
  const customListNames = Array.from(new Set([
    ...Object.keys(rootFriendlyMap),
    ...Object.keys(worldFriendlyMap)
  ]));
  for (let ci = 0; ci < customListNames.length; ci++) {
    if (!topLists.includes(customListNames[ci])) {
      topLists.push(customListNames[ci]);
    }
  }

  function getListByName(name) {
    const topLevelList = payload[name];
    if (Array.isArray(topLevelList)) {
      return topLevelList;
    }
    const worldList = wi[name];
    if (Array.isArray(worldList)) {
      return worldList;
    }
    return null;
  }

  for (let li = 0; li < topLists.length; li++) {
    const arr = getListByName(topLists[li]);
    if (arr) {
      collectExisting(arr);
    }
  }
  if (Array.isArray(wi.domainModelList)) {
    for (let di = 0; di < wi.domainModelList.length; di++) {
      const dom = wi.domainModelList[di];
      collectExisting(dom);
      if (dom && typeof dom === 'object') {
        if (dom.payload != null && typeof dom.payload === 'object') {
          collectExisting(dom.payload);
        }
        if (Array.isArray(dom.items)) {
          collectExisting(dom.items);
        }
      }
    }
  }

  function assignIfModelDescriptor(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return;
    }
    const groupLike =
      Array.isArray(obj.boxModelList) ||
      Array.isArray(obj.subGroup);
    const leafLike =
      typeof obj.objType === 'string' ||
      (obj.geometry != null && typeof obj.geometry === 'object');
    if (!groupLike && !leafLike) {
      return;
    }
    if (typeof obj.threeJsonId !== 'string' || obj.threeJsonId.length === 0) {
      obj.threeJsonId = allocId();
    } else if (!seen.has(obj.threeJsonId)) {
      seen.add(obj.threeJsonId);
    }
  }

  function visit(obj) {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        visit(obj[i]);
      }
      return;
    }
    if (
      obj.domain != null &&
      obj.handler != null &&
      obj.payload != null &&
      typeof obj.payload === 'object'
    ) {
      visit(obj.payload);
      if (Array.isArray(obj.items)) {
        visit(obj.items);
      }
      return;
    }
    assignIfModelDescriptor(obj);
    const nestedKeys = ['subScene', 'joins', 'inters', 'holes', 'css3dPanelList'];
    for (let nk = 0; nk < nestedKeys.length; nk++) {
      const arr = obj[nestedKeys[nk]];
      if (Array.isArray(arr)) {
        visit(arr);
      }
    }
  }

  for (let li = 0; li < topLists.length; li++) {
    const arr = getListByName(topLists[li]);
    if (arr) {
      visit(arr);
    }
  }
  if (Array.isArray(wi.domainModelList)) {
    visit(wi.domainModelList);
  }

  return payload;
}

const PERSIST_WORLD_INFO_LIST_KEYS = [
  "boxModelList",
  "sphereModelList",
  "groupList",
  "lineList",
  "heatList",
  "windList",
  "infoPanelList",
  "objModelList",
  "audioList"
];

/**
 * Assemble an export root copy with worldInfo list semantics primary: lists from canvas snapshot, other worldInfo keys and root fields copied from sanitized in-memory document.
 * By default removes `worldInfo.nativeSceneList` (secondary path embedding full Three `toJSON`).
 *
 * @param {object|null|undefined} rootPayload Usually `sysConfig.jsonData`
 * @param {object|null|undefined} worldInfoFromScene Return value of `collectCurrentWorldInfo()`
 * @param {object} [options]
 * @param {boolean} [options.omitSceneInfoList=true]
 * @param {object|null|undefined} [options.existingSaveMeta]
 * @returns {object}
 */
function buildPersistPayloadWorldInfoPrimary(rootPayload, worldInfoFromScene, options = {}) {
  const omitSceneInfoList = options.omitSceneInfoList !== false;
  const base = sanitizePlainData(rootPayload || {}) || {};
  const wiMem = rootPayload?.worldInfo;
  const baseWi = sanitizePlainData(wiMem && typeof wiMem === 'object' ? wiMem : {}) || {};
  const freshPlain =
    sanitizePlainData(worldInfoFromScene && typeof worldInfoFromScene === 'object' ? worldInfoFromScene : {}) ||
    {};
  const fresh = sanitizeWorldInfoForExport(freshPlain) || {};

  const mergedWi = {
    ...baseWi,
    ...fresh,
    domainModelList: mergeDomainModelList(baseWi.domainModelList, fresh.domainModelList)
  };
  for (let li = 0; li < PERSIST_WORLD_INFO_LIST_KEYS.length; li += 1) {
    const key = PERSIST_WORLD_INFO_LIST_KEYS[li];
    mergedWi[key] = mergeWorldInfoModelListByIdentity(baseWi[key], fresh[key]);
  }

  if (omitSceneInfoList && mergedWi && typeof mergedWi === 'object') {
    delete mergedWi.nativeSceneList;
  }
  if (mergedWi && typeof mergedWi === 'object') {
    delete mergedWi.cameraPosition;
    delete mergedWi.camera;
    delete mergedWi.controls;
    delete mergedWi.orbitControls;
  }

  base.worldInfo = mergedWi;
  const prevMeta = sanitizePlainData(options.existingSaveMeta || rootPayload?.saveMeta) || {};
  base.saveMeta = {
    ...prevMeta,
    exportMode: 'worldinfo_primary',
    exportedAt: new Date().toISOString()
  };
  return base;
}

/**
 * Node filter aligned with editor default skip rules (does not compare against a specific helper instance reference).
 *
 * @param {THREE.Object3D|null|undefined} obj
 * @returns {boolean} true when the node is excluded from the scene tree
 */
function defaultShouldSkipEditorSceneTreeNode(obj) {
  if (!obj) {
    return true;
  }
  if (obj.isTransformControls || obj.type === 'TransformControls') {
    return true;
  }
  if (obj.userData?.type === 'helperBoxEdge') {
    return true;
  }
  if (obj.type === 'AxesHelper' || obj.type === 'GridHelper' || obj.type === 'BoxHelper') {
    return true;
  }
  if (obj.userData?.objJson?.objType === 'light') {
    return true;
  }
  if (
    obj.userData?.objJson?.objType === 'gridHelper'
    || obj.userData?.objJson?.objType === 'axesHelper'
    || obj.userData?.objJson?.objType === 'boxHelper'
  ) {
    return true;
  }
  return false;
}

/**
 * Build a plain JSON-serializable scene tree (nested children) from the current `THREE.Scene`, for editor UI or debugging.
 *
 * @param {THREE.Scene|null|undefined} scene
 * @param {object} [options]
 * @param {(obj: THREE.Object3D) => boolean} [options.shouldSkipObject] When true, skip the node and its subtree
 * @param {(obj: THREE.Object3D) => boolean} [options.transparentSkipObject] When true, omit this node row but hoist its children to the parent (e.g. managed root containers)
 * @param {boolean} [options.includeAnonymous=false] Whether to emit a placeholder when there is no `userData.objJson` and no retained children
 * @returns {Array<{ uuid: string, name: string, objType?: string, threeJsonId?: string, depth: number, children: object[] }>}
 */
function buildEditorSceneTreePlain(scene, options = {}) {
  const shouldSkip =
    typeof options.shouldSkipObject === 'function'
      ? options.shouldSkipObject
      : defaultShouldSkipEditorSceneTreeNode;
  const transparentSkip =
    typeof options.transparentSkipObject === 'function'
      ? options.transparentSkipObject
      : () => false;
  const includeAnonymous = options.includeAnonymous === true;

  /**
   * @param {Array<object>} out
   * @param {object|object[]|null} result
   */
  function appendVisitResult(out, result) {
    if (!result) {
      return;
    }
    if (Array.isArray(result)) {
      for (let i = 0; i < result.length; i++) {
        out.push(result[i]);
      }
      return;
    }
    out.push(result);
  }

  /**
   * @param {THREE.Object3D} obj
   * @param {number} depth
   * @returns {object|object[]|null}
   */
  function visit(obj, depth) {
    if (!obj) {
      return null;
    }
    const transparent = transparentSkip(obj);
    if (shouldSkip(obj) && !transparent) {
      return null;
    }
    const box = obj.userData?.objJson;
    const childrenOut = [];
    const ch = obj.children;
    if (ch && ch.length) {
      for (let i = 0; i < ch.length; i++) {
        appendVisitResult(childrenOut, visit(ch[i], depth + 1));
      }
    }
    if (transparent) {
      return childrenOut.length > 0 ? childrenOut : null;
    }
    const hasDescriptor = box && typeof box === 'object';
    if (!hasDescriptor && childrenOut.length === 0 && !includeAnonymous) {
      return null;
    }
    return {
      uuid: obj.uuid,
      name: obj.name || (typeof box?.name === 'string' ? box.name : '') || '',
      objType: (typeof box?.objType === 'string' ? box.objType : undefined) || obj.type,
      threeJsonId: typeof box?.threeJsonId === 'string' ? box.threeJsonId : undefined,
      depth,
      children: childrenOut
    };
  }

  if (!scene || !scene.children || !scene.children.length) {
    return [];
  }
  const roots = [];
  for (let i = 0; i < scene.children.length; i++) {
    appendVisitResult(roots, visit(scene.children[i], 0));
  }
  return roots;
}

/**
 * Normalize human-friendly JSON into standard `objectList` form.
 * Util-layer wrapper only; conversion logic reuses `sceneFriendlyNormalizer`.
 *
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function convertFriendlyJsonToStandardJson(payload) {
  const sourcePayload = sanitizePlainData(payload || {}) || {};
  const {
    buildStandardScenePayloadFromCanonical,
    normalizeScenePayload
  } = await import('../handler/sceneFriendlyNormalizer.js');
  const normalized = normalizeScenePayload(sourcePayload);
  return sanitizePlainData(
    buildStandardScenePayloadFromCanonical(sourcePayload, normalized.payload)
  ) || {};
}

/**
 * Project standard `objectList` JSON into human-friendly JSON.
 * Optional `friendlyMap` uses the same mapping rule format as friendly JSON.
 *
 * @param {object} payload Standard ThreeJSON, or a payload normalizable to standard form via the unified entry
 * @param {object} [friendlyMap]
 * @returns {Promise<object>}
 */
async function convertStandardJsonToFriendlyJson(payload, friendlyMap) {
  const sourcePayload = sanitizePlainData(payload || {}) || {};
  const mapConfig = sanitizePlainData(friendlyMap || {}) || {};
  const {
    buildFriendlyScenePayloadFromCanonical,
    normalizeScenePayload
  } = await import('../handler/sceneFriendlyNormalizer.js');
  const normalized = normalizeScenePayload(sourcePayload);
  return sanitizePlainData(
    buildFriendlyScenePayloadFromCanonical(sourcePayload, normalized.payload, {
      friendlyMap: mapConfig
    })
  ) || {};
}

function cloneSceneGraphForNativeExport(scene, tempDetachDirectChildrenFromScene) {
  const detachList = Array.isArray(tempDetachDirectChildrenFromScene) ? tempDetachDirectChildrenFromScene : [];
  /** @type {THREE.Object3D[]} */
  const stashed = [];
  for (let i = 0; i < detachList.length; i++) {
    const obj = detachList[i];
    if (obj && obj.parent === scene) {
      scene.remove(obj);
      stashed.push(obj);
    }
  }
  /** @type {THREE.Scene} */
  let root;
  try {
    root = scene.clone(true);
    stripNonSerializableNodesForNativeExport(root);
    return root;
  } finally {
    for (let si = 0; si < stashed.length; si++) {
      scene.add(stashed[si]);
    }
  }
}

/**
 * Sync root-level `visible` from a JSON descriptor onto Object3D and single/multi-material Mesh.
 * @param {import('three').Object3D} object3D
 * @param {{ visible?: boolean }} descriptor
 */
function applyVisibilityFromDescriptor(object3D, descriptor) {
  if (!object3D || !descriptor || typeof descriptor.visible !== 'boolean') {
    return;
  }
  const v = descriptor.visible;
  object3D.visible = v;
  if (object3D.isMesh && object3D.material) {
    const mats = Array.isArray(object3D.material) ? object3D.material : [object3D.material];
    for (let i = 0; i < mats.length; i++) {
      if (mats[i]) {
        mats[i].visible = v;
      }
    }
  }
}

export {
  applyVisibilityFromDescriptor,
  hasValue,
  valueOr,
  listOr,
  parseFilePathParts,
  getFileNameFromPath,
  getDirectoryPathFromPath,
  getFileExtensionFromPath,
  buildFloatingInfoPanel,
  buildAdaptiveContentBoundingBoxTHREE,
  fitPerspectiveCameraToContentBoundsTHREE,
  DEFAULT_ADAPTIVE_SKIP_OBJ_TYPES,
  stripNonSerializableNodesForNativeExport,
  omitExternalFileModelsForNativeExport,
  measureNativeExportSubtreeComplexity,
  shouldOmitExternalModelForNativeExport,
  estimateThreeNativeJsonPayloadChars,
  NATIVE_EXPORT_JSON_CHAR_SOFT_LIMIT,
  cloneSceneGraphForNativeExport,
  ensureThreeJsonIdOnRecord,
  ensureThreeJsonIdsOnScenePayload,
  buildPersistPayloadWorldInfoPrimary,
  mergeWorldInfoModelListByIdentity,
  convertFriendlyJsonToStandardJson,
  convertStandardJsonToFriendlyJson,
  buildEditorSceneTreePlain,
  defaultShouldSkipEditorSceneTreeNode
};
