import { deployInfoPanel } from "../../../core/builder/infoPanelBuilder.js";
import { createDoor } from "../../door/index.js";
import { registerObject } from "../../../core/handler/objectRegistry.js";
import { registerSubSceneChildDeployer } from "../../../core/handler/sceneExtensionRegistry.js";
import { ensureThreeJsonIdOnRecord } from "../../../core/util/util.js";

/**
 * @param {import("three").Object3D} parent
 * @returns {import("three").Group|null}
 */
export function findCabinetDoorHingeGroup(parent) {
  if (!parent?.children?.length) {
    return null;
  }
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child?.type === "Group" && child.children?.some((node) => node?.isMesh)) {
      return child;
    }
  }
  return null;
}

/**
 * @param {import("three").Object3D|null|undefined} parent
 * @returns {boolean}
 */
export function isCabinetDoorAssemblyParent(parent) {
  if (!parent) {
    return false;
  }
  const json = parent.userData?.objJson;
  if (json?.cabinetDoorAssembly === true) {
    return true;
  }
  return parent.name === "defaultCabinetDoor";
}

/**
 * @param {import("three").Object3D} parent
 * @param {object} child
 * @returns {boolean}
 */
export function deployCabinetDoorSubSceneChild(parent, child) {
  if (!isCabinetDoorAssemblyParent(parent)) {
    return false;
  }
  const childType = String(child?.objType || "").trim().toLowerCase();
  if (childType !== "door") {
    return false;
  }
  ensureThreeJsonIdOnRecord(child);
  const doorRoot = createDoor(child);
  if (!doorRoot) {
    return false;
  }
  parent.add(doorRoot);
  registerObject(doorRoot, child);
  return true;
}

/**
 * Attach cabinet door number info panels to door hinge group; rotate with door open/close.
 * @param {import("three").Object3D} parent
 * @param {object} child
 * @returns {boolean}
 */
export function deployCabinetDoorInfoPanelChild(parent, child) {
  if (!isCabinetDoorAssemblyParent(parent)) {
    return false;
  }
  const childType = String(child?.objType || "").trim().toLowerCase();
  if (childType !== "infopanel") {
    return false;
  }
  const hinge = findCabinetDoorHingeGroup(parent);
  if (!hinge) {
    return false;
  }
  void Promise.resolve(deployInfoPanel(hinge, child));
  return true;
}

registerSubSceneChildDeployer(deployCabinetDoorSubSceneChild);
registerSubSceneChildDeployer(deployCabinetDoorInfoPanelChild);
