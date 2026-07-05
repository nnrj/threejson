/**
 * Port scene ops stats (no cabinets): resolution-bar style Group from JSON `businessInfo`.
 */

import { createGroupFromDescriptor } from '../../core/handler/objectLoadHandler.js';
import {
  createStatLabelTexture,
  mapUtilizationRateToColor,
  setStatBarBusinessInfo,
  STAT_UTIL_MID_TEAL
} from '../stat/statShared.js';
import { STAT_BAR_DEFAULT_OPACITY, STAT_UTIL_LOW_GREEN } from '../stat/statPalette.js';
import { ensureThreeJsonIdOnRecord, valueOr } from '../../core/util/util.js';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * @param {'throughput'|'load'|'stack'} menu
 */
function menuToCabStat(menu) {
  if (menu === 'load') {
    return 'bear';
  }
  if (menu === 'stack') {
    return 'rackSpace';
  }
  return 'capacity';
}

function anchorFlagged(biz) {
  return (
    biz.portStatistic === true ||
    biz.statisticsRole === true ||
    biz.portStat === true
  );
}

function dataForStatType(biz, statType) {
  if (statType === 'capacity') {
    if (
      typeof biz.usedTeu === 'number' &&
      typeof biz.totalTeu === 'number' &&
      biz.totalTeu > 0
    ) {
      return { kind: 'teu', used: biz.usedTeu, total: biz.totalTeu };
    }
    if (
      typeof biz.usedSlot === 'number' &&
      typeof biz.totalSlot === 'number' &&
      biz.totalSlot > 0
    ) {
      return { kind: 'slot', used: biz.usedSlot, total: biz.totalSlot };
    }
    return null;
  }
  if (statType === 'bear') {
    if (
      typeof biz.usedLoad === 'number' &&
      typeof biz.totalLoad === 'number' &&
      biz.totalLoad > 0
    ) {
      return { kind: 'load', used: biz.usedLoad, total: biz.totalLoad };
    }
    return null;
  }
  if (statType === 'rackSpace') {
    if (
      typeof biz.filledCells === 'number' &&
      typeof biz.totalCells === 'number' &&
      biz.totalCells > 0
    ) {
      return { kind: 'cells', used: biz.filledCells, total: biz.totalCells };
    }
    if (
      typeof biz.usedTeu === 'number' &&
      typeof biz.stackCapacityTeu === 'number' &&
      biz.stackCapacityTeu > 0
    ) {
      return {
        kind: 'cells',
        used: biz.usedTeu,
        total: biz.stackCapacityTeu
      };
    }
    return null;
  }
  return null;
}

/**
 * @param {object} boxRecord
 * @param {string} statLabel
 * @param {'capacity'|'bear'|'rackSpace'} [statKind]
 */
function setPortStatBarBusinessInfo(boxRecord, statLabel, statKind, labelStyle) {
  setStatBarBusinessInfo(boxRecord, statLabel, statKind, labelStyle);
}

/**
 * @param {string} label
 * @returns {THREE.Texture|undefined}
 */
function createPortStatLabelTexture(label, boxWidth, labelStyle) {
  return createStatLabelTexture(label, boxWidth, labelStyle);
}

/**
 * After deploy, build texture from mesh.userData.objJson.businessInfo.statLabel.
 * @param {import('three').Object3D|null|undefined} root
 */
function stampPortStatLabels(root) {
  if (!root) {
    return;
  }
  root.traverse((obj) => {
    if (!obj.isMesh) {
      return;
    }
    const biz = obj.userData?.objJson?.businessInfo;
    const statLabel = biz && typeof biz.statLabel === 'string' ? biz.statLabel.trim() : '';
    if (!statLabel) {
      return;
    }
    const gw = obj.userData?.objJson?.geometry?.width;
    const labelStyle = biz?.labelStyle && typeof biz.labelStyle === 'object' ? biz.labelStyle : undefined;
    const tex = createPortStatLabelTexture(statLabel, gw, labelStyle);
    if (!tex || !obj.material) {
      return;
    }
    obj.material.map = tex;
    obj.material.needsUpdate = true;
  });
}

/**
 * @param {object} groupDesc
 * @returns {import('three').Group|null}
 */
function deployPortStatGroup(groupDesc) {
  const group = createGroupFromDescriptor(groupDesc);
  if (group) {
    stampPortStatLabels(group);
  }
  return group;
}

function applyBar(desc, rate, colorFn, label, statKind, labelStyle) {
  const box = desc.boxModelList[0];
  const fullH = 115;
  box.geometry.height = rate > 0 ? fullH * rate : 4;
  box.geometry.width = 34;
  box.geometry.depth = 26;
  box.position.y = box.geometry.height / 2;
  box.material.color =
    typeof colorFn === 'function' ? colorFn(rate) : colorFn;
  setPortStatBarBusinessInfo(box, label, statKind, labelStyle);
  return desc;
}

