const digest = async (blob) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, "0")).join("");
const encodeKey = (value) => [...new TextEncoder().encode(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const keyOf = (manifest) => `manifest-${encodeKey(manifest.id)}-${encodeKey(manifest.version)}.json`;
export function validateAudioModelManifest(input) {
  const manifest = structuredClone(input);
  if (![manifest?.id, manifest?.version, manifest?.adapter, manifest?.license].every((value) => typeof value === "string" && value.trim()) || !Array.isArray(manifest.files) || !manifest.files.length) throw new TypeError("Model needs string id, version, adapter, license and files.");
  const roles = new Set();
  for (const file of manifest.files) {
    if (typeof file.role !== "string" || !/^[A-Za-z0-9_.-]+$/.test(file.role) || ["__proto__", "constructor", "prototype"].includes(file.role) || roles.has(file.role) || !/^[a-f0-9]{64}$/i.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new TypeError("Each model file needs a unique safe role, exact bytes and SHA-256.");
    roles.add(file.role);
  }
  return manifest;
}

/** Transactional, explicit model installation. Merely importing never downloads. */
export function createAudioModelManager(storage, options = {}) {
  const active = new Set(), locks = new Map();
  const install = async (input, imports, request = {}) => {
    const manifest = validateAudioModelManifest(input), key = keyOf(manifest);
    if (active.has(key) || locks.has(key)) throw Object.assign(new Error("Model is currently in use."), { code: "AUDIO_MODEL_BUSY" });
    active.add(key); const staged = []; let committed = false;
    try {
      const old = await storage.getJson(key);
      for (const file of manifest.files) {
        request.signal?.throwIfAborted();
        let blob = imports?.[file.role], stream;
        if (blob) { if (!(blob instanceof Blob)) blob = new Blob([blob]); stream = blob.stream(); }
        else {
          if (imports) throw new Error(`Missing imported model role: ${file.role}`);
          if (!file.url) throw new Error(`Model role ${file.role} has no download URL.`);
          const response = await (options.fetch || fetch)(file.url, { signal: request.signal, credentials: "omit" });
          if (!response.ok || !response.body) throw new Error(`Model HTTP ${response.status}`);
          stream = response.body;
        }
        const storageKey = `file-${crypto.randomUUID()}`, writer = await storage.createWriter(storageKey), reader = stream.getReader();
        staged.push(storageKey); let loaded = 0;
        try {
          for (;;) {
            request.signal?.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
            loaded += value.byteLength; if (loaded > file.bytes) throw new Error(`Model role ${file.role} exceeds declared size.`);
            await writer.write(value); request.onProgress?.({ role: file.role, loaded, total: file.bytes });
          }
          await writer.close();
        } catch (error) { await reader.cancel().catch(() => {}); await writer.abort?.().catch(() => {}); throw error; }
        finally { reader.releaseLock(); }
        if (loaded !== file.bytes) throw new Error(`Incomplete model role: ${file.role}`);
        const saved = await storage.getBlob(storageKey);
        if (await digest(saved) !== file.sha256.toLowerCase()) throw Object.assign(new Error(`Model integrity mismatch: ${file.role}`), { code: "AUDIO_MODEL_HASH_MISMATCH" });
        file.storageKey = storageKey;
      }
      request.signal?.throwIfAborted();
      await storage.putJson(key, { ...manifest, installedAt: new Date().toISOString() });
      committed = true;
      // Once the new manifest is visible, failed old-file cleanup must never
      // roll back its files. Report garbage collection separately.
      for (const file of old?.files || []) await storage.remove(file.storageKey).catch((error) => options.onCleanupError?.(error, file.storageKey));
      return { id: manifest.id, version: manifest.version, status: "ready" };
    } catch (error) { if (!committed) for (const key of staged) await storage.remove(key).catch(() => {}); throw error; }
    finally { active.delete(key); }
  };
  return {
    download: (manifest, request) => install(manifest, null, request),
    import: (manifest, files, request) => install(manifest, files, request),
    async list() { return Promise.all((await storage.list()).filter((key) => key.startsWith("manifest-")).map((key) => storage.getJson(key))); },
    async status(input) { const saved = await storage.getJson(keyOf(input)); if (!saved) return { status: "missing" }; for (const file of saved.files) if ((await storage.getBlob(file.storageKey))?.size !== file.bytes) return { status: "incomplete" }; return { status: "ready", manifest: saved }; },
    async acquire(input) {
      const key = keyOf(input); if (active.has(key)) throw new Error("Model installation in progress.");
      locks.set(key, (locks.get(key)||0)+1); let released = false;
      try {
        const saved = await storage.getJson(key); if (!saved) throw new Error("Model is not installed.");
        const files = {};
        for (const file of saved.files) { const blob = await storage.getBlob(file.storageKey); if (!blob || await digest(blob) !== file.sha256.toLowerCase()) throw new Error(`Cached model file is missing or corrupt: ${file.role}`); files[file.role] = blob; }
        return { manifest: saved, files, release() { if (released) return; released = true; const count = locks.get(key)-1; if (count) locks.set(key,count); else locks.delete(key); } };
      } catch (error) { const count = locks.get(key)-1; if (count) locks.set(key,count); else locks.delete(key); throw error; }
    },
    async remove(input) {
      const key=keyOf(input); if (active.has(key)||locks.has(key)) throw Object.assign(new Error("Model is in use."), { code: "AUDIO_MODEL_BUSY" });
      active.add(key);
      try { const saved=await storage.getJson(key); await storage.remove(key); for(const file of saved?.files||[]) await storage.remove(file.storageKey); }
      finally { active.delete(key); }
    },
    estimate: () => storage.estimate?.(), persist: () => storage.persist?.(), close: () => storage.close?.()
  };
}

/** OPFS large-file storage; IndexedDB fallback. No machine paths in browser config. */
export async function createBrowserAudioModelStorage(options = {}) {
  const storage = options.storage || globalThis.navigator?.storage;
  if (storage?.getDirectory && options.preferIndexedDb !== true) {
    let root;
    try { root = await (await storage.getDirectory()).getDirectoryHandle("threejson-audio-models", { create: true }); }
    catch (error) {
      if (!globalThis.indexedDB) throw error;
      options.onFallback?.(error);
      return createBrowserAudioModelStorage({ ...options, preferIndexedDb: true });
    }
    const getBlob = async (key) => { try { return await (await root.getFileHandle(key)).getFile(); } catch (error) { if(error.name === "NotFoundError") return null; throw error; } };
    return {
      kind: "opfs", getBlob,
      async createWriter(key) { return (await root.getFileHandle(key,{create:true})).createWritable(); },
      async getJson(key) { const file=await getBlob(key); return file ? JSON.parse(await file.text()) : null; },
      async putJson(key,value) { const writer=await (await root.getFileHandle(key,{create:true})).createWritable(); await writer.write(JSON.stringify(value)); await writer.close(); },
      async remove(key) { try { await root.removeEntry(key); } catch(error) { if(error.name !== "NotFoundError") throw error; } },
      async list() { const keys=[]; for await(const key of root.keys()) keys.push(key); return keys; },
      estimate: () => storage.estimate(), persist: () => storage.persist()
    };
  }
  if (!globalThis.indexedDB) throw new Error("Neither OPFS nor IndexedDB is available.");
  const db = await new Promise((resolve,reject) => { const request=indexedDB.open("threejson-audio-models",1); request.onupgradeneeded=()=>request.result.createObjectStore("files"); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); });
  const tx = (mode, action) => new Promise((resolve,reject) => { const transaction=db.transaction("files",mode), request=action(transaction.objectStore("files")); transaction.oncomplete=()=>resolve(request?.result); transaction.onerror=()=>reject(transaction.error); transaction.onabort=()=>reject(transaction.error || new Error("Model storage transaction aborted.")); });
  return {
    kind: "indexeddb", getBlob: (key) => tx("readonly",(store)=>store.get(key)),
    async getJson(key) { const blob=await tx("readonly",(store)=>store.get(key)); return blob ? JSON.parse(await blob.text()) : null; },
    putJson: (key,value) => tx("readwrite",(store)=>store.put(new Blob([JSON.stringify(value)]),key)),
    async createWriter(key) { const chunks=[]; return { write(chunk) { chunks.push(new Blob([chunk])); }, close: () => tx("readwrite",(store)=>store.put(new Blob(chunks),key)), async abort(){chunks.length=0;} }; },
    remove: (key) => tx("readwrite",(store)=>store.delete(key)), list: () => tx("readonly",(store)=>store.getAllKeys()),
    estimate: () => storage?.estimate(), persist: () => storage?.persist(), close: () => db.close()
  };
}
