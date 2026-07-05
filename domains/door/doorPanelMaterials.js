/**
 * door domain: door leaf texture layout (BoxGeometry six-face materials).
 * Order matches Three.js BoxGeometry: +X -X +Y -Y +Z -Z.
 *
 * `textureFace`: `"all"` (default) same texture on all faces; `"exterior"` outer face only.
 * `panelKind: "textured"` without `textureFace` defaults to `"exterior"`.
 * When `materials[6]` is provided, user config is respected with no expansion.
 */
import { normalizeMountSide } from "./doorDescriptor.js";
import { DOOR_PANEL_NEUTRAL } from "./doorPalette.js";

/** @type {readonly ["all", "exterior"]} */
export const DOOR_TEXTURE_FACE_VALUES = ["all", "exterior"];

/** @type {readonly ["+x","-x","+y","-y","+z","-z"]} */
export const DOOR_EXTERIOR_FACE_VALUES = ["+x", "-x", "+y", "-y", "+z", "-z"];

const EXTERIOR_FACE_TO_INDEX = {
  "+x": 0,
  "-x": 1,
  "+y": 2,
  "-y": 3,
  "+z": 4,
  "-z": 5
};

const MOUNT_SIDE_TO_EXTERIOR_FACE = {
  front: "+z",
  back: "-z",
  right: "+x",
  left: "-x"
};

/**
 * @param {object} record
 * @returns {"all"|"exterior"}
 */
export function normalizeTextureFace(record) {
  const raw =
    typeof record?.textureFace === "string" ? record.textureFace.trim().toLowerCase() : "";
  if (raw === "exterior" || raw === "all") {
    return raw;
  }
  const panelKind =
    typeof record?.panelKind === "string" ? record.panelKind.trim().toLowerCase() : "";
  if (panelKind === "textured") {
    return "exterior";
  }
  return "all";
}

/**
 * @param {object} geometry
 * @returns {"x"|"y"|"z"}
 */
export function resolveDoorThinAxis(geometry = {}) {
  const width = Number(geometry.width) > 0 ? Number(geometry.width) : 1;
  const height = Number(geometry.height) > 0 ? Number(geometry.height) : 1;
  const depth = Number(geometry.depth) > 0 ? Number(geometry.depth) : 1;
  if (width <= height && width <= depth) {
    return "x";
  }
  if (height <= width && height <= depth) {
    return "y";
  }
  return "z";
}

/**
 * @param {object} geometry
 * @returns {[number, number]}
 */
export function resolveDoorPanelFacePair(geometry = {}) {
  const axis = resolveDoorThinAxis(geometry);
  if (axis === "x") {
    return [0, 1];
  }
  if (axis === "y") {
    return [2, 3];
  }
  return [4, 5];
}

/**
 * @param {object} record
 * @returns {"+x"|"-x"|"+y"|"-y"|"+z"|"-z"|null}
 */
export function normalizeExteriorFace(record) {
  const raw =
    typeof record?.exteriorFace === "string" ? record.exteriorFace.trim().toLowerCase() : "";
  if (EXTERIOR_FACE_TO_INDEX[raw] != null) {
    return raw;
  }
  const mountSide = normalizeMountSide(record);
  if (mountSide && MOUNT_SIDE_TO_EXTERIOR_FACE[mountSide]) {
    return MOUNT_SIDE_TO_EXTERIOR_FACE[mountSide];
  }
  return null;
}

/**
 * @param {object} record
 * @returns {number}
 */
export function resolveDoorExteriorFaceIndex(record) {
  const explicit = Number(record?.exteriorFaceIndex);
  if (Number.isInteger(explicit) && explicit >= 0 && explicit <= 5) {
    return explicit;
  }
  const exteriorFace = normalizeExteriorFace(record);
  if (exteriorFace) {
    return EXTERIOR_FACE_TO_INDEX[exteriorFace];
  }
  const [faceA] = resolveDoorPanelFacePair(record?.geometry || {});
  return faceA;
}

/**
 * @param {object} panelMaterial
 * @param {object} record
 * @returns {string}
 */
function resolveInteriorDoorColor(panelMaterial, record) {
  const fromMaterial =
    typeof panelMaterial?.interiorColor === "string" ? panelMaterial.interiorColor.trim() : "";
  if (fromMaterial) {
    return fromMaterial;
  }
  const fromRecord = typeof record?.interiorColor === "string" ? record.interiorColor.trim() : "";
  if (fromRecord) {
    return fromRecord;
  }
  const panelKind =
    typeof record?.panelKind === "string" ? record.panelKind.trim().toLowerCase() : "";
  if (panelKind === "textured") {
    return "#1a1a1a";
  }
  return panelMaterial?.color || DOOR_PANEL_NEUTRAL;
}

/**
 * @param {object} panelMaterial
 * @param {object} record
 * @returns {object}
 */
function buildInteriorDoorFaceMaterial(panelMaterial, record) {
  const interior = {
    type: panelMaterial?.type || "standard",
    color: resolveInteriorDoorColor(panelMaterial, record),
    transparent: false,
    opacity: 1,
    metalness: panelMaterial?.metalness,
    roughness: panelMaterial?.roughness,
    receiveShadow: panelMaterial?.receiveShadow
  };
  if (interior.metalness == null) {
    delete interior.metalness;
  }
  if (interior.roughness == null) {
    delete interior.roughness;
  }
  if (interior.receiveShadow == null) {
    delete interior.receiveShadow;
  }
  return interior;
}

/**
 * @param {object} record
 * @param {object} panelMaterial exterior material after applyDoorMaterial (includes textureUrl)
 * @returns {object[]}
 */
export function buildDoorPanelFaceMaterials(record, panelMaterial) {
  const exteriorIndex = resolveDoorExteriorFaceIndex(record);
  const interior = buildInteriorDoorFaceMaterial(panelMaterial, record);
  const materials = Array.from({ length: 6 }, () => ({ ...interior }));
  const exteriorMaterial = { ...panelMaterial };
  delete exteriorMaterial.interiorColor;
  materials[exteriorIndex] = exteriorMaterial;
  return materials;
}

/**
 * @param {object} record
 * @returns {boolean}
 */
export function hasUserDefinedDoorMaterials(record) {
  return Array.isArray(record?.materials) && record.materials.length === 6;
}

/**
 * @param {object} record
 * @returns {boolean}
 */
export function shouldApplyExteriorDoorTexture(record) {
  if (hasUserDefinedDoorMaterials(record)) {
    return false;
  }
  if (normalizeTextureFace(record) !== "exterior") {
    return false;
  }
  const textureUrl = record?.material?.textureUrl;
  return Boolean(textureUrl && String(textureUrl).trim());
}

/**
 * Apply single `material` texture per `textureFace`; `exterior` expands six faces and removes `material`.
 * @param {object} record
 */
export function applyDoorPanelMaterials(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  record.textureFace = normalizeTextureFace(record);
  if (!shouldApplyExteriorDoorTexture(record)) {
    return record;
  }
  record.materials = buildDoorPanelFaceMaterials(record, record.material);
  delete record.material;
  return record;
}
