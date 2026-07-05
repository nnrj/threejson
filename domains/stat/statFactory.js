/**
 * stat domain: transparent utilization bar group descriptor build and deploy.
 */
import * as THREE from "three";
import TWEEN, { createTween } from "../../core/compat/adapters/tween.js";
import {
  clonePlainObject,
  formatStatLabel,
  mapUtilizationRateToColor,
  normalizeUtilizationRate,
  setStatBarBusinessInfo,
  stampStatLabels
} from "./statShared.js";
import {
  buildStatLabelRecord,
  resolveStatLabelMode,
  usesStatTextLabel
} from "./statLabelBuilder.js";

export { deployStatGroup } from "./statDeploy.js";
import { STAT_BAR_DEFAULT_OPACITY, STAT_UTIL_LOW_GREEN } from "./statPalette.js";

const DEFAULT_BAR_GEOMETRY = { width: 36, height: 100, depth: 28 };
const DEFAULT_BAR_MATERIAL = {
  color: STAT_UTIL_LOW_GREEN,
  transparent: true,
  opacity: STAT_BAR_DEFAULT_OPACITY
};

/**
 * @param {object} item
 * @param {object} [options]
 * @returns {object}
 */
export function buildStatBarGroupJson(item = {}, options = {}) {
  const statKind = options.statKind || item.statKind || "stat.bar";
  const groupName = item.name || options.name || `statBar-${Date.now()}`;
  const baseHeight = Number(item.geometry?.height ?? options.baseHeight ?? DEFAULT_BAR_GEOMETRY.height);
  const geom = {
    width: Number(item.geometry?.width ?? DEFAULT_BAR_GEOMETRY.width),
    height: baseHeight,
    depth: Number(item.geometry?.depth ?? DEFAULT_BAR_GEOMETRY.depth)
  };
  const material = {
    ...DEFAULT_BAR_MATERIAL,
    ...(item.material && typeof item.material === "object" ? item.material : {})
  };
  return {
    name: groupName,
    objType: options.groupObjType || "statBarGroup",
    position: clonePlainObject(item.position || { x: 0, y: 0, z: 0 }),
    rotation: clonePlainObject(
      item.rotation || { rotationX: 0, rotationY: 0, rotationZ: 0 }
    ),
    scale: clonePlainObject(item.scale || { scaleX: 1, scaleY: 1, scaleZ: 1 }),
    boxModelList: [
      {
        name: `${groupName}-mesh`,
        objType: "statBar",
        geometry: geom,
        position: { x: 0, y: geom.height / 2, z: 0 },
        material
      }
    ],
    _statKind: statKind
  };
}

/**
 * @param {object} groupDesc
 * @param {*} value
 * @param {*} max
 * @param {object} [options]
 * @returns {object}
 */
export function applyUtilizationToBar(groupDesc, value, max, options = {}) {
  const box = groupDesc?.boxModelList?.[0];
  if (!box) {
    return groupDesc;
  }
  const rate = normalizeUtilizationRate(value, max);
  const baseHeight = Number(
    options.baseHeight ?? box.geometry?.height ?? DEFAULT_BAR_GEOMETRY.height
  );
  const fullH = Number.isFinite(baseHeight) && baseHeight > 0 ? baseHeight : DEFAULT_BAR_GEOMETRY.height;
  box.geometry.height = rate > 0 ? fullH * rate : 4;
  box.position.y = box.geometry.height / 2;
  const colorFn = options.colorFn || mapUtilizationRateToColor;
  box.material.color = typeof colorFn === "function" ? colorFn(rate) : colorFn;
  if (options.opacity != null) {
    box.material.opacity = options.opacity;
  }
  const statKind = options.statKind || groupDesc._statKind || "stat.bar";
  const label = formatStatLabel(rate, value, max, options.label ?? options.item?.label);
  const labelStyle =
    options.labelStyle && typeof options.labelStyle === "object"
      ? options.labelStyle
      : options.item?.labelStyle && typeof options.item.labelStyle === "object"
        ? options.item.labelStyle
        : null;
  const labelMode = resolveStatLabelMode(labelStyle || {}, options, options.item);
  if (usesStatTextLabel(labelMode)) {
    if (!Array.isArray(groupDesc.subScene)) {
      groupDesc.subScene = [];
    }
    const labelGap = Number(options.labelGap) || 2;
    groupDesc.subScene.push(
      buildStatLabelRecord({
        name: `${groupDesc.name || box.name}-label`,
        content: label,
        position: { x: 0, y: box.geometry.height + labelGap, z: 0 },
        statKind,
        labelStyle: labelStyle || {},
        options,
        item: options.item,
        color: box.material?.color
      })
    );
  } else {
    setStatBarBusinessInfo(box, label, statKind, labelStyle);
  }
  delete groupDesc._statKind;
  return groupDesc;
}

