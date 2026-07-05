/**
 * Scene hole primitives: CSG subtract, restore by originHole, deploy stand-in mesh with holeData (domain-agnostic).
 */

import { evaluateMeshBoolean } from "./csgBrushOps.js";

/**
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {string} uuid
 * @returns {import("three").Object3D|null}
 */
export function findObjectByUuid(scene, uuid) {
  if (!scene || !uuid) {
    return null;
  }
  let found = null;
  scene.traverse((subObj) => {
    if (found || !subObj || subObj.uuid !== uuid) {
      return;
    }
    found = subObj;
  });
  return found;
}

/**
 * Boolean subtract via `three-bvh-csg`: `boxMesh - holeMesh`.
 * @param {import("three").Mesh} boxMesh
 * @param {import("three").Mesh} holeMesh
 * @returns {import("three-bvh-csg").Brush|void}
 */
export function subtractMeshHole(boxMesh, holeMesh) {
  return evaluateMeshBoolean(boxMesh, holeMesh, "subtract");
}

/**
 * Restore hole stand-ins where `userData.holeData.originHole === originHoleUuid` and show the original wall.
 * @param {import("three").Scene} scene
 * @param {string} originHoleUuid
 */
export function resetHolesByOriginHole(scene, originHoleUuid) {
  if (!originHoleUuid || !scene) {
    return;
  }
  /** @type {import("three").Object3D[]} */
  const resetList = [];
  scene.traverse((subObj) => {
    if (
      subObj?.uuid &&
      subObj.userData?.holeData &&
      originHoleUuid === subObj.userData.holeData.originHole
    ) {
      resetList.push(subObj);
    }
  });
  if (!resetList.length) {
    return;
  }
  for (const holeWall of resetList) {
    const holeData = holeWall.userData.holeData;
    const originWall = findObjectByUuid(scene, holeData.originWall);
    const originModel = holeData.originModel;
    if (originWall) {
      originWall.position.set(holeWall.position.x, holeWall.position.y, holeWall.position.z);
      holeWall.visible = false;
      if (holeWall.material) {
        holeWall.material.visible = false;
      }
      scene.remove(holeWall);
      originWall.visible = true;
      originWall.updateMatrixWorld();
      scene.add(originWall);
    } else if (originModel) {
      holeWall.visible = false;
      if (holeWall.material) {
        holeWall.material.visible = false;
      }
      scene.remove(holeWall);
      originModel.visible = true;
      scene.add(originModel);
    }
  }
}

/**
 * Hide the original wall and add the CSG result with `holeData` to the scene.
 * @param {import("three").Scene} scene
 * @param {object} params
 * @param {import("three").Object3D} params.wall
 * @param {import("three").Object3D} params.holeWall
 * @param {object} params.wallDesc Original wall objJson
 * @param {string} params.originHoleUuid Hole actor uuid (usually a door)
 */
export function deployHoleReplacement(scene, { wall, holeWall, wallDesc, originHoleUuid }) {
  wall.visible = false;
  holeWall.userData = {
    ...(typeof holeWall.userData === "object" && holeWall.userData ? holeWall.userData : {}),
    objJson: wallDesc,
    holeData: {
      originWall: wall.uuid,
      originHole: originHoleUuid,
      originModel: wall
    }
  };
  scene.add(holeWall);
}
