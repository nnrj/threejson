import * as THREE from "three";
import { log } from "../../core/util/logger.js";

import { trackDisposableResource } from "../../core/handler/resourceReclaimer.js";
import { registerInteractionResolver } from "../../core/handler/sceneExtensionRegistry.js";
import { createMesh } from "../../core/builder/modelBuilder.js";
import {
  finalizeDomainDeployRoot
} from "../../core/handler/domainDeployDescriptor.js";
import { setUserDataObjJson } from "../../core/handler/objectDescriptorAttach.js";
import { registerObject } from "../../core/handler/objectRegistry.js";

import {
  computeHingeOffsetFromCenter,
  createDoorJson,
  isDoorDescriptor,
  resolveOpenRotationY
} from "./doorDescriptor.js";
import {
  createDoorGroupJson,
  normalizeLeafCount,
  normalizePanelKind,
  normalizeSwing
} from "./doorGroupBuilder.js";
import { impactHole, resetWall } from "./doorWallHole.js";
import { bindDoorActionTriggers, DOOR_TOGGLED_EVENT } from "./doorEventActions.js";
import {
  isDoorInteractable,
  openOrCloseDoor,
  resolveDoorForAnimation
} from "./doorKinematics.js";

export { DOOR_TOGGLED_EVENT } from "./doorEventActions.js";
export {
  isDoorInteractable,
  openOrCloseDoor,
  resolveDoorForAnimation
} from "./doorKinematics.js";

export {
  computeHingeOffsetFromCenter,
  createDoorJson,
  isDoorDescriptor,
  normalizeHingeSide,
  normalizeMountSide,
  normalizeOpenAngleDeg,
  normalizeOpenAngleRad,
  normalizeOpenDirection,
  normalizeSwingSide,
  DEFAULT_OPEN_ANGLE_DEG,
  DOOR_OPEN_ANGLE_PRESETS,
  resolveOpenRotationY
} from "./doorDescriptor.js";
export {
  createDoorGroupJson,
  normalizeLeafCount,
  normalizePanelKind,
  normalizeSwing
} from "./doorGroupBuilder.js";
export {
  applyDoorPanelMaterials,
  buildDoorPanelFaceMaterials,
  DOOR_TEXTURE_FACE_VALUES,
  hasUserDefinedDoorMaterials,
  normalizeExteriorFace,
  normalizeTextureFace,
  resolveDoorExteriorFaceIndex,
  resolveDoorPanelFacePair,
  resolveDoorThinAxis,
  shouldApplyExteriorDoorTexture
} from "./doorPanelMaterials.js";

/**
 * @param {object} doorDesc
 * @returns {import("three").Group|undefined}
 */
export function createDoor(doorDesc) {
  const descriptor = createDoorJson(doorDesc);
  const hingeFromCenter = computeHingeOffsetFromCenter(descriptor);
  const meshRecord = {
    ...descriptor,
    objType: "box",
    boxType: "box",
    position: { x: 0, y: 0, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 }
  };
  delete meshRecord.type;
  const boxMesh = createMesh(meshRecord);
  if (!boxMesh) {
    return undefined;
  }
  const euler = new THREE.Euler(
    descriptor.rotation?.rotationX ?? 0,
    descriptor.rotation?.rotationY ?? 0,
    descriptor.rotation?.rotationZ ?? 0
  );
  const doorGroup = new THREE.Group();
  trackDisposableResource(doorGroup);
  doorGroup.position.set(
    descriptor.position?.x ?? 0,
    descriptor.position?.y ?? 0,
    descriptor.position?.z ?? 0
  );
  doorGroup.rotation.copy(euler);
  boxMesh.position.set(-hingeFromCenter.x, -hingeFromCenter.y, -hingeFromCenter.z);
  setUserDataObjJson(boxMesh, descriptor);
  finalizeDomainDeployRoot(doorGroup, {
    domainId: "door",
    handler: "addToScene",
    itemDescriptor: descriptor,
    loadRecord: descriptor,
    extras: { threeJsonId: descriptor.threeJsonId }
  });
  doorGroup.name = descriptor.name || "door";
  doorGroup.add(boxMesh);
  return doorGroup;
}

/**
 * @param {string|object|undefined|null} [overrides]
 * @param {import("three").Scene|import("three").Object3D} scene
 */
export function deployDoor(overrides, scene) {
  if (!scene) {
    return;
  }
  const descriptor = createDoorJson(overrides);
  const doorGroup = createDoor(descriptor);
  if (doorGroup) {
    scene.add(doorGroup);
    registerObject(doorGroup, doorGroup.userData?.objJson || descriptor);
  }
}

function mergeRecordIntoDoor(record, scene) {
  if (record.payload != null && typeof record.payload === "object") {
    deployDoor(record.payload, scene);
    return;
  }
  if (Array.isArray(record.items) && record.items[0]) {
    deployDoor(record.items[0], scene);
    return;
  }
  const skip = new Set(["domain", "handler", "items", "options", "payload"]);
  const rest = {};
  for (const k of Object.keys(record)) {
    if (!skip.has(k)) {
      rest[k] = record[k];
    }
  }
  deployDoor({ ...rest, glassKind: record.glassKind }, scene);
}

function resolveDoorDomainModel(record, scene) {
  const handler = record.handler ?? "addToScene";
  if (handler === "addToScene") {
    mergeRecordIntoDoor(record, scene);
    return;
  }
  log.warn("[door] domainModel handler not implemented:", handler);
}

function addToScene(scene, overrides = {}) {
  deployDoor(overrides, scene);
}

/**
 * @param {object} boxModel
 * @returns {import("three").Object3D|null}
 */
function composeBoxModel(boxModel) {
  if (!isDoorDescriptor(boxModel)) {
    return null;
  }
  return createDoor(boxModel) ?? null;
}

registerInteractionResolver(resolveDoorForAnimation);

const doorDomain = {
  id: "door",
  defaultHandler: "addToScene",
  legacyBoxObjTypes: {
    door: "addToScene"
  },
  composeBoxModel,
  resolveDomainModel: resolveDoorDomainModel,
  bindSceneEvents(scene, ctx = {}) {
    return bindDoorActionTriggers(scene, ctx);
  },
  api: {
    createDoorJson,
    createDoor,
    deployDoor,
    addToScene,
    isDoorInteractable,
    resolveDoorForAnimation,
    isDoorDescriptor,
    openOrCloseDoor,
    impactHole,
    resetWall,
    createDoorGroupJson,
    normalizePanelKind,
    normalizeSwing,
    normalizeLeafCount,
    DOOR_TOGGLED_EVENT
  }
};

export default doorDomain;
