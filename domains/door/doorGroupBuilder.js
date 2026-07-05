/**
 * door domain: door Group descriptor (JSON) for cabinet/UPS assemblies; consumed by deployGroupDescriptor.
 */
import { createInfoPanelDescriptor } from "../../core/builder/infoPanelBuilder.js";
import { cloneJson } from "../../core/util/cloneJson.js";
import { DOOR_PANEL_NEUTRAL } from "./doorPalette.js";
import { createDoorJson } from "./doorDescriptor.js";

const VALID_PANEL_KINDS = new Set(["solid", "glass", "textured"]);
const VALID_SWINGS = new Set(["left", "right"]);

/**
 * @param {unknown} value
 * @returns {"solid"|"glass"|"textured"}
 */
export function normalizePanelKind(value) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (key === "glass") {
    return "glass";
  }
  if (key === "textured") {
    return "textured";
  }
  return "solid";
}

/**
 * @param {object} record
 * @returns {"left"|"right"}
 */
export function normalizeSwing(record) {
  const swing = typeof record?.swing === "string" ? record.swing.trim().toLowerCase() : "";
  if (VALID_SWINGS.has(swing)) {
    return swing;
  }
  const doorType = typeof record?.doorType === "string" ? record.doorType.trim().toLowerCase() : "";
  if (doorType === "right") {
    return "right";
  }
  const legacyType = typeof record?.type === "string" ? record.type.trim().toLowerCase() : "";
  if (legacyType === "right") {
    return "right";
  }
  return "left";
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function normalizeLeafCount(value, fallback = 1) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 1 && n <= 2) {
    return Math.floor(n);
  }
  const legacy = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (legacy === "double") {
    return 2;
  }
  return fallback;
}

/**
 * @param {object} label
 * @param {object} doorGeom
 * @param {number} [scaleRatio]
 * @returns {object|null}
 */
function buildDoorLabelPanel(label, doorGeom, scaleRatio = 1) {
  if (!label || typeof label !== "object") {
    return null;
  }
  const text = label.text != null ? String(label.text).trim() : "";
  if (!text) {
    return null;
  }
  const doorHeight = Number(doorGeom?.height) > 0 ? Number(doorGeom.height) : 1;
  const zOffset = 2.1 * scaleRatio;
  const position = {
    x: 0,
    y: doorHeight / 2 - 18 * scaleRatio,
    z: zOffset
  };
  const fontSizePx = Number(label.fontSizePx) > 0 ? Number(label.fontSizePx) : 48;
  const scale = (fontSizePx / 48) * scaleRatio;
  return createInfoPanelDescriptor(text, position, {
    color: label.color || "#ffffff",
    font: label.fontFamily || label.font || "Arial",
    contentScale: scale,
    textStyle: label.textStyle
  });
}

/**
 * @param {object} input
 * @param {"left"|"right"} swing
 * @returns {object}
 */
function resolveLeafMaterial(input, swing) {
  const material = {
    type: "standard",
    color: DOOR_PANEL_NEUTRAL,
    ...(input.material && typeof input.material === "object" ? input.material : {})
  };
  if (typeof input.resolveTextureUrlForSwing === "function") {
    const textureUrl = input.resolveTextureUrlForSwing(swing);
    if (textureUrl) {
      material.textureUrl = textureUrl;
    }
  }
  return material;
}

/**
 * @param {object} input
 * @param {object} [options]
 * @returns {object}
 */
