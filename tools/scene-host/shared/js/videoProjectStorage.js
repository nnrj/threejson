const DB = "threejson-video-editor-v1", LOCAL = "local-media://";
const request = value => new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); });
const complete = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error("Storage transaction failed")); });
export const rewriteStrings = (value, map) => typeof value === "string" ? map(value) : Array.isArray(value) ? value.map(v => rewriteStrings(v, map)) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, rewriteStrings(v, map)])) : value;
export function referencedLocalAssets(document) { const result = new Set(); rewriteStrings(document, value => { if (value.startsWith(LOCAL)) result.add(value); return value; }); return [...result]; }

export async function createEditorStorage() {
  const opening = indexedDB.open(DB, 1);
  opening.onupgradeneeded = () => { opening.result.createObjectStore("projects", { keyPath: "id" }); opening.result.createObjectStore("assets"); opening.result.createObjectStore("handoffs"); };
  const db = await request(opening), urls = new Map(), versions = new Map();
  const read = (store, key) => request(db.transaction(store).objectStore(store).get(key));
  const put = async (store, value, key) => { const tx = db.transaction(store, "readwrite"), done = complete(tx); tx.objectStore(store).put(value, key); await done; };
  return {
    async getProject(id) { const value = await read("projects", id); versions.set(id, value?.storageVersion || 0); return value; },
    async listProjects() { return (await request(db.transaction("projects").objectStore("projects").getAll())).sort((a, b) => b.updated - a.updated); },
    async saveProject(id, document) {
      // IDB serializes this read/compare/write. Another tab must never silently
      // overwrite newer work; its in-memory document can still be downloaded.
      const tx = db.transaction("projects", "readwrite"), done = complete(tx), store = tx.objectStore("projects");
      let conflict = false, nextVersion;
      const get = store.get(id);
      get.onsuccess = () => {
        const expected = versions.get(id) || 0, current = get.result?.storageVersion || 0;
        if (expected !== current) { conflict = true; tx.abort(); return; }
        nextVersion = current + 1;
        store.put({ id, document, updated: Date.now(), storageVersion: nextVersion });
      };
      try { await done; } catch (error) {
        if (conflict) throw Object.assign(new Error("工程已被另一个标签页更新，未覆盖其修改。请下载当前工程包，再从最近工程重新打开。"), { code: "MEDIA_STORAGE_CONFLICT" });
        throw error;
      }
      versions.set(id, nextVersion);
      try { localStorage.setItem("threejson.videoEditor.lastProject", id); } catch { /* IDB remains authoritative */ }
    },
    async addAsset(blob, name = "asset.bin") { const uri = `${LOCAL}${crypto.randomUUID()}/${encodeURIComponent(name)}`; await put("assets", blob, uri); return uri; },
    async resolveDocument(document) {
      for (const uri of referencedLocalAssets(document)) if (!urls.has(uri)) {
        const blob = await read("assets", uri);
        if (!blob) throw new Error("本地素材缺失，可能已被浏览器清理。请重新导入素材或打开 .tjz 工程包。");
        urls.set(uri, URL.createObjectURL(blob));
      }
      return rewriteStrings(document, value => urls.get(value) || value);
    },
    async assetsFor(document) { return Object.fromEntries(await Promise.all(referencedLocalAssets(document).map(async uri => { const blob = await read("assets", uri); if (!blob) throw new Error(`素材已丢失：${uri}`); return [uri, blob]; }))); },
    async portableJson(document) {
      const entries = Object.entries(await this.assetsFor(document)), data = new Map();
      for (const [uri, blob] of entries) data.set(uri, await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }));
      return rewriteStrings(document, value => data.get(value) || value);
    },
    saveHandoff: (key, value) => put("handoffs", value, key), getHandoff: key => read("handoffs", key),
    async deleteHandoff(key) { const tx = db.transaction("handoffs", "readwrite"), done = complete(tx); tx.objectStore("handoffs").delete(key); await done; },
    close() { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); db.close(); }
  };
}

