/**
 * Port assembly factory: `createPortJson` → group JSON; `createPort` → `THREE.Group`; `deployPort` → `scene.add`.
 */

import { finalizeDomainDeployRoot } from '../../core/handler/domainDeployDescriptor.js';
import { createGroupFromDescriptor, deployGroupDescriptor } from '../../core/handler/objectLoadHandler.js';
import { migrateGroupDescriptorToSubScene } from '../../core/handler/subSceneHierarchy.js';
import {
  portGroupShell,
  steelPanelTemplate,
  accentPanelTemplate,
  hullPanelTemplate,
  rtgLegTemplate,
  lampShaftTemplate,
  lampHeadTemplate,
  dockCraneSteelMaterial,
  dockCraneAccentMaterial,
  portStainlessMaterial
} from './port.js';
import { valueOr } from '../../core/util/util.js';

const DEFAULT_BOX = {
  width: 60,
  length: 90,
  height: 100
};

/**
 * Read width/depth(length)/height from JSON; `length` and `depth` are equivalent.
 */
function getBoxGeometrySize(source, defaults = DEFAULT_BOX) {
  const g = (source && source.geometry) || {};
  const depth = valueOr(g.depth, valueOr(g.length, defaults.length));
  return {
    width: valueOr(g.width, defaults.width),
    length: depth,
    height: valueOr(g.height, defaults.height)
  };
}

