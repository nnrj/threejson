import * as THREE from "three";
import { log } from "../../util/logger.js";
import { getObjectByRefName } from "../objectRegistry.js";

/**
 * Attach the viewport camera to a player rig so firstPerson moves the rig instead of the bare camera.
 * @param {import("three").Scene} scene
 * @param {import("three").PerspectiveCamera} camera
 * @param {object|null} controls
 * @param {{ attachTo?: string, eyeHeight?: number }} [cameraConfig]
 * @returns {import("three").Object3D|null}
 */
export function attachCameraToPlayerRig(scene, camera, controls, cameraConfig = {}) {
  const refName = typeof cameraConfig.attachTo === "string" ? cameraConfig.attachTo.trim() : "";
  if (!refName || !camera || !scene) {
    return null;
  }

  const rig = getObjectByRefName(refName);
  if (!rig || !rig.isObject3D) {
    log.warn(`[playerRigAttach] refName="${refName}" not found; camera stays at scene root`);
    return null;
  }

  const eyeHeight = Number.isFinite(cameraConfig.eyeHeight) ? cameraConfig.eyeHeight : 1.6;

  if (camera.parent) {
    camera.parent.remove(camera);
  }
  rig.add(camera);
  camera.position.set(0, eyeHeight, 0);
  camera.rotation.set(0, 0, 0);

  if (controls && typeof controls.setMovementRoot === "function") {
    controls.setMovementRoot(rig);
  }

  return rig;
}
