const DEFAULT_DB_NAME = "threejson-texture-cache";
const DB_VERSION = 1;
const STORE_NAME = "textures";

function openCacheDb(dbName = DEFAULT_DB_NAME) {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);
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

async function withStore(mode, operation, options = {}) {
  const db = await openCacheDb(options.dbName);
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

export async function getCachedTextureBlob(url, options = {}) {
  const key = String(url || "").trim();
  if (!key) return null;
  const record = await withStore("readonly", (store) => store.get(key), options).catch(() => null);
  if (!record?.blob) return null;
  void withStore("readwrite", (store) => store.put({ ...record, lastAccessedAt: Date.now() }), options).catch(() => {});
  return record.blob;
}

export async function putCachedTextureBlob(url, blob, metadata = {}, options = {}) {
  const key = String(url || "").trim();
  if (!key || !(blob instanceof Blob) || !blob.size) return false;
  await withStore("readwrite", (store) => store.put({
    url: key,
    blob,
    contentType: blob.type || metadata.contentType || "application/octet-stream",
    source: metadata.source || "remote",
    createdAt: metadata.createdAt || Date.now(),
    lastAccessedAt: Date.now()
  }), options);
  return true;
}

export async function clearTextureCache(options = {}) {
  await withStore("readwrite", (store) => store.clear(), options);
}

export async function resolveTextureRuntimeUrl(authoritativeUrl, runtimeUrl, options = {}) {
  const source = String(authoritativeUrl || "").trim();
  const fetchUrl = String(runtimeUrl || source).trim();
  if (!source || options.enabled === false || source.startsWith("data:") || source.startsWith("blob:")
    || source.toLowerCase().startsWith("lib://")) {
    return fetchUrl || source;
  }
  const cacheOptions = { dbName: options.dbName };
  const cached = await getCachedTextureBlob(source, cacheOptions);
  if (cached) return URL.createObjectURL(cached);
  try {
    const response = await fetch(fetchUrl, { signal: options.signal });
    if (!response.ok) return fetchUrl;
    const blob = await response.blob();
    if (!blob.size || (blob.type && !blob.type.startsWith("image/"))) return fetchUrl;
    await putCachedTextureBlob(source, blob, { source: options.source }, cacheOptions);
    return URL.createObjectURL(blob);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return fetchUrl;
  }
}
