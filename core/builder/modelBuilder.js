/**
 * Model and scene object builder: boxes/spheres/lines/wind/heatmaps, deploy, external models, etc.
 * Requires Three.js r179+ (official minimum) and several examples/jsm modules.
 */
import * as THREE from 'three';
import { log } from "../util/logger.js";
import TWEEN, { createTween } from '../compat/adapters/tween.js';
import { deployByObjTypeExtension } from '../handler/sceneExtensionRegistry.js';
import {
    setupPlaneScrollMotion,
    shouldPlaneScrollFromDescriptor
} from './planeScrollMotion.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Line2} from 'three/examples/jsm/lines/Line2.js'
import {LineGeometry} from 'three/examples/jsm/lines/LineGeometry.js';
import {LineMaterial} from 'three/examples/jsm/lines/LineMaterial.js'; // Line material with configurable line width
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js'; // GLTF model loader
import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js'; // GLTF Draco decoder
import {OBJLoader} from 'three/examples/jsm/loaders/OBJLoader.js';
import {MTLLoader} from 'three/examples/jsm/loaders/MTLLoader.js';
import {
    isThreeNativeJsonFileType,
    loadThreeNativeObjectJsonFromUrl
} from './nativeObjectLoader.js';
import {
    isBufferExternalMeshType,
    parseMeshArrayBufferToObject3D,
    readMeshArrayBufferFromUrl
} from './meshImportLoaders.js';
import {loadingManager} from '../cache/loading.js';
import {trackDisposableResource} from '../handler/trackedResourceRegistry.js';
import { evaluateMeshBoolean } from '../handler/csgBrushOps.js';
import { registerObject } from '../handler/objectRegistry.js';
import { setUserDataObjJson } from '../handler/objectDescriptorAttach.js';
import { tryRegisterGltfAnimationMixers } from '../handler/animationMixerRegistry.js';
import {
    normalizeAttachTo,
    placeLoadedModelByAttachTarget,
    shouldApplyRecordTransform
} from '../handler/controls/viewModelAttach.js';
import {
    buildHeatmapTexture,
    buildHeatmapVolumeTexture,
    createHeatmapMesh,
    createHeatmapVolumeMesh,
    defaultTextureDimensions,
    defaultTextureDimensions3D,
    HEATMAP_LEGACY_COLOR_STOPS,
    HEATMAP_LEGACY_COLOR_STOPS_VOLUME
} from './heatmap/heatmapTexture.js';
import { attachGifCanvasTextureFromMaterialJson, createGifCanvasTextureFromMaterialJson } from "../util/gifAnimatedTexture.js";
import { resolveBoxDefaultTextureUrl } from "../util/boxTextureUrl.js";
import { resolvePublicAssetUrl } from "../util/assetsBase.js";
import { cloneJson } from "../util/cloneJson.js";
import {
    loadTextureFromMaterialJson,
    TEXTURE_REPEAT_DEFAULT
} from "../util/loadTextureFromMaterialJson.js";
import { materialJsonHasResolvableTexture, resolveTextureSource } from "../util/resolveTextureSource.js";
import { materialPersistSignature } from "../util/descriptorExportSanitize.js";
import { applyVisibilityFromDescriptor } from '../util/util.js';
import { createPoints as createPointsImpl, deployPoints as deployPointsImpl } from "./pointsBuilder.js";
import { normalizeLineTopology } from "../util/lineTopology.js";
import { createSprite as createSpriteImpl, deploySprite as deploySpriteImpl } from "./spriteBuilder.js";
import { createTube as createTubeImpl, deployTube as deployTubeImpl } from "./tubeBuilder.js";
import { deployInstancedMeshWithFactory } from "./instancedBuilder.js";
import { coerceMeshMaterialForRaycast } from "../util/meshPick.js";

let modelLoadingManager = loadingManager;
let textureLoader = new THREE.TextureLoader(modelLoadingManager);
trackDisposableResource(textureLoader)
/** For candidate-chain probing; no LoadingManager to avoid 404 probes polluting global progress. */
let objTextureProbeLoader = new THREE.TextureLoader();
trackDisposableResource(objTextureProbeLoader);

/**
 * Whether value is valid (not undefined and not null).
 * @param {*} value
 * @returns {boolean}
 */
function hasValue(value){
    return value !== undefined && value !== null;
}

/**
 * Return value if present, otherwise fallback.
 * @param {*} value
 * @param {*} fallback
 */
function valueOr(value, fallback){
    return hasValue(value) ? value : fallback;
}

/**
 * Extract MeshStandardMaterial PBR values from JSON material block; only finite numbers written; Three defaults otherwise.
 * @param {object|null|undefined} m
 * @returns {{ metalness?: number, roughness?: number }}
 */
function standardMaterialPbrFromJson(m) {
    if (!m || typeof m !== "object") {
        return {};
    }
    const out = {};
    if (hasValue(m.metalness)) {
        const v = Number(m.metalness);
        if (Number.isFinite(v)) {
            out.metalness = v;
        }
    }
    if (hasValue(m.roughness)) {
        const v = Number(m.roughness);
        if (Number.isFinite(v)) {
            out.roughness = v;
        }
    }
    return out;
}

/**
 * Whether to use MeshStandardMaterial (explicit `standard` type or valid metalness/roughness).
 * @param {object|null|undefined} m
 * @returns {boolean}
 */
function jsonMaterialPrefersStandardPbr(m) {
    if (!m || typeof m !== "object") {
        return false;
    }
    if (m.type === "standard") {
        return true;
    }
    return Object.keys(standardMaterialPbrFromJson(m)).length > 0;
}

/**
 * JSON `map` is often a serialization placeholder (not THREE.Texture); passing directly causes `refreshMaterialUniforms` to throw on missing map.matrix.
 * @param {*} map
 * @returns {THREE.Texture|null}
 */
function safeMaterialMap(map){
    return (map && map.isTexture === true) ? map : null;
}

/**
 * @param {object} record
 * @returns {object[]|null} Six-face material JSON (does not expand record.materials)
 */
function getBoxFaceMaterialJsonList(record) {
    if (Array.isArray(record?.materials) && record.materials.length === 6) {
        return record.materials;
    }
    if (record?.material && typeof record.material === "object") {
        const m = record.material;
        return [m, m, m, m, m, m];
    }
    return null;
}

/**
 * @param {object[]} faces
 * @returns {boolean}
 */
function boxFaceMaterialsUniform(faces) {
    if (!faces || faces.length !== 6) {
        return false;
    }
    const sig0 = materialPersistSignature(faces[0]);
    for (let i = 1; i < 6; i += 1) {
        if (materialPersistSignature(faces[i]) !== sig0) {
            return false;
        }
    }
    return true;
}

/**
 * @param {THREE.Material} threeMaterial
 * @param {object} materialJson
 * @param {object} [opts]
 */
function applyTextureFromMaterialJsonToThreeMaterial(threeMaterial, materialJson, opts = {}) {
    const tex = loadTextureFromMaterialJson(materialJson, opts);
    if (tex && threeMaterial) {
        threeMaterial.map = tex;
    }
    return tex;
}

/**
 * Fill missing textureUrl on six-face material slots (build-time record only).
 * @param {object} record
 * @returns {object[]|null}
 */
function fillMissingBoxFaceTextureUrls(record) {
    const faceJsonList = getBoxFaceMaterialJsonList(record);
    if (!faceJsonList) {
        return null;
    }
    // When six-face materials differ (e.g. AC unit front/back only), blank faces must not inherit other faces' textureUrl
    if (!boxFaceMaterialsUniform(faceJsonList)) {
        return faceJsonList;
    }
    const defaultUrl = resolveBoxDefaultTextureUrl(record);
    if (!defaultUrl) {
        return faceJsonList;
    }
    for (let i = 0; i < faceJsonList.length; i += 1) {
        const mi = faceJsonList[i];
        if (mi && !resolveTextureSource(mi)) {
            mi.textureUrl = defaultUrl;
        }
    }
    return faceJsonList;
}

/**
 * @param {object} faceJson
 * @param {boolean} objectVisible
 * @returns {THREE.Material}
 */
function buildThreeMaterialFromFaceJson(faceJson, objectVisible = true) {
    if ("dynamicBox" === faceJson.type) {
        const subMaterial = new THREE.MeshStandardMaterial({
            map: safeMaterialMap(faceJson.map),
            color: faceJson.color ? faceJson.color : "",
            transparent: faceJson.transparent ? faceJson.transparent : false,
            opacity: faceJson.opacity ? faceJson.opacity : 1,
            visible: objectVisible,
            depthTest: faceJson.depthTest ? faceJson.depthTest : true,
            ...standardMaterialPbrFromJson(faceJson)
        });
        trackDisposableResource(subMaterial);
        return subMaterial;
    }
    if ("phong" === faceJson.type) {
        const subMaterial = new THREE.MeshPhongMaterial({
            map: safeMaterialMap(faceJson.map),
            color: faceJson.color ? faceJson.color : "",
            transparent: faceJson.transparent ? faceJson.transparent : false,
            opacity: faceJson.opacity ? faceJson.opacity : 1,
            depthTest: faceJson.depthTest ? faceJson.depthTest : true
        });
        trackDisposableResource(subMaterial);
        return subMaterial;
    }
    if ("lambert" === faceJson.type) {
        const subMaterial = new THREE.MeshLambertMaterial({
            map: safeMaterialMap(faceJson.map),
            color: faceJson.color ? faceJson.color : "",
            transparent: faceJson.transparent ? faceJson.transparent : false,
            opacity: faceJson.opacity ? faceJson.opacity : 1,
            visible: objectVisible,
            depthTest: faceJson.depthTest ? faceJson.depthTest : true
        });
        trackDisposableResource(subMaterial);
        return subMaterial;
    }
    if ("standard" === faceJson.type) {
        const subMaterial = new THREE.MeshStandardMaterial({
            map: safeMaterialMap(faceJson.map),
            color: valueOr(faceJson.color, "#cccccc"),
            transparent: valueOr(faceJson.transparent, false),
            opacity: valueOr(faceJson.opacity, 1),
            visible: objectVisible,
            depthTest: valueOr(faceJson.depthTest, true),
            ...standardMaterialPbrFromJson(faceJson)
        });
        trackDisposableResource(subMaterial);
        return subMaterial;
    }
    const m = faceJson || {};
    if (jsonMaterialPrefersStandardPbr(m)) {
        const subMaterial = new THREE.MeshStandardMaterial({
            map: safeMaterialMap(m.map),
            color: m.color ? m.color : "#cccccc",
            transparent: m.transparent ? m.transparent : false,
            opacity: m.opacity ? m.opacity : 1,
            visible: objectVisible,
            depthTest: m.depthTest ? m.depthTest : true,
            ...standardMaterialPbrFromJson(m)
        });
        trackDisposableResource(subMaterial);
        return subMaterial;
    }
    const subMaterial = new THREE.MeshLambertMaterial({
        map: safeMaterialMap(m.map),
        color: m.color ? m.color : "#cccccc",
        transparent: m.transparent ? m.transparent : false,
        opacity: m.opacity ? m.opacity : 1,
        visible: objectVisible,
        depthTest: m.depthTest ? m.depthTest : true
    });
    trackDisposableResource(subMaterial);
    return subMaterial;
}

/**
 * cloneJson strips THREE.Texture; write runtime textures on material JSON pre-deploy back to clone.
 * @param {object} source
 * @param {object} record
 */
function restoreRuntimeFaceMapsAfterClone(source, record) {
    const sourceFaces = getBoxFaceMaterialJsonList(source);
    const recordFaces = getBoxFaceMaterialJsonList(record);
    if (!sourceFaces || !recordFaces || sourceFaces.length !== recordFaces.length) {
        return;
    }
    for (let i = 0; i < sourceFaces.length; i += 1) {
        const runtimeMap = safeMaterialMap(sourceFaces[i]?.map);
        if (runtimeMap) {
            recordFaces[i].map = runtimeMap;
        }
    }
}

/**
 * @param {object} record
 * @param {{ applyTexturesFromJson?: boolean }} [options]
 * @returns {{ materials: THREE.Material[], meshMaterial: THREE.Material|THREE.Material[], faceJsonList: object[]|null }}
 */
function buildBoxFaceThreeMaterials(record, options = {}) {
    const faceJsonList = getBoxFaceMaterialJsonList(record);
    const materials = [];
    if (!faceJsonList) {
        for (let i = 0; i < 6; i += 1) {
            materials.push(
                new THREE.LineBasicMaterial({
                    color: "#ffffff"
                })
            );
        }
        return { materials, meshMaterial: materials, faceJsonList: null };
    }
    for (let i = 0; i < faceJsonList.length; i += 1) {
        materials.push(buildThreeMaterialFromFaceJson(faceJsonList[i], false !== record.visible));
    }
    if (options.applyTexturesFromJson && materials.length === 6) {
        const loader = new THREE.TextureLoader(modelLoadingManager);
        const uniformFaces = boxFaceMaterialsUniform(faceJsonList);
        for (let ti = 0; ti < 6; ti += 1) {
            const srcJson = faceJsonList[uniformFaces ? 0 : ti];
            const mr = srcJson.textureRepeat || {};
            applyTextureFromMaterialJsonToThreeMaterial(materials[ti], srcJson, {
                loader,
                wrapRepeat: true,
                defaultRepeatX: valueOr(mr.x, TEXTURE_REPEAT_DEFAULT.x),
                defaultRepeatY: valueOr(mr.y, TEXTURE_REPEAT_DEFAULT.y)
            });
        }
    }
    let meshMaterial = materials;
    if (materials.length === 6 && boxFaceMaterialsUniform(faceJsonList)) {
        meshMaterial = materials[0];
    }
    return { materials, meshMaterial, faceJsonList };
}

const SINGLE_MATERIAL_PRIMITIVE_TYPES = new Set([
    "sphere",
    "cylinder",
    "cone",
    "ring",
    "torus",
    "capsule"
]);
const OBJ_TEXTURE_SLOT_NAMES = [
    "map",
    "normalMap",
    "roughnessMap",
    "metalnessMap",
    "aoMap",
    "emissiveMap",
    "bumpMap",
    "alphaMap",
    "specularMap"
];
const OBJ_STANDARD_ONLY_TEXTURE_SLOT_NAMES = new Set(["roughnessMap", "metalnessMap"]);
const OBJ_FOLDER_MAP_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp"];
const OBJ_FOLDER_MAP_NAME_CANDIDATES = {
    map: ["map", "baseColor", "albedo", "diffuse", "color"],
    normalMap: ["normalMap", "normal"],
    roughnessMap: ["roughnessMap", "roughness"],
    metalnessMap: ["metalnessMap", "metalness", "metallic"],
    aoMap: ["aoMap", "ao", "ambientOcclusion"],
    emissiveMap: ["emissiveMap", "emissive", "emission"],
    bumpMap: ["bumpMap", "bump", "height"],
    alphaMap: ["alphaMap", "alpha", "opacity"],
    specularMap: ["specularMap", "specular"]
};

