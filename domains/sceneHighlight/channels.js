/**
 * sceneHighlight domain: locate / info / alarm channel defaults and pass record builders.
 */
import { createPassRecordJson } from "../../core/builder/postProcessPassBuilder.js";

export const HIGHLIGHT_LOCATE_AMBER = "#E6A800";
export const HIGHLIGHT_ALARM_RED = "#DC3A2F";

/** @typedef {"locate"|"info"|"alarm"} HighlightChannel */

/** @type {Record<HighlightChannel, { visibleEdgeColor: string, hiddenEdgeColor: string, idPrefix: string }>} */
export const HIGHLIGHT_CHANNEL_STYLES = {
  locate: {
    visibleEdgeColor: HIGHLIGHT_LOCATE_AMBER,
    hiddenEdgeColor: HIGHLIGHT_LOCATE_AMBER,
    idPrefix: "pass-locate"
  },
  info: {
    visibleEdgeColor: "#FFFFFF",
    hiddenEdgeColor: "#FFFFFF",
    idPrefix: "pass-info"
  },
  alarm: {
    visibleEdgeColor: HIGHLIGHT_ALARM_RED,
    hiddenEdgeColor: HIGHLIGHT_ALARM_RED,
    idPrefix: "pass-alarm"
  }
};

/**
 * @param {string} value
 * @returns {HighlightChannel|null}
 */
export function normalizeHighlightChannel(value) {
  const key = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (key === "locate" || key === "info" || key === "alarm") {
    return key;
  }
  return null;
}

/**
 * @param {{ highlightChannel: HighlightChannel, id?: string, threeJsonId?: string, threeJsonIds?: string[], targetPolicy?: string, allowEmptyTarget?: boolean, order?: number, [key: string]: unknown }} options
 * @returns {object}
 */
export function createSceneHighlightPassJson(options = {}) {
  const channel = normalizeHighlightChannel(options.highlightChannel);
  if (!channel) {
    throw new Error("[sceneHighlight] highlightChannel must be locate, info, or alarm");
  }
  const style = HIGHLIGHT_CHANNEL_STYLES[channel];
  const { highlightChannel: _hc, ...rest } = options;
  return createPassRecordJson({
    passType: "outline",
    id: rest.id || style.idPrefix,
    visibleEdgeColor: style.visibleEdgeColor,
    hiddenEdgeColor: style.hiddenEdgeColor,
    targetPolicy: "strict",
    allowEmptyTarget: false,
    ...rest,
    passType: "outline"
  });
}

/**
 * Friendly passList / deploy fallback: expand highlightChannel sugar to full pass records.
 * @param {object} record
 * @returns {object}
 */
export function expandPassListEntry(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  const channel = normalizeHighlightChannel(record.highlightChannel);
  if (!channel) {
    return record;
  }
  const { highlightChannel: _hc, ...rest } = record;
  return createSceneHighlightPassJson({
    highlightChannel: channel,
    ...rest
  });
}
