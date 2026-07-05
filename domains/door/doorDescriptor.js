import { resolveDomainItemDescriptor } from "../../core/handler/domainDeployDescriptor.js";
import { log } from "../../core/util/logger.js";
import { applyDoorPanelMaterials } from "./doorPanelMaterials.js";

/** @type {Record<string, { color: string, opacity: number, transparent: boolean, metalness?: number, roughness?: number }>} */
export const GLASS_KIND_PRESETS = {
  clear: {
    color: "#98c8ff",
    opacity: 0.35,
    transparent: true,
    metalness: 0.05,
    roughness: 0.12
  },
  tinted: {
    color: "#5a9fd4",
    opacity: 0.45,
    transparent: true,
    metalness: 0.06,
    roughness: 0.18
  },
  frosted: {
    color: "#e8eef5",
    opacity: 0.55,
    transparent: true,
    metalness: 0.02,
    roughness: 0.82
  },
  doorPanel: {
    opacity: 0.85,
    transparent: true,
    metalness: 0.05,
    roughness: 0.12
  }
};

/**
 * @param {unknown} record
 * @returns {boolean}
 */
export function isDoorDescriptor(record) {
  const item = resolveDomainItemDescriptor(record);
  const raw = typeof (item?.objType ?? record?.objType) === "string"
    ? String(item?.objType ?? record?.objType).trim().toLowerCase()
    : "";
  if (raw === "door") {
    return true;
  }
  const domain = String(record?.domain || "").trim().toLowerCase();
  return domain === "door" && item != null;
}

/**
 * @param {object} baseMaterial
 * @param {object} record
 * @returns {object}
 */
export function applyDoorMaterial(baseMaterial, record) {
  const material = { ...baseMaterial };
  const panelKind =
    typeof record?.panelKind === "string" ? record.panelKind.trim().toLowerCase() : "";
  if (panelKind === "textured") {
    material.transparent = false;
    material.opacity = 1;
    material.type = "standard";
    return material;
  }
  const kind =
    typeof record?.glassKind === "string" ? record.glassKind.trim() : "";
  const hasTexture = Boolean(
    material.textureUrl && String(material.textureUrl).trim()
  );
  const presetKey =
    hasTexture && (!kind || kind === "clear")
      ? "doorPanel"
      : kind && GLASS_KIND_PRESETS[kind]
        ? kind
        : null;
  if (presetKey && GLASS_KIND_PRESETS[presetKey]) {
    const preset = GLASS_KIND_PRESETS[presetKey];
    material.transparent = preset.transparent;
    material.opacity = preset.opacity;
    if (baseMaterial.metalness != null && baseMaterial.metalness !== "") {
      material.metalness = Number(baseMaterial.metalness);
    } else if (preset.metalness != null) {
      material.metalness = preset.metalness;
    }
    if (baseMaterial.roughness != null && baseMaterial.roughness !== "") {
      material.roughness = Number(baseMaterial.roughness);
    } else if (preset.roughness != null) {
      material.roughness = preset.roughness;
    }
    if (!material.textureUrl && preset.color) {
      material.color = preset.color;
    }
  }
  material.type = "standard";
  return material;
}

const VALID_SWINGS = new Set(["left", "right"]);
const VALID_OPEN_DIRECTIONS = new Set(["outward", "inward"]);
const VALID_MOUNT_SIDES = new Set(["front", "back", "left", "right"]);

/** Default open angle in degrees (~108°); cabinet doors use {@link DOOR_OPEN_ANGLE_PRESETS.cabinet} (130°). */
export const DEFAULT_OPEN_ANGLE_DEG = 108;

/** Recommended open angles by door type (degrees) */
export const DOOR_OPEN_ANGLE_PRESETS = {
  cabinet: 130,
  room: 108,
  default: DEFAULT_OPEN_ANGLE_DEG
};

function normalizeDoorType(record) {
  if (typeof record?.doorType === "string" && record.doorType.trim()) {
    return record.doorType.trim();
  }
  const bi = record?.businessInfo;
  if (bi && typeof bi.doorType === "string" && bi.doorType.trim()) {
    return bi.doorType.trim();
  }
  return "left";
}

/**
 * Hinge side on leaf (leaf local coords). Defaults match `doorType` / `swing`.
 * @param {object} record
 * @returns {"left"|"right"}
 */
export function normalizeHingeSide(record) {
  const hingeSide =
    typeof record?.hingeSide === "string" ? record.hingeSide.trim().toLowerCase() : "";
  if (VALID_SWINGS.has(hingeSide)) {
    return hingeSide;
  }
  const swing = typeof record?.swing === "string" ? record.swing.trim().toLowerCase() : "";
  if (VALID_SWINGS.has(swing)) {
    return swing;
  }
  return normalizeDoorType(record) === "right" ? "right" : "left";
}

/**
 * @param {object} record
 * @returns {"outward"|"inward"}
 */
export function normalizeOpenDirection(record) {
  const openDirection =
    typeof record?.openDirection === "string" ? record.openDirection.trim().toLowerCase() : "";
  if (VALID_OPEN_DIRECTIONS.has(openDirection)) {
    return openDirection;
  }
  return "outward";
}

/**
 * @param {object} record
 * @returns {"front"|"back"|"left"|"right"|null}
 */
export function normalizeMountSide(record) {
  const mountSide =
    typeof record?.mountSide === "string" ? record.mountSide.trim().toLowerCase() : "";
  if (VALID_MOUNT_SIDES.has(mountSide)) {
    return mountSide;
  }
  const doorMountSide =
    typeof record?.doorMountSide === "string" ? record.doorMountSide.trim().toLowerCase() : "";
  if (VALID_MOUNT_SIDES.has(doorMountSide)) {
    return doorMountSide;
  }
  return null;
}

