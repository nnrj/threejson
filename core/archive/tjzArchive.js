import {
  isArchiveExtension,
  isLikelyJsonString,
  isZipMagic,
  readInputAsUint8Array
} from "../util/archiveCommon.js";
import { parseTjzArchive } from "./tjzParser.js";
import { createArchiveResourceDocument } from "./tjzResourceDocument.js";
import { log } from "../util/logger.js";
import { resolveArchiveEntryKind } from "../util/archiveEntryKind.js";

/**
 * Parse an archive into portable authoring JSON with stable pack references.
 * @param {*} input
 * @param {{
 *   missingAssetPolicy?: "warn"|"error",
 *   onWarning?: (msg:string)=>void
 * }} [options]
 */
async function parseTjzArchiveForScene(input, options = {}) {
  const parsed = await parseTjzArchive(input);
  const policy = options.missingAssetPolicy || parsed.manifest?.missingAssetPolicy || "warn";
  const rewritten = createArchiveResourceDocument(parsed, {
    missingAssetPolicy: policy,
    onWarning: options.onWarning || ((message) => log.warn(message))
  });
  return {
    payload: rewritten.payload,
    manifest: parsed.manifest,
    entryKind: parsed.entryKind || resolveArchiveEntryKind({
      manifest: parsed.manifest,
      payload: parsed.payload
    }),
    entryPath: parsed.entryPath,
    // Retained for the parser resource-lifetime API; no runtime URL is allocated.
    dispose() {},
    objectUrlCount: 0,
    missing: rewritten.missing
  };
}

async function inspectTjzArchiveEntry(input) {
  const parsed = await parseTjzArchive(input);
  return {
    manifest: parsed.manifest,
    entryPath: parsed.entryPath,
    entryKind: parsed.entryKind || resolveArchiveEntryKind({
      manifest: parsed.manifest,
      payload: parsed.payload
    }),
    payload: parsed.payload
  };
}

async function isTjzLike(input) {
  if (typeof input === "string") {
    if (isLikelyJsonString(input)) {
      return false;
    }
    if (isArchiveExtension(input)) {
      return true;
    }
  }
  try {
    const bytes = await readInputAsUint8Array(input);
    return isZipMagic(bytes);
  } catch (_) {
    return false;
  }
}

export {
  inspectTjzArchiveEntry,
  isTjzLike,
  parseTjzArchiveForScene
};