/**
 * Animate utilization growth on deployed stat bars (options.animate path only).
 * @param {import("three").Object3D} root
 * @param {*} value
 * @param {*} max
 * @param {object} [options]
 */
export function animateUtilizationBarGroup(root, value, max, options = {}) {
  if (!root) {
    return;
  }
  let mesh = null;
  root.traverse((child) => {
    if (!mesh && child?.isMesh && child.userData?.objJson?.objType === "statBar") {
      mesh = child;
    }
  });
  if (!mesh) {
    return;
  }
  const rate = normalizeUtilizationRate(value, max);
  const baseHeight = Number(
    options.baseHeight ?? mesh.userData?.objJson?.geometry?.height ?? DEFAULT_BAR_GEOMETRY.height
  );
  const fullH = Number.isFinite(baseHeight) && baseHeight > 0 ? baseHeight : DEFAULT_BAR_GEOMETRY.height;
  const targetH = rate > 0 ? fullH * rate : 4;
  const fromH = Number(options.fromHeight) > 0 ? Number(options.fromHeight) : 4;
  const colorFn = options.colorFn || mapUtilizationRateToColor;
  const targetColor = typeof colorFn === "function" ? colorFn(rate) : colorFn;
  const startColor = typeof colorFn === "function" ? colorFn(0) : STAT_UTIL_LOW_GREEN;
  const state = {
    h: fromH,
    colorMix: 0
  };
  const duration = Number(options.duration) > 0 ? Number(options.duration) : 800;
  const easing = options.easing || TWEEN.Easing.Cubic.Out;
  const params = mesh.geometry?.parameters;
  const barWidth = params?.width ?? DEFAULT_BAR_GEOMETRY.width;
  const barDepth = params?.depth ?? DEFAULT_BAR_GEOMETRY.depth;
  const startThreeColor = new THREE.Color(startColor);
  const targetThreeColor = new THREE.Color(targetColor);
  createTween(state)
    .to({ h: targetH, colorMix: 1 }, duration)
    .easing(easing)
    .onUpdate(() => {
      mesh.geometry?.dispose?.();
      mesh.geometry = new THREE.BoxGeometry(barWidth, state.h, barDepth);
      mesh.position.y = state.h / 2;
      if (mesh.material?.color) {
        mesh.material.color.copy(startThreeColor).lerp(targetThreeColor, state.colorMix);
      }
    })
    .onComplete(() => {
      const label = formatStatLabel(rate, value, max, options.label ?? options.item?.label);
      const statKind = options.statKind || "stat.bar";
      const labelStyle =
        options.labelStyle && typeof options.labelStyle === "object"
          ? options.labelStyle
          : options.item?.labelStyle && typeof options.item.labelStyle === "object"
            ? options.item.labelStyle
            : null;
      if (mesh.userData?.objJson) {
        mesh.userData.objJson.geometry = mesh.userData.objJson.geometry || {};
        mesh.userData.objJson.geometry.height = targetH;
        mesh.userData.objJson.position = mesh.userData.objJson.position || {};
        mesh.userData.objJson.position.y = targetH / 2;
        mesh.userData.objJson.material = mesh.userData.objJson.material || {};
        mesh.userData.objJson.material.color = targetColor;
        const labelMode = resolveStatLabelMode(labelStyle || {}, options, options.item);
        if (!usesStatTextLabel(labelMode)) {
          setStatBarBusinessInfo(mesh.userData.objJson, label, statKind, labelStyle);
          stampStatLabels(root);
        } else {
          const labelGap = Number(options.labelGap) || 2;
          root.traverse((child) => {
            const record = child.userData?.objJson;
            if (record?.objType !== "text" || typeof record.name !== "string") {
              return;
            }
            if (!record.name.endsWith("-label")) {
              return;
            }
            record.position = record.position || {};
            record.position.y = targetH + labelGap;
            child.position.y = targetH + labelGap;
          });
        }
      }
    })
    .start();
}

