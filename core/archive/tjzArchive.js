import {
  isArchiveExtension,
  isLikelyJsonString,
  isZipMagic,
  readInputAsUint8Array
} from "../util/archiveCommon.js";
import { parseTjzArchive } from "./tjzParser.js";
import { fileMapToBlobMap, rewritePackRefsToObjectUrls } from "./tjzAssetRewrite.js";
import { resolveArchiveEntryKind } from "../util/archiveEntryKind.js";

/**
 * Parse archive and rewrite `pack://` refs to `blob:` URLs.
 * @param {*} input
 * @param {{
 *   missingAssetPolicy?: "warn"|"error",
 *   onWarning?: (msg:string)=>void
 * }} [options]
 */
async function parseTjzArchiveForScene(input, options = {}) {
  const parsed = await parseTjzArchive(input);
  const policy = options.missingAssetPolicy || parsed.manifest?.missingAssetPolicy || "warn";
  const blobMap = fileMapToBlobMap(parsed.fileMap);
  const rewritten = rewritePackRefsToObjectUrls(parsed.payload, blobMap, {
    missingAssetPolicy: policy,
    onWarning: options.onWarning
  });
  return {
    payload: rewritten.payload,
    manifest: parsed.manifest,
    entryKind: parsed.entryKind || resolveArchiveEntryKind({
      manifest: parsed.manifest,
      payload: parsed.payload
    }),
    entryPath: parsed.entryPath,
    dispose: rewritten.dispose,
    objectUrlCount: rewritten.objectUrlCount,
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
