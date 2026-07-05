/**
 * stat domain shared: utilization bands, bar label textures (cabinet/port contract compatible).
 */
import * as THREE from "three";

import { createStrTextureMultiline } from "../../core/util/textureUtils.js";
import {
  STAT_UTIL_CRITICAL_RED,
  STAT_UTIL_HIGH_ORANGE,
  STAT_UTIL_LOW_GREEN,
  STAT_UTIL_MID_TEAL
} from "./statPalette.js";

export { STAT_UTIL_MID_TEAL } from "./statPalette.js";

const SERIES_COLORS = [
  "#42a5f5",
  "#66bb6a",
  "#ffa726",
  "#ef5350",
  "#ab47bc",
  "#26c6da",
  "#8d6e63",
  "#78909c"
];

/**
 * @param {number} index
 * @param {string} [override]
 * @returns {string}
 */
export function pickSeriesColor(index, override) {
  if (typeof override === "string" && override.trim()) {
    return override.trim();
  }
  const i = Number(index);
  if (!Number.isFinite(i) || i < 0) {
    return SERIES_COLORS[0];
  }
  return SERIES_COLORS[i % SERIES_COLORS.length];
}

const LABEL_STYLE_DEFAULTS = {
  fontSizePx: 14,
  fontFamily: "SimHei",
  fillStyle: "#ffffff",
  padding: 5,
  lineHeight: undefined,
  autoFit: true,
  fitRatio: 0.72,
  minFontPx: 12,
  maxFontPx: 56
};

const PANEL_LABEL_STYLE_DEFAULTS = {
  ...LABEL_STYLE_DEFAULTS,
  fontSizePx: 16,
  fillStyle: "#e8eaed",
  backgroundColor: "#1e2838",
  padding: 10,
  lineHeight: 22,
  minFontPx: 14,
  maxFontPx: 64
};

