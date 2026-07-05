import { bootstrapFpsWalkFromScene } from "./bootstrapFromScene.js";
import { log } from "../../core/util/logger.js";

/**
 * 按 JSON 为第一人称 controls 挂载扩展（fps-walk 贴地、Rapier 碰撞等）。
 *
 * @param {{
 *   scene?: import("three").Object3D,
 *   camera?: import("three").PerspectiveCamera,
 *   controls?: object,
 *   controlsConfig?: object,
 *   sceneJson?: object,
 *   sceneConfig?: object,
 *   worldInfo?: object,
 *   pluginHost?: { register: Function },
 *   RAPIER?: object
 * }} ctx
 * @returns {Promise<{ fpsWalk?: object|null, rapier?: object|null }>}
 */
export async function bootstrapFirstPersonExtensionsFromScene(ctx) {
  const out = { fpsWalk: null, rapier: null };
  const controls = ctx?.controls;
  if (!controls || controls.threeJsonControlsKind !== "firstPerson") {
    return out;
  }

  const sceneJson = ctx?.sceneJson && typeof ctx.sceneJson === "object" ? ctx.sceneJson : {};
  const sceneConfig = ctx?.sceneConfig && typeof ctx.sceneConfig === "object"
    ? ctx.sceneConfig
    : sceneJson.sceneConfig && typeof sceneJson.sceneConfig === "object"
      ? sceneJson.sceneConfig
      : {};
  const controlsConfig = ctx?.controlsConfig && typeof ctx.controlsConfig === "object"
    ? ctx.controlsConfig
    : sceneConfig.controls && typeof sceneConfig.controls === "object"
      ? sceneConfig.controls
      : {};

  const collision = controlsConfig.collision && typeof controlsConfig.collision === "object"
    ? controlsConfig.collision
    : {};
  const provider = typeof collision.provider === "string" ? collision.provider.trim().toLowerCase() : "";

  if (provider === "rapier" && collision.enabled !== false) {
    if (ctx?.RAPIER && ctx?.pluginHost) {
      const { bootstrapRapierFirstPersonFromScene } = await import(
        "../physics-rapier/firstPersonBridge.js"
      );
      out.rapier = await bootstrapRapierFirstPersonFromScene(ctx);
      return out;
    }
    log.warn(
      "[firstPerson] controls.collision.provider 为 rapier，但未传入 RAPIER / pluginHost，回退 fps-walk（若已配置）"
    );
  }

  out.fpsWalk = bootstrapFpsWalkFromScene(ctx);
  return out;
}
