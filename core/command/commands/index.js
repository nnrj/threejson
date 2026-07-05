import { handleSceneApplyPatch } from "./document.js";
import {
  handleSceneExport,
  handleSceneList,
  handleSceneLoad,
  handleSceneValidate
} from "./scene.js";
import {
  handleObjectAdd,
  handleObjectGet,
  handleObjectPatch,
  handleObjectReconcile,
  handleObjectRemove
} from "./object.js";
import { handleMaterialPatch } from "./material.js";
import { handleCameraFit } from "./camera.js";

/** @typedef {(ctx: import("../types.js").CommandContext, args: object) => unknown | Promise<unknown>} CommandHandler */

/** @type {Record<string, CommandHandler>} */
export const CORE_COMMAND_HANDLERS = {
  "scene.load": handleSceneLoad,
  "scene.validate": handleSceneValidate,
  "scene.applyPatch": handleSceneApplyPatch,
  "scene.export": handleSceneExport,
  "scene.list": handleSceneList,
  "object.add": handleObjectAdd,
  "object.remove": handleObjectRemove,
  "object.patch": handleObjectPatch,
  "object.get": handleObjectGet,
  "object.reconcile": handleObjectReconcile,
  "material.patch": handleMaterialPatch,
  "camera.fit": handleCameraFit
};
