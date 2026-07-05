/**
 * device.cabinet: door assembly (delegates to door domain createDoorGroupJson).
 */
import { createInfoPanelDescriptor } from "../../../core/builder/infoPanelBuilder.js";
import { STAT_UTIL_MID_TEAL } from "../../stat/statShared.js";
import { DEVICE_SHELL_SIDE } from "../devicePalette.js";
import { assetUrl } from "../../../assets/assetsBase.js";
import { computeHingeOffsetFromCenter, DOOR_OPEN_ANGLE_PRESETS } from "../../door/doorDescriptor.js";
import { createDoorGroupJson, normalizeLeafCount, normalizeSwing } from "../../door/doorGroupBuilder.js";
import { cloneJson } from "../../../core/util/cloneJson.js";
import { valueOr } from "../../../core/util/util.js";

const CABINET_DEFAULT_DOOR_HEIGHT = 150;

/** Batch visibility key for cabinet door number info panels (not default `infoPanel`, avoids worldInfo bucket collision). */
export const CABINET_NUM_PANEL_NAME = "cabNumPanel";

/** Matches cabinet side panel {@link deviceTemplates} {@link DEVICE_SHELL_SIDE}; white tint preserves texture color. */
const CABINET_DOOR_FACE_MATERIAL = {
  type: "standard",
  color: "#FFFFFF",
  interiorColor: "#1A1A1A",
  metalness: 0.35,
  roughness: 0.55
};

const WALL_INDEX_BY_SIDE = {
  front: 5,
  back: 4,
  right: 3,
  left: 2
};

/**
 * Leaf swing matches texture filename: left leaf uses left texture (handle on free/mullion edge), right uses right.
 * @param {"left"|"right"} swing
 * @returns {string}
 */
export function resolveCabinetDoorTexture(swing) {
  return swing === "left"
    ? assetUrl("textures/device/cabinet/cabinet_left_door.png")
    : assetUrl("textures/device/cabinet/cabinet_right_door.png");
}

/**
 * Hinge side vs `swing` when mounting on each cabinet face (matches legacy cabinet productCabinetDoor).
 * @param {string} mountSide
 * @param {"left"|"right"} swing
 * @returns {"left"|"right"}
 */
export function resolveCabinetDoorHingeSide(mountSide, swing) {
  const normalizedSwing = swing === "right" ? "right" : "left";
  if (mountSide === "front") {
    return normalizedSwing;
  }
  return normalizedSwing === "left" ? "right" : "left";
}

function isDoorLeafRecord(node) {
  return String(node?.objType || "").trim().toLowerCase() === "door";
}

/**
 * Collect door leaf JSON descriptors from a cabinet door assembly tree.
 * @param {object|null|undefined} node
 * @param {object[]} [out]
 * @returns {object[]}
 */
function collectCabinetDoorLeafDescriptors(node, out = []) {
  if (!node || typeof node !== "object") {
    return out;
  }
  if (isDoorLeafRecord(node)) {
    out.push(node);
    return out;
  }
  for (const key of ["boxModelList", "subGroup", "subScene"]) {
    const children = node[key];
    if (!Array.isArray(children)) {
      continue;
    }
    for (let i = 0; i < children.length; i++) {
      collectCabinetDoorLeafDescriptors(children[i], out);
    }
  }
  return out;
}

/**
 * Stable ids for ELM door.toggle on cabinet door leaves (parent cabinet must have threeJsonId).
 * @param {string|null|undefined} cabinetThreeJsonId
 * @param {object|null|undefined} assembly
 * @param {string} side
 */
export function assignCabinetDoorLeafIds(cabinetThreeJsonId, assembly, side) {
  const cabinetId = typeof cabinetThreeJsonId === "string" ? cabinetThreeJsonId.trim() : "";
  const mountSide = typeof side === "string" ? side.trim().toLowerCase() : "front";
  if (!cabinetId || !assembly) {
    return;
  }
  const leaves = collectCabinetDoorLeafDescriptors(assembly);
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i];
    if (typeof leaf.threeJsonId === "string" && leaf.threeJsonId.trim()) {
      continue;
    }
    const swing = normalizeSwing(leaf);
    const suffix = leaves.length > 1 ? `-${swing}` : "";
    leaf.threeJsonId = `${cabinetId}__door-${mountSide}${suffix}`;
  }
}

/**
 * @param {object} node
 * @param {string} mountSide
 */
