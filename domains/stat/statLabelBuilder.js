/**
 * Stat label descriptors: legacy box+statLabel or objType:text (sdf / texture / mesh).
 */
import { clonePlainObject } from "./statShared.js";

const TEXT_LABEL_MODES = new Set(["sdf", "texture", "mesh"]);
const BOX_LABEL_ALIASES = new Set(["box", "statlabel", "canvas", "plane"]);

/**
 * @param {object} [labelStyle]
 * @param {object} [options]
 * @param {object} [item]
 * @returns {"box"|"sdf"|"texture"|"mesh"}
 */
export function resolveStatLabelMode(labelStyle = {}, options = {}, item = {}) {
  const raw =
    item?.labelMode ??
    item?.labelStyle?.labelMode ??
    labelStyle?.labelMode ??
    labelStyle?.mode ??
    options?.labelMode ??
    "box";
  const mode = typeof raw === "string" ? raw.trim().toLowerCase() : "box";
  if (TEXT_LABEL_MODES.has(mode)) {
    return mode;
  }
  if (BOX_LABEL_ALIASES.has(mode)) {
    return "box";
  }
  return "box";
}

/**
 * @param {"box"|"sdf"|"texture"|"mesh"} mode
 * @returns {boolean}
 */
export function usesStatTextLabel(mode) {
  return TEXT_LABEL_MODES.has(mode);
}

/**
 * Pie/ring label layout: flat on slice top or upright (billboard).
 * @param {object} [labelStyle]
 * @param {object} [options]
 * @param {object} [item]
 * @returns {"flat"|"upright"}
 */
export function resolveSliceChartLabelOrientation(labelStyle = {}, options = {}, item = {}) {
  const raw =
    item?.labelOrientation ??
    item?.labelStyle?.labelOrientation ??
    labelStyle?.labelOrientation ??
    labelStyle?.orientation ??
    options?.labelOrientation ??
    "flat";
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "flat";
  if (normalized === "upright" || normalized === "vertical" || normalized === "stand") {
    return "upright";
  }
  return "flat";
}

/**
 * Y position for pie/ring slice labels relative to cylinder top (y = height).
 * @param {number} height slice cylinder height
 * @param {object} [labelStyle]
 * @param {object} [options]
 * @param {number} [boxHeight]
 * @param {object} [item]
 * @returns {number}
 */
export function resolveSliceChartLabelY(height, labelStyle = {}, options = {}, boxHeight = 0.4, item = {}) {
  const orientation = resolveSliceChartLabelOrientation(labelStyle, options, item);
  const defaultGap = orientation === "flat" ? 0.02 : 0.8;
  const labelGap = Number(options.labelGap ?? labelStyle.labelGap);
  const safeGap = Number.isFinite(labelGap) ? labelGap : defaultGap;
  const mode = resolveStatLabelMode(labelStyle, options, item);
  if (orientation === "flat") {
    if (usesStatTextLabel(mode)) {
      return height + safeGap;
    }
    return height + safeGap + boxHeight / 2;
  }
  if (usesStatTextLabel(mode)) {
    const fontSize = Number(labelStyle.fontSize ?? options.labelFontSize ?? 0.85);
    const anchor = labelStyle.anchor ?? options.labelAnchor ?? { x: 0.5, y: 0.5 };
    const anchorY = Number(anchor.y);
    const safeAnchorY = Number.isFinite(anchorY) ? anchorY : 0.5;
    return height + fontSize * safeAnchorY + safeGap;
  }
  return height + 0.35 + boxHeight / 2;
}

/**
 * @param {object} params
 * @returns {object}
 */
export function buildStatBoxLabelRecord({
  name,
  content,
  position,
  statKind,
  labelStyle,
  geometry,
  material
}) {
  const geom = geometry || { width: 10, height: 6, depth: 0.25 };
  const pos = clonePlainObject(position || { x: 0, y: 0, z: 0 });
  const mergedStyle = {
    backgroundColor: "transparent",
    ...(labelStyle && typeof labelStyle === "object" ? labelStyle : {})
  };
  return {
    name,
    objType: "box",
    geometry: geom,
    position: pos,
    material: {
      color: "#ffffff",
      transparent: true,
      opacity: 1,
      ...(material && typeof material === "object" ? material : {})
    },
    businessInfo: {
      statLabel: String(content),
      statKind,
      labelStyle: mergedStyle
    }
  };
}

const SLICE_CHART_STAT_KINDS = new Set(["stat.pie", "stat.ring"]);