/**
 * Whether non-Texture `map` string in JSON can be passed to TextureLoader as URL.
 * (Relative paths are relative to current page origin)
 * @param {string} mapStr
 * @returns {boolean}
 */
function materialMapStringResolvableAsUrl(mapStr) {
    const s = typeof mapStr === "string" ? mapStr.trim() : "";
    if (!s.length) {
        return false;
    }
    return (
        /^data:/i.test(s)
        || /^https?:\/\//i.test(s)
        || s.startsWith("//")
        || s.startsWith("/")
        || /^\.{1,2}\//.test(s)
    );
}

/**
 * Material JSON texture source: `image` (default, TextureLoader) | `video` (VideoTexture) | `gif` (CanvasTexture + gifuct-js).
 * `textureKind: "image"` with `.gif` URL still parsed as static (first frame only); explicit `gif` decodes animation.
 * @param {object|null|undefined} material
 * @returns {"image"|"video"|"gif"}
 */
function normalizeMaterialTextureKind(material) {
    const raw = material && (material.textureKind ?? material.mapSourceKind);
    const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (s === "video") {
        return "video";
    }
    if (s === "gif") {
        return "gif";
    }
    return "image";
}

/**
 * Pause and release associated `HTMLVideoElement` on `THREE.Texture.dispose`.
 * @param {THREE.Texture} texture
 * @param {HTMLVideoElement} video
 */
function wrapVideoElementTextureDispose(texture, video) {
    if (!texture || !video || typeof texture.dispose !== "function") {
        return;
    }
    const innerDispose = texture.dispose.bind(texture);
    texture.dispose = function disposeVideoBackedTexture() {
        try {
            video.pause();
            video.removeAttribute("src");
            video.load();
        } catch (_) {
            /* ignore */
        }
        innerDispose();
    };
}

/**
 * Create `VideoTexture` from material JSON and assign to `material.map` (same repeat semantics as `ensureMaterialTextureFromJson`).
 * @param {object} material Material JSON (`map` will be written)
 * @param {string} url Video URL (mp4/webm/ogg, etc.; depends on browser decode support)
 * @param {{ wrapRepeat?: boolean, defaultRepeatX?: number, defaultRepeatY?: number }} [opts]
 */
function attachVideoTextureFromMaterialJson(material, url, opts = {}) {
    const video = document.createElement("video");
    video.setAttribute("playsinline", "");
    video.playsInline = true;
    video.muted = material.videoMuted !== false;
    video.loop = material.videoLoop !== false;
    const cors = material.videoCrossOrigin ?? material.crossOrigin;
    if (cors === "anonymous" || cors === "use-credentials") {
        video.crossOrigin = cors;
    } else if (/^https?:\/\//i.test(url) || url.startsWith("//")) {
        video.crossOrigin = "anonymous";
    }
    video.src = url;
    const texture = new THREE.VideoTexture(video);
    trackDisposableResource(texture);
    if (THREE.SRGBColorSpace !== undefined) {
        texture.colorSpace = THREE.SRGBColorSpace;
    }
    const wrapRepeat = opts.wrapRepeat !== false;
    const defX = hasValue(opts.defaultRepeatX) ? opts.defaultRepeatX : TEXTURE_REPEAT_DEFAULT.x;
    const defY = hasValue(opts.defaultRepeatY) ? opts.defaultRepeatY : TEXTURE_REPEAT_DEFAULT.y;
    const tr = material.textureRepeat || {};
    texture.wrapS = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.repeat.set(
        wrapRepeat ? valueOr(tr.x, defX) : 1,
        wrapRepeat ? valueOr(tr.y, defY) : 1
    );
    wrapVideoElementTextureDispose(texture, video);
    material.map = texture;
    if (material.videoAutoplay !== false) {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch((err) => {
                log.warn("[textureKind:video] video.play() failed:", url, err);
            });
        }
    }
}

function hasText(value) {
    return typeof value === "string" && value.trim().length > 0;
}

function dedupeStringArray(arr) {
    return Array.from(new Set((arr || []).filter(hasText).map(s => s.trim())));
}

function resolveAssetUrl(baseUrl, rawUrl) {
    if (!hasText(rawUrl)) {
        return "";
    }
    const input = rawUrl.trim();
    if (/^(data:|blob:|https?:\/\/)/i.test(input) || input.startsWith("//")) {
        return input;
    }
    const publicResolved = resolvePublicAssetUrl(input);
    if (publicResolved !== input) {
        return publicResolved;
    }
    try {
        const base = hasText(baseUrl)
            ? new URL(baseUrl, window.location.href)
            : new URL(window.location.href);
        return new URL(input, base).toString();
    } catch (err) {
        if (!hasText(baseUrl)) {
            return input;
        }
        const normalizedBase = /\/$/.test(baseUrl) ? baseUrl : `${baseUrl}/`;
        return `${normalizedBase}${input.replace(/^\.\//, "")}`;
    }
}

function extractAssetBaseUrl(urlLike) {
    const resolved = resolveAssetUrl("", urlLike);
    if (!hasText(resolved)) {
        return "";
    }
    return THREE.LoaderUtils.extractUrlBase(resolved);
}

function readTextAsset(url, onLoad, onError) {
    const loader = new THREE.FileLoader(modelLoadingManager);
    loader.setResponseType("text");
    loader.load(url, onLoad, undefined, onError);
}

function readArrayBufferAsset(url, onLoad, onError) {
    const loader = new THREE.FileLoader(modelLoadingManager);
    loader.setResponseType("arraybuffer");
    loader.load(url, onLoad, undefined, onError);
}

function parseObjMaterialLibraries(objText) {
    if (!hasText(objText)) {
        return [];
    }
    const libs = [];
    const lines = objText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith("#")) {
            continue;
        }
        const match = line.match(/^mtllib\s+(.+)$/i);
        if (match && hasText(match[1])) {
            libs.push(match[1].trim());
        }
    }
    return dedupeStringArray(libs);
}

function getObjMaterialJson(objInfo) {
    return (objInfo && objInfo.material && typeof objInfo.material === "object") ? objInfo.material : {};
}

function getObjMapsJson(objInfo) {
    if (objInfo && objInfo.maps && typeof objInfo.maps === "object") {
        const keys = Object.keys(objInfo.maps);
        if (keys.length > 0) {
            return objInfo.maps;
        }
    }
    const nested = getObjMaterialJson(objInfo).maps;
    if (nested && typeof nested === "object" && Object.keys(nested).length > 0) {
        return nested;
    }
    return null;
}

/**
 * OBJ `maps/` sibling folder fallback scope: `off` disabled | `map` diffuse only (default) | `full` all slots.
 * @param {object|null|undefined} objInfo
 * @returns {"off"|"map"|"full"}
 */
function normalizeMapsFolderFallback(objInfo) {
    const raw = objInfo?.mapsFolderFallback ?? getObjMaterialJson(objInfo).mapsFolderFallback;
    if (raw === undefined || raw === null || raw === "") {
        return "off";
    }
    const mode = String(raw).trim().toLowerCase();
    if (mode === "off") {
        return "off";
    }
    if (mode === "full") {
        return "full";
    }
    if (mode === "map") {
        return "map";
    }
    log.warn(`[OBJ] unknown mapsFolderFallback "${raw}", falling back to "map"`);
    return "map";
}

function objSiblingMapsSlotNames(folderFallbackMode) {
    if (folderFallbackMode === "full") {
        return OBJ_TEXTURE_SLOT_NAMES;
    }
    return ["map"];
}

function normalizeObjTextureSlotPlan(slotName, rawConfig, baseUrl) {
    if (typeof rawConfig === "string") {
        const direct = resolveAssetUrl(baseUrl, rawConfig);
        return direct
            ? {
                slotName,
                candidates: [direct],
                wrapRepeat: true,
                textureKind: "image"
            }
            : null;
    }
    if (!rawConfig || typeof rawConfig !== "object") {
        return null;
    }
    const urls = [];
    if (hasText(rawConfig.url)) {
        urls.push(resolveAssetUrl(baseUrl, rawConfig.url));
    }
    if (hasText(rawConfig.path)) {
        urls.push(resolveAssetUrl(baseUrl, rawConfig.path));
    }
    if (hasText(rawConfig.textureUrl)) {
        urls.push(resolveAssetUrl(baseUrl, rawConfig.textureUrl));
    }
    if (Array.isArray(rawConfig.urls)) {
        for (let i = 0; i < rawConfig.urls.length; i++) {
            urls.push(resolveAssetUrl(baseUrl, rawConfig.urls[i]));
        }
    }
    const candidates = dedupeStringArray(urls);
    if (!candidates.length) {
        return null;
    }
    return {
        slotName,
        candidates,
        wrapRepeat: rawConfig.wrapRepeat !== false,
        repeat: rawConfig.repeat || rawConfig.textureRepeat || null,
        offset: rawConfig.offset || null,
        rotation: rawConfig.rotation,
        center: rawConfig.center || null,
        colorSpace: rawConfig.colorSpace,
        textureKind: (() => {
            const k = typeof rawConfig.textureKind === "string" ? rawConfig.textureKind.trim().toLowerCase() : "";
            if (k === "video") {
                return "video";
            }
            if (k === "gif") {
                return "gif";
            }
            return "image";
        })(),
        videoMuted: rawConfig.videoMuted,
        videoLoop: rawConfig.videoLoop,
        videoAutoplay: rawConfig.videoAutoplay,
        videoCrossOrigin: rawConfig.videoCrossOrigin,
        gifAutoplay: rawConfig.gifAutoplay,
        gifPlaybackRate: rawConfig.gifPlaybackRate,
        gifMaxFps: rawConfig.gifMaxFps,
        crossOrigin: rawConfig.crossOrigin
    };
}

function buildObjJsonTexturePlans(objInfo) {
    const maps = getObjMapsJson(objInfo);
    if (!maps) {
        return null;
    }
    const materialJson = getObjMaterialJson(objInfo);
    const rawBasePath = objInfo?.mapsBasePath || materialJson.mapsBasePath || "";
    const fallbackBase = extractAssetBaseUrl(objInfo?.modelPath || "");
    const mapsBaseUrl = hasText(rawBasePath) ? resolveAssetUrl(fallbackBase, rawBasePath) : fallbackBase;
    const plans = {};
    for (let i = 0; i < OBJ_TEXTURE_SLOT_NAMES.length; i++) {
        const slotName = OBJ_TEXTURE_SLOT_NAMES[i];
        const plan = normalizeObjTextureSlotPlan(slotName, maps[slotName], mapsBaseUrl);
        if (plan) {
            plans[slotName] = plan;
        }
    }
    return Object.keys(plans).length ? plans : null;
}

function buildObjSiblingMapsTexturePlans(objInfo, loadCtx = {}, folderFallbackMode = "map") {
    if (folderFallbackMode === "off") {
        return null;
    }
    const baseCandidates = [];
    if (hasText(objInfo?.modelPath)) {
        baseCandidates.push(resolveAssetUrl(extractAssetBaseUrl(objInfo.modelPath), "maps/"));
    }
    if (hasText(loadCtx.effectiveMtlPath)) {
        baseCandidates.push(resolveAssetUrl(extractAssetBaseUrl(loadCtx.effectiveMtlPath), "maps/"));
    }
    const folderBases = dedupeStringArray(baseCandidates);
    if (!folderBases.length) {
        return null;
    }
    const slotNames = objSiblingMapsSlotNames(folderFallbackMode);
    const plans = {};
    for (let i = 0; i < slotNames.length; i++) {
        const slotName = slotNames[i];
        const names = OBJ_FOLDER_MAP_NAME_CANDIDATES[slotName] || [slotName];
        const candidates = [];
        for (let bi = 0; bi < folderBases.length; bi++) {
            const folderBase = folderBases[bi];
            for (let ni = 0; ni < names.length; ni++) {
                for (let ei = 0; ei < OBJ_FOLDER_MAP_EXTENSIONS.length; ei++) {
                    candidates.push(resolveAssetUrl(folderBase, `${names[ni]}.${OBJ_FOLDER_MAP_EXTENSIONS[ei]}`));
                }
            }
        }
        plans[slotName] = {
            slotName,
            candidates: dedupeStringArray(candidates),
            wrapRepeat: true
        };
    }
    return plans;
}

function buildObjLegacyTexturePlan(objInfo) {
    const materialJson = getObjMaterialJson(objInfo);
    const legacyUrl = hasText(materialJson.textureUrl)
        ? materialJson.textureUrl.trim()
        : (typeof materialJson.map === "string" && materialMapStringResolvableAsUrl(materialJson.map) ? materialJson.map.trim() : "");
    if (!legacyUrl) {
        return null;
    }
    return {
        map: {
            slotName: "map",
            candidates: [resolveAssetUrl("", legacyUrl)],
            wrapRepeat: true,
            repeat: materialJson.textureRepeat || { x: 4, y: 4 }
        }
    };
}

function buildObjTexturePlans(objInfo, loadCtx = {}) {
    const jsonPlans = buildObjJsonTexturePlans(objInfo);
    if (jsonPlans) {
        return { source: "json", slotPlans: jsonPlans };
    }
    const folderFallbackMode = normalizeMapsFolderFallback(objInfo);
    const siblingPlans = buildObjSiblingMapsTexturePlans(objInfo, loadCtx, folderFallbackMode);
    const legacyPlans = buildObjLegacyTexturePlan(objInfo);
    if (siblingPlans) {
        if (legacyPlans?.map) {
            siblingPlans.map = {
                ...siblingPlans.map,
                repeat: legacyPlans.map.repeat || siblingPlans.map.repeat,
                candidates: dedupeStringArray([
                    ...(siblingPlans.map?.candidates || []),
                    ...legacyPlans.map.candidates
                ])
            };
        }
        return { source: "folder", slotPlans: siblingPlans };
    }
    if (legacyPlans) {
        return { source: "legacy", slotPlans: legacyPlans };
    }
    return { source: "none", slotPlans: null };
}

function objTextureSlotUsesSrgb(slotName) {
    return slotName === "map" || slotName === "emissiveMap";
}

function applyObjTextureSettings(texture, slotName, plan = {}) {
    if (!texture || texture.isTexture !== true) {
        return;
    }
    const wrapRepeat = plan.wrapRepeat !== false;
    texture.wrapS = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    const repeat = plan.repeat || {};
    texture.repeat.set(
        wrapRepeat ? valueOr(repeat.x, 1) : 1,
        wrapRepeat ? valueOr(repeat.y, 1) : 1
    );
    if (plan.offset && typeof plan.offset === "object") {
        texture.offset.set(valueOr(plan.offset.x, 0), valueOr(plan.offset.y, 0));
    }
    if (plan.center && typeof plan.center === "object") {
        texture.center.set(valueOr(plan.center.x, 0.5), valueOr(plan.center.y, 0.5));
    }
    if (Number.isFinite(Number(plan.rotation))) {
        texture.rotation = Number(plan.rotation);
    }
    if (hasText(plan.colorSpace)) {
        const cs = String(plan.colorSpace).trim().toLowerCase();
        if (cs === "srgb") {
            texture.colorSpace = THREE.SRGBColorSpace;
        } else if (cs === "linear" && "NoColorSpace" in THREE) {
            texture.colorSpace = THREE.NoColorSpace;
        }
    } else if (objTextureSlotUsesSrgb(slotName)) {
        texture.colorSpace = THREE.SRGBColorSpace;
    }
}

