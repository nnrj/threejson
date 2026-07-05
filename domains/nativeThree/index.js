import { log } from "../../core/util/logger.js";
import {
  loadThreeNativeObjectJsonFromUrl,
  parseThreeNativeObjectJsonAndAdd
} from "../../core/builder/nativeObjectLoader.js";

function createNativeThreeJson(overrides = {}) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return {
    fileType: "three",
    modelPath: source.modelPath ?? "",
    ...source
  };
}

function createNativeThree(overrides = {}) {
  const info = createNativeThreeJson(overrides);
  return info.modelPath ? info : null;
}

function deployNativeThree(overrides, scene, deps) {
  if (!scene) {
    return;
  }
  const info = createNativeThree(overrides);
  if (!info) {
    return;
  }
  loadThreeNativeObjectJsonFromUrl(
    /** @type {Parameters<typeof loadThreeNativeObjectJsonFromUrl>[0]} */ (info),
    scene,
    deps
  );
}

/** @param {object} record */
function buildMergedObjInfo(record) {
  const skip = new Set(["domain", "handler", "items", "options", "payload", "json"]);
  /** @type {Record<string, unknown>} */
  const merged = {};
  for (const k of Object.keys(record)) {
    if (!skip.has(k)) {
      merged[k] = record[k];
    }
  }
  if (record.payload != null && typeof record.payload === "object") {
    Object.assign(merged, record.payload);
  }
  if (Array.isArray(record.items) && record.items[0] && typeof record.items[0] === "object") {
    Object.assign(merged, record.items[0]);
  }
  if (!merged.fileType) {
    merged.fileType = "three";
  }
  return merged;
}

/**
 * @param {object} record
 * @param {import("three").Scene} scene
 * @param {{ loadingManager?: import("three").LoadingManager }} [ctx]
 */
function resolveNativeThreeDomainModel(record, scene, ctx) {
  const handler = record.handler ?? "loadFromUrl";
  if (handler === "parseInline") {
    const graph =
      record.json ??
      (record.payload && typeof record.payload === "object" ? record.payload.json : undefined) ??
      (Array.isArray(record.items) && record.items[0] && typeof record.items[0] === "object"
        ? record.items[0]
        : undefined);
    if (!graph || typeof graph !== "object") {
      log.warn("[nativeThree] parseInline requires record.json, payload.json, or items[0] object");
      return;
    }
    const transformOpts = {
      position: record.position,
      rotation: record.rotation,
      scale: record.scale,
      visible: record.visible,
      resourcePath: record.resourcePath,
      path: record.path,
      crossOrigin: record.crossOrigin
    };
    const deps = {};
    const mgr = ctx && typeof ctx === "object" ? ctx.loadingManager : undefined;
    if (mgr) {
      deps.loadingManager = mgr;
    }
    void parseThreeNativeObjectJsonAndAdd(graph, scene, transformOpts, deps).catch((err) => {
      const esrc =
        typeof err?.target?.src === "string" ? err.target.src.replace(/\s+/g, " ").trim() : "";
      const suffix = esrc !== "" ? `(image URL snippet: ${esrc.slice(0, 200)}…)` : "";
      log.error("[nativeThree] parseInline failed:", err, suffix || "");
    });
    return;
  }
  if (handler !== "loadFromUrl") {
    log.warn("[nativeThree] domainModel handler not implemented:", handler);
    return;
  }
  const info = buildMergedObjInfo(record);
  const modelPath = /** @type {string|undefined} */ (info.modelPath);
  if (!modelPath) {
    log.warn("[nativeThree] modelPath required (or provide via payload/items[0])");
    return;
  }
  const deps = {};
  const mgr = ctx && typeof ctx === "object" ? ctx.loadingManager : undefined;
  if (mgr) {
    deps.loadingManager = mgr;
  }
  loadThreeNativeObjectJsonFromUrl(/** @type {Parameters<typeof loadThreeNativeObjectJsonFromUrl>[0]} */ (info), scene, deps);
}

/**
 * Three.js Object/Scene native JSON: `domain: 'nativeThree'` in `domainModelList`.
 * - `handler: 'loadFromUrl'`: `modelPath` is JSON file URL;
 * - `handler: 'parseInline'`: `record.json` (or `payload.json` / `items[0]`) is in-memory object graph.
 */
const nativeThreeDomain = {
  id: "nativeThree",
  defaultHandler: "loadFromUrl",
  resolveDomainModel: resolveNativeThreeDomainModel,
  api: {
    createNativeThreeJson,
    createNativeThree,
    deployNativeThree,
    loadThreeNativeObjectJsonFromUrl,
    buildMergedObjInfo
  }
};

export default nativeThreeDomain;
