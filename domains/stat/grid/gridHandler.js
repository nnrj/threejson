/**
 * stat.grid: multi-bar grid.
 */
import { clonePlainObject } from "../statShared.js";
import { log } from "../../../core/util/logger.js";
import {
  applyUtilizationToBar,
  buildStatBarGroupJson,
  deployStatGroup
} from "../statFactory.js";
import { normalizeStatBarItem } from "../bar/barHandler.js";

/**
 * @param {object[]} items
 * @param {object} [layout]
 * @returns {object}
 */
export function createStatGridJson(items = [], layout = {}) {
  return {
    items: Array.isArray(items) ? items : [],
    options: layout && typeof layout === "object" ? layout : {}
  };
}

/**
 * @param {object[]} items
 * @param {import("three").Scene} scene
 * @param {object} [layout]
 * @returns {import("three").Group|null}
 */
export function createStatGrid(items, scene, layout = {}) {
  const list = Array.isArray(items) ? items : [];
  const opts = layout && typeof layout === "object" ? layout : {};
  const sharedLabelStyle =
    opts.labelStyle && typeof opts.labelStyle === "object" ? opts.labelStyle : null;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const item = normalizeStatBarItem(list[i]);
    if (!item) {
      continue;
    }
    const spacingX = Number(opts.spacingX ?? 40);
    const spacingZ = Number(opts.spacingZ ?? 40);
    const columns = Math.max(1, Math.floor(Number(opts.columns ?? 4)));
    const origin = clonePlainObject(opts.origin || { x: 0, y: 0, z: 0 });
    const col = n % columns;
    const row = Math.floor(n / columns);
    const groupDesc = buildStatBarGroupJson(
      {
        ...item,
        position: {
          x: origin.x + col * spacingX,
          y: origin.y + (item.position?.y ?? 0),
          z: origin.z + row * spacingZ
        },
        name: item.name || `statGrid-${n}`
      },
      { statKind: "stat.grid", groupObjType: "statGrid" }
    );
    applyUtilizationToBar(groupDesc, item.value ?? item.used, item.max ?? item.total, {
      label: item.label,
      statKind: "stat.grid",
      item,
      labelStyle:
        item?.labelStyle && typeof item.labelStyle === "object" ? item.labelStyle : sharedLabelStyle
    });
    deployStatGroup(scene, groupDesc);
    n++;
  }
  return n > 0 ? scene : null;
}

/** @param {object[]|object} items @param {import("three").Scene} scene @param {object} [layout] */
export function deployStatGrid(items, scene, layout = {}) {
  const list = Array.isArray(items) ? items : items?.items ? items.items : [];
  const opts = items?.options || layout || {};
  return createStatGrid(list, scene, opts);
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 */
export function resolveStatGridDomainModel(record, scene) {
  const handler = record?.handler ?? "createStatGrid";
  if (handler === "createStatGrid") {
    const items = Array.isArray(record.items) ? record.items : [];
    const options = record.options && typeof record.options === "object" ? record.options : {};
    createStatGrid(items, scene, options);
    return;
  }
  log.warn("[stat.grid] unknown handler:", handler);
}