function stampCabinetDoorKinematics(node, mountSide) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (node.objType === "door") {
    const swing = normalizeSwing(node);
    node.doorType = swing;
    node.swing = swing;
    node.mountSide = mountSide;
    node.openDirection = "outward";
    node.openAngleDeg = DOOR_OPEN_ANGLE_PRESETS.cabinet;
    node.hingeSide = resolveCabinetDoorHingeSide(mountSide, swing);
  }
  const children = [
    ...(Array.isArray(node.boxModelList) ? node.boxModelList : []),
    ...(Array.isArray(node.subGroup) ? node.subGroup : []),
    ...(Array.isArray(node.subScene) ? node.subScene : [])
  ];
  for (let i = 0; i < children.length; i++) {
    stampCabinetDoorKinematics(children[i], mountSide);
  }
}

/**
 * @param {number} doorHeight
 * @returns {number}
 */
export function getCabNumScaleRatio(doorHeight) {
  const h = Math.abs(Number(doorHeight)) || CABINET_DEFAULT_DOOR_HEIGHT;
  return Math.max(0.1, h / CABINET_DEFAULT_DOOR_HEIGHT);
}

/**
 * @param {{x?:number,y?:number,z?:number}} leafPosition
 * @param {number} doorHeight
 * @param {number} [zDirection=1]
 * @returns {{x:number,y:number,z:number}}
 */
export function createCabNumPosition(leafPosition, doorHeight, zDirection = 1) {
  const ratio = getCabNumScaleRatio(doorHeight);
  const baseX = valueOr(leafPosition?.x, 0);
  const baseZ = valueOr(leafPosition?.z, 0);
  const zOffset = 2.1 * ratio;
  return {
    x: baseX,
    y: doorHeight / 2 - 18 * ratio,
    z: baseZ + (zDirection >= 0 ? zOffset : -zOffset)
  };
}

/**
 * @param {string} cabNum
 * @param {{x?:number,y?:number,z?:number}} position
 * @param {number} [scaleRatio=1]
 * @returns {object}
 */
export function buildCabinetNumPanel(cabNum, position, scaleRatio = 1) {
  const normalizedScaleRatio = Math.max(0.1, Number(scaleRatio) || 1);
  const panelSize = 6.5 * normalizedScaleRatio;
  const descriptor = createInfoPanelDescriptor(
    cabNum,
    {
      x: valueOr(position?.x, 0),
      y: valueOr(position?.y, 0),
      z: valueOr(position?.z, 0)
    },
    {
      panelBoxType: "plane",
      color: "#fff",
      backColor: STAT_UTIL_MID_TEAL,
      panelWidth: panelSize,
      panelHeight: panelSize,
      textureWidth: 100,
      textureHeight: 100,
      textAlign: "center",
      textVerticalAlign: "middle",
      font: "32px SimHei",
      textStyle: {
        fontSizePx: 44,
        minFontPx: 28,
        maxFontPx: 52,
        autoFit: true,
        fitRatio: 0.72,
        padding: 4,
        fontFamily: "SimHei"
      },
      opacity: 1,
      panelDepth: 0
    }
  );
  descriptor.name = CABINET_NUM_PANEL_NAME;
  return descriptor;
}

/**
 * @param {object} doorLeaf
 * @param {number} doorHeight
 * @param {number} zDirection
 * @returns {{x:number,y:number,z:number}}
 */
function resolveCabNumAnchorPosition(doorLeaf, doorHeight, zDirection) {
  const hingeOffset = computeHingeOffsetFromCenter(doorLeaf || {});
  return createCabNumPosition(
    { x: -hingeOffset.x, y: 0, z: -hingeOffset.z },
    doorHeight,
    zDirection
  );
}

/**
 * @param {object} assembly
 * @param {string} text
 * @param {number} doorHeight
 * @param {number} [zDirection=1]
 */
function attachCabinetNumPanel(assembly, text, doorHeight, zDirection = 1) {
  if (!assembly || !text) {
    return;
  }
  const ratio = getCabNumScaleRatio(doorHeight);
  const attachToLeafAssembly = (leafAssembly) => {
    if (!leafAssembly) {
      return;
    }
    delete leafAssembly.infoPanelList;
    const leaf = leafAssembly.boxModelList?.[0];
    const position = resolveCabNumAnchorPosition(leaf, doorHeight, zDirection);
    leafAssembly.infoPanelList = [buildCabinetNumPanel(text, position, ratio)];
  };
  if (Array.isArray(assembly.subGroup) && assembly.subGroup.length > 0) {
    attachToLeafAssembly(assembly.subGroup[0]);
    delete assembly.infoPanelList;
    return;
  }
  attachToLeafAssembly(assembly);
}

