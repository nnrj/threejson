/** Renderer-independent scene feature inventory. No prompting or AI provider dependencies. */
import { DEFAULT_FRIENDLY_SCENE_LIST_ORDER } from "../handler/sceneFriendlyMap.js";

export function analyzeSceneUsage(sceneObj) {
  const listsUsed = [];
  const objTypes = new Set();
  let totalItems = 0;

  const runtimeRendererRecord = Array.isArray(sceneObj?.objectList)
    ? [...sceneObj.objectList].reverse().find(
      (record) => String(record?.objType || "").trim().toLowerCase() === "renderer"
    )
    : null;
  const rendererBackend = String(
    sceneObj?.sceneConfig?.renderer?.backend
      || runtimeRendererRecord?.backend
      || sceneObj?.renderer?.backend
      || "webgl"
  ).trim().toLowerCase();
  if (rendererBackend) {
    objTypes.add(`renderer:${rendererBackend}`);
  }

  if (sceneObj?.sceneConfig?.intro) {
    objTypes.add("intro");
  }
  if (Array.isArray(sceneObj?.sceneConfig?.lights) && sceneObj.sceneConfig.lights.length > 0) {
    objTypes.add("light");
  }
  const scenePassList = sceneObj?.sceneConfig?.passList || sceneObj?.passList;
  if (Array.isArray(scenePassList) && scenePassList.length > 0) {
    if (!listsUsed.includes("passList")) {
      listsUsed.push("passList");
    }
    objTypes.add("pass");
    totalItems += scenePassList.length;
  }

  const wi = sceneObj?.worldInfo;
  if (wi && typeof wi === "object") {
    for (let i = 0; i < DEFAULT_FRIENDLY_SCENE_LIST_ORDER.length; i += 1) {
      const listName = DEFAULT_FRIENDLY_SCENE_LIST_ORDER[i];
      const arr = wi[listName];
      if (Array.isArray(arr) && arr.length > 0) {
        listsUsed.push(listName);
        totalItems += arr.length;
        for (let j = 0; j < arr.length; j += 1) {
          collectObjTypes(arr[j], objTypes);
        }
      }
    }
  }

  const objectList = sceneObj?.objectList;
  if (Array.isArray(objectList) && objectList.length > 0) {
    if (!listsUsed.includes("objectList")) {
      listsUsed.push("objectList");
    }
    totalItems += objectList.length;
    for (let i = 0; i < objectList.length; i += 1) {
      collectObjTypes(objectList[i], objTypes);
    }
  }

  return { listsUsed, objTypes, totalItems };
}

/**
 * @param {object} record
 * @param {Set<string>} objTypes
 */
function collectObjTypes(record, objTypes) {
  if (!record || typeof record !== "object") {
    return;
  }
  if (typeof record.objType === "string" && record.objType.trim()) {
    objTypes.add(record.objType.trim());
  }
  if (record.events && typeof record.events === "object") {
    objTypes.add("event");
  }
  if (Array.isArray(record.animations) && record.animations.length > 0) {
    objTypes.add("animation");
  }
  if (record.animationGraph && typeof record.animationGraph === "object") {
    objTypes.add("animationGraph");
  }
  if (record.domain && typeof record.domain === "string") {
    objTypes.add("domain");
    objTypes.add(`domain:${record.domain}`);
    const leaf = record.domain.split(".").pop();
    if (leaf) {
      objTypes.add(leaf);
    }
  }
  if (record.geometry?.type && typeof record.geometry.type === "string") {
    objTypes.add("native");
  }
  const collectMaterial = (material) => {
    if (!material || typeof material !== "object") return;
    const materialType = String(material.type || "").trim().toLowerCase();
    if (materialType === "tsl" || materialType === "nodematerial") {
      objTypes.add("material:tsl");
      const tslKind = String(material.tsl?.kind || "preset").trim().toLowerCase();
      if (tslKind) objTypes.add(`tslKind:${tslKind}`);
    }
  };
  collectMaterial(record.material);
  if (Array.isArray(record.materials)) record.materials.forEach(collectMaterial);
  if (Array.isArray(record.materialArr)) record.materialArr.forEach(collectMaterial);
  if (Array.isArray(record.materialBindings)) {
    record.materialBindings.forEach((binding) => collectMaterial(binding?.material));
  }
  if (String(record.objType || "").trim().toLowerCase() === "particleemitter") {
    objTypes.add("particleEmitter");
    const backend = String(record.simulation?.backend || "cpu").trim().toLowerCase();
    const sourceType = String(record.source?.type || "box").trim().toLowerCase();
    if (backend) objTypes.add(`particleBackend:${backend}`);
    if (sourceType) objTypes.add(`particleSource:${sourceType}`);
    if (sourceType === "textmask" || sourceType === "imagemask") {
      objTypes.add("particleSource:raster");
    }
  }
  if (record.parseMode === "native") {
    objTypes.add("native");
  }
  const nestedLists = ["boxModelList", "subScene", "subGroup", "joins", "inters", "holes", "children", "objectList"];
  for (let i = 0; i < nestedLists.length; i += 1) {
    const key = nestedLists[i];
    const nested = record[key];
    if (Array.isArray(nested)) {
      for (let j = 0; j < nested.length; j += 1) {
        collectObjTypes(nested[j], objTypes);
      }
    }
  }
}