function loadObjTexturePlan(plan, onLoad, onError) {
    const candidates = Array.isArray(plan?.candidates) ? plan.candidates : [];
    if (!candidates.length) {
        onError?.(new Error("texture candidate list is empty"));
        return;
    }
    const tryLoad = (index) => {
        if (index >= candidates.length) {
            onError?.(new Error(`OBJ texture load failed: ${plan.slotName}`));
            return;
        }
        const url = candidates[index];
        if (plan.textureKind === "video") {
            const proxyMat = {
                textureUrl: url,
                textureRepeat: plan.repeat,
                videoMuted: plan.videoMuted,
                videoLoop: plan.videoLoop,
                videoAutoplay: plan.videoAutoplay,
                videoCrossOrigin: plan.videoCrossOrigin ?? plan.crossOrigin,
                crossOrigin: plan.crossOrigin
            };
            attachVideoTextureFromMaterialJson(proxyMat, url, {
                wrapRepeat: plan.wrapRepeat !== false,
                defaultRepeatX: valueOr(plan.repeat?.x, 1),
                defaultRepeatY: valueOr(plan.repeat?.y, 1)
            });
            const loaded = proxyMat.map;
            applyObjTextureSettings(loaded, plan.slotName, plan);
            trackDisposableResource(loaded);
            onLoad?.(loaded, url);
            return;
        }
        if (plan.textureKind === "gif") {
            const proxyMat = {
                textureUrl: url,
                textureRepeat: plan.repeat,
                gifAutoplay: plan.gifAutoplay,
                gifPlaybackRate: plan.gifPlaybackRate,
                gifMaxFps: plan.gifMaxFps
            };
            attachGifCanvasTextureFromMaterialJson(proxyMat, url, {
                wrapRepeat: plan.wrapRepeat !== false,
                defaultRepeatX: valueOr(plan.repeat?.x, 1),
                defaultRepeatY: valueOr(plan.repeat?.y, 1)
            });
            const loaded = proxyMat.map;
            applyObjTextureSettings(loaded, plan.slotName, plan);
            trackDisposableResource(loaded);
            onLoad?.(loaded, url);
            return;
        }
        const imageLoader = candidates.length > 1 ? objTextureProbeLoader : textureLoader;
        const texture = imageLoader.load(
            url,
            function(loaded) {
                applyObjTextureSettings(loaded, plan.slotName, plan);
                trackDisposableResource(loaded);
                onLoad?.(loaded, url);
            },
            undefined,
            function() {
                tryLoad(index + 1);
            }
        );
        applyObjTextureSettings(texture, plan.slotName, plan);
    };
    tryLoad(0);
}

function objTexturePlansRequireStandardMaterial(slotPlans, materialJson) {
    if (jsonMaterialPrefersStandardPbr(materialJson)) {
        return true;
    }
    if (!slotPlans) {
        return false;
    }
    const slotNames = Object.keys(slotPlans);
    for (let i = 0; i < slotNames.length; i++) {
        if (OBJ_STANDARD_ONLY_TEXTURE_SLOT_NAMES.has(slotNames[i])) {
            return true;
        }
    }
    return false;
}

function createObjMaterialFromJson(materialJson = {}, useStandard = false) {
    const baseOptions = {
        color: materialJson.color ? materialJson.color : "#fff",
        transparent: hasValue(materialJson.transparent) ? !!materialJson.transparent : false,
        opacity: hasValue(materialJson.opacity) ? materialJson.opacity : 1
    };
    const next = useStandard
        ? new THREE.MeshStandardMaterial({
            ...baseOptions,
            ...standardMaterialPbrFromJson(materialJson)
        })
        : new THREE.MeshPhongMaterial(baseOptions);
    trackDisposableResource(next);
    return next;
}

function copyTextureIfSupported(targetMaterial, sourceMaterial, slotName) {
    if (!targetMaterial || !sourceMaterial || !(slotName in targetMaterial)) {
        return;
    }
    const tex = safeMaterialMap(sourceMaterial[slotName]);
    if (tex) {
        targetMaterial[slotName] = tex;
    }
}

function convertObjMaterialToStandard(material, materialJson = {}) {
    if (!material || material.isMaterial !== true) {
        return createObjMaterialFromJson(materialJson, true);
    }
    const next = new THREE.MeshStandardMaterial({
        color: material.color ? material.color.clone() : new THREE.Color(materialJson.color ? materialJson.color : "#fff"),
        transparent: hasValue(materialJson.transparent) ? !!materialJson.transparent : !!material.transparent,
        opacity: hasValue(materialJson.opacity) ? materialJson.opacity : valueOr(material.opacity, 1),
        side: material.side,
        wireframe: material.wireframe,
        flatShading: material.flatShading,
        ...standardMaterialPbrFromJson(materialJson)
    });
    if (material.emissive && next.emissive) {
        next.emissive.copy(material.emissive);
    }
    if (hasValue(material.emissiveIntensity) && hasValue(next.emissiveIntensity)) {
        next.emissiveIntensity = material.emissiveIntensity;
    }
    if (material.normalScale && next.normalScale) {
        next.normalScale.copy(material.normalScale);
    }
    if (material.displacementScale && hasValue(next.displacementScale)) {
        next.displacementScale = material.displacementScale;
    }
    if (material.displacementBias && hasValue(next.displacementBias)) {
        next.displacementBias = material.displacementBias;
    }
    copyTextureIfSupported(next, material, "map");
    copyTextureIfSupported(next, material, "normalMap");
    copyTextureIfSupported(next, material, "aoMap");
    copyTextureIfSupported(next, material, "emissiveMap");
    copyTextureIfSupported(next, material, "bumpMap");
    copyTextureIfSupported(next, material, "alphaMap");
    copyTextureIfSupported(next, material, "displacementMap");
    copyTextureIfSupported(next, material, "lightMap");
    copyTextureIfSupported(next, material, "envMap");
    trackDisposableResource(next);
    return next;
}

function applyObjMaterialJsonProps(material, materialJson = {}) {
    if (!material || material.isMaterial !== true || !materialJson || typeof materialJson !== "object") {
        return material;
    }
    if (hasText(materialJson.color) && material.color) {
        material.color.set(materialJson.color);
    }
    if (hasValue(materialJson.transparent)) {
        material.transparent = !!materialJson.transparent;
    }
    if (hasValue(materialJson.opacity)) {
        material.opacity = Number(materialJson.opacity);
    }
    if (hasValue(materialJson.metalness) && "metalness" in material) {
        material.metalness = Number(materialJson.metalness);
    }
    if (hasValue(materialJson.roughness) && "roughness" in material) {
        material.roughness = Number(materialJson.roughness);
    }
    material.needsUpdate = true;
    return material;
}

function prepareObjMeshMaterial(material, materialJson, useStandard) {
    let next = material;
    if (!next || next.isMaterial !== true) {
        next = createObjMaterialFromJson(materialJson, useStandard);
    } else if (useStandard && !(next instanceof THREE.MeshStandardMaterial)) {
        next = convertObjMaterialToStandard(next, materialJson);
    }
    return applyObjMaterialJsonProps(next, materialJson);
}

function applyTextureToObjMaterial(material, slotName, texture) {
    if (!material || material.isMaterial !== true || !(slotName in material)) {
        return false;
    }
    if (safeMaterialMap(material[slotName])) {
        return false;
    }
    material[slotName] = texture;
    if (slotName === "alphaMap") {
        material.transparent = true;
    }
    material.needsUpdate = true;
    return true;
}

function applyTextureToObjObject(object, slotName, texture) {
    if (!object || !texture) {
        return;
    }
    object.traverse(function(child) {
        if (!child.isMesh) {
            return;
        }
        if (Array.isArray(child.material)) {
            for (let i = 0; i < child.material.length; i++) {
                applyTextureToObjMaterial(child.material[i], slotName, texture);
            }
            return;
        }
        applyTextureToObjMaterial(child.material, slotName, texture);
    });
}

/**
 * Write `textureUrl` or recognizable URL string `map` to `material.map`.
 * - Default (`textureKind` omitted or `image`): TextureLoader static texture (`.gif` URL **first frame** only; no animation decode).
 * - `textureKind: "video"`: THREE.VideoTexture (`textureUrl` is video address); optional videoMuted / videoLoop / videoAutoplay / videoCrossOrigin.
 * - `textureKind: "gif"`: CanvasTexture + gifuct-js; optional gifAutoplay / gifPlaybackRate / gifMaxFps.
 * @param {*} material JSON material block
 * @param {{
 *   loader?: THREE.TextureLoader,
 *   wrapRepeat?: boolean,
 *   defaultRepeatX?: number,
 *   defaultRepeatY?: number
 * }} [opts]
 */
/**
 * Load texture from material JSON; does not write back to POJO by default. Binds to runtime material when `threeMaterial` passed.
 * @deprecated New code should use {@link loadTextureFromMaterialJson} + {@link applyTextureFromMaterialJsonToThreeMaterial}
 */
function ensureMaterialTextureFromJson(material, opts = {}) {
    if (!material || typeof material !== "object") {
        return null;
    }
    if (opts.threeMaterial) {
        return applyTextureFromMaterialJsonToThreeMaterial(opts.threeMaterial, material, opts);
    }
    return loadTextureFromMaterialJson(material, opts);
}

/** Whether material JSON has parseable textureUrl (including lib://). */
function jsonMaterialTextureUrlResolvable(material) {
    return materialJsonHasResolvableTexture(material);
}

/**
 * JSON may put `receiveShadow` in material block; runtime only honors Object3D.receiveShadow.
 * @param {{ receiveShadow?: boolean }[]|null|undefined} materialsLike Six-face or merged material array
 */
function meshReceiveShadowFromMaterials(materialsLike){
    if (!materialsLike || !materialsLike.length) return true;
    for (let i = 0; i < materialsLike.length; i++){
        const m = materialsLike[i];
        if (m && m.receiveShadow === false) return false;
    }
    return true;
}

/**
 * Normalize position object; defaults to 0.
 * @param {object} [position={}]
 * @returns {{ x: number, y: number, z: number }}
 */
function normalizePosition(position = {}){
    return {
        x: valueOr(position.x, 0),
        y: valueOr(position.y, 0),
        z: valueOr(position.z, 0)
    };
}

/**
 * Normalize rotation object (radians); defaults to 0.
 * @param {object} [rotation={}]
 * @returns {{ rotationX: number, rotationY: number, rotationZ: number }}
 */
function normalizeRotation(rotation = {}){
    return {
        rotationX: valueOr(rotation.rotationX, 0),
        rotationY: valueOr(rotation.rotationY, 0),
        rotationZ: valueOr(rotation.rotationZ, 0)
    };
}

/**
 * Normalize scale; defaults to 1.
 * @param {object} [scale={}]
 * @returns {{ scaleX: number, scaleY: number, scaleZ: number }}
 */
function normalizeScale(scale = {}){
    return {
        scaleX: valueOr(scale.scaleX, 1),
        scaleY: valueOr(scale.scaleY, 1),
        scaleZ: valueOr(scale.scaleZ, 1)
    };
}

/**
 * Apply position / rotation / scale from JSON to Three Object3D.
 * @param {THREE.Object3D} object3D
 * @param {object} [source={}] May include position, rotation, scale
 */
function applyObjectTransform(object3D, source = {}){
    const position = normalizePosition(source.position);
    const rotation = normalizeRotation(source.rotation);
    const scale = normalizeScale(source.scale);

    object3D.position.set(position.x, position.y, position.z);
    object3D.rotation.set(rotation.rotationX, rotation.rotationY, rotation.rotationZ);
    object3D.scale.set(scale.scaleX, scale.scaleY, scale.scaleZ);
    applyVisibilityFromDescriptor(object3D, source);
}