function cloneCfg(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function pickRootTransform(src, shell) {
  const out = cloneCfg(shell);
  out.name = src.name || out.name;
  const srcObjType = typeof src?.objType === "string" ? src.objType.trim().toLowerCase() : "";
  if (srcObjType && srcObjType !== "domain") {
    out.objType = src.objType;
  }
  out.position = src.position ? { ...src.position } : { ...out.position };
  out.rotation = src.rotation
    ? {
        rotationX: valueOr(src.rotation.rotationX, 0),
        rotationY: valueOr(src.rotation.rotationY, 0),
        rotationZ: valueOr(src.rotation.rotationZ, 0)
      }
    : { ...out.rotation };
  out.scale = src.scale ? { ...out.scale } : { ...out.scale };
  if (src.businessInfo) {
    out.businessInfo = cloneCfg(src.businessInfo);
  }
  if (src.infoPanel) {
    out.infoPanel = cloneCfg(src.infoPanel);
  }
  if (src.infoPanelList) {
    out.infoPanelList = cloneCfg(src.infoPanelList);
  }
  return out;
}

/**
 * Quay crane schematic: sea/land legs, top girder, boom, trolley and spreader blocks.
 * Child leg bottoms at group local y=0; JSON root `position.y` is floor/berth contact world height, not bbox center height/2.
 */
function createDockCraneComposite(src) {
  const { width, length, height } = getBoxGeometrySize(src);
  const g = pickRootTransform(src, portGroupShell);
  g.boxModelList = [];

  const legW = Math.max(4, width * 0.12);
  const legD = Math.max(6, length * 0.45);
  const legH = height * 0.88;
  const legY = legH / 2;
  const legSpread = width * 0.42;

  for (let side = -1; side <= 1; side += 2) {
    const leg = cloneCfg(steelPanelTemplate());
    leg.name = side < 0 ? '岸桥腿L' : '岸桥腿R';
    leg.geometry = { width: legW, height: legH, depth: legD };
    leg.position = {
      x: side * legSpread,
      y: legY,
      z: length * 0.08
    };
    leg.material = dockCraneSteelMaterial({
      textureRepeat: { x: 2.6, y: Math.max(7, Math.min(14, legH / 12)) }
    });
    g.boxModelList.push(leg);
  }

  const girder = cloneCfg(steelPanelTemplate());
  girder.name = '岸桥大梁';
  girder.geometry = {
    width: width * 1.08,
    height: Math.max(5, height * 0.04),
    depth: length * 0.55
  };
  girder.position = {
    x: 0,
    y: height * 0.9,
    z: length * 0.1
  };
  girder.material = dockCraneSteelMaterial({
    textureRepeat: { x: Math.max(8, width / 14), y: 3.2 }
  });
  g.boxModelList.push(girder);

  const boom = cloneCfg(steelPanelTemplate());
  boom.name = '岸桥前臂';
  boom.geometry = {
    width: width * 0.22,
    height: Math.max(4, height * 0.025),
    depth: length * 1.25
  };
  boom.position = {
    x: 0,
    y: height * 0.82,
    z: -length * 0.55
  };
  boom.material = dockCraneSteelMaterial({
    textureRepeat: { x: 3.2, y: Math.max(10, length / 9) }
  });
  g.boxModelList.push(boom);

  const trolley = cloneCfg(accentPanelTemplate());
  trolley.name = '岸桥小车';
  trolley.geometry = {
    width: width * 0.2,
    height: Math.max(6, height * 0.03),
    depth: length * 0.16
  };
  trolley.position = {
    x: width * 0.12,
    y: height * 0.86,
    z: -length * 0.25
  };
  trolley.material = dockCraneAccentMaterial({
    textureRepeat: { x: 3.5, y: 2.8 }
  });
  g.boxModelList.push(trolley);

  const spreader = cloneCfg(accentPanelTemplate());
  spreader.name = '吊具';
  spreader.geometry = {
    width: width * 0.55,
    height: Math.max(3, height * 0.012),
    depth: length * 0.12
  };
  spreader.position = {
    x: 0,
    y: height * 0.38,
    z: -length * 0.35
  };
  spreader.material = dockCraneAccentMaterial({
    textureRepeat: { x: 6.5, y: 2.2 }
  });
  g.boxModelList.push(spreader);

  const cabin = cloneCfg(steelPanelTemplate());
  cabin.name = '司机室';
  cabin.geometry = {
    width: Math.max(8, width * 0.14),
    height: Math.max(10, height * 0.06),
    depth: Math.max(8, length * 0.12)
  };
  cabin.position = {
    x: -width * 0.38,
    y: height * 0.78,
    z: length * 0.22
  };
  cabin.material = dockCraneSteelMaterial({
    textureRepeat: { x: 2.4, y: 2.8 }
  });
  g.boxModelList.push(cabin);

  return g;
}

/**
 * Berth cargo ship schematic: low hull + deck + superstructure.
 */
function createBerthShipComposite(src) {
  const { width, length, height } = getBoxGeometrySize(src);
  const g = pickRootTransform(src, portGroupShell);
  g.boxModelList = [];

  const hull = cloneCfg(hullPanelTemplate());
  hull.name = '船体';
  hull.geometry = {
    width: width * 1.05,
    height: height * 0.42,
    depth: length * 0.92
  };
  hull.position = {
    x: 0,
    y: height * 0.21,
    z: 0
  };
  g.boxModelList.push(hull);

  const deck = cloneCfg(steelPanelTemplate());
  deck.name = '甲板';
  deck.objType = 'berthShipDeck';
  deck.geometry = {
    width: width * 0.92,
    height: Math.max(2, height * 0.04),
    depth: length * 0.88
  };
  deck.position = {
    x: 0,
    y: height * 0.45,
    z: length * 0.02
  };
  g.boxModelList.push(deck);

  const superstructure = cloneCfg(hullPanelTemplate());
  superstructure.name = '上层建筑';
  superstructure.objType = 'berthShipSuper';
  superstructure.geometry = {
    width: width * 0.28,
    height: height * 0.48,
    depth: length * 0.2
  };
  superstructure.position = {
    x: -width * 0.22,
    y: height * 0.68,
    z: length * 0.32
  };
  g.boxModelList.push(superstructure);

  const bow = cloneCfg(hullPanelTemplate());
  bow.name = '艏部';
  bow.objType = 'berthShipBow';
  bow.geometry = {
    width: width * 0.55,
    height: height * 0.35,
    depth: length * 0.18
  };
  bow.position = {
    x: 0,
    y: height * 0.22,
    z: -length * 0.46
  };
  g.boxModelList.push(bow);

  return g;
}

/**
 * RTG schematic: four legs, top beam, hoist trolley.
 * Same convention as quay crane: child leg bottoms at group local y=0; JSON root `position.y` is **floor world height** (not single-box center height).
 */
function createRtgComposite(src) {
  const { width, length, height } = getBoxGeometrySize(src);
  const g = pickRootTransform(src, portGroupShell);
  g.boxModelList = [];

  const pillarW = Math.max(4, width * 0.11);
  const pillarD = Math.max(4, length * 0.14);
  const pillarH = height * 0.72;
  const py = pillarH / 2;
  const gx = width * 0.38;
  const gz = length * 0.32;

  for (let ix = -1; ix <= 1; ix += 2) {
    for (let iz = -1; iz <= 1; iz += 2) {
      const pillar = cloneCfg(rtgLegTemplate());
      pillar.name = `RTG腿_${ix}_${iz}`;
      pillar.geometry = {
        width: pillarW,
        height: pillarH,
        depth: pillarD
      };
      pillar.position = {
        x: ix * gx,
        y: py,
        z: iz * gz
      };
      g.boxModelList.push(pillar);
    }
  }

  const topBeam = cloneCfg(steelPanelTemplate());
  topBeam.name = 'RTG大梁';
  topBeam.objType = 'rtgBeam';
  topBeam.geometry = {
    width: width * 1.1,
    height: Math.max(4, height * 0.05),
    depth: length * 0.7
  };
  topBeam.position = {
    x: 0,
    y: height * 0.78,
    z: 0
  };
  topBeam.material = portStainlessMaterial({
    textureRepeat: { x: Math.max(8, width / 12), y: 3.2 },
    roughness: 0.4
  });
  g.boxModelList.push(topBeam);

  const hoist = cloneCfg(accentPanelTemplate());
  hoist.name = '吊具小车';
  hoist.objType = 'rtgHoist';
  hoist.geometry = {
    width: width * 0.22,
    height: Math.max(5, height * 0.04),
    depth: length * 0.18
  };
  hoist.position = {
    x: 0,
    y: height * 0.55,
    z: length * 0.08
  };
  hoist.material = portStainlessMaterial({
    textureRepeat: { x: 3.2, y: 2.6 },
    metalness: 0.9
  });
  g.boxModelList.push(hoist);

  return g;
}

/**
 * Single-pole shoreline lamp schematic.
 */
function createPortLampPostComposite(src) {
  const { width, length, height } = getBoxGeometrySize(src);
  const g = pickRootTransform(src, portGroupShell);
  g.boxModelList = [];

  const poleW = Math.max(2, width * 0.22);
  const pole = cloneCfg(lampShaftTemplate());
  pole.name = '灯杆';
  pole.geometry = {
    width: poleW,
    height: height * 0.92,
    depth: poleW
  };
  pole.position = {
    x: 0,
    y: height * 0.46,
    z: 0
  };
  g.boxModelList.push(pole);

  const head = cloneCfg(lampHeadTemplate());
  head.name = '灯头';
  head.geometry = {
    width: Math.max(6, width * 0.55),
    height: Math.max(4, height * 0.06),
    depth: Math.max(6, length * 0.55)
  };
  head.position = {
    x: 0,
    y: height * 0.94,
    z: 0
  };
  g.boxModelList.push(head);

  return g;
}

const COMPOSITE_TYPES = {
  dockCrane: createDockCraneComposite,
  berthShip: createBerthShipComposite,
  rtgCrane: createRtgComposite,
  portLampPost: createPortLampPostComposite
};

/**
 * @param {object} boxModel
 * @returns {string}
 */
function resolvePortCompositeKey(boxModel) {
  if (!boxModel) {
    return "";
  }
  const handler = typeof boxModel.handler === "string" ? boxModel.handler.trim() : "";
  if (handler && COMPOSITE_TYPES[handler]) {
    return handler;
  }
  const objType = typeof boxModel.objType === "string" ? boxModel.objType.trim() : "";
  return objType && COMPOSITE_TYPES[objType] ? objType : "";
}

/**
 * Returns group descriptor JSON for port assembly records, otherwise `null`.
 * @param {object} boxModel
 * @returns {object|null}
 */
function createPortJson(boxModel) {
  if (!boxModel) {
    return null;
  }
  const compositeKey = resolvePortCompositeKey(boxModel);
  if (!compositeKey) {
    return null;
  }
  const fn = COMPOSITE_TYPES[compositeKey];
  if (!fn) {
    return null;
  }
  const composite = fn(boxModel);
  return composite ? migrateGroupDescriptorToSubScene(composite) : null;
}

/**
 * `createPortJson` then {@link createGroup} → `THREE.Group` (not added to scene).
 * @param {object} boxModel
 * @returns {import("three").Group|null}
 */
function createPort(boxModel) {
  const g = createPortJson(boxModel);
  return g ? createGroupFromDescriptor(g) : null;
}

/**
 * After `createPort`, add group to scene (aligned with {@link deployMesh}).
 * @param {object} boxModel
 * @param {import("three").Scene} scene
 */
function deployPort(boxModel, scene) {
  if (!scene) {
    return;
  }
  const groupJson = createPortJson(boxModel);
  if (!groupJson) {
    return;
  }
  const group = deployGroupDescriptor(scene, groupJson);
  if (group) {
    const handler = String(boxModel?.handler || resolvePortCompositeKey(boxModel) || "").trim();
    finalizeDomainDeployRoot(group, {
      domainId: "port",
      handler,
      loadRecord: boxModel,
      extras: {
        threeJsonId: boxModel?.threeJsonId
      }
    });
  }
}

export {
  createDockCraneComposite,
  createBerthShipComposite,
  createRtgComposite,
  createPortLampPostComposite,
  createPortJson,
  createPort,
  deployPort,
  getBoxGeometrySize
};
