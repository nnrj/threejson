import { collectObjectsWithObjJson, readObjJsonFromUserData } from "../../core/util/spatialQuery.js";
import { readExtensionConfig, resolveSceneExtensions } from "../../core/util/extensionsUtil.js";
import { createRapierScenePlugin } from "./rapierPlugin.js";

const EXTENSION_ID = "physics-rapier";

/**
 * @param {object} cfg
 * @returns {boolean}
 */
function isStaticRigidBody(cfg) {
  const rb = String(cfg?.rigidBody ?? cfg?.body ?? "").trim().toLowerCase();
  return rb === "fixed" || rb === "static";
}

/**
 * @param {object} cfg
 * @returns {boolean}
 */
function isDynamicRigidBody(cfg) {
  const rb = String(cfg?.rigidBody ?? cfg?.body ?? "").trim().toLowerCase();
  return rb === "dynamic" || rb === "kinematic" || rb === "";
}

/**
 * @param {object} cfg
 * @returns {boolean}
 */
function isSensorCollider(cfg) {
  return cfg?.sensor === true || cfg?.collider?.sensor === true;
}

/**
 * 从已加载场景 JSON 的 `extensions["physics-rapier"]` 注册 Rapier 插件（支持多 static + 多 dynamic）。
 *
 * @param {{
 *   scene: import("three").Scene|import("three").Object3D,
 *   sceneJson?: object,
 *   pluginHost: { register: (plugin: object) => void },
 *   RAPIER: object
 * }} ctx
 * @returns {Promise<object|null>}
 */
export async function bootstrapPhysicsRapierFromScene(ctx) {
  const scene = ctx?.scene;
  const pluginHost = ctx?.pluginHost;
  const RAPIER = ctx?.RAPIER;
  if (!scene || !pluginHost || !RAPIER) {
    throw new Error("bootstrapPhysicsRapierFromScene: scene, pluginHost and RAPIER required");
  }

  const sceneJson = ctx?.sceneJson && typeof ctx.sceneJson === "object" ? ctx.sceneJson : {};
  const sceneConfig = sceneJson.sceneConfig && typeof sceneJson.sceneConfig === "object"
    ? sceneJson.sceneConfig
    : {};
  const worldInfo = sceneJson.worldInfo && typeof sceneJson.worldInfo === "object"
    ? sceneJson.worldInfo
    : {};

  const sceneExt = resolveSceneExtensions(sceneConfig, worldInfo)[EXTENSION_ID];
  if (sceneExt && typeof sceneExt === "object" && sceneExt.enabled === false) {
    return null;
  }

  const gravityRaw = sceneExt && typeof sceneExt === "object" ? sceneExt.gravity : null;
  const gravity = {
    x: Number(gravityRaw?.x) || 0,
    y: Number.isFinite(gravityRaw?.y) ? gravityRaw.y : -12,
    z: Number(gravityRaw?.z) || 0
  };

  const objects = collectObjectsWithObjJson(scene, { requireGeometry: true });
  /** @type {Array<{ mesh: import("three").Object3D, rigidBody: string, sensor?: boolean }>} */
  const entries = [];

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const objJson = readObjJsonFromUserData(obj.userData);
    const cfg = readExtensionConfig(objJson, EXTENSION_ID);
    if (!cfg) {
      continue;
    }
    if (isStaticRigidBody(cfg)) {
      entries.push({
        mesh: obj,
        rigidBody: "fixed",
        sensor: isSensorCollider(cfg)
      });
    } else if (isDynamicRigidBody(cfg)) {
      entries.push({
        mesh: obj,
        rigidBody: "dynamic",
        sensor: isSensorCollider(cfg)
      });
    }
  }

  const hasDynamic = entries.some((e) => e.rigidBody === "dynamic");
  if (!hasDynamic) {
    return null;
  }

  const plugin = await createRapierScenePlugin({ entries, RAPIER, gravity });
  pluginHost.register(plugin);
  return plugin;
}

export { EXTENSION_ID };
