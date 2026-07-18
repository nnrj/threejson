/**
 * Lightweight per-scene persistence for the "AI 生成" / "AI 调整" tabs' shared conversation log
 * (editorAiGeneratePanel.js, editorAiAdjustPanel.js — both tabs read/write the same per-scene
 * record here, keyed by scene not by tab). Deliberately NOT a port of ThreeBox's
 * threeBoxSessionStore.js — that
 * schema exists to support ThreeBox's "history is immutable, every turn gets its own
 * independently-renderable scene card" model (diff-cache reconstruction, conversations/projects
 * grouping, etc). Editor has none of that: the live scene *is* the single source of truth, and
 * this store only needs to remember the transcript (who said what) for context and for the user
 * to scroll back through — not scene-JSON snapshots, which editor's own save/session-recovery
 * mechanisms already own.
 *
 * Turns are keyed by a "scene key" derived from the editor's current scene label (see
 * `resolveSceneKeyFromLabel` below) — an approximation of "one log per scene file". Renaming a
 * scene starts a fresh log under the new key; this is a known, accepted simplification.
 */

const DB_NAME = "threejson_editor_ai_chat";
const DB_VERSION = 1;
const STORE_NAME = "turns";

let dbPromise = null;

function openDb() {
  if (dbPromise) {
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("sceneKey", "sceneKey", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open AI chat history database."));
  });
  return dbPromise;
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let result;
    Promise.resolve(fn(store))
      .then((r) => {
        result = r;
      })
      .catch(reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Cheap, dependency-free string hash — just needs to be stable and filesystem/IndexedDB-key
 * safe, not cryptographically strong. */
function hashLabel(label) {
  let h = 0;
  for (let i = 0; i < label.length; i += 1) {
    h = (h * 31 + label.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function resolveSceneKeyFromLabel(label) {
  const trimmed = String(label || "").trim();
  if (!trimmed) {
    return "unsaved";
  }
  return `s_${hashLabel(trimmed)}`;
}

let turnSeq = 0;

export function createAiChatTurnId() {
  turnSeq += 1;
  return `aichat-${Date.now().toString(36)}-${turnSeq}`;
}

/** @returns {Promise<Array<{id:string, sceneKey:string, seq:number, role:"user"|"assistant", text:string, createdAt:number}>>} */
export async function getAiChatHistory(sceneKey) {
  const all = await withStore("readonly", (store) =>
    requestToPromise(store.index("sceneKey").getAll(IDBKeyRange.only(sceneKey)))
  );
  return (all || []).sort((a, b) => a.seq - b.seq);
}

export async function appendAiChatTurn(sceneKey, { role, text, id = createAiChatTurnId() }) {
  const turn = { id, sceneKey, seq: Date.now(), role, text: String(text || ""), createdAt: Date.now() };
  await withStore("readwrite", (store) => requestToPromise(store.put(turn)));
  return turn;
}

/** Clears every scene's AI chat history — wired into editorCacheClear.js's "清除缓存" modal as its
 * own scope, matching that modal's other scopes (session/recent/baseline/presets/settings), which
 * are also whole-store wipes rather than per-scene. */
export async function clearAllAiChatHistory() {
  await withStore("readwrite", (store) => requestToPromise(store.clear()));
}
