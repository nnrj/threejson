import { hasValue } from "threejson";

/** Mirrors tools/old_version/scene-editor.html mergeSceneHelpersFromSysConfig */
export function mergeSceneHelpersFromSysConfig(existingHelpers, sysConfig) {
  const out =
    existingHelpers && typeof existingHelpers === "object"
      ? JSON.parse(JSON.stringify(existingHelpers))
      : {};
  if (!out.grid || typeof out.grid !== "object") {
    if (sysConfig.gridShow === true) {
      out.grid = { visible: true };
    }
  } else if (!hasValue(out.grid.visible) && sysConfig.gridShow === true) {
    out.grid.visible = true;
  }
  if (!out.axes || typeof out.axes !== "object") {
    if (sysConfig.axesShow === true) {
      out.axes = { visible: true };
    }
  } else if (!hasValue(out.axes.visible) && sysConfig.axesShow === true) {
    out.axes.visible = true;
  }
  delete out.boxHelper;
  return Object.keys(out).length > 0 ? out : null;
}
