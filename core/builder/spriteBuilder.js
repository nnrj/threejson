/**
 * THREE.Sprite icons/markers (separate from infoPanel text panels).
 */
import * as THREE from "three";
import { log } from "../util/logger.js";
import { loadingManager } from "../cache/loading.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { applyVisibilityFromDescriptor } from "../util/util.js";

const textureLoader = new THREE.TextureLoader(loadingManager);
trackDisposableResource(textureLoader);

function hasValue(value) {
  return value !== undefined && value !== null;
}

function valueOr(value, fallback) {
  return hasValue(value) ? value : fallback;
}

function normalizePosition(position = {}) {
  return {
    x: Number(valueOr(position.x, 0)),
    y: Number(valueOr(position.y, 0)),
    z: Number(valueOr(position.z, 0))
  };
}

function normalizeScale(scale = {}) {
  return {
    scaleX: Number(valueOr(scale.scaleX, 1)),
    scaleY: Number(valueOr(scale.scaleY, 1)),
    scaleZ: Number(valueOr(scale.scaleZ, 1))
  };
}

function applySpriteTransform(sprite, record) {
  const position = normalizePosition(record.position);
  sprite.position.set(position.x, position.y, position.z);
  const scale = normalizeScale(record.scale);
  const materialInfo = record.material && typeof record.material === "object" ? record.material : {};
  const size = Number(valueOr(materialInfo.size, valueOr(record.size, 20)));
  const sx = hasValue(scale.scaleX) ? scale.scaleX : size;
  const sy = hasValue(scale.scaleY) ? scale.scaleY : size;
  const sz = hasValue(scale.scaleZ) ? scale.scaleZ : 1;
  sprite.scale.set(sx, sy, sz);
  applyVisibilityFromDescriptor(sprite, record);
}

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

function resolveTextureUrl(record) {
  const material = record?.material && typeof record.material === "object" ? record.material : {};
  const map = material.map ?? material.textureUrl ?? material.url ?? record.textureUrl ?? record.url;
  return typeof map === "string" ? map.trim() : "";
}

function applySpriteTextureWhenLoaded(sprite, url) {
  textureLoader.load(
    url,
    (texture) => {
      trackDisposableResource(texture);
      texture.colorSpace = THREE.SRGBColorSpace;
      const mat = sprite.material;
      if (mat && mat.isSpriteMaterial) {
        mat.map = texture;
        mat.transparent = true;
        mat.needsUpdate = true;
      }
    },
    undefined,
    (err) => {
      log.warn("[createSprite] texture load failed:", url, err);
    }
  );
}

/**
 * @param {object} record
 * @param {THREE.Texture} [map]
 * @returns {THREE.Sprite}
 */
export function buildSpriteObject(record, map) {
  const materialInfo = record?.material && typeof record.material === "object" ? record.material : {};
  const params = {
    color: hasValue(materialInfo.color) ? new THREE.Color(materialInfo.color) : new THREE.Color("#ffffff"),
    transparent: Boolean(valueOr(materialInfo.transparent, Boolean(map))),
    opacity: Number(valueOr(materialInfo.opacity, 1)),
    depthWrite: valueOr(materialInfo.depthWrite, !materialInfo.transparent),
    depthTest: valueOr(materialInfo.depthTest, true)
  };
  if (map) {
    params.map = map;
    params.transparent = true;
  }
  const mat = new THREE.SpriteMaterial(params);
  trackDisposableResource(mat);
  const sprite = new THREE.Sprite(mat);
  trackDisposableResource(sprite);
  sprite.name = typeof record?.name === "string" && record.name.length ? record.name : "newSprite";
  record.objType = "sprite";
  setUserDataObjJson(sprite, record);
  applySpriteTransform(sprite, record);
  return sprite;
}

/**
 * @param {object} record
 * @param {THREE.Scene} scene
 * @returns {THREE.Sprite|null}
 */
export function createSprite(record, scene) {
  if (!record || !scene) {
    return null;
  }
  const texUrl = resolveTextureUrl(record);
  const sprite = buildSpriteObject(record);
  scene.add(sprite);
  registerObject(sprite, record);
  if (texUrl && materialMapStringResolvableAsUrl(texUrl)) {
    applySpriteTextureWhenLoaded(sprite, texUrl);
  }
  return sprite;
}

/**
 * @param {object} record
 * @param {THREE.Scene} scene
 * @returns {THREE.Sprite|null}
 */
export function deploySprite(record, scene) {
  return createSprite(record, scene);
}
