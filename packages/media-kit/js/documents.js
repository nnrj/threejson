import { validateTimeline } from "threejson/timeline";

const mime = (path) => ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4", webm: "video/webm", glb: "model/gltf-binary", json: "application/json" })[path.split(".").pop().toLowerCase()] || "application/octet-stream";
function packPath(value) { return value.replace(/^pack:(\/\/)?/, "").replace(/^\/+/, ""); }
export function validateMediaDocument(input) {
  const document = structuredClone(input);
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new TypeError("Media input must be a scene or composition JSON document.");
  if (document.documentType && !["scene", "composition"].includes(document.documentType)) throw new Error(`Unsupported media document type: ${document.documentType}`);
  if (document.documentType === "composition") {
    if (document.compositionVersion !== 1) throw new Error("Unsupported composition version.");
    document.timeline = validateTimeline(document.timeline);
    if (!document.timeline.clips.length) throw new Error("Composition needs scene clips.");
  } else if (!document.sceneConfig && !Array.isArray(document.objectList) && !document.worldInfo) throw new Error("Input is not a ThreeJSON scene.");
  if (document.timeline) document.timeline = validateTimeline(document.timeline);
  return document;
}

/** Input JSON/.tjz -> authoring document + resource resolver with explicit lifetime. */
export async function openMediaDocument(input, options = {}) {
  let source = input, baseUrl = options.baseUrl, archive;
  const urls = new Map(), children = new Set(), owners = new WeakMap();
  if (typeof source === "string") {
    if (/^\s*[{[]/.test(source)) source = JSON.parse(source);
    else {
      baseUrl = new URL(source, baseUrl || globalThis.location?.href).href;
      const response = await (options.fetch || fetch)(baseUrl, { signal: options.signal });
      if (!response.ok) throw new Error(`Media document HTTP ${response.status}`);
      source = new Uint8Array(await response.arrayBuffer());
    }
  }
  if (source instanceof Blob) source = new Uint8Array(await source.arrayBuffer());
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      archive = await (await import("threejson/archive")).parseTjzArchive(bytes, { async: options.asyncArchive !== false });
      source = archive.payload;
      if (archive.entryKind === "object") throw new Error("An object archive needs a scene/camera before it can become a video.");
    } else source = JSON.parse(new TextDecoder().decode(bytes));
  }
  const document = validateMediaDocument(source);
  const resolveAsset = async (url) => {
    options.signal?.throwIfAborted();
    if (typeof url !== "string") return url;
    if (url.startsWith("pack:")) {
      const path = packPath(url), bytes = archive?.fileMap.get(path);
      if (!bytes) throw new Error(`Missing packed resource: ${path}`);
      if (!urls.has(path)) urls.set(path, URL.createObjectURL(new Blob([bytes], { type: mime(path) })));
      return urls.get(path);
    }
    return baseUrl ? new URL(url, baseUrl).href : url;
  };
  const api = {
    document, baseUrl, resolveAsset,
    ownerOf(scene) { return owners.get(scene) || api; },
    async materialize(value) {
      const rewrite = async (item) => {
        if (typeof item === "string" && item.startsWith("pack:")) return resolveAsset(item);
        if (Array.isArray(item)) return Promise.all(item.map(rewrite));
        if (item && typeof item === "object") return Object.fromEntries(await Promise.all(Object.entries(item).map(async ([key, entry]) => [key, await rewrite(entry)])));
        return item;
      };
      return rewrite(value);
    },
    async loadScene(source) {
      if (source && typeof source === "object") return validateMediaDocument(source);
      if (document.scenes?.[source]) return validateMediaDocument(document.scenes[source]);
      if (typeof source === "string" && source.startsWith("pack:")) {
        const path = packPath(source), bytes = archive?.fileMap.get(path);
        if (!bytes) throw new Error(`Missing packed scene: ${path}`);
        if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return validateMediaDocument(JSON.parse(new TextDecoder().decode(bytes)));
        const child = await openMediaDocument(bytes, options); children.add(child); owners.set(child.document, child); return child.document;
      }
      const child = await openMediaDocument(await resolveAsset(source), { ...options, baseUrl });
      children.add(child); owners.set(child.document, child); return child.document;
    },
    dispose() { for (const child of children) child.dispose(); children.clear(); for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); archive?.fileMap.clear(); }
  };
  return api;
}

/** Binary assets plus already-inline generated audio; never fetch remote dependencies. */
export async function packMediaDocument(document, options = {}) {
  document = validateMediaDocument(document);
  const assets = {}, replacements = new Map(), inputs = new Map(Object.entries(options.assets || {}));
  const collectAudio = value => {
    if (!value || typeof value !== "object") return;
    if (typeof value.url === "string" && /^data:audio\/[a-z0-9.+-]+;base64,/i.test(value.url) && !inputs.has(value.url)) {
      const binary = atob(value.url.slice(value.url.indexOf(",") + 1));
      inputs.set(value.url, Uint8Array.from(binary, char => char.charCodeAt(0)));
    }
    for (const child of Object.values(value)) if (typeof child === "object") collectAudio(child);
  };
  collectAudio(document);
  for (const [source, input] of inputs) {
    const bytes = input instanceof Blob ? new Uint8Array(await input.arrayBuffer()) : input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    if (!(bytes instanceof Uint8Array)) throw new TypeError("Archive assets must be binary bytes or Blobs.");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const audioType = /^data:audio\/([a-z0-9.+-]+);/i.exec(source)?.[1]?.toLowerCase();
    const extension = audioType ? ({ wav: "wav", "x-wav": "wav", mpeg: "mp3", ogg: "ogg", mp4: "m4a", webm: "webm" }[audioType] || "bin") : /\.([a-z0-9]+)(?:[?#]|$)/i.exec(source)?.[1] || "bin";
    const path = `assets/${hash}.${extension}`;
    assets[path] = bytes; replacements.set(source, `pack://${path}`);
  }
  const rewrite = (value) => typeof value === "string" ? replacements.get(value) || value : Array.isArray(value) ? value.map(rewrite) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)])) : value;
  const composition = document.documentType === "composition";
  return (await import("threejson/archive")).packTjzArchive(rewrite(document), { assets, manifest: { entryKind: composition ? "composition" : "scene", entry: composition ? "composition.json" : "scene.json", missingAssetPolicy: "error" }, outputType: options.outputType });
}