function fallbackDemoBar(desc, statType, labelStyle) {
  const demoRate = statType === 'rackSpace' ? 0.62 : statType === 'bear' ? 0.71 : 0.58;
  const label =
    statType === 'rackSpace' ? '18/28' : `${Math.round(demoRate * 100)}%`;
  return applyBar(desc, demoRate, mapUtilizationRateToColor, label, statType, labelStyle);
}

/**
 * @param {*} raw single boxModel JSON entry
 * @param {'capacity'|'bear'|'rackSpace'} statType
 * @returns {THREE.Group|null}
 */
function buildStatGroupFromAnchor(raw, statType) {
  if (!raw) {
    return null;
  }
  const biz =
    raw.businessInfo && typeof raw.businessInfo === 'object'
      ? raw.businessInfo
      : {};
  const menu = biz.portStatMenu ? String(biz.portStatMenu) : '';
  if (menu && menuToCabStat(menu) !== statType) {
    return null;
  }

  const data = dataForStatType(biz, statType);
  const labelStyle = biz?.labelStyle && typeof biz.labelStyle === 'object' ? biz.labelStyle : undefined;
  const flagged = anchorFlagged(biz);
  if (!data && !(flagged || menu)) {
    return null;
  }

  const pos = clone(raw.position || { x: 0, y: 0, z: 0 });
  const gx = raw.geometry?.width ?? 48;
  const gz = valueOr(raw.geometry?.depth, valueOr(raw.geometry?.length, 40));

  const groupDesc = {
    name: `${raw.name || 'portStat'}-${statType}`,
    objType:
      statType === 'capacity' ? 'capacity' : statType === 'bear' ? 'bear' : 'rackSpace',
    position: { x: pos.x + gx * 0.72, y: pos.y, z: pos.z + gz * 0.72 },
    rotation: clone(
      raw.rotation || {
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0
      }
    ),
    scale: clone(
      raw.scale || {
        scaleX: 1,
        scaleY: 1,
        scaleZ: 1
      }
    ),
    boxModelList: [
      {
        name: 'portStatBar',
        objType: 'statBar',
        geometry: { width: 36, height: 100, depth: 28 },
        position: { x: 0, y: 50, z: 0 },
        material: {
          color: STAT_UTIL_LOW_GREEN,
          transparent: true,
          opacity: STAT_BAR_DEFAULT_OPACITY
        }
      }
    ]
  };

  if (!data) {
    fallbackDemoBar(groupDesc, statType, labelStyle);
    ensureThreeJsonIdOnRecord(groupDesc);
    return deployPortStatGroup(groupDesc);
  }

  const rate = Math.min(1, Math.max(0, data.used / data.total));
  if (data.kind === 'cells') {
    applyBar(
      groupDesc,
      rate,
      () => STAT_UTIL_MID_TEAL,
      `${data.used}/${data.total}`,
      'rackSpace',
      labelStyle
    );
  } else {
    applyBar(
      groupDesc,
      rate,
      mapUtilizationRateToColor,
      `${Math.round(rate * 100)}%`,
      statType,
      labelStyle
    );
  }
  ensureThreeJsonIdOnRecord(groupDesc);
  return deployPortStatGroup(groupDesc);
}

/**
 * Count anchors eligible for port stat bars (read-only JSON, no scene add). `statType` same as `createPortStatistics`.
 * @param {{ worldInfo?: { boxModelList?: object[] } }} sceneJsonRoot
 */
function countPortStatisticsAnchors(sceneJsonRoot, statType) {
  const list = sceneJsonRoot?.worldInfo?.boxModelList;
  if (!Array.isArray(list)) {
    return 0;
  }
  let n = 0;
  for (const item of list) {
    if (buildStatGroupFromAnchor(item, statType)) {
      n++;
    }
  }
  return n;
}

/**
 * `statType`: `capacity` | `bear` | `rackSpace` (legacy cabinet stat naming).
 * @param {{ worldInfo?: { boxModelList?: object[] } }} sceneJsonRoot
 */
function createPortStatistics(sceneJsonRoot, scene, statType) {
  const list = sceneJsonRoot?.worldInfo?.boxModelList;
  if (!scene || !Array.isArray(list)) {
    return 0;
  }
  let n = 0;
  for (const item of list) {
    const grp = buildStatGroupFromAnchor(item, statType);
    if (grp) {
      scene.add(grp);
      n++;
    }
  }
  return n;
}

export {
  countPortStatisticsAnchors,
  createPortStatistics,
  stampPortStatLabels,
  menuToCabStat,
  mapUtilizationRateToColor
};
