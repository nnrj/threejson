import { ensureThreeJsonIdOnRecord } from "../util/util.js";
import {
  inferMeshImportFormatFromFileName,
  normalizeMeshImportFormat,
  parseMeshArrayBufferToObject3D,
  SUPPORTED_MESH_IMPORT_FORMATS
} from "../builder/meshImportLoaders.js";

/**
 * @param {string} fileName
 * @returns {string}
 */
function stemFromFileName(fileName) {
  if (typeof fileName !== "string" || !fileName.trim()) {
    return "imported-mesh";
  }
  const normalized = fileName.trim().replace(/\\/g, "/");
  const base = normalized.split("/").pop() || normalized;
  const dotIndex = base.lastIndexOf(".");
  return dotIndex > 0 ? base.slice(0, dotIndex) : base;
}

/**
 * Build an `externalModel` descriptor from a local file/Blob import (for reuse by the JSON deploy pipeline).
 * @param {object} options
 * @returns {object}
 */
function buildExternalModelImportRecord(options = {}) {
  const fileName = typeof options.fileName === "string" ? options.fileName : "";
  const modelPath = typeof options.modelPath === "string" ? options.modelPath.trim() : "";
  if (!modelPath) {
    const error = new Error("E_MESH_IMPORT_RECORD_INVALID: modelPath is required");
    error.code = "E_MESH_IMPORT_RECORD_INVALID";
    throw error;
  }
  const modelFileType = normalizeMeshImportFormat(
    options.modelFileType || (fileName ? inferMeshImportFormatFromFileName(fileName) : "")
  );
  const record = {
    objType: "externalModel",
    name: typeof options.name === "string" && options.name.trim()
      ? options.name.trim()
      : stemFromFileName(fileName),
    modelPath,
    modelFileType
  };
  if (options.position && typeof options.position === "object") {
    record.position = options.position;
  }
  if (options.rotation && typeof options.rotation === "object") {
    record.rotation = options.rotation;
  }
  if (options.scale && typeof options.scale === "object") {
    record.scale = options.scale;
  }
  if (typeof options.threeJsonId === "string" && options.threeJsonId.trim()) {
    record.threeJsonId = options.threeJsonId.trim();
  }
  return ensureThreeJsonIdOnRecord(record);
}

/**
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {object} [options]
 * @returns {Promise<import("three").Object3D>}
 */
async function importMeshFromArrayBuffer(buffer, options = {}) {
  const format = normalizeMeshImportFormat(
    options.format || (options.fileName ? inferMeshImportFormatFromFileName(options.fileName) : "")
  );
  return parseMeshArrayBufferToObject3D(format, buffer, {
    resourcePath: options.resourcePath,
    fileName: options.fileName,
    loadingManager: options.loadingManager
  });
}

/**
 * Convert a Blob/File into a deployable externalModel record (`modelPath` is a blob URL).
 * @param {Blob} blob
 * @param {object} [options]
 * @returns {Promise<{ record: object, format: string, objectUrl: string, revokeObjectUrl: () => void }>}
 */
async function importMeshBlob(blob, options = {}) {
  if (!blob || typeof blob.arrayBuffer !== "function") {
    const error = new Error("E_MESH_IMPORT_BLOB_INVALID: expected Blob or File");
    error.code = "E_MESH_IMPORT_BLOB_INVALID";
    throw error;
  }
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    const error = new Error("E_MESH_IMPORT_ENV: URL.createObjectURL is unavailable");
    error.code = "E_MESH_IMPORT_ENV";
    throw error;
  }
  const fileName = typeof options.fileName === "string" && options.fileName.trim()
    ? options.fileName.trim()
    : (typeof blob.name === "string" ? blob.name : "");
  const format = normalizeMeshImportFormat(
    options.format || (fileName ? inferMeshImportFormatFromFileName(fileName) : "")
  );
  const objectUrl = URL.createObjectURL(blob);
  const record = buildExternalModelImportRecord({
    ...options,
    fileName,
    modelPath: objectUrl,
    modelFileType: format
  });
  return {
    record,
    format,
    objectUrl,
    revokeObjectUrl() {
      URL.revokeObjectURL(objectUrl);
    }
  };
}

export {
  SUPPORTED_MESH_IMPORT_FORMATS,
  normalizeMeshImportFormat,
  inferMeshImportFormatFromFileName,
  buildExternalModelImportRecord,
  importMeshFromArrayBuffer,
  importMeshBlob
};