/**
 * @param {object} door
 * @param {string} [cabLabel]
 * @returns {string|null}
 */
function resolveCabinetDoorLabelText(door, cabLabel) {
  if (door?.label && typeof door.label === "object") {
    const text = door.label.text != null ? String(door.label.text).trim() : "";
    if (text) {
      return text;
    }
  }
  if (door?.side === "front" && cabLabel != null && String(cabLabel).trim() !== "") {
    return String(cabLabel).trim();
  }
  return null;
}

/**
 * @param {object} door
 * @param {string} [cabLabel]
 * @returns {object}
 */
export function normalizeCabinetDoorRecord(door, cabLabel) {
  const side = typeof door?.side === "string" ? door.side.trim().toLowerCase() : "front";
  const legacyType = typeof door?.type === "string" ? door.type.trim().toLowerCase() : "";
  let swing = normalizeSwing(door);
  let leafCount = normalizeLeafCount(door?.leafCount ?? legacyType, 1);
  if (legacyType === "double") {
    leafCount = 2;
  } else if (legacyType === "left") {
    swing = "left";
    leafCount = 1;
  } else if (legacyType === "right") {
    swing = "right";
    leafCount = 1;
  }
  const labelText = resolveCabinetDoorLabelText({ ...door, side }, cabLabel);
  return {
    side,
    swing,
    leafCount,
    panelKind: door?.panelKind,
    glassKind: door?.glassKind,
    label: labelText ? { text: labelText } : null
  };
}

/**
 * Double doors: each hinge group at left/right jamb of opening (matches legacy cabinet productCabinetDoor).
 * @param {object} assembly
 * @param {string} side
 * @param {number} doorWidth
 */
export function positionDoubleDoorLeafAssemblies(assembly, side, doorWidth) {
  const leaves = Array.isArray(assembly?.subGroup) ? assembly.subGroup : [];
  if (leaves.length < 2) {
    return;
  }
  const halfW = doorWidth / 2;
  let leftAsm = null;
  let rightAsm = null;
  for (let i = 0; i < leaves.length; i++) {
    const leaf = leaves[i]?.boxModelList?.[0];
    const swing = normalizeSwing(leaf || {});
    if (swing === "left") {
      leftAsm = leaves[i];
    } else if (swing === "right") {
      rightAsm = leaves[i];
    }
  }
  if (!leftAsm || !rightAsm) {
    leftAsm = leaves[0];
    rightAsm = leaves[1];
  }
  if (side === "front") {
    leftAsm.position = { x: -halfW, y: 0, z: 0 };
    rightAsm.position = { x: halfW, y: 0, z: 0 };
    return;
  }
  if (side === "back") {
    leftAsm.position = { x: halfW, y: 0, z: 0 };
    rightAsm.position = { x: -halfW, y: 0, z: 0 };
    return;
  }
  if (side === "right") {
    leftAsm.position = { x: 0, y: 0, z: -halfW };
    rightAsm.position = { x: 0, y: 0, z: halfW };
    return;
  }
  if (side === "left") {
    leftAsm.position = { x: 0, y: 0, z: halfW };
    rightAsm.position = { x: 0, y: 0, z: -halfW };
  }
}

/**
 * @param {object} assembly
 * @param {string} side
 * @param {string} swing
 * @param {number} width
 * @param {number} length
 * @param {number} height
 * @param {number} wallDepth
 * @param {number} [leafCount=1]
 */
