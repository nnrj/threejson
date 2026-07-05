/**
 * Core shader mechanism registration: solidColor test preset + objType shaderSurface deployer.
 */
import { registerObjTypeDeployer } from "../../handler/sceneExtensionRegistry.js";
import { registerSolidColorPreset } from "./presets/solidColorPreset.js";
import { deployShaderSurface } from "./shaderSurfaceBuilder.js";

let registered = false;

export function registerCoreShaderMechanism() {
  if (registered) {
    return;
  }
  registerSolidColorPreset();
  registerObjTypeDeployer("shadersurface", (record, scene, ctx) => {
    deployShaderSurface(record, scene, ctx);
  });
  registered = true;
}

registerCoreShaderMechanism();
