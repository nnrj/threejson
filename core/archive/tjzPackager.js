import * as fflate from "fflate";
import { normalizeArchivePath } from "../util/archiveCommon.js";
import { normalizeTjzManifest } from "./tjzManifest.js";
import { extractArchiveResourceFiles } from "./tjzResourceDocument.js";

const { strToU8, zipSync } = fflate;

if (typeof strToU8 !== "function" || typeof zipSync !== "function") {
  throw new Error("ThreeJSON .tjz packaging requires the optional peer: npm install fflate");
}

async function normalizeAssetInputToBytes(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer());
  }
  if (typeof input === "string") {
    return strToU8(input);
  }
  throw new Error("[archive] unsupported asset input type for packaging");
}

/**
 * @param {object|string} payloadOrText
 * @param {{
 *   manifest?: object,
 *   assets?: Record<string, Uint8Array|ArrayBuffer|ArrayBufferView|Blob|string>,
 *   outputType?: "bytes"|"blob"
 * }} [options]
 */
async function packTjzArchive(payloadOrText, options = {}) {
  const extracted = extractArchiveResourceFiles(typeof payloadOrText === "string" ? JSON.parse(payloadOrText) : payloadOrText ?? {});
  const payloadText = JSON.stringify(extracted.payload, null, 2);

  const zipEntries = {};
  const manifest = normalizeTjzManifest(options.manifest || {});
  if (!manifest.entry) {
    manifest.entry = "scene.json";
  }
  zipEntries[normalizeArchivePath(manifest.entry)] = strToU8(payloadText);
  zipEntries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  for (const [path, bytes] of extracted.assets) zipEntries[normalizeArchivePath(path)] = bytes;

  const assets = options.assets && typeof options.assets === "object" ? options.assets : {};
  for (const [rawPath, rawData] of Object.entries(assets)) {
    const path = normalizeArchivePath(rawPath);
    if (!path) {
      continue;
    }
    const bytes = await normalizeAssetInputToBytes(rawData);
    if (zipEntries[path] && (zipEntries[path].length !== bytes.length || zipEntries[path].some((byte, index) => byte !== bytes[index]))) throw new Error(`[archive] conflicting or reserved asset path: ${path}`);
    zipEntries[path] = bytes;
  }

  const zipped = zipSync(zipEntries, { level: 6 });
  if (options.outputType === "blob") {
    return new Blob([zipped], { type: "application/zip" });
  }
  return zipped;
}

export {
  packTjzArchive
};
