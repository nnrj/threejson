/** Portable file entries reuse assetLibrary; no archive/renderer/service dependency. */
const packPrefix = "pack://";
export function visitSceneAssetLibraries(payload, visit) {
  const seen = new Set(), stack = [payload];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node);
    if (ArrayBuffer.isView(node) || node instanceof ArrayBuffer) continue;
    if (Array.isArray(node)) { for (const item of node) if (item && typeof item === "object") stack.push(item); continue; }
    if (Array.isArray(node.assetLibrary)) visit(node.assetLibrary);
    for (const [key, value] of Object.entries(node)) if (key !== "assetLibrary" && value && typeof value === "object") stack.push(value);
  }
}

export function createEmbeddedResourceIndex(payload) {
  const files = new Map();
  visitSceneAssetLibraries(payload, (library) => {
    for (const entry of library) {
      if (entry?.assetKind !== "file" || typeof entry.archivePath !== "string" || typeof entry.url !== "string") continue;
      const key = `${packPrefix}${entry.archivePath}`;
      if (files.has(key) && files.get(key) !== entry.url) throw Object.assign(new Error(`Conflicting embedded resource: ${key}`), { code: "RESOURCE_ID_CONFLICT" });
      files.set(key, entry.url);
    }
  });
  return files;
}

export function resolveEmbeddedResource(index, source) {
  if (typeof source !== "string" || !source.startsWith(packPrefix)) return source;
  const resolved = index.get(source);
  if (!resolved || resolved.startsWith(packPrefix)) throw Object.assign(new Error(`Missing embedded resource: ${source}`), { code: "RESOURCE_NOT_FOUND", source });
  return resolved;
}

export function bytesToDataUrl(bytes, mimeType = "application/octet-stream") {
  let encoded;
  if (typeof Buffer !== "undefined") encoded = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  else {
    const chunks = [];
    for (let start = 0; start < bytes.length; start += 24576) chunks.push(String.fromCharCode(...bytes.subarray(start, start + 24576)));
    encoded = btoa(chunks.join(""));
  }
  return `data:${mimeType};base64,${encoded}`;
}

export function dataUrlToBytes(url) {
  const match = /^data:([^,]*?),(.*)$/s.exec(url);
  if (!match) throw new TypeError("Expected an embedded data URL.");
  if (!/;base64$/i.test(match[1])) return new TextEncoder().encode(decodeURIComponent(match[2]));
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(match[2], "base64"));
  return Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
}

export function inferResourceMimeType(path) {
  const extension = String(path).split(/[?#]/)[0].split(".").pop().toLowerCase();
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml",
    gltf: "model/gltf+json", glb: "model/gltf-binary", obj: "text/plain", mtl: "text/plain", json: "application/json", js: "text/javascript", mjs: "text/javascript",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" })[extension] || "application/octet-stream";
}
