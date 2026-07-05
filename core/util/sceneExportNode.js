const NATIVE_SCENE_ROOT_NAME = "__threejson_native_scene__";

/**
 * Export skip rules aligned with editor `isRuntimeOnlyObject` / `defaultShouldSkipEditorSceneTreeNode`.
 *
 * @param {import("three").Object3D|null|undefined} obj
 * @returns {boolean} true = skip (exclude from scene→JSON reverse-scan)
 */
export function shouldSkipSceneExportNode(obj) {
  if (!obj) {
    return true;
  }
  if (obj.isTransformControls || obj.type === "TransformControls") {
    return true;
  }
  if (obj.userData?.type === "helperBoxEdge") {
    return true;
  }
  if (obj.type === "AxesHelper" || obj.type === "GridHelper" || obj.type === "BoxHelper") {
    return true;
  }
  if (obj.userData?.objJson?.objType === "light") {
    return true;
  }
  if (
    obj.userData?.objJson?.objType === "gridHelper"
    || obj.userData?.objJson?.objType === "axesHelper"
    || obj.userData?.objJson?.objType === "boxHelper"
  ) {
    return true;
  }
  if (obj.name === NATIVE_SCENE_ROOT_NAME) {
    return true;
  }
  return false;
}

export { NATIVE_SCENE_ROOT_NAME };
