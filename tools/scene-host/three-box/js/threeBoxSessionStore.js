/**
 * ThreeBox's own IndexedDB database — entirely separate from the Scene Editor's
 * ("threejson_scene_editor", see tools/scene-host/shared/js/editorSessionIdb.js). Stores one
 * object store, "turns", keyed by turn id. A turn record captures everything a later chat
 * message needs to build context without re-sending full scene JSON to the model:
 * { id, conversationId, seq, userPrompt, mode: 'generate'|'adjust', targetTurnId, sceneJson
 *   (string), spatialSummary, recapSummary, createdAt }.
 */
const DB_NAME = "threejson_threebox";
const DB_VERSION = 1;
const STORE_TURNS = "turns";

let dbPromise = null;

function openDb() {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_TURNS)) {
        const store = db.createObjectStore(STORE_TURNS, { keyPath: "id" });
        store.createIndex("conversationId", "conversationId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TURNS, mode);
    const store = tx.objectStore(STORE_TURNS);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function putTurn(turn) {
  await withStore("readwrite", (store) => store.put(turn));
  return turn;
}

export async function getTurn(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TURNS, "readonly");
    const req = tx.objectStore(STORE_TURNS).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getTurnsForConversation(conversationId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TURNS, "readonly");
    const index = tx.objectStore(STORE_TURNS).index("conversationId");
    const req = index.getAll(conversationId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.seq - b.seq));
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTurnsForConversation(conversationId) {
  const turns = await getTurnsForConversation(conversationId);
  await withStore("readwrite", (store) => {
    for (const turn of turns) {
      store.delete(turn.id);
    }
  });
}

export function createTurnId() {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