function normalizePrimitiveShapeType(rawType){
    if (typeof rawType !== "string") {
        return "";
    }
    const normalized = rawType.trim().toLowerCase();
    if (!normalized) {
        return "";
    }
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

function resolvePrimitiveShapeType(modelObj){
    if (!modelObj || typeof modelObj !== "object") {
        return "box";
    }
    const candidates = [
        modelObj.boxType,
        modelObj.geometry?.type,
        modelObj.objType
    ];
    for (let i = 0; i < candidates.length; i++) {
        const normalized = normalizePrimitiveShapeType(candidates[i]);
        if (normalized === "box" || SINGLE_MATERIAL_PRIMITIVE_TYPES.has(normalized)) {
            return normalized;
        }
    }
    return "box";
}

function getPrimitiveMaterialJson(source){
    if (source?.material && typeof source.material === "object") {
        return source.material;
    }
    if (Array.isArray(source?.materials) && source.materials.length > 0) {
        for (let i = 0; i < source.materials.length; i++) {
            if (source.materials[i] && typeof source.materials[i] === "object") {
                return source.materials[i];
            }
        }
    }
    return null;
}

/** Write JSON `material.side` (front / back / double) to Three material; plane branch has separate impl; primitives use this. */
function applyMaterialSideFromJson(material, materialJson) {
    if (!material || material.isMaterial !== true || !materialJson?.side) {
        return material;
    }
    const side = String(materialJson.side).trim().toLowerCase();
    if (side === "double") {
        material.side = THREE.DoubleSide;
    } else if (side === "front") {
        material.side = THREE.FrontSide;
    } else if (side === "back") {
        material.side = THREE.BackSide;
    }
    return material;
}

function buildSingleMaterialSurface(materialJson, objectVisible = true){
    let material;
    if (materialJson) {
        if ("dynamicBox" === materialJson.type) {
            material = new THREE.MeshStandardMaterial({
                map: safeMaterialMap(materialJson.map),
                color: valueOr(materialJson.color, "#cccccc"),
                transparent: valueOr(materialJson.transparent, false),
                opacity: valueOr(materialJson.opacity, 1),
                visible: objectVisible,
                depthTest: valueOr(materialJson.depthTest, true),
                ...standardMaterialPbrFromJson(materialJson),
            });
        } else if ("phong" === materialJson.type) {
            material = new THREE.MeshPhongMaterial({
                map: safeMaterialMap(materialJson.map),
                color: valueOr(materialJson.color, "#cccccc"),
                transparent: valueOr(materialJson.transparent, false),
                opacity: valueOr(materialJson.opacity, 1),
                depthTest: valueOr(materialJson.depthTest, true),
            });
        } else if ("lambert" === materialJson.type) {
            material = new THREE.MeshLambertMaterial({
                map: safeMaterialMap(materialJson.map),
                color: valueOr(materialJson.color, "#cccccc"),
                transparent: valueOr(materialJson.transparent, false),
                opacity: valueOr(materialJson.opacity, 1),
                visible: objectVisible,
                depthTest: valueOr(materialJson.depthTest, true),
            });
        } else if ("standard" === materialJson.type) {
            material = new THREE.MeshStandardMaterial({
                map: safeMaterialMap(materialJson.map),
                color: valueOr(materialJson.color, "#cccccc"),
                transparent: valueOr(materialJson.transparent, false),
                opacity: valueOr(materialJson.opacity, 1),
                visible: objectVisible,
                depthTest: valueOr(materialJson.depthTest, true),
                ...standardMaterialPbrFromJson(materialJson),
            });
        } else if ("basic" === materialJson.type) {
            material = new THREE.MeshBasicMaterial({
                map: safeMaterialMap(materialJson.map),
                color: valueOr(materialJson.color, "#cccccc"),
                transparent: valueOr(materialJson.transparent, false),
                opacity: valueOr(materialJson.opacity, 1),
                visible: objectVisible,
                depthTest: valueOr(materialJson.depthTest, true),
            });
        } else if (jsonMaterialPrefersStandardPbr(materialJson)) {
            material = new THREE.MeshStandardMaterial({
                map: safeMaterialMap(materialJson.map),
                color: valueOr(materialJson.color, "#cccccc"),
                transparent: valueOr(materialJson.transparent, false),
                opacity: valueOr(materialJson.opacity, 1),
                visible: objectVisible,
                depthTest: valueOr(materialJson.depthTest, true),
                ...standardMaterialPbrFromJson(materialJson),
            });
        } else {
            material = new THREE.MeshPhongMaterial({
                map: safeMaterialMap(materialJson.map),
                color: valueOr(materialJson.color, "#cccccc"),
                transparent: valueOr(materialJson.transparent, false),
                opacity: valueOr(materialJson.opacity, 1),
                visible: objectVisible,
                depthTest: valueOr(materialJson.depthTest, true),
            });
        }
    } else {
        material = new THREE.MeshPhongMaterial({
            color: "#0xffff00"
        });
    }
    return applyMaterialSideFromJson(material, materialJson);
}

function createPrimitiveGeometry(primitiveObj, shapeType){
    const geometryInfo = primitiveObj?.geometry || {};
    if ("sphere" === shapeType) {
        return new THREE.SphereGeometry(
            valueOr(geometryInfo.radius, 1),
            valueOr(geometryInfo.widthSegments, 32),
            valueOr(geometryInfo.heightSegments, 16),
            valueOr(geometryInfo.phiStart, 0),
            valueOr(geometryInfo.phiLength, Math.PI * 2),
            valueOr(geometryInfo.thetaStart, 0),
            valueOr(geometryInfo.thetaLength, Math.PI)
        );
    }
    if ("cylinder" === shapeType) {
        return new THREE.CylinderGeometry(
            valueOr(geometryInfo.radiusTop, valueOr(geometryInfo.radius, 1)),
            valueOr(geometryInfo.radiusBottom, valueOr(geometryInfo.radius, 1)),
            valueOr(geometryInfo.height, valueOr(geometryInfo.length, 1)),
            valueOr(geometryInfo.radialSegments, 32),
            valueOr(geometryInfo.heightSegments, 1),
            valueOr(geometryInfo.openEnded, false),
            valueOr(geometryInfo.thetaStart, 0),
            valueOr(geometryInfo.thetaLength, Math.PI * 2)
        );
    }
    if ("cone" === shapeType) {
        return new THREE.ConeGeometry(
            valueOr(geometryInfo.radius, 1),
            valueOr(geometryInfo.height, valueOr(geometryInfo.length, 1)),
            valueOr(geometryInfo.radialSegments, 32),
            valueOr(geometryInfo.heightSegments, 1),
            valueOr(geometryInfo.openEnded, false),
            valueOr(geometryInfo.thetaStart, 0),
            valueOr(geometryInfo.thetaLength, Math.PI * 2)
        );
    }
    if ("ring" === shapeType) {
        return new THREE.RingGeometry(
            valueOr(geometryInfo.innerRadius, 0.5),
            valueOr(geometryInfo.outerRadius, 1),
            valueOr(geometryInfo.thetaSegments, 32),
            valueOr(geometryInfo.phiSegments, 1),
            valueOr(geometryInfo.thetaStart, 0),
            valueOr(geometryInfo.thetaLength, Math.PI * 2)
        );
    }
    if ("torus" === shapeType) {
        return new THREE.TorusGeometry(
            valueOr(geometryInfo.radius, 1),
            valueOr(geometryInfo.tube, 0.4),
            valueOr(geometryInfo.radialSegments, 16),
            valueOr(geometryInfo.tubularSegments, 48),
            valueOr(geometryInfo.arc, Math.PI * 2)
        );
    }
    if ("capsule" === shapeType) {
        return new THREE.CapsuleGeometry(
            valueOr(geometryInfo.radius, 0.5),
            valueOr(geometryInfo.length, 1),
            valueOr(geometryInfo.capSegments, 4),
            valueOr(geometryInfo.radialSegments, 8)
        );
    }
    return null;
}

function finalizeSingleMaterialPrimitive(primitiveMesh, primitiveObj, materialJson){
    primitiveMesh.receiveShadow = materialJson ? valueOr(materialJson.receiveShadow, true) : true;
    applyObjectTransform(primitiveMesh, primitiveObj);

    if(primitiveObj.joins && primitiveObj.joins.length > 0){
        for(let i = 0; i < primitiveObj.joins.length; i++){
            let joinMesh = createMesh(primitiveObj.joins[i]);
            if(joinMesh){
                primitiveMesh = evaluateMeshBoolean(primitiveMesh, joinMesh, "add");
            }
        }
    }
    if(primitiveObj.inters && primitiveObj.inters.length > 0){
        for(let i = 0; i < primitiveObj.inters.length; i++){
            let interMesh = createMesh(primitiveObj.inters[i]);
            if(interMesh){
                primitiveMesh = evaluateMeshBoolean(primitiveMesh, interMesh, "inter");
            }
        }
    }
    if(primitiveObj.holes && primitiveObj.holes.length > 0){
        for(let i = 0; i < primitiveObj.holes.length; i++){
            let holeMesh = createMesh(primitiveObj.holes[i]);
            if(holeMesh){
                primitiveMesh = evaluateMeshBoolean(primitiveMesh, holeMesh, "sub");
            }
        }
    }

    if (primitiveObj.name) {
        primitiveMesh.name = primitiveObj.name;
    } else if (primitiveObj.boxInfoId) {
        primitiveMesh.name = primitiveObj.boxInfoId.toString();
    } else {
        primitiveMesh.name = "newModel";
    }
    setUserDataObjJson(primitiveMesh, primitiveObj);

    if(primitiveObj.type){
        if("dynamicBox" === primitiveObj.type){
            primitiveMesh.scale.y = 0;
            primitiveMesh.position.y = 0;
            createTween(primitiveMesh.scale, primitiveMesh).to({
                y: 1
            }, 1 * 1000).easing(TWEEN.Easing.Linear.None).start();
            createTween(primitiveMesh.position, primitiveMesh).to({
                y: primitiveObj.position?.y ?? 0
            }, 1 * 1000).easing(TWEEN.Easing.Linear.None).start();
        }
    }
    return primitiveMesh;
}

function createSingleMaterialPrimitiveMesh(primitiveObj, shapeType, options = {}){
    if(!primitiveObj){
        return;
    }
    const geometry = createPrimitiveGeometry(primitiveObj, shapeType);
    if(!geometry){
        return;
    }
    trackDisposableResource(geometry);

    const materialJson = getPrimitiveMaterialJson(primitiveObj);
    const material = buildSingleMaterialSurface(materialJson, false !== primitiveObj.visible);
    if (options.ensureTexture && materialJson) {
        applyTextureFromMaterialJsonToThreeMaterial(material, materialJson, {
            loader: new THREE.TextureLoader(modelLoadingManager),
            wrapRepeat: Boolean(materialJson.textureRepeat),
            defaultRepeatX: TEXTURE_REPEAT_DEFAULT.x,
            defaultRepeatY: TEXTURE_REPEAT_DEFAULT.y
        });
    }
    trackDisposableResource(material);
    let primitiveMesh = new THREE.Mesh(geometry, material);
    trackDisposableResource(primitiveMesh);
    primitiveMesh = finalizeSingleMaterialPrimitive(primitiveMesh, primitiveObj, materialJson);
    return primitiveMesh;
}

/**
 * Write current Object3D transform back to `userData.objJson` (same JSON reference); does not change Three.uuid.
 * @param {THREE.Object3D|null|undefined} object3D
 * @returns {boolean} Whether written
 */
function syncBoxModelTransformFromObject3D(object3D) {
    const u = object3D?.userData;
    const data = u?.objJson && typeof u.objJson === "object" ? u.objJson : null;
    if (!data || typeof data !== 'object') {
        return false;
    }
    data.position = {
        x: Number(object3D.position.x) || 0,
        y: Number(object3D.position.y) || 0,
        z: Number(object3D.position.z) || 0
    };
    data.rotation = {
        rotationX: Number(object3D.rotation.x) || 0,
        rotationY: Number(object3D.rotation.y) || 0,
        rotationZ: Number(object3D.rotation.z) || 0
    };
    data.scale = {
        scaleX: Number(object3D.scale.x) || 1,
        scaleY: Number(object3D.scale.y) || 1,
        scaleZ: Number(object3D.scale.z) || 1
    };
    return true;
}

/**
 * Apply position / rotation / scale from `userData.objJson` to Object3D (same shape as {@link applyObjectTransform}).
 * @param {THREE.Object3D|null|undefined} object3D
 * @returns {boolean} Whether applied
 */
function applyBoxModelTransformToObject3D(object3D) {
    const u = object3D?.userData;
    const data = u?.objJson && typeof u.objJson === "object" ? u.objJson : null;
    if (!data || typeof data !== 'object') {
        return false;
    }
    applyObjectTransform(object3D, data);
    return true;
}

/**
 * Read transform snapshot from Object3D (plain object), same shape as {@link applyObjectTransform} `source`; does not write objJson.
 *
 * @param {THREE.Object3D|null|undefined} object3D
 * @returns {{ position: object, rotation: object, scale: object }|null}
 */
function snapshotBoxModelTransformFromObject3D(object3D) {
    if (!object3D) {
        return null;
    }
    return {
        position: {
            x: Number(object3D.position.x) || 0,
            y: Number(object3D.position.y) || 0,
            z: Number(object3D.position.z) || 0
        },
        rotation: {
            rotationX: Number(object3D.rotation.x) || 0,
            rotationY: Number(object3D.rotation.y) || 0,
            rotationZ: Number(object3D.rotation.z) || 0
        },
        scale: {
            scaleX: Number(object3D.scale.x) || 1,
            scaleY: Number(object3D.scale.y) || 1,
            scaleZ: Number(object3D.scale.z) || 1
        }
    };
}

/**
 * Replace global LoadingManager and rebuild TextureLoader (affects subsequent texture loads).
 * @param {THREE.LoadingManager|null|undefined} manager Falls back to default loadingManager when null/undefined
 */
function setModelLoadingManager(manager){
    modelLoadingManager = manager || loadingManager;
    textureLoader = new THREE.TextureLoader(modelLoadingManager);
    trackDisposableResource(textureLoader);
}

/**
 * Untextured box: supports `instance` branch (instancing), `merge` (merged geometry), else six-face material Box.
 * @param {object} boxObj Box JSON
 * @returns {THREE.Mesh|THREE.InstancedMesh|undefined}
 */
function createNormalBox(boxObj, options = {}) {
    if(!boxObj) {
        return;
    }
    const record = options.skipClone === true ? boxObj : cloneJson(boxObj);
    if (options.skipClone !== true) {
        restoreRuntimeFaceMapsAfterClone(boxObj, record);
    }
    if(record.instance){
        return createInstanceBox(record, options);
    }
    if(record.merge || (record.geometryArr && record.materialArr)){
        return createMergeBox(record);
    }
    let geometry;
    if(record.geometry){
        record.geometry.width = record.geometry.width ? record.geometry.width : 1;
        record.geometry.height = record.geometry.height ? record.geometry.height : 1;
        record.geometry.depth = record.geometry.depth ? record.geometry.depth : 1;
        geometry = new THREE.BoxGeometry(record.geometry.width, record.geometry.height, record.geometry.depth); // Create box geometry
        trackDisposableResource(geometry)
    }
    else{
        geometry = new THREE.BoxGeometry(1, 1, 1);
        trackDisposableResource(geometry)
    }
    const { materials, meshMaterial, faceJsonList } = buildBoxFaceThreeMaterials(record, {
        applyTexturesFromJson: options.applyTexturesFromJson === true
    });
    let boxMesh = new THREE.Mesh(geometry, meshMaterial);  // Create mesh
    trackDisposableResource(materials)
    trackDisposableResource(boxMesh)
    boxMesh.receiveShadow = meshReceiveShadowFromMaterials(record.materials || faceJsonList);
    boxMesh.position.set(0, 0, 0)
    if (record.position) {
        record.position.x = record.position.x ? record.position.x : 0;
        record.position.y = record.position.y ? record.position.y : 0;
        record.position.z = record.position.z ? record.position.z : 0;
        boxMesh.position.set(record.position.x, record.position.y, record.position.z)
    }
    boxMesh.rotation.set(0, 0, 0);
    if (record.rotation) {
        record.rotation.rotationX = record.rotation.rotationX ? record.rotation.rotationX : 0;
        record.rotation.rotationY = record.rotation.rotationY ? record.rotation.rotationY : 0;
        record.rotation.rotationZ = record.rotation.rotationZ ? record.rotation.rotationZ : 0;
        boxMesh.rotation.set(record.rotation.rotationX, record.rotation.rotationY, record.rotation.rotationZ);
    }
    boxMesh.scale.set(1, 1, 1);
    if (record.scale) {
        record.scale.scaleX = record.scale.scaleX ? record.scale.scaleX : 1;
        record.scale.scaleY = record.scale.scaleY ? record.scale.scaleY : 1;
        record.scale.scaleZ = record.scale.scaleZ ? record.scale.scaleZ : 1;
        boxMesh.scale.set(record.scale.scaleX, record.scale.scaleY, record.scale.scaleZ);
    }
    // Handle merge
    if(record.joins && record.joins.length > 0){
        for(let i = 0; i < record.joins.length; i++){
            let joinMesh = createBox(record.joins[i]);
            boxMesh = evaluateMeshBoolean(boxMesh, joinMesh, 'add')
        }
    }
    // Handle intersection
    if(record.inters && record.inters.length > 0){
        for(let i = 0; i < record.inters.length; i++){
            let interMesh = createBox(record.inters[i]);
            boxMesh = evaluateMeshBoolean(boxMesh, interMesh, 'inter');
        }
    }
    // Handle hole cut
    if(record.holes && record.holes.length > 0){
        for(let i = 0; i < record.holes.length; i++){
            let holeMesh = createBox(record.holes[i]);
            boxMesh = evaluateMeshBoolean(boxMesh, holeMesh, 'sub');
        }
    }
    boxMesh = finalizeCsgBoxMeshResult(boxMesh, meshMaterial);
    if (!boxMesh?.isMesh) {
        return boxMesh;
    }
    if (record.boxInfoId) {
        boxMesh.name = record.boxInfoId.toString();
    } else {
        boxMesh.name = "newModel"
    }
    boxMesh.name = record && record.name ? record.name : "newModel";
    setUserDataObjJson(boxMesh, record);
    // Handle animation
    if(record.type){
        if("dynamicBox" === record.type){
            boxMesh.scale.y = 0
            boxMesh.position.y = 0
            createTween(boxMesh.scale, boxMesh).to({
                y:  1
            }, 1*1000).easing(TWEEN.Easing.Linear.None).start();
            createTween(boxMesh.position, boxMesh).to({
                y:  record.position.y
            }, 1*1000).easing(TWEEN.Easing.Linear.None).start();
        }
    }
    return boxMesh;
}

/**
 * Inconsistent six-face textures cannot use single-material InstancedMesh; falls back to Group + multiple Meshes.
 * @param {object} record
 * @param {{ applyTexturesFromJson?: boolean }} [options]
 * @returns {THREE.Group|undefined}
 */
function createInstanceBoxAsMeshGroup(record, options = {}) {
    if (!record || !Array.isArray(record.transforms) || !record.transforms.length) {
        return;
    }
    fillMissingBoxFaceTextureUrls(record);
    const group = new THREE.Group();
    trackDisposableResource(group);
    for (let i = 0; i < record.transforms.length; i += 1) {
        const transform = record.transforms[i];
        const one = cloneJson(record);
        delete one.instance;
        delete one.transforms;
        delete one.combineArr;
        delete one.businessInfoArr;
        one.position = transform.position ? transform.position : { x: 0, y: 0, z: 0 };
        one.rotation = transform.rotation ? transform.rotation : { rotationX: 0, rotationY: 0, rotationZ: 0 };
        one.scale = transform.scale ? transform.scale : { scaleX: 1, scaleY: 1, scaleZ: 1 };
        const mesh = createTextureBox(one);
        if (mesh) {
            group.add(mesh);
        }
    }
    group.receiveShadow = meshReceiveShadowFromMaterials(record.materials);
    if (record.boxInfoId) {
        group.name = record.boxInfoId.toString();
    } else {
        group.name = "newModel";
    }
    group.name = record && record.name ? record.name : group.name;
    setUserDataObjJson(group, record);
    return group;
}

/**
 * Create InstancedMesh: same geometry and material; poses from boxObj.transforms.
 * Falls back to {@link createInstanceBoxAsMeshGroup} when six-face textures differ.
 * @param {object} boxObj Must include `transforms` array
 * @param {{ applyTexturesFromJson?: boolean, skipClone?: boolean }} [options]
 * @returns {THREE.InstancedMesh|THREE.Group|undefined}
 */
function createInstanceBox(boxObj, options = {}) {
    if(!boxObj) {
        return;
    }
    const record = options.skipClone === true ? boxObj : cloneJson(boxObj);
    if (!Array.isArray(record.transforms) || !record.transforms.length) {
        return;
    }
    fillMissingBoxFaceTextureUrls(record);
    const faceJsonList = getBoxFaceMaterialJsonList(record);
    if (faceJsonList && !boxFaceMaterialsUniform(faceJsonList)) {
        return createInstanceBoxAsMeshGroup(record, options);
    }
    let geometry;
    if(record.geometry){
        record.geometry.width = record.geometry.width ? record.geometry.width : 1;
        record.geometry.height = record.geometry.height ? record.geometry.height : 1;
        record.geometry.depth = record.geometry.depth ? record.geometry.depth : 1;
        geometry = new THREE.BoxGeometry(record.geometry.width, record.geometry.height, record.geometry.depth);
        trackDisposableResource(geometry)
    }
    else{
        geometry = new THREE.BoxGeometry(1, 1, 1);
        trackDisposableResource(geometry)
    }
    const { meshMaterial } = buildBoxFaceThreeMaterials(record, {
        applyTexturesFromJson: options.applyTexturesFromJson === true
    });
    const instMaterial = Array.isArray(meshMaterial) ? meshMaterial[0] : meshMaterial;
    if (!instMaterial) {
        return;
    }
    let instanceBoxMesh = new THREE.InstancedMesh(geometry, instMaterial, record.transforms.length);
    trackDisposableResource(instanceBoxMesh);
    instanceBoxMesh.receiveShadow = meshReceiveShadowFromMaterials(record.materials || faceJsonList);
    for (let i = 0; i < record.transforms.length; i++) {
        let transform = record.transforms[i];
        let matrix4 = colTransMatrix(transform);
        trackDisposableResource(matrix4);
        instanceBoxMesh.setMatrixAt(i, matrix4);
    }
    instanceBoxMesh.instanceMatrix.needsUpdate = true;
    instanceBoxMesh.computeBoundingSphere();
    instanceBoxMesh.computeBoundingBox();
    if (record.boxInfoId) {
        instanceBoxMesh.name = record.boxInfoId.toString();
    } else {
        instanceBoxMesh.name = "newModel"
    }
    instanceBoxMesh.name = record && record.name ? record.name : "newModel";
    setUserDataObjJson(instanceBoxMesh, record);
    return instanceBoxMesh;
}

/**
 * Convert position / rotation / scale in JSON fragment to local matrix **T·R·S** consistent with {@link THREE.Object3D} (column-vector left multiply).
 * For baking transform into vertices in merged geometry, instanced meshes, etc.; must match {@link applyObjectTransform} semantics.
 * @param {{ position?: object, rotation?: object, scale?: object }|null|undefined} transform
 * @returns {THREE.Matrix4}
 */
function colTransMatrix(transform){
    const matrix4 = new THREE.Matrix4();
    if(!transform || (!transform.scale && !transform.position && !transform.rotation)){
        log.error("Failed to compute transform matrix: invalid data!")
        return matrix4;
    }
    trackDisposableResource(matrix4);
    const scale = normalizeScale(transform.scale);
    const rotation = normalizeRotation(transform.rotation);
    const position = normalizePosition(transform.position);
    const positionV = new THREE.Vector3(position.x, position.y, position.z);
    const scaleV = new THREE.Vector3(scale.scaleX, scale.scaleY, scale.scaleZ);
    const euler = new THREE.Euler(rotation.rotationX, rotation.rotationY, rotation.rotationZ, 'XYZ');
    const quaternion = new THREE.Quaternion().setFromEuler(euler);
    matrix4.compose(positionV, quaternion, scaleV);
    return matrix4;
}

/**
 * Recompute bounds on geometry and Object3D (CSG Brush has geometry-level bounds only).
 * @param {THREE.Object3D|undefined} mesh
 */
function recomputeMeshBounds(mesh) {
    if (!mesh?.geometry) return;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    if (typeof mesh.computeBoundingSphere === 'function') {
        mesh.computeBoundingSphere();
    }
}

/**
 * three-bvh-csg evaluate returns Brush; downstream uses as Mesh.
 * @param {THREE.Object3D|import('three-bvh-csg').Brush|null|undefined} csgObject
 * @param {THREE.Material|THREE.Material[]} fallbackMaterial
 * @returns {THREE.Mesh|null}
 */
function meshFromCsgResult(csgObject, fallbackMaterial) {
    if (!csgObject) return null;
    if (csgObject.isMesh) {
        return coerceMeshMaterialForRaycast(csgObject, fallbackMaterial);
    }
    if (csgObject.geometry) {
        const mesh = new THREE.Mesh(csgObject.geometry, csgObject.material || fallbackMaterial);
        trackDisposableResource(mesh);
        if (csgObject.matrix) {
            mesh.applyMatrix4(csgObject.matrix);
        } else {
            mesh.position.copy(csgObject.position);
            mesh.rotation.copy(csgObject.rotation);
            mesh.scale.copy(csgObject.scale);
        }
        return coerceMeshMaterialForRaycast(mesh, fallbackMaterial);
    }
    return null;
}

/**
 * CSG boolean result may be Brush; material array may have undefined slots (hole walls/door frames).
 * @param {*} csgOrMesh
 * @param {THREE.Material|THREE.Material[]} fallbackMaterialLike
 * @returns {THREE.Mesh|*}
 */
function finalizeCsgBoxMeshResult(csgOrMesh, fallbackMaterialLike) {
    if (!csgOrMesh) {
        return csgOrMesh;
    }
    if (csgOrMesh.isMesh === true) {
        return coerceMeshMaterialForRaycast(csgOrMesh, fallbackMaterialLike);
    }
    const mesh = meshFromCsgResult(csgOrMesh, fallbackMaterialLike);
    return mesh || csgOrMesh;
}

/**
 * Merge multi-segment box geometry via geometryArr / materialArr into single Mesh; optional CSG on combineArr (union/intersect/subtract).
 * @param {object} boxObj Requires merge===true and geometryArr.length === materialArr.length
 * @returns {THREE.Mesh|undefined}
 */
function createMergeBox(boxObj){
    if(!boxObj || !boxObj.merge || !boxObj.geometryArr ||!boxObj.materialArr || boxObj.geometryArr.length !== boxObj.materialArr.length){
        return;
    }
    let geometryList = [];
    let materialList = [];
    // Create merged boxes
    for(let i = 0; i < boxObj.geometryArr.length; i++){
        let matrix4 = new THREE.Matrix4();
        if(boxObj.transforms && boxObj.transforms.length && boxObj.transforms.length === boxObj.geometryArr.length){
            const transform = boxObj.transforms[i];
            matrix4 = colTransMatrix(transform);
            trackDisposableResource(matrix4);
        }
        let geometry;
        if(boxObj.geometryArr[i]){
            boxObj.geometryArr[i].width = boxObj.geometryArr[i].width ? boxObj.geometryArr[i].width : 1;
            boxObj.geometryArr[i].height = boxObj.geometryArr[i].height ? boxObj.geometryArr[i].height : 1;
            boxObj.geometryArr[i].depth = boxObj.geometryArr[i].depth ? boxObj.geometryArr[i].depth : 1;
            geometry = new THREE.BoxGeometry(boxObj.geometryArr[i].width, boxObj.geometryArr[i].height, boxObj.geometryArr[i].depth); // Create box geometry
            trackDisposableResource(geometry)
        }
        else{
            geometry = new THREE.BoxGeometry(1, 1, 1);
            trackDisposableResource(geometry)
        }
        const mergedMatSrc = boxObj.materialArr[i];
        const mr = mergedMatSrc && mergedMatSrc.textureRepeat ? mergedMatSrc.textureRepeat : {};
        let material;
        if ("dynamicBox" === boxObj.materialArr[i].type) {
            material = new THREE.MeshStandardMaterial({
                map: safeMaterialMap(boxObj.materialArr[i].map),
                color: boxObj.materialArr[i].color ? boxObj.materialArr[i].color : '',
                transparent: boxObj.materialArr[i].transparent ? boxObj.materialArr[i].transparent : false,
                opacity: boxObj.materialArr[i].opacity ? boxObj.materialArr[i].opacity : 1,
                visible: false !== boxObj.visible,
                depthTest: boxObj.materialArr[i].depthTest ? boxObj.materialArr[i].depthTest : true,
                ...standardMaterialPbrFromJson(boxObj.materialArr[i]),
            });
            trackDisposableResource(material)
        }
        else if("phong" === boxObj.materialArr[i].type){
            material = new THREE.MeshPhongMaterial({
                map: safeMaterialMap(boxObj.materialArr[i].map),
                color: boxObj.materialArr[i].color ? boxObj.materialArr[i].color : '',
                transparent : boxObj.materialArr[i].transparent ? boxObj.materialArr[i].transparent : false,
                opacity: boxObj.materialArr[i].opacity ? boxObj.materialArr[i].opacity : 1,
                depthTest: boxObj.materialArr[i].depthTest ? boxObj.materialArr[i].depthTest : true,
            });
            trackDisposableResource(material)
        }
        else if ("lambert" === boxObj.materialArr[i].type) {
            material = new THREE.MeshLambertMaterial({
                map: safeMaterialMap(boxObj.materialArr[i].map),
                color: boxObj.materialArr[i].color ? boxObj.materialArr[i].color : '',
                transparent: boxObj.materialArr[i].transparent ? boxObj.materialArr[i].transparent : false,
                opacity: boxObj.materialArr[i].opacity ? boxObj.materialArr[i].opacity : 1,
                visible: false !== boxObj.visible,
                depthTest: boxObj.materialArr[i].depthTest ? boxObj.materialArr[i].depthTest : true,
            });
            trackDisposableResource(material)
        }
        else if ("standard" === boxObj.materialArr[i].type) {
            const mm = boxObj.materialArr[i];
            material = new THREE.MeshStandardMaterial({
                map: safeMaterialMap(mm.map),
                color: valueOr(mm.color, ''),
                transparent: valueOr(mm.transparent, false),
                opacity: valueOr(mm.opacity, 1),
                visible: false !== boxObj.visible,
                depthTest: valueOr(mm.depthTest, true),
                ...standardMaterialPbrFromJson(mm),
            });
            trackDisposableResource(material)
        }
        else if (jsonMaterialPrefersStandardPbr(boxObj.materialArr[i])) {
            const mm = boxObj.materialArr[i] || {};
            material = new THREE.MeshStandardMaterial({
                map: safeMaterialMap(mm.map),
                color: mm.color ? mm.color : "#cccccc",
                transparent: mm.transparent ? mm.transparent : false,
                opacity: mm.opacity ? mm.opacity : 1,
                visible: false !== boxObj.visible,
                depthTest: mm.depthTest ? mm.depthTest : true,
                ...standardMaterialPbrFromJson(mm),
            });
            trackDisposableResource(material)
        }
        else {
            const mm = boxObj.materialArr[i] || {};
            material = new THREE.MeshLambertMaterial({
                map: safeMaterialMap(mm.map),
                color: mm.color ? mm.color : "#cccccc",
                transparent: mm.transparent ? mm.transparent : false,
                opacity: mm.opacity ? mm.opacity : 1,
                visible: false !== boxObj.visible,
                depthTest: mm.depthTest ? mm.depthTest : true,
            });
            trackDisposableResource(material)
        }
        if (material && mergedMatSrc) {
            applyTextureFromMaterialJsonToThreeMaterial(material, mergedMatSrc, {
                defaultRepeatX: valueOr(mr.x, TEXTURE_REPEAT_DEFAULT.x),
                defaultRepeatY: valueOr(mr.y, TEXTURE_REPEAT_DEFAULT.y)
            });
        }
        geometry.applyMatrix4(matrix4);
        geometryList.push(geometry);
        materialList.push(material);
    }
    // Merge models
    let mergedGeometries = BufferGeometryUtils.mergeGeometries(geometryList, true);
    trackDisposableResource(mergedGeometries)
    let singleMergeMesh = new THREE.Mesh(mergedGeometries, materialList);
    trackDisposableResource(singleMergeMesh)
    singleMergeMesh.receiveShadow = meshReceiveShadowFromMaterials(boxObj.materialArr);
    let resultMesh = singleMergeMesh;
    if (boxObj.combineArr && boxObj.combineArr.length > 0) {
        let hasCsgOps = false;
        for (let t = 0; t < boxObj.combineArr.length; t++) {
            const combine = boxObj.combineArr[t];
            if (
                (combine.joins && combine.joins.length > 0)
                || (combine.inters && combine.inters.length > 0)
                || (combine.holes && combine.holes.length > 0)
            ) {
                hasCsgOps = true;
                break;
            }
        }
        if (hasCsgOps) {
            let tempMesh = singleMergeMesh.clone();
            trackDisposableResource(tempMesh);
            for (let t = 0; t < boxObj.combineArr.length; t++) {
                const combine = boxObj.combineArr[t];
                if (combine.joins && combine.joins.length > 0) {
                    for (let i = 0; i < combine.joins.length; i++) {
                        const joinMesh = createBox(combine.joins[i]);
                        tempMesh = evaluateMeshBoolean(tempMesh, joinMesh, "add");
                    }
                }
                if (combine.inters && combine.inters.length > 0) {
                    for (let i = 0; i < combine.inters.length; i++) {
                        const interMesh = createBox(combine.inters[i]);
                        tempMesh = evaluateMeshBoolean(tempMesh, interMesh, "inter");
                    }
                }
                if (combine.holes && combine.holes.length > 0) {
                    for (let i = 0; i < combine.holes.length; i++) {
                        const holeMesh = createBox(combine.holes[i]);
                        tempMesh = evaluateMeshBoolean(tempMesh, holeMesh, "sub");
                    }
                }
            }
            const normalized = meshFromCsgResult(tempMesh, singleMergeMesh.material);
            if (normalized) {
                resultMesh = normalized;
            }
        }
    }
    if (boxObj.boxInfoId) {
        resultMesh.name = boxObj.boxInfoId.toString();
    } else {
        resultMesh.name = "newModel";
    }
    resultMesh.name = boxObj && boxObj.name ? boxObj.name : "newModel";
    setUserDataObjJson(resultMesh, boxObj);
    recomputeMeshBounds(resultMesh);
    return resultMesh;
}

/**
 * Fill six-face textureUrl, async load textures, delegate to {@link createNormalBox}; untextured falls back to normal box.
 * @param {object} boxObj
 * @returns {THREE.Mesh|THREE.InstancedMesh|undefined}
 */
function createTextureBox(boxObj) {
    if(!boxObj) {
        return;
    }
    const record = cloneJson(boxObj);
    const faceJsonList = fillMissingBoxFaceTextureUrls(record);
    if(!faceJsonList){
        return createNormalBox(record, { skipClone: true });
    }
    return createNormalBox(record, { skipClone: true, applyTexturesFromJson: true });
}

/**
 * Load material.textureUrl then delegate to {@link createNormalSphere}; missing texture falls back to untextured sphere.
 * @param {object} sphereObj
 * @returns {THREE.Mesh|undefined}
 */
function createTextureSphere(sphereObj) {
    return createSingleMaterialPrimitiveMesh(sphereObj, "sphere", { ensureTexture: true });
}

function createCylinder(cylinderObj) {
    return createSingleMaterialPrimitiveMesh(cylinderObj, "cylinder", {
        ensureTexture: jsonMaterialTextureUrlResolvable(getPrimitiveMaterialJson(cylinderObj))
    });
}

function createCone(coneObj) {
    return createSingleMaterialPrimitiveMesh(coneObj, "cone", {
        ensureTexture: jsonMaterialTextureUrlResolvable(getPrimitiveMaterialJson(coneObj))
    });
}

function createRing(ringObj) {
    return createSingleMaterialPrimitiveMesh(ringObj, "ring", {
        ensureTexture: jsonMaterialTextureUrlResolvable(getPrimitiveMaterialJson(ringObj))
    });
}

function createTorus(torusObj) {
    return createSingleMaterialPrimitiveMesh(torusObj, "torus", {
        ensureTexture: jsonMaterialTextureUrlResolvable(getPrimitiveMaterialJson(torusObj))
    });
}

function createCapsule(capsuleObj) {
    return createSingleMaterialPrimitiveMesh(capsuleObj, "capsule", {
        ensureTexture: jsonMaterialTextureUrlResolvable(getPrimitiveMaterialJson(capsuleObj))
    });
}

function createPrimitiveByType(primitiveObj, shapeType) {
    if ("sphere" === shapeType) {
        return createSphere(primitiveObj);
    }
    if ("cylinder" === shapeType) {
        return createCylinder(primitiveObj);
    }
    if ("cone" === shapeType) {
        return createCone(primitiveObj);
    }
    if ("ring" === shapeType) {
        return createRing(primitiveObj);
    }
    if ("torus" === shapeType) {
        return createTorus(primitiveObj);
    }
    if ("capsule" === shapeType) {
        return createCapsule(primitiveObj);
    }
    return createBox(primitiveObj);
}

/**
 * Box entry: boxType==='sphere' uses sphere; else textureUrl/multi-face materials use textured box, else untextured box.
 * @param {object} boxObj
 * @returns {THREE.Mesh|THREE.InstancedMesh|undefined}
 */
function createBox(boxObj) {
    if(!boxObj) {
        log.error("Failed to create box: invalid box data!")
        return;
    }
    const primitiveShapeType = resolvePrimitiveShapeType(boxObj);
    if("box" !== primitiveShapeType) {
        return createPrimitiveByType(boxObj, primitiveShapeType);
    }
    // Textured box (textureUrl, parseable URL in map, or six-face materials triggers texture resolution branch)
    if (
        jsonMaterialTextureUrlResolvable(boxObj.material)
        || boxObj.materials
    ) {
        return createTextureBox(boxObj);
    }
    return createNormalBox(boxObj);
}

/**
 * Create box Mesh and add to scene.
 * @param {object} boxObj JSON box descriptor
 * @param {THREE.Scene|THREE.Object3D} scene
 */
function deployBox(boxObj, scene) {
    if(!boxObj || !scene) {
        return;
    }
    const boxMesh = createBox(boxObj);
    if(boxMesh) {
        scene.add(boxMesh);
        registerObject(boxMesh, boxObj);
    }
}

/**
 * Sphere entry: may convert to box via boxType==='box'; textured uses {@link createTextureSphere}, else {@link createNormalSphere}.
 * @param {object} sphereObj
 * @returns {THREE.Mesh|THREE.InstancedMesh|undefined}
 */
function createSphere(sphereObj) {
    const primitiveShapeType = resolvePrimitiveShapeType(sphereObj);
    if("box" === primitiveShapeType) {
        return createBox(sphereObj);
    }
    if("sphere" !== primitiveShapeType) {
        return createPrimitiveByType(sphereObj, primitiveShapeType);
    }
    const materialJson = getPrimitiveMaterialJson(sphereObj);
    if (materialJson && jsonMaterialTextureUrlResolvable(materialJson)) {
        return createTextureSphere(sphereObj);
    }
    else {
        return createNormalSphere(sphereObj);
    }
}

/**
 * Create sphere mesh via {@link superCreateMesh} and add to scene.
 * @param {object} sphereObj
 * @param {THREE.Scene|THREE.Object3D} scene
 */
function deploySphere(sphereObj, scene) {
    if(!sphereObj || !scene) {
        return;
    }
    let sphereMesh = superCreateMesh(sphereObj);
    if(sphereMesh){
        scene.add(sphereMesh);
        registerObject(sphereMesh, sphereObj);
    }
}

/**
 * Dispatch between box/sphere factories by boxType; pairs with {@link deployMesh}.
 * @param {object} boxObj
 * @returns {THREE.Mesh|THREE.InstancedMesh|undefined}
 */
function createMesh(boxObj) {
    if(!boxObj) {
        return;
    }
    const primitiveShapeType = resolvePrimitiveShapeType(boxObj);
    if("box" !== primitiveShapeType) {
        return createPrimitiveByType(boxObj, primitiveShapeType);
    }
    return createBox(boxObj);
}

/**
 * Create box or sphere mesh by boxType and add to scene.
 * @param {object} boxObj
 * @param {THREE.Scene|THREE.Object3D} scene
 */
function deployMesh(boxObj, scene) {
    if(!boxObj) {
        return;
    }
    let mesh = createMesh(boxObj);
    if(mesh) {
        scene.add(mesh)
        registerObject(mesh, boxObj);
    }
}

/**
 * Create empty group container; children mounted recursively via descriptor.subScene on deploy path.
 * @param {object} groupObj group descriptor
 * @returns {THREE.Group|null}
 */
function createGroup(groupObj){
    if(!groupObj){
        return;
    }
    let groupName = groupObj.name ? groupObj.name : "newGroup";
    let group = new THREE.Group();
    trackDisposableResource(group);
    applyObjectTransform(group, groupObj);
    group.name = groupName;
    setUserDataObjJson(group, groupObj);
    return registerObject(group, groupObj);
}

/**
 * @param {"line"|"lineSegments"|"lineLoop"} topology
 * @returns {typeof THREE.Line}
 */
function lineObject3DClassForTopology(topology) {
    if (topology === "lineSegments") {
        return THREE.LineSegments;
    }
    if (topology === "lineLoop") {
        return THREE.LineLoop;
    }
    return THREE.Line;
}

/**
 * Whether textured plane enables UV scroll (wind field or explicit motion).
 * @param {object} planeObj
 * @returns {boolean}
 */
function shouldPlaneScrollTexture(planeObj) {
    return shouldPlaneScrollFromDescriptor(planeObj);
}

/**
 * Create polyline with THREE.Line (1px width only; use createLine2 for wide lines).
 * @param {object} lineObj Includes points: {x,y,z}[], material, name, objType
 * @returns {THREE.Line|null}
 */
function createLine(lineObj){
    if(!lineObj || !lineObj.points || lineObj.points.length <= 0){
        return;
    }
    let material = new THREE.LineBasicMaterial( { color: 0xffffff } );
    trackDisposableResource(material)
    if(lineObj.material){
        material = new THREE.LineBasicMaterial({
            color: valueOr(lineObj.material.color, '0xffffff'),
            transparent : valueOr(lineObj.material.transparent, false),
            opacity: valueOr(lineObj.material.opacity, 1),
            linecap: lineObj.material.linecap ? lineObj.material.linecap : 'round',
            linejoin: lineObj.material.linejoin ? lineObj.material.linejoin : 'round',
            fog: valueOr(lineObj.material.fog, true)
        })
    }
    let points = [];
    for(let i = 0; i < lineObj.points.length; i++){
        let point = lineObj.points[i];
        if(!point){
            continue;
        }
        points.push( new THREE.Vector3( point.x, point.y, point.z ))
    }
    const topology = normalizeLineTopology(lineObj);
    let geometry = new THREE.BufferGeometry().setFromPoints( points );
    trackDisposableResource(geometry)
    const LineClass = lineObject3DClassForTopology(topology);
    let line = new LineClass(geometry, material );
    trackDisposableResource(line)
    line.name = lineObj.name ? lineObj.name : "newLine";
    line.objType = lineObj.objType ? lineObj.objType : "line";
    setUserDataObjJson(line, lineObj);
    return registerObject(line, lineObj);
}

/**
 * Create adjustable-width polyline with Line2 + LineMaterial.
 * @param {object} lineObj Includes points, material.linewidth, etc.
 * @returns {Line2|null}
 */
function createLine2(lineObj){
    if(!lineObj || !lineObj.points || lineObj.points.length <= 0){
        return;
    }
    const topology = normalizeLineTopology(lineObj);
    if (topology !== "line") {
        log.warn("[createLine2] topology", topology, "topology does not support adjustable line width, fell back to createLine");
        return createLine(lineObj);
    }
    let material = new LineMaterial( { color: 0xffffff } );
    trackDisposableResource(material)
    if(lineObj.material){
        material = new LineMaterial({
            color: valueOr(lineObj.material.color, '0xffffff'),
            transparent : valueOr(lineObj.material.transparent, false),
            opacity: valueOr(lineObj.material.opacity, 1),
            linewidth: valueOr(lineObj.material.linewidth, 1),
            linecap: lineObj.material.linecap ? lineObj.material.linecap : 'round',
            linejoin: lineObj.material.linejoin ? lineObj.material.linejoin : 'round',
            fog: valueOr(lineObj.material.fog, true)
        })
    }
    // Set material resolution
    material.resolution.set(window.innerWidth, window.innerHeight);
    let points = [];
    for(let i = 0; i < lineObj.points.length; i++){
        let point = lineObj.points[i];
        if(!point){
            continue;
        }
        points.push(point.x)
        points.push(point.y)
        points.push(point.z)
    }
    let geometry = new LineGeometry();
    trackDisposableResource(geometry)
    geometry.setPositions(points);
    let line = new Line2(geometry, material );
    trackDisposableResource(line)
    // Compute line width
    line.computeLineDistances();
    line.name = lineObj.name ? lineObj.name : "newLine";
    line.objType = lineObj.objType ? lineObj.objType : "line";
    setUserDataObjJson(line, lineObj);
    return registerObject(line, lineObj);
}

/**
 * Create dynamic wind field plane (flowing-texture Plane, objType `wind`).
 * @param {object} windObj
 * @param {THREE.Scene} scene
 */
function createWind(windObj, scene) {
    if (!windObj || !scene) {
        return null;
    }
    const record = { ...windObj, objType: windObj.objType || "wind" };
    if (deployByObjTypeExtension(record, scene)) {
        return null;
    }
    log.warn("[modelBuilder] createWind: register wind deployer (import from \"threejson\")");
    return null;
}

/**
 * Textured plane branch: assemble Mesh and add to scene after THREE.Texture (including VideoTexture) is ready.
 * @returns {THREE.Object3D|null}
 */
function finishTexturedPlane(planeObj, scene, materialInfo, geometryInfo, position, rotation, texture) {
    const textureRepeat = materialInfo.textureRepeat || {};
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(valueOr(textureRepeat.x, 1), valueOr(textureRepeat.y, 1));
    if (shouldPlaneScrollTexture(planeObj)) {
        texture.offset.x = 0;
        texture.offset.y = valueOr(texture.offset.y, 0);
    }
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        color: valueOr(materialInfo.color, "#ffffff"),
        transparent: valueOr(materialInfo.transparent, false),
        opacity: valueOr(materialInfo.opacity, 1),
        side: THREE.DoubleSide
    });
    trackDisposableResource(material);
    if (materialInfo.side) {
        if ("double" === materialInfo.side) {
            material.side = THREE.DoubleSide;
        } else if ("front" === materialInfo.side) {
            material.side = THREE.FrontSide;
        } else if ("back" === materialInfo.side) {
            material.side = THREE.BackSide;
        } else {
            material.side = THREE.DoubleSide;
        }
    }
    const geometry = new THREE.PlaneGeometry(valueOr(geometryInfo.width, 1), valueOr(geometryInfo.height, 1));
    trackDisposableResource(geometry);
    const plane = new THREE.Mesh(geometry, material);
    trackDisposableResource(plane);
    plane.position.set(position.x, position.y, position.z);
    plane.rotation.set(rotation.rotationX, rotation.rotationY, rotation.rotationZ, "XYZ");
    const scale = normalizeScale(planeObj.scale);
    plane.scale.set(scale.scaleX, scale.scaleY, scale.scaleZ);
    setUserDataObjJson(plane, planeObj);
    applyVisibilityFromDescriptor(plane, planeObj);
    scene.add(plane);
    const registered = registerObject(plane, planeObj);
    setupPlaneScrollMotion(plane, planeObj);
    return registered;
}

