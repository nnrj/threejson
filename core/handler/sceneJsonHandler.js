/**
 * Scene serialization and save payload: strip non-JSON values, clone scene for `toJSON`, assemble room-save API body.
 */
import * as THREE from "three";

/**
 * Recursively sanitize any value to null/number/string/boolean/plain object/array only; strips Three objects, functions, etc.
 * @param {*} value
 * @param {number} [depth=0] Current recursion depth
 * @param {number} [maxDepth=20] Max depth to prevent stack overflow on cycles
 * @returns {*|undefined} undefined means drop the field
 */
function sanitizePlainData(value, depth = 0, maxDepth = 20) {
  if (depth > maxDepth) {
    return null;
  }
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const valueType = typeof value;
  if (valueType === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (valueType === "string" || valueType === "boolean") {
    return value;
  }
  if (valueType === "function" || valueType === "symbol" || valueType === "bigint") {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizePlainData(item, depth + 1, maxDepth))
      .filter((item) => item !== undefined);
  }
  if (valueType === "object") {
    if (
      value?.isObject3D
      || value?.isMaterial
      || value?.isGeometry
      || value?.isBufferGeometry
      || value?.isTexture
      || value?.isVector2
      || value?.isVector3
      || value?.isVector4
      || value?.isColor
      || value?.isEuler
      || value?.isQuaternion
      || value?.isMatrix3
      || value?.isMatrix4
    ) {
      return undefined;
    }
    const output = {};
    for (const [key, subValue] of Object.entries(value)) {
      const cleaned = sanitizePlainData(subValue, depth + 1, maxDepth);
      if (cleaned !== undefined) {
        output[key] = cleaned;
      }
    }
    return output;
  }
  return undefined;
}

/**
 * Walk an Object3D subtree and replace each node's userData in place with sanitized plain data.
 * @param {THREE.Object3D} root
 */
function sanitizeObjectTreeUserData(root) {
  if (!root?.traverse) {
    return;
  }
  root.traverse((obj) => {
    if (obj?.userData) {
      obj.userData = sanitizePlainData(obj.userData) || {};
    }
  });
}

/**
 * Clone scene children into a new Scene; optionally skip objects and sanitize userData.
 * @param {THREE.Scene} scene
 * @param {object} [options={}]
 * @param {(obj:THREE.Object3D)=>boolean} [options.shouldSkipObject] Return true to skip a child
 * @param {boolean} [options.sanitizeUserData=true]
 * @returns {THREE.Scene}
 */
function cloneSceneForSerialization(scene, options = {}) {
  const shouldSkipObject = options.shouldSkipObject;
  const sanitizeUserData = options.sanitizeUserData !== false;
  const exportScene = new THREE.Scene();
  exportScene.name = scene?.name || "scene_export";
  exportScene.userData = sanitizePlainData(scene?.userData || {}) || {};
  if (scene?.children?.length) {
    for (const child of scene.children) {
      if (shouldSkipObject?.(child)) {
        continue;
      }
      const cloned = child.clone(true);
      if (sanitizeUserData) {
        sanitizeObjectTreeUserData(cloned);
      }
      exportScene.add(cloned);
    }
  }
  return exportScene;
}

/**
 * Call `Object3D.toJSON` for a persistable object plus a formatted string.
 * @param {THREE.Scene} scene
 * @param {object} [options={}] Passed to cloneSceneForSerialization; may include `space` for indent
 * @returns {{ jsonObj: object, jsonString: string }}
 */
function sceneToNativeJson(scene, options = {}) {
  const space = Number.isFinite(options.space) ? options.space : 2;
  const exportScene = cloneSceneForSerialization(scene, options);
  const jsonObj = exportScene.toJSON();
  return {
    jsonObj,
    jsonString: JSON.stringify(jsonObj, null, space)
  };
}

/**
 * Assemble a payload with nativeSceneList embedding on baseData.
 * @param {object} [baseData] Original scene description; shallow-sanitized
 * @param {string} sceneJsonString Serialized scene JSON string
 * @returns {object}
 */
function buildRoomSavePayload(baseData, sceneJsonString) {
  const payload = sanitizePlainData(baseData || {}) || {};
  delete payload.worldId;
  payload.worldInfo = payload.worldInfo && typeof payload.worldInfo === "object" ? payload.worldInfo : {};
  payload.worldInfo.nativeSceneList = [
    {
      jsonData: sceneJsonString
    }
  ];
  return payload;
}

/**
 * Convenience wrapper for `JSON.stringify(buildRoomSavePayload(...), null, space)`.
 */
function stringifyRoomSavePayload(baseData, sceneJsonString, space = 2) {
  const payload = buildRoomSavePayload(baseData, sceneJsonString);
  return JSON.stringify(payload, null, space);
}

export {
  sanitizePlainData,
  cloneSceneForSerialization,
  sceneToNativeJson,
  buildRoomSavePayload,
  stringifyRoomSavePayload
};
