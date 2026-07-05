const EDITOR_SESSION_DB_NAME = "threejson_scene_editor";
const EDITOR_SESSION_DB_VERSION = 1;
const EDITOR_SESSION_STORE_NAME = "session";

let dbPromise = null;

function openEditorSessionDb() {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(EDITOR_SESSION_DB_NAME, EDITOR_SESSION_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EDITOR_SESSION_STORE_NAME)) {
        db.createObjectStore(EDITOR_SESSION_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

export async function editorSessionIdbGet(key) {
  const db = await openEditorSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EDITOR_SESSION_STORE_NAME, "readonly");
    const store = tx.objectStore(EDITOR_SESSION_STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error || new Error("IndexedDB get failed"));
  });
}

export async function editorSessionIdbPut(key, value) {
  const db = await openEditorSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EDITOR_SESSION_STORE_NAME, "readwrite");
    const store = tx.objectStore(EDITOR_SESSION_STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve(value);
    req.onerror = () => reject(req.error || new Error("IndexedDB put failed"));
  });
}

export async function editorSessionIdbDelete(key) {
  const db = await openEditorSessionDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EDITOR_SESSION_STORE_NAME, "readwrite");
    const store = tx.objectStore(EDITOR_SESSION_STORE_NAME);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("IndexedDB delete failed"));
  });
}

export const EDITOR_SESSION_RECOVERY_KEY = "recovery";
export const EDITOR_SESSION_TAB_KEY_PREFIX = "tab:";
export const EDITOR_TAB_SESSION_STORAGE_KEY = "threejson_sceneEditor_tabSessionId";
export const EDITOR_RECENT_SCENES_KEY = "recent-scenes";
export const EDITOR_SCENE_SNAPSHOT_KEY = "scene-snapshots";
export const EDITOR_SCENE_PRESETS_KEY = "scene-presets";