/**
 * Create textured or solid-color plane and add to scene; for wind, decorative quads, etc.
 * @param {object} planeObj geometry、material、position、rotation
 * @param {THREE.Scene} scene
 * @returns {THREE.Mesh|null}
 */
function createPlane(planeObj, scene){
    if(!planeObj){
        return null;
    }
    if (!planeObj.objType) {
        planeObj.objType = "plane";
    }
    const materialInfo = planeObj.material || {};
    const geometryInfo = planeObj.geometry || {};
    const position = normalizePosition(planeObj.position);
    const rotation = normalizeRotation(planeObj.rotation);
    if(planeObj.material && planeObj.material.textureUrl){
        const texUrl = String(planeObj.material.textureUrl).trim();
        if (normalizeMaterialTextureKind(materialInfo) === "video") {
            attachVideoTextureFromMaterialJson(materialInfo, texUrl, {
                wrapRepeat: true,
                defaultRepeatX: valueOr((materialInfo.textureRepeat || {}).x, 1),
                defaultRepeatY: valueOr((materialInfo.textureRepeat || {}).y, 1)
            });
            return finishTexturedPlane(planeObj, scene, materialInfo, geometryInfo, position, rotation, materialInfo.map);
        }
        if (normalizeMaterialTextureKind(materialInfo) === "gif") {
            attachGifCanvasTextureFromMaterialJson(materialInfo, texUrl, {
                wrapRepeat: true,
                defaultRepeatX: valueOr((materialInfo.textureRepeat || {}).x, 1),
                defaultRepeatY: valueOr((materialInfo.textureRepeat || {}).y, 1)
            });
            return finishTexturedPlane(planeObj, scene, materialInfo, geometryInfo, position, rotation, materialInfo.map);
        }
        textureLoader.load(texUrl, function(texture){
            finishTexturedPlane(planeObj, scene, materialInfo, geometryInfo, position, rotation, texture);
        })
    }
    else{
        let material = new THREE.MeshBasicMaterial({
            color: valueOr(materialInfo.color, '#ffffff'),
            transparent : valueOr(materialInfo.transparent, false),
            opacity: valueOr(materialInfo.opacity, 1)
        });
        trackDisposableResource(material)
        if(materialInfo.side){
            if("double" === materialInfo.side){
                material.side = THREE.DoubleSide;
            }
            else if("front" === materialInfo.side){
                material.side = THREE.FrontSide;
            }
            else if("back" === materialInfo.side){
                material.side = THREE.BackSide;
            }
        }
        let geometry = new THREE.PlaneGeometry(valueOr(geometryInfo.width, 1), valueOr(geometryInfo.height, 1));
        trackDisposableResource(geometry)
        if(planeObj.objType && "wind" === planeObj.objType){
            //new TWEEN.Tween(plane.material.map.offset).to({X:  0}, 0.001).easing(TWEEN.Easing.Linear.None).repeat(Infinity).start();
            material.forceSinglePass = true;
            material.needsUpdate = true;
        }
        let plane = new THREE.Mesh( geometry, material );
        trackDisposableResource(plane)
        plane.position.set(position.x, position.y, position.z);
        plane.rotation.set(rotation.rotationX, rotation.rotationY, rotation.rotationZ, 'XYZ');
        const scale = normalizeScale(planeObj.scale);
        plane.scale.set(scale.scaleX, scale.scaleY, scale.scaleZ);
        setUserDataObjJson(plane, planeObj);
        applyVisibilityFromDescriptor(plane, planeObj);
        scene.add(plane);
        const registered = registerObject(plane, planeObj);
        setupPlaneScrollMotion(plane, planeObj);
        return registered;
    }
}

