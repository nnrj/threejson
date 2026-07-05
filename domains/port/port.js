/**
 * Port domain fragment templates and constants: `createGroup`-compatible snippets (clone then edit geometry/pose), same role as cabinet `cabinet.js`.
 * Texture placeholders match {@link portShow.json}; replace as needed.
 */
import { assetUrl } from "../../assets/assetsBase.js";

const PORT_WOOD_TEXTURE_URL = assetUrl("textures/building/floor/wood_floor.webp");

/** Quay crane steel rust plate texture (PBR: `MeshStandardMaterial` / `type: standard`) */
const DOCK_CRANE_IRON_TEXTURE_URL = assetUrl("textures/building/metal/iron_frame.webp");

/** Brushed stainless texture: lamp posts, rails, crane trolley/spreader exposed metal. */
const PORT_STAINLESS_STEEL_TEXTURE_URL = assetUrl("textures/building/metal/stainless_steel.webp");

const portGroupShell = {
  name: "portComposite",
  objType: "portComposite",
  position: { x: 0, y: 0, z: 0 },
  rotation: {
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0
  },
  scale: {
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1
  },
  boxModelList: []
};

/**
 * Quay crane main steel: `iron_frame` plate + medium-high metalness, higher roughness (aged paint/rust).
 * @param {object} [overrides] override `textureRepeat` / `metalness` / `roughness` / `color`, etc.
 * @returns {object} material block compatible with {@link createNormalBox}
 */
function dockCraneSteelMaterial(overrides = {}) {
  return {
    type: 'standard',
    color: '#ffffff',
    textureUrl: DOCK_CRANE_IRON_TEXTURE_URL,
    textureRepeat: { x: 4, y: 4 },
    metalness: 0.7,
    roughness: 0.82,
    transparent: false,
    opacity: 1,
    ...overrides
  };
}

/**
 * Crane trolley, spreader, etc.: brushed stainless (distinct from main girder rust plate).
 * @param {object} [overrides]
 */
function dockCraneAccentMaterial(overrides = {}) {
  return {
    type: 'standard',
    color: '#ffffff',
    textureUrl: PORT_STAINLESS_STEEL_TEXTURE_URL,
    textureRepeat: { x: 3, y: 3 },
    metalness: 0.9,
    roughness: 0.4,
    transparent: false,
    opacity: 1,
    ...overrides
  };
}

/**
 * Port scene brushed stainless generic block (lamp posts, shades, rails, RTG girder, etc.).
 * @param {object} [overrides]
 */
function portStainlessMaterial(overrides = {}) {
  return {
    type: 'standard',
    color: '#ffffff',
    textureUrl: PORT_STAINLESS_STEEL_TEXTURE_URL,
    textureRepeat: { x: 3, y: 3 },
    metalness: 0.92,
    roughness: 0.42,
    transparent: false,
    opacity: 1,
    ...overrides
  };
}

function steelPanelTemplate() {
  return {
    name: "steel",
    objType: "dockCranePart",
    geometry: {
      width: 1,
      height: 1,
      depth: 1
    },
    position: { x: 0, y: 0, z: 0 },
    rotation: {
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0
    },
    material: {
      type: "lambert",
      color: "#ffffff",
      textureUrl: PORT_WOOD_TEXTURE_URL,
      textureRepeat: { x: 3, y: 3 }
    }
  };
}

/** Warning color block template (crane trolley/spreader accent) */
function accentPanelTemplate() {
  const box = steelPanelTemplate();
  box.objType = "dockCraneAccent";
  box.material = {
    type: "lambert",
    color: "#ffffff",
    textureUrl: PORT_WOOD_TEXTURE_URL,
    textureRepeat: { x: 2, y: 2 }
  };
  return box;
}

/** Ship hull primary color block */
function hullPanelTemplate() {
  const box = steelPanelTemplate();
  box.objType = "berthShipHull";
  box.material = {
    type: "lambert",
    color: "#ffffff",
    textureUrl: DOCK_CRANE_IRON_TEXTURE_URL,
    textureRepeat: { x: 5, y: 5 }
  };
  return box;
}

/** RTG portal leg */
function rtgLegTemplate() {
  const box = steelPanelTemplate();
  box.objType = "rtgLeg";
  box.material = {
    type: "lambert",
    color: "#ffffff",
    textureUrl: DOCK_CRANE_IRON_TEXTURE_URL
  };
  return box;
}

/** Beacon/lamp post (brushed stainless pole) */
function lampShaftTemplate() {
  const box = steelPanelTemplate();
  box.objType = "portLampShaft";
  box.material = portStainlessMaterial({
    textureRepeat: { x: 2.5, y: 8 },
    roughness: 0.4
  });
  return box;
}

/** Lamp head housing */
function lampHeadTemplate() {
  const box = steelPanelTemplate();
  box.objType = "portLampHead";
  box.material = portStainlessMaterial({
    textureRepeat: { x: 2, y: 2 },
    metalness: 0.88
  });
  return box;
}

/** Checkpoint concrete block */
function gateBarrierTemplate() {
  const box = steelPanelTemplate();
  box.objType = "gateBarrier";
  box.material = {
    type: "lambert",
    color: "#ffffff",
    textureUrl: PORT_WOOD_TEXTURE_URL,
    textureRepeat: { x: 3, y: 3 }
  };
  return box;
}

export {
  PORT_WOOD_TEXTURE_URL,
  DOCK_CRANE_IRON_TEXTURE_URL,
  PORT_STAINLESS_STEEL_TEXTURE_URL,
  portGroupShell,
  steelPanelTemplate,
  accentPanelTemplate,
  hullPanelTemplate,
  rtgLegTemplate,
  lampShaftTemplate,
  lampHeadTemplate,
  gateBarrierTemplate,
  dockCraneSteelMaterial,
  dockCraneAccentMaterial,
  portStainlessMaterial
};
