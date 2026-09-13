const DB_NAME = "threejson-texture-cache";
const DB_VERSION = 1;
const STORE_NAME = "textures";

function openCacheDb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "url" });
        store.createIndex("lastAccessedAt", "lastAccessedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation) {
  const db = await openCacheDb();
  if (!db) return null;
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let value;
      try { value = operation(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(value?.result ?? value ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Texture cache transaction aborted."));
    });
  } finally {
    db.close();
  }
}

export async function getCachedTextureBlob(url) {
  const key = String(url || "").trim();
  if (!key) return null;
  const record = await withStore("readonly", (store) => store.get(key)).catch(() => null);
  if (!record?.blob) return null;
  void withStore("readwrite", (store) => store.put({ ...record, lastAccessedAt: Date.now() })).catch(() => {});
  return record.blob;
}

export async function putCachedTextureBlob(url, blob, metadata = {}) {
  const key = String(url || "").trim();
  if (!key || !(blob instanceof Blob) || !blob.size) return false;
  await withStore("readwrite", (store) => store.put({
    url: key,
    blob,
    contentType: blob.type || metadata.contentType || "application/octet-stream",
    source: metadata.source || "remote",
    createdAt: metadata.createdAt || Date.now(),
    lastAccessedAt: Date.now()
  }));
  return true;
}

export async function clearTextureCache() {
  await withStore("readwrite", (store) => store.clear());
}

export async function resolveTextureRuntimeUrl(authoritativeUrl, runtimeUrl, options = {}) {
  const source = String(authoritativeUrl || "").trim();
  const fetchUrl = String(runtimeUrl || source).trim();
  if (!source || options.enabled === false || source.startsWith("data:") || source.startsWith("blob:")
    || source.toLowerCase().startsWith("lib://")) {
    return fetchUrl || source;
  }
  const cached = await getCachedTextureBlob(source);
  if (cached) return URL.createObjectURL(cached);
  try {
    const response = await fetch(fetchUrl, { signal: options.signal });
    if (!response.ok) return fetchUrl;
    const blob = await response.blob();
    if (!blob.size || (blob.type && !blob.type.startsWith("image/"))) return fetchUrl;
    await putCachedTextureBlob(source, blob, { source: options.source });
    return URL.createObjectURL(blob);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return fetchUrl;
  }
}

/** Return leased blob URLs to the engine, releasing them with the final texture reference. */
export function createTextureResourceResolver(options = {}) {
  return async (source, request = {}) => {
    if (!["texture", "image"].includes(request.kind)) return request.runtimeUrl || source;
    const authoritative = request.source || source;
    const enabled = typeof options.enabled === "function" ? options.enabled() !== false : options.enabled !== false;
    const resolved = await resolveTextureRuntimeUrl(authoritative, request.runtimeUrl || source, { ...options, enabled, signal: request.signal });
    if (resolved.startsWith("blob:") && !authoritative.startsWith("blob:")) {
      let released = false;
      return { url: resolved, release() { if (!released) { released = true; URL.revokeObjectURL(resolved); } } };
    }
    return resolved;
  };
}
