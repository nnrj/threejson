/**
 * Three.js native Object / Scene JSON (Object3D.toJSON / Editor export) loading.
 * ObjectLoader is exported from the `three` main package since r153; no longer uses examples/jsm path.
 */

import { ImageUtils, ObjectLoader } from "three";
import { log } from "../util/logger.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject } from "../handler/objectRegistry.js";
import { applyObjectTransform } from "./heatmap/heatmapTexture.js";

/** Common Mesh*Material texture slots (probed per slot; unsupported materials get undefined). */
const MATERIAL_TEXTURE_SLOTS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
  "bumpMap",
  "displacementMap",
  "alphaMap",
  "lightMap",
  "envMap",
  "specularMap",
  "gradientMap",
  "clearcoatNormalMap",
  "transmissionMap",
  "sheenColorMap",
  "sheenRoughnessMap",
  "anisotropyMap",
  "clearcoatMap",
  "iridescenceMap",
  "iridescenceThicknessMap"
];

/**
 * Only addresses that are hard to resolve after saving JSON locally are inlined as data URLs.
 * Relative paths, site-root paths, etc. are kept as-is so users can bundle JSON with resource folders.
 * @param {string} s
 */
function textureUrlNeedsPortableReplacement(s) {
  if (typeof s !== "string" || s.length === 0) {
    return false;
  }
  if (/^data:/i.test(s)) {
    return false;
  }
  if (/^blob:/i.test(s)) {
    return true;
  }
  if (/^https?:\/\//i.test(s) || s.startsWith("//")) {
    return true;
  }
  return false;
}

/**
 * @param {HTMLImageElement | HTMLCanvasElement | ImageBitmap | null | undefined} image
 * @returns {string|null}
 */
function imageBitmapLikeToDataUrl(image) {
  if (image == null) {
    return null;
  }
  try {
    if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) {
      const src = image.src;
      if (typeof src === "string" && /^data:/i.test(src)) {
        return src;
      }
      return ImageUtils.getDataURL(image);
    }
    if (typeof HTMLCanvasElement !== "undefined" && image instanceof HTMLCanvasElement) {
      return ImageUtils.getDataURL(image);
    }
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
      return ImageUtils.getDataURL(image);
    }
  } catch (_e) {
    return null;
  }
  return null;
}

/**
 * @param {import("three").Texture} tex
 * @param {Map<string, string|string[]>} outUuidToPortable
 */
function registerTextureSourcePortableUrls(tex, outUuidToPortable) {
  if (!tex || !tex.isTexture || !tex.source || typeof tex.source.uuid !== "string") {
    return;
  }
  if (outUuidToPortable.has(tex.source.uuid)) {
    return;
  }
  const data = tex.source.data;
  if (Array.isArray(data)) {
    const parts = [];
    for (let i = 0; i < data.length; i++) {
      const du = imageBitmapLikeToDataUrl(data[i]);
      if (!du) {
        return;
      }
      parts.push(du);
    }
    outUuidToPortable.set(tex.source.uuid, parts);
    return;
  }
  const one = imageBitmapLikeToDataUrl(data);
  if (!one) {
    return;
  }
  outUuidToPortable.set(tex.source.uuid, one);
}

/**
 * @param {import("three").Material} m
 * @param {Map<string, string|string[]>} outUuidToPortable
 */
function collectPortableUrlsFromMaterial(m, outUuidToPortable) {
  if (!m || m.isMaterial !== true) {
    return;
  }
  for (let si = 0; si < MATERIAL_TEXTURE_SLOTS.length; si++) {
    const key = MATERIAL_TEXTURE_SLOTS[si];
    const t = m[key];
    if (t && t.isTexture === true) {
      registerTextureSourcePortableUrls(t, outUuidToPortable);
    }
  }
}

/**
 * Replace `images[].url` addresses in export JSON that are usually unavailable off-site (`http(s)` / `//` / `blob:`) with in-memory texture data URLs when collectible.
 * Relative paths, `data:`, empty strings, etc. stay unchanged; **URL is not modified on collection failure** (no placeholder PNG).
 * **Must pass the root node on the same object graph as `toJSON()`** (e.g. return value of `cloneSceneGraphForNativeExport`):
 * Using the editor `scene` for uuid alignment fails because `clone` copies `Source` with new uuids mismatched to JSON, so replacement never runs (`patched` stays 0).
 *
 * @param {import("three").Scene|import("three").Object3D} objectTreeRoot Same clone/subgraph root as `payload` source
 * @param {object} payload toJSON root object usable by `ObjectLoader`
 * @returns {{ patched: number, sourceMapSize: number }}
 */