function buildSingleLeafAssembly(input, options = {}) {
  const panelKind = normalizePanelKind(input.panelKind);
  const swing = normalizeSwing(input);
  const geom = {
    width: Number(input.geometry?.width) > 0 ? Number(input.geometry.width) : 1,
    height: Number(input.geometry?.height) > 0 ? Number(input.geometry.height) : 1,
    depth: Number(input.geometry?.depth) > 0 ? Number(input.geometry.depth) : 1
  };
  const material = resolveLeafMaterial(input, swing);
  const doorOverrides = {
    name: input.name || options.leafName || "door-leaf",
    objType: "door",
    doorType: swing,
    panelKind,
    geometry: geom,
    material,
    position: { x: 0, y: geom.height / 2, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: cloneJson(input.scale || { scaleX: 1, scaleY: 1, scaleZ: 1 })
  };
  if (typeof input.mountSide === "string" && input.mountSide.trim()) {
    doorOverrides.mountSide = input.mountSide.trim().toLowerCase();
  }
  if (typeof input.textureFace === "string" && input.textureFace.trim()) {
    doorOverrides.textureFace = input.textureFace.trim().toLowerCase();
  }
  if (typeof input.exteriorFace === "string" && input.exteriorFace.trim()) {
    doorOverrides.exteriorFace = input.exteriorFace.trim().toLowerCase();
  }
  if (panelKind === "glass") {
    doorOverrides.glassKind =
      typeof input.glassKind === "string" && input.glassKind.trim()
        ? input.glassKind.trim()
        : "clear";
  } else if (panelKind === "solid") {
    doorOverrides.material = {
      ...doorOverrides.material,
      transparent: false,
      opacity: 1
    };
    delete doorOverrides.glassKind;
  } else {
    delete doorOverrides.glassKind;
  }
  const leafDesc = createDoorJson(doorOverrides);
  const assembly = {
    name: input.assemblyName || options.assemblyName || `${doorOverrides.name}-assembly`,
    objType: "group",
    cabinetDoorAssembly: true,
    position: cloneJson(input.position || { x: 0, y: 0, z: 0 }),
    rotation: cloneJson(input.rotation || { rotationX: 0, rotationY: 0, rotationZ: 0 }),
    scale: cloneJson(input.scale || { scaleX: 1, scaleY: 1, scaleZ: 1 }),
    boxModelList: [
      {
        ...leafDesc,
        position: { x: 0, y: 0, z: 0 }
      }
    ]
  };
  const labelPanel = buildDoorLabelPanel(input.label, geom, options.labelScaleRatio ?? 1);
  if (labelPanel) {
    assembly.infoPanelList = [labelPanel];
  }
  return assembly;
}

/**
 * Build single- or double-leaf door Group descriptor (for subGroup attachment).
 * @param {object} input
 * @returns {object}
 */
export function createDoorGroupJson(input = {}) {
  const leafCount = normalizeLeafCount(input.leafCount ?? input.type, 1);
  const baseName = input.name || `door-group-${Date.now()}`;
  if (leafCount === 1) {
    return buildSingleLeafAssembly({ ...input, name: baseName });
  }
  const fullWidth = Number(input.geometry?.width) > 0 ? Number(input.geometry.width) : 1;
  const halfWidth = fullWidth / 2;
  const halfGeom = {
    width: halfWidth,
    height: Number(input.geometry?.height) > 0 ? Number(input.geometry.height) : 1,
    depth: Number(input.geometry?.depth) > 0 ? Number(input.geometry.depth) : 1
  };
  const basePos = input.position || { x: 0, y: 0, z: 0 };
  const leftAssembly = buildSingleLeafAssembly(
    {
      ...input,
      name: `${baseName}-left`,
      assemblyName: `${baseName}-left-assembly`,
      swing: "left",
      leafCount: 1,
      geometry: halfGeom,
      position: {
        x: (basePos.x ?? 0) - halfWidth / 2,
        y: basePos.y ?? 0,
        z: basePos.z ?? 0
      },
      label: input.labelOnLeft === true ? input.label : null
    },
    { assemblyName: `${baseName}-left-assembly` }
  );
  const rightAssembly = buildSingleLeafAssembly(
    {
      ...input,
      name: `${baseName}-right`,
      assemblyName: `${baseName}-right-assembly`,
      swing: "right",
      leafCount: 1,
      geometry: halfGeom,
      position: {
        x: (basePos.x ?? 0) + halfWidth / 2,
        y: basePos.y ?? 0,
        z: basePos.z ?? 0
      },
      label: input.labelOnLeft === true ? null : input.label
    },
    { assemblyName: `${baseName}-right-assembly` }
  );
  return {
    name: baseName,
    objType: "group",
    position: cloneJson(basePos),
    rotation: cloneJson(input.rotation || { rotationX: 0, rotationY: 0, rotationZ: 0 }),
    scale: cloneJson(input.scale || { scaleX: 1, scaleY: 1, scaleZ: 1 }),
    subGroup: [leftAssembly, rightAssembly]
  };
}
