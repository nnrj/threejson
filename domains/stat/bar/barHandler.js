/**
 * stat.bar: single transparent utilization bar.
 */
import { log } from "../../../core/util/logger.js";
import {
  animateUtilizationBarGroup,
  applyUtilizationToBar,
  buildStatBarGroupJson,
  deployStatGroup
} from "../statFactory.js";

/**
 * @param {object} item
 * @returns {object|null}
 */
export function normalizeStatBarItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const value = item.value ?? item.used;
  const max = item.max ?? item.total;
  if (value == null || max == null) {
    return null;
  }
  return item;
}

/**
 * @param {object} item
 * @param {object} [options]
 * @returns {object}
 */
export function createStatBarJson(item = {}, options = {}) {
  const normalized = normalizeStatBarItem(item) || item;
  const groupDesc = buildStatBarGroupJson(normalized, { statKind: "stat.bar" });
  const value = normalized.value ?? normalized.used ?? 0;
  const max = normalized.max ?? normalized.total ?? 100;
  const labelStyle =
    normalized?.labelStyle && typeof normalized.labelStyle === "object"
      ? normalized.labelStyle
      : options?.labelStyle && typeof options.labelStyle === "object"
        ? options.labelStyle
        : undefined;
  if (options.animate) {
    applyUtilizationToBar(groupDesc, 0, max, {
      label: normalized.label,
      statKind: "stat.bar",
      item: normalized,
      labelStyle,
      baseHeight: normalized.geometry?.height ?? options.baseHeight
    });
    groupDesc._statAnimate = { value, max, options: { ...options, labelStyle, item: normalized } };
    return groupDesc;
  }
  applyUtilizationToBar(groupDesc, value, max, {
    label: normalized.label,
    statKind: "stat.bar",
    item: normalized,
    labelStyle
  });
  return groupDesc;
}

/**
 * @param {object} item
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {import("three").Group|null}
 */
export function createStatBar(item, scene, options = {}) {
  const desc = createStatBarJson(item, options);
  if (!scene) {
    return desc;
  }
  const animatePayload = desc._statAnimate;
  if (animatePayload) {
    delete desc._statAnimate;
  }
  const group = deployStatGroup(scene, desc);
  if (group && animatePayload) {
    animateUtilizationBarGroup(
      group,
      animatePayload.value,
      animatePayload.max,
      animatePayload.options
    );
  }
  return group;
}

/** @param {object} item @param {import("three").Scene} scene @param {object} [options] */
export function deployStatBar(item, scene, options = {}) {
  return createStatBar(item, scene, options);
}

/**
 * @param {object[]} items
 * @param {import("three").Scene} scene
 * @param {object} [options]
 * @returns {number}
 */
export function createStatBars(items, scene, options = {}) {
  if (!scene || !Array.isArray(items)) {
    return 0;
  }
  let n = 0;
  for (let i = 0; i < items.length; i++) {
    const item = normalizeStatBarItem(items[i]);
    if (!item) {
      continue;
    }
    if (createStatBar(item, scene, options)) {
      n++;
    }
  }
  return n;
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 */
export function resolveStatBarDomainModel(record, scene) {
  const handler = record?.handler ?? "createStatBars";
  if (handler === "createStatBars" || handler === "deployStatBar") {
    const sharedOptions = record?.options && typeof record.options === "object" ? record.options : {};
    const items = Array.isArray(record.items)
      ? record.items
      : record.payload != null && typeof record.payload === "object"
        ? [record.payload]
        : [];
    createStatBars(items, scene, sharedOptions);
    return;
  }
  log.warn("[stat.bar] unknown handler:", handler);
}