/**
 * @param {object} planeObj
 * @param {THREE.Scene} scene
 * @returns {THREE.Mesh|null|undefined}
 */
function deployPlane(planeObj, scene) {
    return createPlane(planeObj, scene);
}

/**
 * Untextured sphere (SphereGeometry and various Mesh*Material).
 * @param {object} sphereObj Sphere JSON
 * @returns {THREE.Mesh|undefined}
 */
function createNormalSphere(sphereObj) {
    return createSingleMaterialPrimitiveMesh(sphereObj, "sphere");
}

/**
 * JSON flat heatmap: heatMap point array + temperature. Always uses createHeatmapMesh; **ignores** geometry.depth even if present.
 * @param {object} heatObj
 * @param {THREE.Scene} scene
 */
function createHeatmap(heatObj, scene) {
    if (!heatObj || !heatObj.heatMap || !scene) {
        return;
    }
    const pw = heatObj.geometry?.width ?? 1;
    const ph = heatObj.geometry?.height ?? 1;
    heatObj.objType = 'heatMap';

    const texSize = defaultTextureDimensions(pw, ph);
    const sigmaBase = (200 / 2.5) * (texSize.width / Math.max(pw, 1e-6));
    const mesh = createHeatmapMesh(THREE, {
        plane: { width: pw, height: ph },
        textureSize: texSize,
        points: heatObj.heatMap,
        valueKey: 'temperature',
        valueRange: { min: 0, max: 35 },
        composition: 'add',
        sigmaScaleWithValue: true,
        sigmaBasePixels: sigmaBase,
        colormapStops: HEATMAP_LEGACY_COLOR_STOPS,
        transform: {
            position: heatObj.position,
            rotation: heatObj.rotation,
            scale: heatObj.scale
        },
        userDataObjJson: heatObj,
        material: heatObj.material || {}
    });
    applyVisibilityFromDescriptor(mesh, heatObj);
    scene.add(mesh);
    registerObject(mesh, heatObj);
}

