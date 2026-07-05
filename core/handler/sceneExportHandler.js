import {
  buildMinimalWorldJsonForNativeThreeInline,
  embedPortableImageUrlsIntoThreeExportJson,
  isThreeJsObjectExportJson
} from "../builder/nativeObjectLoader.js";
import { sceneToNativeJson } from "./sceneJsonHandler.js";
import {
  cloneSceneGraphForNativeExport,
  convertFriendlyJsonToStandardJson,
  convertStandardJsonToFriendlyJson
} from "../util/util.js";
import { sceneToJson } from "../util/sceneToJson.js";

function isRuntimeTarget(input) {
  return input?.isScene === true || input?.scene?.isScene === true;
}

function resolveSceneFromTarget(input) {
  if (input?.isScene === true) {
    return input;
  }
  if (input?.scene?.isScene === true) {
    return input.scene;
  }
  return null;
}

async function exportNativeFromScene(scene, options = {}) {
  const cloned = cloneSceneGraphForNativeExport(scene, []);
  const nativeJson = cloned.toJSON();
  if (options.embedPortableImages !== false) {
    embedPortableImageUrlsIntoThreeExportJson(cloned, nativeJson);
  }
  return buildMinimalWorldJsonForNativeThreeInline(nativeJson, {
    threeJsonId: typeof options.threeJsonId === "string" ? options.threeJsonId : undefined,
    label: options.label
  });
}

function resolveNativeJsonFromPayload(payload) {
  if (isThreeJsObjectExportJson(payload)) {
    return payload;
  }
  const nativeSceneList = payload?.worldInfo?.nativeSceneList;
  if (!Array.isArray(nativeSceneList)) {
    return null;
  }
  for (let i = 0; i < nativeSceneList.length; i++) {
    const jsonData = nativeSceneList[i]?.jsonData;
    const parsed = typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData;
    if (isThreeJsObjectExportJson(parsed)) {
      return parsed;
    }
  }
  return null;
}

async function exportJsonScene(targetOrPayload, options = {}) {
  const format = options.format || "standard";
  if (format === "three-native") {
    const scene = resolveSceneFromTarget(targetOrPayload);
    if (scene) {
      return exportNativeFromScene(scene, options);
    }
    const nativeJson = resolveNativeJsonFromPayload(targetOrPayload);
    if (nativeJson) {
      return buildMinimalWorldJsonForNativeThreeInline(nativeJson, {
        threeJsonId: typeof options.threeJsonId === "string" ? options.threeJsonId : undefined,
        label: options.label
      });
    }
    throw new Error("E_SCENE_NATIVE_EXPORT_REQUIRES_SCENE: three-native export requires runtime scene or nativeSceneList");
  }

  if (isRuntimeTarget(targetOrPayload)) {
    const scene = resolveSceneFromTarget(targetOrPayload);
    const sceneOpts = {
      ...options,
      basePayload: options.basePayload || {},
      runtimeTarget: targetOrPayload,
      embedNative: options.includeSceneInfoList === true || options.embedNative === true,
      subSceneLayout: options.subSceneLayout
    };
    if (format === "friendly") {
      sceneOpts.format = "friendly";
    }
    const payload = await sceneToJson(scene, sceneOpts);
    if (format === "standard") {
      return payload;
    }
    return payload;
  }

  if (format === "friendly") {
    const standardPayload = await convertFriendlyJsonToStandardJson(targetOrPayload || {});
    return convertStandardJsonToFriendlyJson(standardPayload, options.friendlyMap);
  }
  return convertFriendlyJsonToStandardJson(targetOrPayload || {});
}

async function exportJsonSceneText(targetOrPayload, options = {}) {
  const payload = await exportJsonScene(targetOrPayload, options);
  const space = Number.isFinite(options.space) ? options.space : 2;
  return JSON.stringify(payload, null, space);
}

export {
  exportJsonScene,
  exportJsonSceneText,
  sceneToNativeJson
};
