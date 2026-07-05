import * as THREE from "three";
import { log } from "../../core/util/logger.js";

import { getObjectByRefName } from "../../core/handler/objectRegistry.js";
import { setMovementRootWorldPosition } from "../../core/handler/controls/movementRootUtil.js";
import { resolveSceneExtensions } from "../../core/util/extensionsUtil.js";

const EXTENSION_ID = "fps-walk";

/**
 * 按地板 mesh 顶面 + eyeHeight 计算目标世界 Y（相机或 Rig 根）。
 * @param {import("three").Object3D} floorMesh
 * @param {number} eyeHeight
 */
function computeEyeWorldYOnFloor(floorMesh, eyeHeight) {
  const floorBox = new THREE.Box3().setFromObject(floorMesh);
  return floorBox.max.y + (Number.isFinite(eyeHeight) ? eyeHeight : 1.6);
}

/**
 * 为第一人称 controls 注册贴地 provider（`floorMeshRef`）。
 *
 * @param {{
 *   scene?: import("three").Scene,
 *   camera?: import("three").PerspectiveCamera,
 *   controls?: object,
 *   sceneJson?: object,
 *   sceneConfig?: object,
 *   worldInfo?: object
 * }} ctx
 * @returns {{ floorMeshRef?: string, floorMesh?: import("three").Object3D|null }|null}
 */
export function bootstrapFpsWalkFromScene(ctx) {
  const controls = ctx?.controls;
  if (!controls || controls.threeJsonControlsKind !== "firstPerson") {
    return null;
  }
  if (typeof controls.setCollisionProvider !== "function") {
    return null;
  }

  const sceneJson = ctx?.sceneJson && typeof ctx.sceneJson === "object" ? ctx.sceneJson : {};
  const sceneConfig = ctx?.sceneConfig && typeof ctx.sceneConfig === "object"
    ? ctx.sceneConfig
    : sceneJson.sceneConfig && typeof sceneJson.sceneConfig === "object"
      ? sceneJson.sceneConfig
      : {};
  const worldInfo = ctx?.worldInfo && typeof ctx.worldInfo === "object"
    ? ctx.worldInfo
    : sceneJson.worldInfo && typeof sceneJson.worldInfo === "object"
      ? sceneJson.worldInfo
      : {};

  const ext = resolveSceneExtensions(sceneConfig, worldInfo)[EXTENSION_ID];
  if (!ext || typeof ext !== "object" || ext.enabled === false) {
    return null;
  }

  const floorMeshRef = typeof ext.floorMeshRef === "string" ? ext.floorMeshRef.trim() : "";
  if (!floorMeshRef) {
    return null;
  }

  const floorMesh = getObjectByRefName(floorMeshRef);
  if (!floorMesh) {
    log.warn(`[fps-walk] floorMeshRef="${floorMeshRef}" not found`);
    return { floorMeshRef, floorMesh: null };
  }

  if (ext.floorSnap !== false) {
    controls.floorSnap = false;
  }

  const eyeHeight = Number.isFinite(controls.eyeHeight) ? controls.eyeHeight : 1.6;

  controls.setCollisionProvider({
    resolve({ movementRoot, eyeHeight: cfgEyeHeight }) {
      const eh = Number.isFinite(cfgEyeHeight) ? cfgEyeHeight : eyeHeight;
      const targetY = computeEyeWorldYOnFloor(floorMesh, eh);
      const root = movementRoot ?? controls.movementRoot;
      const worldPos = root ? root.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
      setMovementRootWorldPosition(root, ctx.camera, {
        x: worldPos.x,
        y: targetY,
        z: worldPos.z
      });
    }
  });

  return { floorMeshRef, floorMesh };
}