function numberBetween(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

function parseLabelStyle(style) {
  if (!style || typeof style !== "object") {
    return {};
  }
  return style;
}

function resolveLabelStyle(baseDefaults, style = {}, overrides = {}) {
  const raw = {
    ...baseDefaults,
    ...parseLabelStyle(style),
    ...parseLabelStyle(overrides)
  };
  const minFontPx = numberBetween(raw.minFontPx, baseDefaults.minFontPx, 6, 120);
  const maxFontPx = numberBetween(raw.maxFontPx, baseDefaults.maxFontPx, minFontPx, 160);
  const fontSizePx = numberBetween(raw.fontSizePx, baseDefaults.fontSizePx, minFontPx, maxFontPx);
  return {
    fontSizePx,
    fontFamily:
      typeof raw.fontFamily === "string" && raw.fontFamily.trim()
        ? raw.fontFamily.trim()
        : baseDefaults.fontFamily,
    fillStyle:
      typeof raw.fillStyle === "string" && raw.fillStyle.trim()
        ? raw.fillStyle.trim()
        : baseDefaults.fillStyle,
    backgroundColor:
      typeof raw.backgroundColor === "string" && raw.backgroundColor.trim()
        ? raw.backgroundColor.trim()
        : baseDefaults.backgroundColor,
    padding: numberBetween(raw.padding, baseDefaults.padding, 0, 64),
    lineHeight:
      raw.lineHeight == null ? baseDefaults.lineHeight : numberBetween(raw.lineHeight, baseDefaults.lineHeight ?? 0, 8, 160),
    autoFit: raw.autoFit !== false,
    fitRatio: numberBetween(raw.fitRatio, baseDefaults.fitRatio, 0.3, 0.96),
    minFontPx,
    maxFontPx
  };
}

function splitLines(label) {
  return String(label ?? "").split(/\r?\n/);
}

function calcLongestLineLength(lines) {
  let max = 0;
  for (let i = 0; i < lines.length; i++) {
    const len = String(lines[i] ?? "").length;
    if (len > max) {
      max = len;
    }
  }
  return max;
}

function resolveAutoFitFontSize(label, width, height, style) {
  if (style.autoFit !== true) {
    return style.fontSizePx;
  }
  const lines = splitLines(label);
  const lineCount = Math.max(1, lines.length);
  const longest = Math.max(1, calcLongestLineLength(lines));
  const drawWidth = Math.max(1, width - style.padding * 2);
  const drawHeight = Math.max(1, height - style.padding * 2);
  const targetWidth = drawWidth * style.fitRatio;
  const widthByChars = targetWidth / (longest * 0.62);
  const lineHeightFactor = Math.max(
    1.1,
    style.lineHeight && style.fontSizePx ? style.lineHeight / style.fontSizePx : 1.22
  );
  const maxByHeight = drawHeight / (lineCount * lineHeightFactor);
  const preferred = Math.min(widthByChars, maxByHeight);
  return numberBetween(preferred, style.fontSizePx, style.minFontPx, style.maxFontPx);
}

/**
 * @param {number} rate 0..1
 * @returns {string}
 */
export function mapUtilizationRateToColor(rate) {
  if (rate <= 0.2) {
    return STAT_UTIL_LOW_GREEN;
  }
  if (rate <= 0.5) {
    return STAT_UTIL_MID_TEAL;
  }
  if (rate <= 0.9) {
    return STAT_UTIL_HIGH_ORANGE;
  }
  return STAT_UTIL_CRITICAL_RED;
}

/**
 * @param {object} boxRecord
 * @param {string} statLabel
 * @param {string} [statKind]
 * @param {object} [labelStyle]
 */
export function setStatBarBusinessInfo(boxRecord, statLabel, statKind, labelStyle) {
  if (!boxRecord || !statLabel) {
    return;
  }
  boxRecord.businessInfo = {
    ...(boxRecord.businessInfo && typeof boxRecord.businessInfo === "object"
      ? boxRecord.businessInfo
      : {}),
    statLabel: String(statLabel),
    ...(statKind ? { statKind: String(statKind) } : {}),
    ...(labelStyle && typeof labelStyle === "object" ? { labelStyle: { ...labelStyle } } : {})
  };
}

/**
 * @param {string} label
 * @param {number} [boxWidth]
 * @param {object} [labelStyle]
 * @param {number} [boxHeight]
 * @returns {THREE.Texture|undefined}
 */
export function createStatLabelTexture(label, boxWidth, labelStyle = {}, boxHeight) {
  let gwNum = Number(boxWidth);
  if (!Number.isFinite(gwNum)) {
    gwNum = 70;
  }
  let ghNum = Number(boxHeight);
  if (!Number.isFinite(ghNum) || ghNum <= 0) {
    ghNum = gwNum;
  }
  const aspect = gwNum / ghNum;
  const texBase = Math.round(Math.max(64, Math.min(512, gwNum * 24)));
  const texW = aspect >= 1 ? texBase : Math.round(texBase * aspect);
  const texH = aspect >= 1 ? Math.round(texBase / aspect) : texBase;
  const style = resolveLabelStyle(LABEL_STYLE_DEFAULTS, labelStyle);
  const fontSize = resolveAutoFitFontSize(label, texW, texH, style);
  const lineHeight =
    style.lineHeight == null
      ? Math.max(Math.round(fontSize * 1.2), fontSize + 2)
      : numberBetween(style.lineHeight, style.lineHeight, fontSize, 160);
  const bgRaw = labelStyle.backgroundColor;
  const rateTexture = createStrTextureMultiline({
    str: label,
    width: texW,
    height: texH,
    fillStyle: style.fillStyle,
    font: `${fontSize}px ${style.fontFamily}`,
    textBaseline: "top",
    padding: style.padding,
    lineHeight,
    ...(bgRaw !== undefined ? { backgroundColor: bgRaw } : {})
  });
  if (!rateTexture) {
    return;
  }
  rateTexture.repeat.x = 1;
  rateTexture.repeat.y = 1;
  rateTexture.needsUpdate = true;
  if (THREE.SRGBColorSpace !== undefined) {
    rateTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return rateTexture;
}

/**
 * @param {string} label
 * @param {number} [panelWidth]
 * @param {number} [panelHeight]
 * @param {object} [options]
 * @returns {THREE.Texture|undefined}
 */
export function createStatPanelLabelTexture(label, panelWidth, panelHeight, options = {}) {
  const w = Number(panelWidth);
  const h = Number(panelHeight);
  const aspect =
    Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0 ? w / h : 2;
  const texW = Math.round(Math.max(128, Math.min(512, (Number.isFinite(w) && w > 0 ? w : 96) * 4)));
  const texH = Math.round(Math.max(64, Math.min(512, texW / aspect)));
  const style = resolveLabelStyle(PANEL_LABEL_STYLE_DEFAULTS, options?.labelStyle, options);
  const fontSize = resolveAutoFitFontSize(label, texW, texH, style);
  const lineHeight =
    style.lineHeight == null
      ? Math.max(Math.round(fontSize * 1.2), fontSize + 2)
      : numberBetween(style.lineHeight, style.lineHeight, fontSize, 180);
  const rateTexture = createStrTextureMultiline({
    str: label,
    width: texW,
    height: texH,
    fillStyle: style.fillStyle,
    backgroundColor: style.backgroundColor,
    font: `${fontSize}px ${style.fontFamily}`,
    textBaseline: "top",
    padding: style.padding,
    lineHeight
  });
  if (!rateTexture) {
    return;
  }
  rateTexture.needsUpdate = true;
  if (THREE.SRGBColorSpace !== undefined) {
    rateTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return rateTexture;
}

/**
 * @param {import("three").Object3D|null|undefined} root
 */
export function stampStatLabels(root) {
  if (!root) {
    return;
  }
  root.traverse((obj) => {
    if (!obj.isMesh) {
      return;
    }
    const objJson = obj.userData?.objJson;
    const biz = objJson?.businessInfo;
    const statLabel = biz && typeof biz.statLabel === "string" ? biz.statLabel.trim() : "";
    if (!statLabel) {
      return;
    }
    const statKind = biz?.statKind;
    const geom = objJson?.geometry;
    const labelStyle =
      biz?.labelStyle && typeof biz.labelStyle === "object" ? biz.labelStyle : {};
    const floatingLabel = statKind === "stat.line";
    const tex =
      statKind === "stat.panel"
        ? createStatPanelLabelTexture(statLabel, geom?.width, geom?.height, {
            backgroundColor: objJson?.material?.color ?? "#1e2838",
            labelStyle
          })
        : createStatLabelTexture(
            statLabel,
            geom?.width,
            floatingLabel
              ? { ...labelStyle, backgroundColor: labelStyle.backgroundColor ?? "transparent" }
              : labelStyle,
            geom?.height
          );
    if (!tex || !obj.material) {
      return;
    }
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i];
      if (!mat) {
        continue;
      }
      mat.map = tex;
      if ((statKind === "stat.panel" || floatingLabel) && mat.color?.set) {
        mat.color.set(0xffffff);
      }
      if (floatingLabel) {
        mat.transparent = true;
        mat.alphaTest = 0.05;
        mat.depthWrite = false;
      }
      mat.needsUpdate = true;
    }
  });
}

/**
 * @param {object} [src]
 * @returns {object}
 */
export function clonePlainObject(src) {
  if (!src || typeof src !== "object") {
    return {};
  }
  return JSON.parse(JSON.stringify(src));
}

/**
 * @param {*} value
 * @param {*} max
 * @returns {number}
 */
export function normalizeUtilizationRate(value, max) {
  const v = Number(value);
  const m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, v / m));
}

/**
 * @param {number} rate
 * @param {*} value
 * @param {*} max
 * @param {string} [label]
 * @returns {string}
 */
export function formatStatLabel(rate, value, max, label) {
  if (typeof label === "string" && label.trim()) {
    return label.trim();
  }
  const v = Number(value);
  const m = Number(max);
  if (Number.isFinite(v) && Number.isFinite(m) && m > 0 && Math.abs(m - Math.round(m)) < 1e-6) {
    if (Math.abs(v - Math.round(v)) < 1e-6 && v <= m) {
      return `${Math.round(v)}/${Math.round(m)}`;
    }
  }
  return `${Math.round(rate * 100)}%`;
}
