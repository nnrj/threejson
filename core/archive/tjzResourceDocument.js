import { isPackRef, parsePackRef } from "../util/archiveCommon.js";
import { bytesToDataUrl, dataUrlToBytes, inferResourceMimeType, visitSceneAssetLibraries } from "../resource/embeddedResources.js";

/** Keep pack references and their bytes in authoring state, never page-lifetime blob URLs.
 * Namespace archive paths so two imported objects may both contain assets/image.png. */
export function createArchiveResourceDocument(parsed, options = {}) {
  const payload = structuredClone(parsed.payload), references = new Map(), missing = new Set();
  const policy = options.missingAssetPolicy || parsed.manifest?.missingAssetPolicy || "warn";
  const scope = `_archive/${parsed.sourceId}`;
  const pathFor = (path) => /^_archive\/[a-f\d]{64}\//.test(path) ? path : `${scope}/${path}`;
  const files = [];
  for (const [path, bytes] of parsed.fileMap) {
    if (path === "manifest.json" || path === parsed.entryPath) continue;
    const archivePath = pathFor(path);
    references.set(path, archivePath);
    files.push({ threeJsonId: `archive:${archivePath}`, assetKind: "file", archivePath,
      url: bytesToDataUrl(bytes, inferResourceMimeType(path)), byteLength: bytes.byteLength });
  }
  function rewrite(value) {
    if (typeof value === "string" && isPackRef(value)) {
      const path = parsePackRef(value), resolved = references.get(path);
      if (!resolved) { missing.add(path); return value; }
      return `pack://${resolved}`;
    }
    if (!value || typeof value !== "object") return value;
    for (const key of Object.keys(value)) value[key] = rewrite(value[key]);
    return value;
  }
  rewrite(payload);
  if (missing.size && policy === "error") throw new Error(`[archive] missing pack resource: ${[...missing].join(", ")}`);
  for (const path of missing) options.onWarning?.(`[archive] missing pack resource: ${path}`);
  const retained = new Set();
  const byPath = new Map(files.map((file) => [file.archivePath, file]));
  visitSceneAssetLibraries(payload, (library) => {
    for (const entry of library) {
      if (entry?.assetKind !== "file" || !entry.archivePath) continue;
      const path = references.get(entry.archivePath);
      const file = byPath.get(path);
      if (file) { Object.assign(entry, { ...file, threeJsonId: entry.threeJsonId || file.threeJsonId }); retained.add(path); }
    }
  });
  const additional = files.filter((file) => !retained.has(file.archivePath));
  if (additional.length) {
    const owner = payload.worldInfo && !Array.isArray(payload.assetLibrary) ? payload.worldInfo : payload;
    owner.assetLibrary = [...(owner.assetLibrary || []), ...additional];
  }
  return { payload, missing: [...missing] };
}

/** Split portable JSON into a normal .tjz file table without duplicate base64 bytes. */
export function extractArchiveResourceFiles(input) {
  const payload = structuredClone(input), assets = new Map();
  visitSceneAssetLibraries(payload, (library) => {
    for (const entry of library) {
      if (entry?.assetKind !== "file" || !entry.archivePath || !entry.url?.startsWith("data:")) continue;
      const existing = assets.get(entry.archivePath);
      const bytes = dataUrlToBytes(entry.url);
      if (existing && (existing.length !== bytes.length || existing.some((byte, index) => byte !== bytes[index]))) throw new Error(`Conflicting archive resource: ${entry.archivePath}`);
      assets.set(entry.archivePath, bytes);
      entry.url = `pack://${entry.archivePath}`;
    }
  });
  return { payload, assets };
}
