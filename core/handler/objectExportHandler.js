import { exportJsonScene } from "./sceneExportHandler.js";
import {
  collectObjectsByObjType,
  exportRecordFromObject3D,
  normalizeSelectorBy,
  resolveObjectById
} from "../util/objectExportUtil.js";

let archiveModulesPromise = null;

async function loadArchiveExportModules() {
  if (!archiveModulesPromise) {
    archiveModulesPromise = Promise.all([
      import("../util/archiveExportUtil.js"),
      import("../archive/tjzPackager.js")
    ]).catch((error) => {
      throw error;
    });
  }
  const [archiveExportUtil, tjzPackager] = await archiveModulesPromise;
  return {
    packPayloadToTjz: archiveExportUtil.packPayloadToTjz,
    packTjzArchive: tjzPackager.packTjzArchive
  };
}

function buildNotFoundError(by, id) {
  const error = new Error(`E_EXPORT_OBJECT_NOT_FOUND: object not found by ${by}="${id}"`);
  error.code = "E_EXPORT_OBJECT_NOT_FOUND";
  return error;
}

function normalizeIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }
  return ids
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter(Boolean);
}

function buildSelectorOptions(options = {}) {
  return {
    by: normalizeSelectorBy(options.by || "threeJsonId"),
    syncTransforms: options.syncTransforms !== false
  };
}

function mergeManifestWithEntryKind(manifest, entryKind) {
  const out = manifest && typeof manifest === "object" ? { ...manifest } : {};
  if (!out.entryKind) {
    out.entryKind = entryKind;
  }
  return out;
}

function exportJsonObject(target, id, options = {}) {
  const selector = buildSelectorOptions(options);
  const object3D = resolveObjectById(target, id, selector.by);
  if (!object3D) {
    throw buildNotFoundError(selector.by, id);
  }
  return exportRecordFromObject3D(object3D, selector);
}

function exportJsonObjectBatch(target, ids, options = {}) {
  const list = normalizeIds(ids);
  const strict = options.strict === true;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const id = list[i];
    try {
      out.push({
        id,
        ok: true,
        value: exportJsonObject(target, id, options)
      });
    } catch (error) {
      if (strict) {
        throw error;
      }
      out.push({
        id,
        ok: false,
        error: error?.message || String(error)
      });
    }
  }
  return out;
}

function exportJsonObjectByType(target, objType, options = {}) {
  const hits = collectObjectsByObjType(target, objType);
  return hits.map((node) => exportRecordFromObject3D(node, options));
}

function exportJsonObjectByTypeList(target, objTypeList, options = {}) {
  const hits = collectObjectsByObjType(target, objTypeList);
  return hits.map((node) => exportRecordFromObject3D(node, options));
}

async function packJsonObjectArchive(target, id, options = {}) {
  const { packPayloadToTjz } = await loadArchiveExportModules();
  const record = exportJsonObject(target, id, options);
  return packPayloadToTjz(record, {
    ...options,
    manifest: mergeManifestWithEntryKind(options.manifest, "object")
  });
}

async function packJsonObjectBatchArchive(target, ids, options = {}) {
  const { packPayloadToTjz } = await loadArchiveExportModules();
  const batch = exportJsonObjectBatch(target, ids, options);
  const out = [];
  for (let i = 0; i < batch.length; i++) {
    const item = batch[i];
    if (!item.ok) {
      out.push(item);
      continue;
    }
    const archive = await packPayloadToTjz(item.value, {
      ...options,
      manifest: mergeManifestWithEntryKind(options.manifest, "object")
    });
    out.push({
      id: item.id,
      ok: true,
      archive
    });
  }
  return out;
}

async function packJsonSceneArchive(targetOrPayload, options = {}) {
  const { packPayloadToTjz, packTjzArchive } = await loadArchiveExportModules();
  const format = options.format || "standard";
  const scenePayload = await exportJsonScene(targetOrPayload, options);
  if (format === "three-native") {
    return packTjzArchive(scenePayload, {
      outputType: options.outputType || "bytes",
      manifest: mergeManifestWithEntryKind(options.manifest, "scene")
    });
  }
  return packPayloadToTjz(scenePayload, {
    ...options,
    manifest: mergeManifestWithEntryKind(options.manifest, "scene")
  });
}

export {
  exportJsonObject,
  exportJsonObjectBatch,
  exportJsonObjectByType,
  exportJsonObjectByTypeList,
  packJsonObjectArchive,
  packJsonObjectBatchArchive,
  packJsonSceneArchive
};