function positionDoorAssembly(assembly, side, swing, width, length, height, wallDepth, leafCount = 1) {
  const wallCenterY = height / 2;
  const halfW = width / 2;
  const halfL = length / 2;
  const jambX = halfW - wallDepth;
  const jambZ = halfL - wallDepth;
  if (leafCount === 2) {
    if (side === "front") {
      assembly.position = { x: 0, y: wallCenterY, z: halfL };
    } else if (side === "back") {
      assembly.position = { x: 0, y: wallCenterY, z: -halfL };
    } else if (side === "right") {
      assembly.position = { x: jambX, y: wallCenterY, z: 0 };
    } else if (side === "left") {
      assembly.position = { x: -jambX, y: wallCenterY, z: 0 };
    }
    return;
  }
  if (side === "front") {
    const z = halfL;
    if (swing === "left") {
      assembly.position = { x: -jambX, y: wallCenterY, z };
    } else if (swing === "right") {
      assembly.position = { x: jambX, y: wallCenterY, z };
    } else {
      assembly.position = { x: 0, y: wallCenterY, z };
    }
    return;
  }
  if (side === "back") {
    const z = -halfL;
    if (swing === "left") {
      assembly.position = { x: jambX, y: wallCenterY, z };
    } else if (swing === "right") {
      assembly.position = { x: -jambX, y: wallCenterY, z };
    } else {
      assembly.position = { x: 0, y: wallCenterY, z };
    }
    return;
  }
  if (side === "right") {
    const x = jambX;
    assembly.position = { x, y: wallCenterY, z: swing === "right" ? -jambZ : jambZ };
    return;
  }
  if (side === "left") {
    const x = -jambX;
    assembly.position = { x, y: wallCenterY, z: swing === "right" ? jambZ : -jambZ };
  }
}

/**
 * @param {object} cabinetObj
 * @param {object} groupObj
 * @param {number} width
 * @param {number} length
 * @param {number} height
 * @param {number} wallDepth
 * @returns {object}
 */
export function applyCabinetDoors(cabinetObj, groupObj, width, length, height, wallDepth) {
  if (!cabinetObj || !groupObj || !Array.isArray(cabinetObj.doors) || cabinetObj.doors.length === 0) {
    return groupObj;
  }
  const cabLabel = cabinetObj.cabLabel;
  const subGroup = Array.isArray(groupObj.subGroup) ? [...groupObj.subGroup] : [];
  for (let i = 0; i < cabinetObj.doors.length; i++) {
    const door = normalizeCabinetDoorRecord(cabinetObj.doors[i], cabLabel);
    const wallIndex = WALL_INDEX_BY_SIDE[door.side];
    if (wallIndex == null || !groupObj.boxModelList?.[wallIndex]) {
      continue;
    }
    const wall = groupObj.boxModelList[wallIndex];
    const doorWidth = wall.geometry.width;
    const doorHeight = wall.geometry.height;
    const doorDepth = wall.geometry.depth ?? wallDepth;
    groupObj.boxModelList.splice(wallIndex, 1);
    const assembly = createDoorGroupJson({
      name: `${door.side}-door`,
      panelKind: door.panelKind || "glass",
      textureFace: "exterior",
      mountSide: door.side,
      swing: door.swing,
      leafCount: door.leafCount,
      glassKind: door.glassKind || "clear",
      geometry: { width: doorWidth, height: doorHeight, depth: doorDepth },
      material: { ...CABINET_DOOR_FACE_MATERIAL },
      resolveTextureUrlForSwing: resolveCabinetDoorTexture
    });
    stampCabinetDoorKinematics(assembly, door.side);
    assignCabinetDoorLeafIds(cabinetObj.threeJsonId, assembly, door.side);
    if (door.leafCount === 2) {
      positionDoubleDoorLeafAssemblies(assembly, door.side, doorWidth);
    }
    positionDoorAssembly(assembly, door.side, door.swing, width, length, height, wallDepth, door.leafCount);
    const labelText = resolveCabinetDoorLabelText(door, cabLabel);
    if (labelText) {
      const zDirection = door.side === "back" ? -1 : 1;
      attachCabinetNumPanel(assembly, labelText, doorHeight, zDirection);
    }
    subGroup.push(assembly);
  }
  if (subGroup.length > 0) {
    groupObj.subGroup = subGroup;
  }
  return groupObj;
}

/**
 * @param {object} groupObj
 * @param {number} width
 * @param {number} length
 * @param {number} height
 * @param {number} wallDepth
 * @returns {object}
 */
export function removeFrontWallForUps(groupObj, width, length, height, wallDepth) {
  const idx = WALL_INDEX_BY_SIDE.front;
  if (!groupObj?.boxModelList?.[idx]) {
    return { groupObj, opening: null };
  }
  const wall = cloneJson(groupObj.boxModelList[idx]);
  groupObj.boxModelList.splice(idx, 1);
  return {
    groupObj,
    opening: {
      width: wall.geometry?.width ?? width,
      height: wall.geometry?.height ?? height,
      depth: wall.geometry?.depth ?? wallDepth,
      position: cloneJson(wall.position || { x: 0, y: height / 2, z: length / 2 })
    }
  };
}