/**
 * @param {string|undefined} statKind
 * @returns {boolean}
 */
function isSliceChartStatKind(statKind) {
  return SLICE_CHART_STAT_KINDS.has(statKind);
}

/**
 * @param {object} params
 * @returns {object}
 */
export function buildStatTextLabelRecord({
  name,
  content,
  position,
  labelMode,
  labelStyle = {},
  options = {},
  color,
  statKind,
  item = {}
}) {
  const mode = labelMode;
  const sliceChart = isSliceChartStatKind(statKind);
  const orientation = sliceChart
    ? resolveSliceChartLabelOrientation(labelStyle, options, item)
    : "flat";
  const textColor =
    labelStyle.fillStyle ??
    labelStyle.color ??
    options.labelColor ??
    color ??
    "#e8eaed";
  const billboard = sliceChart
    ? orientation === "upright"
      ? labelStyle.billboard !== false && options.labelBillboard !== false
      : labelStyle.billboard === true || options.labelBillboard === true
    : labelStyle.billboard !== false && options.labelBillboard !== false;
  /** @type {object} */
  const record = {
    name,
    objType: "text",
    content: String(content),
    mode,
    position: clonePlainObject(position || { x: 0, y: 0, z: 0 }),
    align: labelStyle.align ?? options.labelAlign ?? "center",
    anchor: clonePlainObject(labelStyle.anchor ?? options.labelAnchor ?? { x: 0.5, y: 0.5 }),
    billboard,
    color: textColor
  };
  if (sliceChart && !labelStyle.rotation && !options.labelRotation) {
    if (orientation === "flat") {
      record.rotation = { rotationX: -Math.PI / 2 };
    }
  }

  if (mode === "sdf") {
    record.fontSize = Number(labelStyle.fontSize ?? options.labelFontSize ?? 0.85);
    record.sdf = {
      outlineWidth: 0.05,
      outlineColor: "#1a2030",
      ...(options.labelSdf && typeof options.labelSdf === "object" ? options.labelSdf : {}),
      ...(labelStyle.sdf && typeof labelStyle.sdf === "object" ? labelStyle.sdf : {})
    };
  } else if (mode === "texture") {
    record.fontSize = Number(labelStyle.fontSizePx ?? options.labelFontSizePx ?? 28);
    record.texture = {
      backgroundColor: "transparent",
      padding: labelStyle.padding ?? 8,
      textStyle: {
        fontSizePx: labelStyle.fontSizePx ?? 24,
        fontFamily: labelStyle.fontFamily ?? "SimHei",
        autoFit: labelStyle.autoFit !== false,
        fitRatio: labelStyle.fitRatio ?? 0.78,
        minFontPx: labelStyle.minFontPx ?? 12,
        maxFontPx: labelStyle.maxFontPx ?? 64,
        fillStyle: textColor
      },
      ...(options.labelTexture && typeof options.labelTexture === "object" ? options.labelTexture : {}),
      ...(labelStyle.texture && typeof labelStyle.texture === "object" ? labelStyle.texture : {})
    };
  } else if (mode === "mesh") {
    record.fontSize = Number(labelStyle.fontSize ?? options.labelFontSize ?? 1.1);
    record.mesh = {
      fontJsonUrl: "/assets/fonts/helvetiker_bold.typeface.json",
      depth: 0.12,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.02,
      ...(options.labelMesh && typeof options.labelMesh === "object" ? options.labelMesh : {}),
      ...(labelStyle.mesh && typeof labelStyle.mesh === "object" ? labelStyle.mesh : {})
    };
  }

  if (labelStyle.text && typeof labelStyle.text === "object") {
    Object.assign(record, labelStyle.text);
  }
  if (options.labelText && typeof options.labelText === "object") {
    Object.assign(record, options.labelText);
  }

  return record;
}

/**
 * @param {object} params
 * @returns {object}
 */
export function buildStatLabelRecord(params) {
  const labelStyle = params.labelStyle && typeof params.labelStyle === "object" ? params.labelStyle : {};
  const options = params.options && typeof params.options === "object" ? params.options : {};
  const item = params.item && typeof params.item === "object" ? params.item : {};
  const mode = resolveStatLabelMode(labelStyle, options, item);
  if (usesStatTextLabel(mode)) {
    return buildStatTextLabelRecord({
      ...params,
      labelMode: mode,
      labelStyle,
      options
    });
  }
  return buildStatBoxLabelRecord(params);
}