export function embedPortableImageUrlsIntoThreeExportJson(objectTreeRoot, payload) {
  if (!objectTreeRoot || !payload || !Array.isArray(payload.images)) {
    return { patched: 0, sourceMapSize: 0 };
  }

  /** @type {Map<string, string|string[]>} */
  const bySourceUuid = new Map();
  objectTreeRoot.traverse((obj) => {
    const mats = obj.material;
    if (!mats) {
      return;
    }
    const list = Array.isArray(mats) ? mats : [mats];
    for (let i = 0; i < list.length; i++) {
      collectPortableUrlsFromMaterial(list[i], bySourceUuid);
    }
  });

  let patched = 0;
  const images = payload.images;
  for (let ii = 0; ii < images.length; ii++) {
    const entry = images[ii];
    if (!entry || typeof entry.uuid !== "string") {
      continue;
    }
    const rep = bySourceUuid.get(entry.uuid);
    if (rep === undefined) {
      continue;
    }

    if (typeof entry.url === "string") {
      if (!textureUrlNeedsPortableReplacement(entry.url)) {
        continue;
      }
      if (typeof rep === "string") {
        entry.url = rep;
        patched += 1;
      }
    } else if (Array.isArray(entry.url) && Array.isArray(rep)) {
      for (let j = 0; j < entry.url.length && j < rep.length; j++) {
        if (typeof entry.url[j] !== "string" || !textureUrlNeedsPortableReplacement(entry.url[j])) {
          continue;
        }
        const r = rep[j];
        if (typeof r === "string") {
          entry.url[j] = r;
          patched += 1;
        }
      }
    }
  }

  return { patched, sourceMapSize: bySourceUuid.size };
}

/** @typedef {import("three").LoadingManager} LoadingManager */

/**
 * Whether fileType is native Three JSON.
 * @param {string | undefined | null} fileType
 * @returns {boolean}
 */
export function isThreeNativeJsonFileType(fileType) {
  if (fileType == null || typeof fileType !== "string") {
    return false;
  }
  const ft = fileType.trim().toLowerCase();
  return ft === "three" || ft === "threejson" || ft === "object";
}

/**
 * Whether root object is ObjectLoader format from Three.js `Object3D.toJSON()` / `Scene.toJSON()` export
 *(metadata + object, usually geometries/materials, etc.), not a ThreeJSON worldInfo package.
 * @param {unknown} data
 * @returns {boolean}
 */
export function isThreeJsObjectExportJson(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  if (data.worldInfo && typeof data.worldInfo === "object") {
    return false;
  }
  const meta = data.metadata;
  if (!meta || typeof meta !== "object") {
    return false;
  }
  const root = data.object;
  if (!root || typeof root !== "object" || typeof root.type !== "string" || !root.type) {
    return false;
  }
  if (
    Array.isArray(data.geometries) ||
    Array.isArray(data.materials) ||
    meta.type === "Object" ||
    typeof meta.version === "number" ||
    (typeof meta.generator === "string" && meta.generator.length > 0)
  ) {
    return true;
  }
  return false;
}

/**
 * Normalize parsed JSON into ingestible ThreeJSON scene package; native ObjectLoader JSON auto-wrapped in nativeThree.parseInline.
 * @param {unknown} parsed
 * @param {{ label?: string, threeJsonId?: string }} [options]
 * @returns {object}
 */
export function resolveScenePayloadForLoad(parsed, options = {}) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  if (isThreeJsObjectExportJson(parsed)) {
    return buildMinimalWorldJsonForNativeThreeInline(parsed, {
      label: options.label,
      threeJsonId: options.threeJsonId
    });
  }
  return parsed;
}

/**
 * Load URL via ObjectLoader (Object/Scene metadata.type !== 'geometry').
 * @param {{
 *   modelPath: string,
 *   position?: object,
 *   rotation?: object,
 *   scale?: object,
 *   visible?: boolean,
 *   resourcePath?: string,
 *   path?: string
 * }} objInfo aligned with OBJ / GLTF entries; `resourcePath` is relative texture/resource base path (optional).
 * @param {import("three").Scene} scene
 * @param {{ loadingManager?: LoadingManager }} [deps={}]
 */
