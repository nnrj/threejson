/**
 * Door-wall hole business: uses core collision detection and holeSceneOps primitives.
 */

import { impactCheck } from "../../core/handler/modelHandler.js";
import {
  deployHoleReplacement,
  resetHolesByOriginHole,
  subtractMeshHole
} from "../../core/handler/holeSceneOps.js";
import { readObjJsonFromUserData } from "../../core/util/spatialQueryUtil.js";

/**
 * @param {import("three").Object3D} wall
 * @returns {boolean}
 */
function isWallObject(wall) {
  const wallDesc = readObjJsonFromUserData(wall?.userData);
  if (!wallDesc) {
    return false;
  }
  if (wallDesc.objType === "wall") {
    return true;
  }
  return wallDesc.name === "room-wall";
}

/**
 * Door moved away: restore hole proxy linked to door uuid.
 * @param {import("three").Object3D} door
 * @param {import("three").Scene} scene
 */
export function resetWall(door, scene) {
  if (!door?.uuid || !scene) {
    return;
  }
  resetHolesByOriginHole(scene, door.uuid);
}

/**
 * Door model: restore old hole, then CSG hole on colliding walls.
 * @param {import("three").Object3D} model expected userData marks door
 * @param {import("three").Scene} scene
 */
export function impactHole(model, scene) {
  resetWall(model, scene);
  const doorDesc = readObjJsonFromUserData(model?.userData);
  if (!model?.userData || !doorDesc || "door" !== doorDesc.objType) {
    return;
  }
  const impactModelList = impactCheck(model, scene);
  if (!impactModelList?.length) {
    return;
  }
  for (let i = 0; i < impactModelList.length; i++) {
    const wall = impactModelList[i];
    if (!wall?.userData || !isWallObject(wall)) {
      continue;
    }
    const wallDesc = readObjJsonFromUserData(wall.userData);
    const holeWall = subtractMeshHole(wall, model);
    if (!holeWall) {
      continue;
    }
    deployHoleReplacement(scene, {
      wall,
      holeWall,
      wallDesc,
      originHoleUuid: model.uuid
    });
  }
}
