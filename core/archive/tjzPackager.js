import { strToU8, zipSync } from "fflate";
import { normalizeArchivePath } from "../util/archiveCommon.js";
import { normalizeTjzManifest } from "./tjzManifest.js";

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
  const payloadText =
    typeof payloadOrText === "string"
      ? payloadOrText
      : JSON.stringify(payloadOrText ?? {}, null, 2);

  const zipEntries = {};
  zipEntries["scene.json"] = strToU8(payloadText);

  const manifest = normalizeTjzManifest(options.manifest || {});
  if (!manifest.entry) {
    manifest.entry = "scene.json";
  }
  zipEntries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

  const assets = options.assets && typeof options.assets === "object" ? options.assets : {};
  for (const [rawPath, rawData] of Object.entries(assets)) {
    const path = normalizeArchivePath(rawPath);
    if (!path) {
      continue;
    }
    zipEntries[path] = await normalizeAssetInputToBytes(rawData);
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
