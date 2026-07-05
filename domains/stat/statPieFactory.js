/**
 * stat.pie: cylinder sector slices with statLabel overlays.
 */
import { clonePlainObject, pickSeriesColor } from "./statShared.js";
import { buildStatLabelRecord, resolveSliceChartLabelY } from "./statLabelBuilder.js";
import {
  STAT_PIE_MAX_SLICES,
  formatSliceLabel,
  sliceToThetaRanges
} from "./statSliceMath.js";

const DEFAULT_LABEL_BOX = { width: 10, height: 0.4, depth: 10 };

/**
 * @param {object[]} subScene
 * @param {string} namePrefix
 * @param {number} midAngle
 * @param {number} labelRadius
 * @param {number} height
 * @param {string} label
 * @param {string} statKind
 * @param {string} color
 * @param {object} [labelStyle]
 */
function appendSliceLabel(
  subScene,
  namePrefix,
  midAngle,
  labelRadius,
  height,
  label,
  statKind,
  color,
  labelStyle,
  options,
  slice
) {
  subScene.push(
    buildStatLabelRecord({
      name: `${namePrefix}-label`,
      content: label,
      position: {
        x: Math.cos(midAngle) * labelRadius,
        y: resolveSliceChartLabelY(height, labelStyle, options, DEFAULT_LABEL_BOX.height, slice),
        z: Math.sin(midAngle) * labelRadius
      },
      statKind,
      labelStyle,
      options,
      item: slice,
      color,
      geometry: { ...DEFAULT_LABEL_BOX },
      material: { color: color || "#ffffff" }
    })
  );
}

/**
 * @param {object} record
 * @param {object} [options]
 * @returns {object}
 */
export function buildStatPieGroupJson(record = {}, options = {}) {
  const mergedOptions = {
    ...options,
    ...(record.options && typeof record.options === "object" ? record.options : {})
  };
  const slices = record.slices ?? mergedOptions.slices ?? [];
  const radius = Number(mergedOptions.radius) || 36;
  const height = Number(mergedOptions.height) || 14;
  const radialSegments = Number(mergedOptions.radialSegments) || 32;
  const startAngle = Number(mergedOptions.startAngle) || 0;
  const labelStyle =
    mergedOptions.labelStyle && typeof mergedOptions.labelStyle === "object"
      ? mergedOptions.labelStyle
      : undefined;
  const statKind = mergedOptions.statKind || "stat.pie";
  const groupName = record.name || mergedOptions.name || "statPie";
  const labelRadiusFactor = Number(mergedOptions.labelRadiusFactor) || 0.62;
  const ranges = sliceToThetaRanges(slices, {
    startAngle,
    maxSlices: STAT_PIE_MAX_SLICES
  });
  /** @type {object[]} */
  const subScene = [];

  ranges.forEach((range, index) => {
    const color = pickSeriesColor(index, range.slice.color);
    const midAngle = range.thetaStart + range.thetaLength / 2;
    const sliceName = `${groupName}-slice-${index}`;
    subScene.push({
      name: sliceName,
      objType: "cylinder",
      geometry: {
        radiusTop: radius,
        radiusBottom: radius,
        height,
        thetaStart: range.thetaStart,
        thetaLength: range.thetaLength,
        radialSegments
      },
      position: { x: 0, y: height / 2, z: 0 },
      material: {
        color,
        transparent: true,
        opacity: mergedOptions.sliceOpacity ?? 0.9
      }
    });
    appendSliceLabel(
      subScene,
      sliceName,
      midAngle,
      radius * labelRadiusFactor,
      height,
      formatSliceLabel(range.fraction, range.slice),
      statKind,
      color,
      labelStyle,
      mergedOptions,
      range.slice
    );
  });

  return {
    name: groupName,
    objType: mergedOptions.groupObjType || "statPieGroup",
    position: clonePlainObject(record.position || mergedOptions.position || { x: 0, y: 0, z: 0 }),
    rotation: clonePlainObject(
      record.rotation || mergedOptions.rotation || { rotationX: 0, rotationY: 0, rotationZ: 0 }
    ),
    scale: clonePlainObject(record.scale || mergedOptions.scale || { scaleX: 1, scaleY: 1, scaleZ: 1 }),
    subScene
  };
}
