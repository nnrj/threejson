import { strFromU8, unzipSync } from "fflate";
import {
  isZipMagic,
  normalizeArchivePath,
  readInputAsUint8Array
} from "../util/archiveCommon.js";
import {
  normalizeTjzManifest,
  resolveArchiveEntryPath
} from "./tjzManifest.js";
import { resolveArchiveEntryKind } from "../util/archiveEntryKind.js";

function unzipToFileMap(bytes) {
  const unzipped = unzipSync(bytes);
  const map = new Map();
  for (const [rawPath, data] of Object.entries(unzipped)) {
    const path = normalizeArchivePath(rawPath);
    if (!path || path.endsWith("/")) {
      continue;
    }
    map.set(path, data);
  }
  return map;
}

function parseJsonEntry(fileMap, path, label) {
  const data = fileMap.get(path);
  if (!data) {
    throw new Error(`[archive] missing ${label}: ${path}`);
  }
  const text = strFromU8(data);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`[archive] invalid JSON in ${label} (${path}): ${error?.message || error}`);
  }
}

/**
 * @param {*} input zip bytes/url/blob/file
 * @param {{ sourceName?: string }} [options]
 */
async function parseTjzArchive(input, options = {}) {
  const bytes = await readInputAsUint8Array(input);
  if (!isZipMagic(bytes)) {
    throw new Error("[archive] input is not a valid zip archive");
  }
  const fileMap = unzipToFileMap(bytes);
  if (!fileMap.size) {
    throw new Error("[archive] archive is empty");
  }

  const hasManifest = fileMap.has("manifest.json");
  const manifestRaw = hasManifest ? parseJsonEntry(fileMap, "manifest.json", "manifest") : {};
  const manifest = normalizeTjzManifest(manifestRaw);
  const entryPath = resolveArchiveEntryPath(manifest, fileMap);
  if (!entryPath) {
    throw new Error("[archive] no valid entry found (manifest.entry / scene.json)");
  }
  const payload = parseJsonEntry(fileMap, entryPath, "entry");
  const entryKind = resolveArchiveEntryKind({
    manifest,
    payload
  });

  return {
    payload,
    manifest,
    entryKind,
    entryPath,
    fileMap,
    sourceName: options.sourceName || null
  };
}

export {
  parseTjzArchive
};