/**
 * @param {object} record
 * @returns {"left"|"right"}
 */
export function normalizeSwingSide(record) {
  const swing = typeof record?.swing === "string" ? record.swing.trim().toLowerCase() : "";
  if (VALID_SWINGS.has(swing)) {
    return swing;
  }
  return normalizeDoorType(record) === "right" ? "right" : "left";
}

/**
 * Open angle in degrees. JSON scenes prefer `openAngleDeg`; code may override with `openAngle` (radians).
 * @param {object} record
 * @returns {number}
 */
export function normalizeOpenAngleDeg(record) {
  const deg = Number(record?.openAngleDeg);
  if (Number.isFinite(deg) && deg > 0) {
    return deg;
  }
  const rad = Number(record?.openAngle);
  if (Number.isFinite(rad) && rad > 0) {
    return (rad * 180) / Math.PI;
  }
  return DEFAULT_OPEN_ANGLE_DEG;
}

/**
 * @param {object} record
 * @returns {number}
 */
export function normalizeOpenAngleRad(record) {
  return (normalizeOpenAngleDeg(record) * Math.PI) / 180;
}

/**
 * Target open angle around Y (radians). `doorType`/`swing` set base rotation; `mountSide`/`openDirection` outward vs inward.
 * @param {object} record
 * @returns {number}
 */
export function resolveOpenRotationY(record) {
  const swing = normalizeSwingSide(record);
  const hingeSide = normalizeHingeSide(record);
  const openDirection = normalizeOpenDirection(record);
  const mountSide = normalizeMountSide(record);
  let sign = swing === "right" ? 1 : -1;
  // Front/back: hinge geometry fixed by hingeSide; rotation matches legacy doorType for outward open.
  // Side-wall leaves hinge on Z; flip rotation when hingeSide and swing disagree.
  if ((mountSide === "left" || mountSide === "right") && hingeSide !== swing) {
    sign *= -1;
  }
  if (openDirection === "inward") {
    sign *= -1;
  }
  return sign * normalizeOpenAngleRad(record);
}

/**
 * Leaf center to hinge local offset (Y-axis rotation door; JSON position is hinge Group world position).
 * @param {object} record
 * @returns {{ x: number, y: number, z: number }}
 */
export function computeHingeOffsetFromCenter(record) {
  const geom = record?.geometry ?? {};
  const scale = record?.scale ?? {};
  const width = Number(geom.width) > 0 ? Number(geom.width) : 1;
  const depth = Number(geom.depth) > 0 ? Number(geom.depth) : 1;
  const scaleX = Number(scale.scaleX) > 0 ? Number(scale.scaleX) : 1;
  const scaleZ = Number(scale.scaleZ) > 0 ? Number(scale.scaleZ) : 1;
  const halfX = (width * scaleX) / 2;
  const halfZ = (depth * scaleZ) / 2;
  const useX = halfX >= halfZ;
  const half = useX ? halfX : halfZ;
  const hingeSide = normalizeHingeSide(record);
  const sign = hingeSide === "right" ? 1 : -1;
  if (useX) {
    return { x: sign * half, y: 0, z: 0 };
  }
  return { x: 0, y: 0, z: sign * half };
}

function defaultDoorDescriptor() {
  return {
    name: `new-door-${Date.now()}`,
    objType: "door",
    boxType: "box",
    doorType: "left",
    glassKind: "clear",
    geometry: { width: 1, height: 19, depth: 5 },
    material: {
      type: "standard",
      color: "#98c8ff",
      opacity: 0.35,
      transparent: true,
      metalness: 0.05,
      roughness: 0.12
    },
    position: { x: 0, y: 0, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  };
}

/**
 * @param {object} overrides
 * @returns {Record<string, unknown>}
 */
function stripLegacyDoorFields(overrides) {
  const copy = { ...overrides };
  delete copy.type;
  return copy;
}

/**
 * @param {object} overrides
 * @returns {object}
 */
export function createDoorJson(overrides) {
  const base = defaultDoorDescriptor();
  if (overrides == null || overrides === "") {
    return base;
  }
  let merged = base;
  if (typeof overrides === "string") {
    try {
      const parsed = JSON.parse(overrides);
      if (parsed && typeof parsed === "object") {
        merged = { ...base, ...parsed };
      }
    } catch {
      log.warn("[door] createDoorJson: JSON parse failed, using default descriptor");
    }
  } else {
    merged = { ...base, ...stripLegacyDoorFields(overrides) };
  }
  merged.objType = "door";
  merged.boxType = merged.boxType || "box";
  merged.doorType = normalizeDoorType(merged);
  merged.hingeSide = normalizeHingeSide(merged);
  merged.openDirection = normalizeOpenDirection(merged);
  const mountSide = normalizeMountSide(merged);
  if (mountSide) {
    merged.mountSide = mountSide;
  } else {
    delete merged.mountSide;
  }
  merged.openAngleDeg = normalizeOpenAngleDeg(merged);
  merged.material = applyDoorMaterial(
    {
      ...base.material,
      ...(merged.material && typeof merged.material === "object" ? merged.material : {})
    },
    merged
  );
  applyDoorPanelMaterials(merged);
  if (merged.businessInfo && typeof merged.businessInfo === "object") {
    const { doorType: _dt, businessName: _bn, ...restBi } = merged.businessInfo;
    merged.businessInfo = Object.keys(restBi).length ? restBi : undefined;
  }
  delete merged.type;
  return merged;
}
