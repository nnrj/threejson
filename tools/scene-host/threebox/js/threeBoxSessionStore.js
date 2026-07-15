/**
 * ThreeBox's own IndexedDB database — entirely separate from the Scene Editor's
 * ("threejson_scene_editor", see tools/scene-host/shared/js/editorSessionIdb.js). Four object
 * stores:
 * - "turns" (keyed by turn id): { id, conversationId, seq, userPrompt, mode: 'generate'|'adjust'|
 *   'template', targetTurnId, stage ('generate'|'template'|'commands'|'json-incremental'|
 *   'json-full'|'error'), status ('failed'|'stopped' for unsuccessful turns; omitted for legacy/
 *   successful turns), errorMessage, sceneJson (string|null — the full scene snapshot; null when this turn was
 *   cached in "diff" mode as a commands-only delta, see threeBoxSettingsSchema.js's
 *   io.turnCacheMode), commands (array|null — the operation commands that produced this turn's
 *   result, only present for stage:"commands" turns; used to reconstruct sceneJson by replaying
 *   from the nearest earlier turn that still has a full sceneJson — see
 *   threeBoxTurnReconstruction.js), spatialSummary, recapSummary, sceneTitle (string — AI-generated
 *   short scene title when settings.ai.autoGenerateSceneTitle is on, else ""; used as the scene
 *   card's label/download file name, both live and on conversation-switch replay — see
 *   threeBoxApp.js), createdAt }.
 * - "resources" (keyed by resource id): user-uploaded files from the composer's attach menu —
 *   { id, kind: 'json'|'tjz'|'image'|'model'|'other', name, sceneJson (string, only for
 *   json/tjz/model — the auto-loadable kinds), blob (raw File, only for image/other/model —
 *   kept so a model's externalModel record's blob: URL can be re-derived if needed), createdAt }.
 * - "conversations" (keyed by conversation id): sidebar history-list metadata — { id, title,
 *   updatedAt, pinned, archived, projectId }. Previously in-memory only in threeBoxSidebar.js,
 *   which meant the whole "聊天历史" list vanished on every page refresh even though the
 *   underlying turns were safely cached — this store fixes that.
 * - "projects" (keyed by project id): { id, name }.
 */
const DB_NAME = "threejson_threebox";
const DB_VERSION = 3;
const STORE_TURNS = "turns";
const STORE_RESOURCES = "resources";
const STORE_CONVERSATIONS = "conversations";
const STORE_PROJECTS = "projects";

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
      if (!db.objectStoreNames.contains(STORE_RESOURCES)) {
        const store = db.createObjectStore(STORE_RESOURCES, { keyPath: "id" });
        store.createIndex("kind", "kind", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
        db.createObjectStore(STORE_CONVERSATIONS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function putTurn(turn) {
  await withStore(STORE_TURNS, "readwrite", (store) => store.put(turn));
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
  await withStore(STORE_TURNS, "readwrite", (store) => {
    for (const turn of turns) {
      store.delete(turn.id);
    }
  });
}

export function createTurnId() {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function putResource(resource) {
  await withStore(STORE_RESOURCES, "readwrite", (store) => store.put(resource));
  return resource;
}

export async function getResource(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RESOURCES, "readonly");
    const req = tx.objectStore(STORE_RESOURCES).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllResources() {
  const list = await getAll(STORE_RESOURCES);
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteResource(id) {
  await withStore(STORE_RESOURCES, "readwrite", (store) => store.delete(id));
}

export function createResourceId() {
  return `res-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function putConversation(conversation) {
  await withStore(STORE_CONVERSATIONS, "readwrite", (store) => store.put(conversation));
  return conversation;
}

export async function getAllConversations() {
  return getAll(STORE_CONVERSATIONS);
}

export async function deleteConversation(id) {
  await withStore(STORE_CONVERSATIONS, "readwrite", (store) => store.delete(id));
}

export async function putProject(project) {
  await withStore(STORE_PROJECTS, "readwrite", (store) => store.put(project));
  return project;
}

export async function getAllProjects() {
  return getAll(STORE_PROJECTS);
}