export function loadThreeNativeObjectJsonFromUrl(objInfo, scene, deps = {}) {
  if (!objInfo?.modelPath || !scene) {
    return;
  }
  const manager = deps.loadingManager ?? undefined;
  const loader = manager ? new ObjectLoader(manager) : new ObjectLoader();

  if (typeof objInfo.path === "string" && objInfo.path !== "") {
    loader.setPath(objInfo.path);
  }
  const rp = typeof objInfo.resourcePath === "string" ? objInfo.resourcePath.trim() : "";
  if (rp !== "") {
    loader.setResourcePath(rp.endsWith("/") ? rp : `${rp}/`);
  }

  if (typeof objInfo.crossOrigin === "string") {
    loader.setCrossOrigin(objInfo.crossOrigin);
  }

  function finish(root) {
    trackDisposableResource(root);
    applyObjectTransform(root, objInfo);
    root.visible = false !== objInfo.visible;
    scene.add(root);
    registerObject(root, objInfo);
  }

  loader.load(
    objInfo.modelPath,
    (object) => {
      finish(object);
    },
    undefined,
    (err) => {
      log.error("Three native JSON load failed:", objInfo.modelPath, err);
    }
  );
}

/**
 * Async parse in-memory Object/Scene JSON (suitable for fetch-then-add-to-scene).
 * @param {object} json
 * @param {import("three").Scene} scene
 * @param {{
 *   position?: object,
 *   rotation?: object,
 *   scale?: object,
 *   visible?: boolean,
 *   resourcePath?: string,
 *   path?: string,
 * }} [transformOpts]
 * @param {{ loadingManager?: LoadingManager }} [deps={}]
 * @returns {Promise<import("three").Object3D>}
 */
export async function parseThreeNativeObjectJsonAndAdd(json, scene, transformOpts = {}, deps = {}) {
  if (!json || typeof json !== "object" || !scene) {
    return Promise.reject(new Error("parseThreeNativeObjectJsonAndAdd: json and scene required"));
  }
  const manager = deps.loadingManager ?? undefined;
  const loader = manager ? new ObjectLoader(manager) : new ObjectLoader();

  if (typeof transformOpts.path === "string" && transformOpts.path !== "") {
    loader.setPath(transformOpts.path);
  }
  const rp =
    typeof transformOpts.resourcePath === "string" ? transformOpts.resourcePath.trim() : "";
  if (rp !== "") {
    loader.setResourcePath(rp.endsWith("/") ? rp : `${rp}/`);
  }
  if (typeof transformOpts.crossOrigin === "string") {
    loader.setCrossOrigin(transformOpts.crossOrigin);
  }

  const object = await loader.parseAsync(json);
  trackDisposableResource(object);
  applyObjectTransform(object, transformOpts);
  object.visible = false !== transformOpts.visible;
  scene.add(object);
  registerObject(object, transformOpts);
  return object;
}

/**
 * Build minimal ThreeJSON world: single `nativeThree.parseInline` in `domainModelList` for editor/player direct ingest.
 * Does not require pre-validating `nativeObjectJson` as legal ObjectLoader data; parse failures surface via ObjectLoader / console.
 * @param {object} nativeObjectJson Object graph parseable by ObjectLoader (metadata / object, etc.)
 * @param {{
 *   label?: string,
 *   threeJsonId?: string,
 *   position?: object,
 *   rotation?: object,
 *   scale?: object,
 *   visible?: boolean,
 *   resourcePath?: string,
 *   path?: string,
 *   crossOrigin?: string
 * }} [options]
 * @returns {{ threeJsonId?: string, worldInfo: object, label?: string }}
 */
export function buildMinimalWorldJsonForNativeThreeInline(nativeObjectJson, options = {}) {
  const lists = [
    "boxModelList",
    "sphereModelList",
    "groupList",
    "lineList",
    "infoPanelList",
    "heatList",
    "windList",
    "objModelList"
  ];
  /** @type {Record<string, unknown>} */
  const worldInfo = { domainModelList: [] };
  for (let i = 0; i < lists.length; i++) {
    worldInfo[lists[i]] = [];
  }
  const record = {
    domain: "nativeThree",
    handler: "parseInline",
    json: nativeObjectJson
  };
  if (options.position) {
    record.position = options.position;
  }
  if (options.rotation) {
    record.rotation = options.rotation;
  }
  if (options.scale) {
    record.scale = options.scale;
  }
  if (options.visible !== undefined) {
    record.visible = options.visible;
  }
  if (options.resourcePath) {
    record.resourcePath = options.resourcePath;
  }
  if (options.path) {
    record.path = options.path;
  }
  if (options.crossOrigin) {
    record.crossOrigin = options.crossOrigin;
  }
  worldInfo.domainModelList.push(record);

  /** @type {{ threeJsonId?: string, worldInfo: object, label?: string }} */
  const out = {
    worldInfo
  };
  if (typeof options.threeJsonId === "string" && options.threeJsonId.trim()) {
    out.threeJsonId = options.threeJsonId.trim();
  }
  if (options.label) {
    const raw = String(options.label).trim();
    out.label = raw.replace(/\.json$/i, "") || raw;
  }
  return out;
}
