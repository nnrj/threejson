/**
 * stat.panel: 3D flat panel (Canvas texture summary, no ECharts).
 */
import { clonePlainObject } from "../statShared.js";
import { log } from "../../../core/util/logger.js";
import { deployStatGroup } from "../statFactory.js";

/**
 * @param {object} item
 * @returns {object}
 */
export function createStatPanelJson(item = {}) {
  const lines = item.lines ?? item.summary ?? item.text;
  const statLabel = Array.isArray(lines)
    ? lines.map((line) => String(line)).join("\n")
    : String(lines ?? "Stat Panel");
  const width = Number(item.geometry?.width ?? item.width ?? 96);
  const height = Number(item.geometry?.height ?? item.panelHeight ?? 48);
  const depth = Number(item.geometry?.depth ?? item.panelDepth ?? 0.8);
  const labelStyle =
    item?.labelStyle && typeof item.labelStyle === "object" ? { ...item.labelStyle } : undefined;
  return {
    name: item.name || "statPanel",
    objType: "statPanel",
    position: clonePlainObject(item.position || { x: 0, y: 24, z: 0 }),
    rotation: clonePlainObject(
      item.rotation || { rotationX: 0, rotationY: 0, rotationZ: 0 }
    ),
    scale: clonePlainObject(item.scale || { scaleX: 1, scaleY: 1, scaleZ: 1 }),
    boxModelList: [
      {
        name: "statPanelMesh",
        objType: "statPanelMesh",
        geometry: {
          width,
          height,
          depth
        },
        position: { x: 0, y: height / 2, z: 0 },
        material: {
          color: item.material?.color ?? "#1e2838",
          transparent: true,
          opacity: item.material?.opacity ?? 0.92
        },
        businessInfo: {
          statLabel,
          statKind: "stat.panel",
          ...(labelStyle ? { labelStyle } : {})
        }
      }
    ]
  };
}

/**
 * @param {object} item
 * @param {import("three").Scene} [scene]
 * @returns {import("three").Group|object|null}
 */
export function createStatPanel(item, scene) {
  const desc = createStatPanelJson(item);
  if (!scene) {
    return desc;
  }
  return deployStatGroup(scene, desc);
}

/** @param {object} item @param {import("three").Scene} scene */
export function deployStatPanel(item, scene) {
  return createStatPanel(item, scene);
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 */
export function resolveStatPanelDomainModel(record, scene) {
  const handler = record?.handler ?? "deployStatPanel";
  if (handler === "deployStatPanel" || handler === "createStatPanel") {
    const payload =
      record.payload && typeof record.payload === "object"
        ? record.payload
        : record;
    deployStatPanel(payload, scene);
    return;
  }
  log.warn("[stat.panel] unknown handler:", handler);
}
