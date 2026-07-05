import * as THREE from "three";

import { collectObjectsWithObjJson, readObjJsonFromUserData } from "../../core/util/spatialQuery.js";
import { readExtensionConfig } from "../../core/util/extensionsUtil.js";
import { cuboidFromObject } from "./rapierPlugin.js";

const EXTENSION_ID = "physics-rapier";

/**
 * @param {object} cfg
 */
function isStaticRigidBody(cfg) {
  const rb = String(cfg?.rigidBody ?? cfg?.body ?? "").trim().toLowerCase();
  return rb === "fixed" || rb === "static";
}

/**
 * 从场景中带 `extensions.physics-rapier` 的 static/fixed 物体创建 Rapier 碰撞体。
 * @param {object} world
 * @param {object} RAPIER
 * @param {import("three").Object3D} scene
 * @param {object} [options]
 * @param {string} [options.skipRefName] 跳过玩家 Rig 等
 */
export function addStaticCollidersFromScene(world, RAPIER, scene, options = {}) {
  const skipRef = typeof options.skipRefName === "string" ? options.skipRefName.trim() : "";
  const objects = collectObjectsWithObjJson(scene, { requireGeometry: true });

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const objJson = readObjJsonFromUserData(obj.userData);
    const cfg = readExtensionConfig(objJson, EXTENSION_ID);
    if (!cfg || !isStaticRigidBody(cfg)) {
      continue;
    }
    const ref = objJson?.refName || objJson?.runtimeRef || "";
    if (skipRef && String(ref).trim() === skipRef) {
      continue;
    }
    const cuboid = cuboidFromObject(obj);
    const collider = RAPIER.ColliderDesc.cuboid(cuboid.halfX, cuboid.halfY, cuboid.halfZ).setTranslation(
      cuboid.center.x,
      cuboid.center.y,
      cuboid.center.z
    );
    if (cfg?.sensor === true || cfg?.collider?.sensor === true) {
      collider.setSensor(true);
    }
    world.createCollider(collider);
  }
}