/**
 * 3D volume heatmap; **degrades** to {@link createHeatmap} when geometry.depth is invalid or missing.
 * @param {object} heatObj
 * @param {THREE.Scene} scene
 */
function createHeatmapVolume(heatObj, scene) {
    if (!heatObj || !heatObj.heatMap || !scene) {
        return;
    }
    const pw = heatObj.geometry?.width ?? 1;
    const ph = heatObj.geometry?.height ?? 1;
    const pd = Number(heatObj.geometry?.depth);
    heatObj.objType = 'heatMap';

    if (!Number.isFinite(pd) || pd <= 0) {
        createHeatmap(heatObj, scene);
        return;
    }

    const texSize = defaultTextureDimensions3D(pw, ph, pd);
    const sigmaBase = (200 / 2.5) * (texSize.width / Math.max(pw, 1e-6));
    const mesh = createHeatmapVolumeMesh(THREE, {
        volume: { width: pw, height: ph, depth: pd },
        textureSize: texSize,
        points: heatObj.heatMap,
        valueKey: 'temperature',
        valueRange: { min: 0, max: 35 },
        composition: 'add',
        sigmaScaleWithValue: true,
        sigmaBasePixels: sigmaBase,
        colormapStops: HEATMAP_LEGACY_COLOR_STOPS_VOLUME,
        transform: {
            position: heatObj.position,
            rotation: heatObj.rotation,
            scale: heatObj.scale
        },
        userDataObjJson: heatObj,
        material: heatObj.material || {},
        volumeRender: heatObj.volumeRender || {}
    });
    applyVisibilityFromDescriptor(mesh, heatObj);
    scene.add(mesh);
    registerObject(mesh, heatObj);
}

/**
 * Async load GLTF/GLB (with Draco) and add to scene or camera (attachTo: "camera").
 * @param {object} glbObj Includes modelPath, position, scale, rotation, optional attachTo
 * @param {THREE.Scene} scene
 * @param {{ camera?: THREE.PerspectiveCamera|null }} [loadOptions]
 */
function loadGltf(glbObj, scene, loadOptions = {}) {
    if(!glbObj || !glbObj.modelPath){
        return;
    }
    // Initialize GLTF model loader
    const gltfLoader = new GLTFLoader(modelLoadingManager);
    trackDisposableResource(gltfLoader)
    // Draco-compressed GLTF/GLB requires DRACOLoader decoding.
    const dracoLoader = new DRACOLoader()
    trackDisposableResource(dracoLoader)
    dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/draco/gltf/')
    gltfLoader.setDRACOLoader(dracoLoader)
    const resolvedPath = resolveAssetUrl("", glbObj.modelPath);
    if (!resolvedPath) {
        log.warn("[loadGltf] cannot resolve modelPath:", glbObj.modelPath);
        return;
    }
    gltfLoader.load(resolvedPath, (gltf) => {
            // Track loaded GLTF model for memory cleanup
            let model = gltf.scene;
            trackDisposableResource(model)
            const attachTo = normalizeAttachTo(glbObj);
            let placedOnCamera = false;
            if (attachTo === "camera" && loadOptions.camera && loadOptions.scene?.isScene) {
                const placed = placeLoadedModelByAttachTarget(glbObj, model, loadOptions.scene, loadOptions);
                placedOnCamera = placed === "camera";
                if (placed === "unsupported") {
                    log.warn(
                        `[loadGltf] unsupported attachTo="${glbObj.attachTo}":`,
                        glbObj?.name || glbObj?.refName || resolvedPath
                    );
                }
            } else if (attachTo === "camera") {
                log.warn(
                    "[loadGltf] attachTo=camera but missing camera or scene, adding as normal model:",
                    glbObj?.name || glbObj?.refName || ""
                );
            } else if (attachTo) {
                log.warn(
                    `[loadGltf] unsupported attachTo="${glbObj.attachTo}", adding as normal model:`,
                    glbObj?.name || glbObj?.refName || resolvedPath
                );
            }
            if (!placedOnCamera) {
                if (shouldApplyRecordTransform(glbObj)) {
                    applyObjectTransform(model, glbObj);
                }
                scene.add(model);
            }
            registerObject(model, glbObj);
            tryRegisterGltfAnimationMixers(model, gltf, glbObj);
        },
        () => {},
        (error) => {
            log.error("[loadGltf] load failed:", resolvedPath, error)
        })
}

