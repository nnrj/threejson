import { packTjzArchive } from "../archive/tjzPackager.js";
import { isEventScriptReference } from "../runtime/eventMechanism/scriptReference.js";
import { LIB_PREFIX } from "./resolveTextureSource.js";

const ASSET_CANDIDATE_KEYS = new Set([
  "textureUrl",
  "texturePath",
  "modelPath",
  "map",
  "url",
  "src",
  "script",
  "scriptUrl"
]);

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch (_error) {
    return value ?? null;
  }
}

function isLikelyAssetRef(value) {
  return typeof value === "string"
    && (value.startsWith("blob:")
      || value.startsWith("data:")
      || value.startsWith("http://")
      || value.startsWith("https://")
      || value.startsWith("pack://")
      || value.startsWith("./")
      || value.startsWith("../")
      || value.startsWith("/"));
}

function isPackableAssetRef(key, value) {
  if (typeof value !== "string" || !value) {
    return false;
  }
  if (key === "script" || key === "scriptUrl") {
    return isEventScriptReference(value);
  }
  return ASSET_CANDIDATE_KEYS.has(key) && isLikelyAssetRef(value);
}

function walkPayloadForAssetRefs(payload, onRef, path = "$") {
  if (!payload || typeof payload !== "object") {
    return;
  }
  if (Array.isArray(payload)) {
    for (let i = 0; i < payload.length; i++) {
      walkPayloadForAssetRefs(payload[i], onRef, `${path}[${i}]`);
    }
    return;
  }
  const entries = Object.entries(payload);
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i];
    const nextPath = `${path}.${key}`;
    if (typeof value === "string" && isPackableAssetRef(key, value)) {
      onRef?.({ key, ref: value, path: nextPath });
    }
    walkPayloadForAssetRefs(value, onRef, nextPath);
  }
}

function dataUrlToBytes(dataUrl) {
  const marker = ";base64,";
  const idx = dataUrl.indexOf(marker);
  if (!dataUrl.startsWith("data:") || idx < 0) {
    return null;
  }
  const b64 = dataUrl.slice(idx + marker.length);
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  if (typeof atob === "function") {
    const text = atob(b64);
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      out[i] = text.charCodeAt(i);
    }
    return out;
  }
  return null;
}

function textToBytes(text) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text);
  }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * @param {object|null|undefined} payload
 * @param {string} token
 * @returns {object|null}
 */
function findEventScriptEntry(payload, token) {
  const normalized = typeof token === "string" ? token.trim() : "";
  if (!payload || !normalized || !Array.isArray(payload.assetLibrary)) {
    return null;
  }
  for (let i = 0; i < payload.assetLibrary.length; i++) {
    const entry = payload.assetLibrary[i];
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const kind = String(entry.assetKind ?? entry.resourceKind ?? "").trim().toLowerCase();
    if (kind !== "eventscript") {
      continue;
    }
    const id = String(entry.threeJsonId ?? entry.id ?? "").trim();
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (id === normalized || (name && name === normalized)) {
      return entry;
    }
  }
  return null;
}

function guessAssetExt(ref, fallback = "bin") {
  if (typeof ref !== "string" || !ref) {
    return fallback;
  }
  if (ref.toLowerCase().startsWith(LIB_PREFIX)) {
    return "dsl";
  }
  if (ref.startsWith("data:image/png")) {
    return "png";
  }
  if (ref.startsWith("data:image/jpeg")) {
    return "jpg";
  }
  const clean = ref.split(/[?#]/)[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : fallback;
}

async function fetchUrlToBytes(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

async function tryResolveAssetBytes(ref, options = {}) {
  const resolver = typeof options.resolveAsset === "function" ? options.resolveAsset : null;
  if (resolver) {
    const out = await resolver(ref);
    if (out instanceof Uint8Array) {
      return out;
    }
  }
  if (typeof ref !== "string") {
    return null;
  }
  if (ref.startsWith("data:")) {
    return dataUrlToBytes(ref);
  }
  if (ref.toLowerCase().startsWith(LIB_PREFIX)) {
    const entry = findEventScriptEntry(options.payload, ref.slice(LIB_PREFIX.length));
    if (!entry) {
      return null;
    }
    const source = entry.source ?? entry.code ?? entry.text ?? entry.value;
    if (typeof source === "string" && source.trim()) {
      return textToBytes(source);
    }
    const nestedUrl = entry.url ?? entry.scriptUrl;
    if (typeof nestedUrl === "string" && nestedUrl.trim()) {
      return tryResolveAssetBytes(nestedUrl.trim(), options);
    }
    return null;
  }
  if (options.fetchExternalUrls && (ref.startsWith("http://") || ref.startsWith("https://"))) {
    return fetchUrlToBytes(ref);
  }
  return null;
}

function rewriteRefsToPack(payload, rewriteMap) {
  const next = cloneJson(payload);
  if (!next || typeof next !== "object") {
    return next;
  }
  const visit = (node) => {
    if (!node || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        visit(node[i]);
      }
      return;
    }
    const entries = Object.entries(node);
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      if (typeof value === "string" && rewriteMap.has(value)) {
        node[key] = rewriteMap.get(value);
        continue;
      }
      visit(value);
    }
  };
  visit(next);
  return next;
}

async function collectAssetsFromPayload(payload, options = {}) {
  const assets = {};
  const rewriteMap = new Map();
  const refs = [];
  const packOptions = { ...options, payload };
  walkPayloadForAssetRefs(payload, ({ ref }) => refs.push(ref));
  const uniqueRefs = Array.from(new Set(refs));
  for (let i = 0; i < uniqueRefs.length; i++) {
    const ref = uniqueRefs[i];
    const bytes = await tryResolveAssetBytes(ref, packOptions);
    if (!bytes) {
      continue;
    }
    const ext = guessAssetExt(ref);
    const fileName = `assets/item_${i + 1}.${ext}`;
    assets[fileName] = bytes;
    rewriteMap.set(ref, `pack://${fileName}`);
  }
  return {
    assets,
    payload: rewriteRefsToPack(payload, rewriteMap),
    rewrittenCount: rewriteMap.size
  };
}

async function packPayloadToTjz(payload, options = {}) {
  const policy = options.assetPolicy || "preserve";
  const outputType = options.outputType || "bytes";
  if (policy !== "tryPack") {
    return packTjzArchive(payload, {
      outputType,
      manifest: options.manifest
    });
  }
  const collected = await collectAssetsFromPayload(payload, options);
  return packTjzArchive(collected.payload, {
    outputType,
    manifest: options.manifest,
    assets: collected.assets
  });
}

export {
  collectAssetsFromPayload,
  findEventScriptEntry,
  packPayloadToTjz,
  rewriteRefsToPack,
  tryResolveAssetBytes,
  walkPayloadForAssetRefs
};