function inferExternalModelTypeFromPath(modelPath){
    if(typeof modelPath !== "string"){
        return "";
    }
    const normalized = modelPath.trim().split(/[?#]/)[0];
    const dotIndex = normalized.lastIndexOf(".");
    if(dotIndex < 0 || dotIndex >= normalized.length - 1){
        return "";
    }
    return normalized.slice(dotIndex + 1).trim().toLowerCase();
}

/**
 * Normalize external model type string; prefers modelFileType, legacy fields, then modelPath extension.
 * @param {object} modelInfo
 * @returns {string}
 */
const IGNORED_OBJ_TYPE_AS_MODEL_FILE = new Set([
    "externalmodel",
    "skinned",
    "points",
    "particles",
    "particle",
    "plane",
    "wind",
    "line",
    "heatmap",
    "infopanel",
    "sprite",
    "tube",
    "instanced",
    "domain",
    "group",
    "audio"
]);

function resolveExternalModelType(modelInfo){
    const candidates = [
        modelInfo?.modelFileType,
        modelInfo?.fileType,
        modelInfo?.objType
    ];
    for(let i = 0; i < candidates.length; i++){
        if(typeof candidates[i] !== "string"){
            continue;
        }
        const normalized = candidates[i].trim().toLowerCase();
        if(normalized && normalized !== "externalmodel" && !IGNORED_OBJ_TYPE_AS_MODEL_FILE.has(normalized)){
            return normalized;
        }
    }
    return inferExternalModelTypeFromPath(modelInfo?.modelPath);
}

/**
 * Skinned character: semantic objType skinned; loading still via glTF/GLB.
 * @param {object} record
 * @param {THREE.Scene} scene
 * @param {{ camera?: THREE.PerspectiveCamera|null }} [loadOptions]
 */
function loadSkinnedModel(record, scene, loadOptions = {}) {
    if (!record || !scene) {
        return;
    }
    if (!record.modelPath) {
        log.warn("[loadSkinnedModel] missing modelPath:", record?.name || "");
        return;
    }
    const payload = { ...record, objType: "skinned" };
    const fileType = resolveExternalModelType({
        modelPath: payload.modelPath,
        modelFileType: payload.modelFileType,
        fileType: payload.fileType
    });
    if (!fileType) {
        log.warn("[loadSkinnedModel] cannot resolve model type, defaulting to glb:", payload.modelPath);
        payload.modelFileType = "glb";
    } else if (!payload.modelFileType) {
        payload.modelFileType = fileType;
    }
    if (fileType === "gltf" || fileType === "glb") {
        loadGltf(payload, scene, loadOptions);
        return;
    }
    loadExternalModel(payload, scene, loadOptions);
}

function deployInstancedMesh(record, scene) {
    return deployInstancedMeshWithFactory(createInstanceBox, record, scene);
}

/**
 * Common finalize after STL/PLY/FBX/USDZ etc. buffer external model load.
 * @param {THREE.Object3D} object
 * @param {object} objInfo
 * @param {THREE.Scene} scene
 * @param {{ camera?: THREE.PerspectiveCamera|null, scene?: THREE.Scene }} [loadOptions]
 */
function finalizeExternalMeshObject(object, objInfo, scene, loadOptions = {}) {
    if (!object || !scene) {
        return;
    }
    trackDisposableResource(object);
    const attachTo = normalizeAttachTo(objInfo);
    let placedOnCamera = false;
    if (attachTo === "camera" && loadOptions.camera && loadOptions.scene?.isScene) {
        const placed = placeLoadedModelByAttachTarget(objInfo, object, loadOptions.scene, loadOptions);
        placedOnCamera = placed === "camera";
    }
    if (!placedOnCamera) {
        if (shouldApplyRecordTransform(objInfo)) {
            applyObjectTransform(object, objInfo);
        }
        scene.add(object);
    }
    registerObject(object, objInfo);
}

/**
 * Common OBJ post-load: apply transform, optional unified material, add to scene.
 * @param {THREE.Object3D} object
 * @param {object} objInfo
 * @param {THREE.Scene} scene
 */
function finalizeObjObject(object, objInfo, scene, loadCtx = {}){
    if(!object || !scene){
        return;
    }
    applyObjectTransform(object, objInfo);
    const materialJson = getObjMaterialJson(objInfo);
    const texturePlanState = buildObjTexturePlans(objInfo, loadCtx);
    const forceStandardMaterial = objTexturePlansRequireStandardMaterial(texturePlanState.slotPlans, materialJson);
    object.traverse(function(child){
        if(!child.isMesh){
            return;
        }
        if(Array.isArray(child.material)){
            child.material = child.material.map(m => prepareObjMeshMaterial(m, materialJson, forceStandardMaterial));
        }
        else{
            child.material = prepareObjMeshMaterial(child.material, materialJson, forceStandardMaterial);
        }
        child.receiveShadow = valueOr(materialJson.receiveShadow, true);
    });
    if(texturePlanState.slotPlans){
        const slotNames = Object.keys(texturePlanState.slotPlans);
        for(let i = 0; i < slotNames.length; i++){
            const slotName = slotNames[i];
            loadObjTexturePlan(
                texturePlanState.slotPlans[slotName],
                function(tex){
                    applyTextureToObjObject(object, slotName, tex);
                },
                function(err){
                    if(texturePlanState.source === "json" || texturePlanState.source === "legacy"){
                        log.error(`OBJ ${slotName} texture load failed:`, texturePlanState.slotPlans[slotName].candidates, err);
                    }
                }
            );
        }
    }
    scene.add(object);
    registerObject(object, objInfo);
}

/**
 * Load `.obj` via OBJLoader; optionally preload `.mtl` and bind materials.
 * @param {object} objInfo
 * @param {THREE.Scene} scene
 */
function loadObjWithOptionalMtl(objInfo, scene){
    if(!objInfo || !objInfo.modelPath){
        return;
    }
    const modelPath = resolveAssetUrl("", objInfo.modelPath);
    const explicitMtlPath = objInfo.mtlPath || objInfo.materialPath || objInfo.mtlModelPath;
    readTextAsset(
        modelPath,
        function(objText){
            const objLibs = parseObjMaterialLibraries(objText);
            const modelBase = extractAssetBaseUrl(modelPath);
            const inferredMtlPath = hasText(explicitMtlPath)
                ? resolveAssetUrl(modelBase, explicitMtlPath)
                : (objLibs.length ? resolveAssetUrl(modelBase, objLibs[0]) : "");
            const parseObjWithLoader = (loader, effectiveMtlPath = "") => {
                try{
                    const obj = loader.parse(objText);
                    finalizeObjObject(obj, objInfo, scene, { effectiveMtlPath });
                }catch(error){
                    log.error("OBJ model parse failed:", objInfo.modelPath, error);
                }
            };
            if(!inferredMtlPath){
                parseObjWithLoader(new OBJLoader(modelLoadingManager), "");
                return;
            }
            const mtlLoader = new MTLLoader(modelLoadingManager);
            const resourceBase = extractAssetBaseUrl(inferredMtlPath);
            if(resourceBase){
                mtlLoader.setResourcePath(resourceBase);
            }
            mtlLoader.load(
                inferredMtlPath,
                function(materials){
                    materials.preload();
                    const objLoader = new OBJLoader(modelLoadingManager);
                    objLoader.setMaterials(materials);
                    parseObjWithLoader(objLoader, inferredMtlPath);
                },
                undefined,
                function(error){
                    log.error("MTL material load failed, continuing OBJ load without MTL:", inferredMtlPath, error);
                    parseObjWithLoader(new OBJLoader(modelLoadingManager), inferredMtlPath);
                }
            );
        },
        function(error){
            log.error("OBJ model load failed:", objInfo.modelPath, error);
        }
    );
}

/**
 * @param {object} glbObj
 * @param {THREE.Scene} scene
 * @param {{ camera?: THREE.PerspectiveCamera|null, scene?: THREE.Scene }} [loadOptions]
 * @returns {Promise<import("three").Object3D|null>}
 */
function loadGltfAsync(glbObj, scene, loadOptions = {}) {
  return new Promise((resolve, reject) => {
    if (!glbObj || !glbObj.modelPath) {
      resolve(null);
      return;
    }
    const gltfLoader = new GLTFLoader(modelLoadingManager);
    trackDisposableResource(gltfLoader);
    const dracoLoader = new DRACOLoader();
    trackDisposableResource(dracoLoader);
    dracoLoader.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/draco/gltf/");
    gltfLoader.setDRACOLoader(dracoLoader);
    const resolvedPath = resolveAssetUrl("", glbObj.modelPath);
    if (!resolvedPath) {
      reject(new Error(`[loadGltf] cannot resolve modelPath: ${glbObj.modelPath}`));
      return;
    }
    gltfLoader.load(
      resolvedPath,
      (gltf) => {
        const model = gltf.scene;
        trackDisposableResource(model);
        const attachTo = normalizeAttachTo(glbObj);
        let placedOnCamera = false;
        if (attachTo === "camera" && loadOptions.camera && loadOptions.scene?.isScene) {
          const placed = placeLoadedModelByAttachTarget(glbObj, model, loadOptions.scene, loadOptions);
          placedOnCamera = placed === "camera";
        }
        if (!placedOnCamera) {
          if (shouldApplyRecordTransform(glbObj)) {
            applyObjectTransform(model, glbObj);
          }
          scene.add(model);
        }
        registerObject(model, glbObj);
        tryRegisterGltfAnimationMixers(model, gltf, glbObj);
        resolve(model);
      },
      undefined,
      (error) => {
        log.error("[loadGltf] load failed:", resolvedPath, error);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/**
 * @param {object} objInfo
 * @param {THREE.Scene} scene
 * @returns {Promise<import("three").Object3D|null>}
 */
function loadObjWithOptionalMtlAsync(objInfo, scene) {
  return new Promise((resolve, reject) => {
    if (!objInfo || !objInfo.modelPath) {
      resolve(null);
      return;
    }
    const modelPath = resolveAssetUrl("", objInfo.modelPath);
    const explicitMtlPath = objInfo.mtlPath || objInfo.materialPath || objInfo.mtlModelPath;
    readTextAsset(
      modelPath,
      (objText) => {
        const objLibs = parseObjMaterialLibraries(objText);
        const modelBase = extractAssetBaseUrl(modelPath);
        const inferredMtlPath = hasText(explicitMtlPath)
          ? resolveAssetUrl(modelBase, explicitMtlPath)
          : objLibs.length
            ? resolveAssetUrl(modelBase, objLibs[0])
            : "";
        const parseObjWithLoader = (loader, effectiveMtlPath = "") => {
          try {
            const obj = loader.parse(objText);
            finalizeObjObject(obj, objInfo, scene, { effectiveMtlPath });
            resolve(obj);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };
        if (!inferredMtlPath) {
          parseObjWithLoader(new OBJLoader(modelLoadingManager), "");
          return;
        }
        const mtlLoader = new MTLLoader(modelLoadingManager);
        const resourceBase = extractAssetBaseUrl(inferredMtlPath);
        if (resourceBase) {
          mtlLoader.setResourcePath(resourceBase);
        }
        mtlLoader.load(
          inferredMtlPath,
          (materials) => {
            materials.preload();
            const objLoader = new OBJLoader(modelLoadingManager);
            objLoader.setMaterials(materials);
            parseObjWithLoader(objLoader, inferredMtlPath);
          },
          undefined,
          () => {
            parseObjWithLoader(new OBJLoader(modelLoadingManager), inferredMtlPath);
          }
        );
      },
      (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

/**
 * @param {object} modelInfo
 * @param {THREE.Scene} scene
 * @param {{ loadingManager?: import("three").LoadingManager }} [deps]
 * @returns {Promise<import("three").Object3D|null>}
 */
function loadThreeNativeObjectJsonFromUrlAsync(modelInfo, scene, deps = {}) {
  return new Promise((resolve, reject) => {
    if (!modelInfo?.modelPath || !scene) {
      resolve(null);
      return;
    }
    const manager = deps.loadingManager ?? modelLoadingManager;
    const LoaderCtor = THREE.ObjectLoader;
    const loader = manager ? new LoaderCtor(manager) : new LoaderCtor();
    if (typeof modelInfo.path === "string" && modelInfo.path !== "") {
      loader.setPath(modelInfo.path);
    }
    const rp = typeof modelInfo.resourcePath === "string" ? modelInfo.resourcePath.trim() : "";
    if (rp !== "") {
      loader.setResourcePath(rp.endsWith("/") ? rp : `${rp}/`);
    }
    if (typeof modelInfo.crossOrigin === "string") {
      loader.setCrossOrigin(modelInfo.crossOrigin);
    }
    loader.load(
      modelInfo.modelPath,
      (object) => {
        trackDisposableResource(object);
        applyObjectTransform(object, modelInfo);
        object.visible = modelInfo.visible !== false;
        scene.add(object);
        registerObject(object, modelInfo);
        resolve(object);
      },
      undefined,
      (err) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

/**
 * @param {object} modelInfo
 * @param {THREE.Scene} scene
 * @param {{ camera?: THREE.PerspectiveCamera|null, scene?: THREE.Scene }} [loadOptions]
 */
function loadBufferExternalModel(modelInfo, scene, loadOptions = {}) {
    if (!modelInfo || !modelInfo.modelPath) {
        return;
    }
    const externalType = resolveExternalModelType(modelInfo);
    const modelPath = resolveAssetUrl("", modelInfo.modelPath);
    if (!modelPath) {
        log.error("[loadBufferExternalModel] cannot resolve modelPath:", modelInfo.modelPath);
        return;
    }
    const resourceBase = extractAssetBaseUrl(modelPath);
    readArrayBufferAsset(
        modelPath,
        function(buffer) {
            parseMeshArrayBufferToObject3D(externalType, buffer, {
                resourcePath: resourceBase,
                fileName: modelInfo.modelPath,
                loadingManager: modelLoadingManager
            })
                .then(function(object) {
                    finalizeExternalMeshObject(object, modelInfo, scene, loadOptions);
                })
                .catch(function(error) {
                    log.error("External model parse failed:", modelInfo.modelPath, error);
                });
        },
        function(error) {
            log.error("External model load failed:", modelInfo.modelPath, error);
        }
    );
}

/**
 * @param {object} modelInfo
 * @param {THREE.Scene} scene
 * @param {{ camera?: THREE.PerspectiveCamera|null, scene?: THREE.Scene }} [loadOptions]
 * @returns {Promise<import("three").Object3D|null>}
 */
async function loadBufferExternalModelAsync(modelInfo, scene, loadOptions = {}) {
    if (!modelInfo || !modelInfo.modelPath) {
        return null;
    }
    const externalType = resolveExternalModelType(modelInfo);
    const modelPath = resolveAssetUrl("", modelInfo.modelPath);
    if (!modelPath) {
        throw new Error(`[loadBufferExternalModel] cannot resolve modelPath: ${modelInfo.modelPath}`);
    }
    const resourceBase = extractAssetBaseUrl(modelPath);
    const buffer = await readMeshArrayBufferFromUrl(modelPath, modelLoadingManager);
    const object = await parseMeshArrayBufferToObject3D(externalType, buffer, {
        resourcePath: resourceBase,
        fileName: modelInfo.modelPath,
        loadingManager: modelLoadingManager
    });
    finalizeExternalMeshObject(object, modelInfo, scene, loadOptions);
    return object;
}

function createExternalModelUnsupportedError(externalType) {
    const error = new Error(
        `E_EXTERNAL_MODEL_UNSUPPORTED: unsupported external model type "${externalType}"`
    );
    error.code = "E_EXTERNAL_MODEL_UNSUPPORTED";
    return error;
}

/**
 * External model Promise entry (for deployScheduler phase3 concurrency pool).
 * @param {object} modelInfo
 * @param {THREE.Scene} scene
 * @param {{ camera?: THREE.PerspectiveCamera|null, scene?: THREE.Scene }} [loadOptions]
 * @returns {Promise<import("three").Object3D|null>}
 */
export function loadExternalModelAsync(modelInfo, scene, loadOptions = {}) {
  if (!modelInfo || !modelInfo.modelPath) {
    return Promise.resolve(null);
  }
  const externalType = resolveExternalModelType(modelInfo);
  if (!externalType) {
    return Promise.reject(
      new Error("External model type resolution failed: provide modelFileType or use recognizable modelPath extension")
    );
  }
  const sceneForAttach = loadOptions.scene?.isScene ? loadOptions.scene : scene;
  const opts = { ...loadOptions, scene: sceneForAttach };
  if (externalType === "gltf" || externalType === "glb") {
    return loadGltfAsync(modelInfo, scene, opts);
  }
  if (isThreeNativeJsonFileType(externalType)) {
    return loadThreeNativeObjectJsonFromUrlAsync(modelInfo, scene, {
      loadingManager: modelLoadingManager
    });
  }
  if (externalType === "obj") {
    return loadObjWithOptionalMtlAsync(modelInfo, scene);
  }
  if (isBufferExternalMeshType(externalType)) {
    return loadBufferExternalModelAsync(modelInfo, scene, opts);
  }
  return Promise.reject(createExternalModelUnsupportedError(externalType));
}

/**
 * External model unified entry: dispatch by objType; legacy fileType supported.
 * @param {object} modelInfo
 * @param {THREE.Scene} scene
 * @param {{ camera?: THREE.PerspectiveCamera|null }} [loadOptions]
 */
function loadExternalModel(modelInfo, scene, loadOptions = {}){
    if(!modelInfo || !modelInfo.modelPath){
        return;
    }
    const externalType = resolveExternalModelType(modelInfo);
    if(!externalType){
        log.error("External model type resolution failed: provide modelFileType or use recognizable modelPath extension", modelInfo);
        return;
    }
    if("gltf" === externalType || "glb" === externalType){
        loadGltf(modelInfo, scene, loadOptions);
    }
    else if(isThreeNativeJsonFileType(externalType)){
        loadThreeNativeObjectJsonFromUrl(modelInfo, scene, { loadingManager: modelLoadingManager });
    }
    else if(externalType === "obj"){
        loadObjWithOptionalMtl(modelInfo, scene);
    }
    else if(isBufferExternalMeshType(externalType)){
        loadBufferExternalModel(modelInfo, scene, loadOptions);
    }
    else{
        log.error(createExternalModelUnsupportedError(externalType).message, modelInfo);
    }
}

export {
    setModelLoadingManager,
    normalizeMapsFolderFallback,
    buildObjTexturePlans,
    createNormalBox,
    createInstanceBox,
    createTextureBox,
    fillMissingBoxFaceTextureUrls,
    createBox,
    createGroup,
    createLine,
    createLine2,
    createPlane,
    deployPlane,
    createWind,
    createPointsImpl as createPoints,
    deployPointsImpl as deployPoints,
    createSpriteImpl as createSprite,
    deploySpriteImpl as deploySprite,
    createTubeImpl as createTube,
    deployTubeImpl as deployTube,
    loadSkinnedModel,
    deployInstancedMesh,
    // create heatmap（flat，`createHeatmapVolume` is the three-dimensional body thermal entrance）
    createHeatmap,
    createHeatmapVolume,
    buildHeatmapTexture,
    createHeatmapMesh,
    buildHeatmapVolumeTexture,
    createHeatmapVolumeMesh,
    defaultTextureDimensions,
    defaultTextureDimensions3D,
    HEATMAP_LEGACY_COLOR_STOPS,
    HEATMAP_LEGACY_COLOR_STOPS_VOLUME,
    loadGltf,
    loadExternalModel,
    createNormalSphere,
    createSphere,
    createCylinder,
    createCone,
    createRing,
    createTorus,
    createCapsule,
    createTextureSphere,
    createMesh,
    deployBox,
    deploySphere,
    deployMesh,
    syncBoxModelTransformFromObject3D,
    applyBoxModelTransformToObject3D,
    snapshotBoxModelTransformFromObject3D
}
