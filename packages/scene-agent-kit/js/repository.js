const DB_VERSION = 3;
const STORES = Object.freeze({ turns: "turns", resources: "resources", conversations: "conversations", projects: "projects" });

export function createSceneAgentRepository({ dbName, indexedDb = globalThis.indexedDB } = {}) {
  const resolvedDbName = String(dbName || "").trim();
  if (!resolvedDbName) throw new Error("createSceneAgentRepository requires a non-empty dbName.");
  let dbPromise = null;

  function available() { return Boolean(indexedDb); }
  function openDb() {
    if (!available()) return Promise.reject(new Error("IndexedDB is unavailable."));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDb.open(resolvedDbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORES.turns)) {
          const store = db.createObjectStore(STORES.turns, { keyPath: "id" });
          store.createIndex("conversationId", "conversationId", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.resources)) {
          const store = db.createObjectStore(STORES.resources, { keyPath: "id" });
          store.createIndex("kind", "kind", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.conversations)) db.createObjectStore(STORES.conversations, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORES.projects)) db.createObjectStore(STORES.projects, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function withStore(storeName, mode, operation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      operation(tx.objectStore(storeName));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function getOne(storeName, id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function getAll(storeName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function getTurnsForConversation(conversationId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORES.turns, "readonly").objectStore(STORES.turns)
        .index("conversationId").getAll(conversationId);
      request.onsuccess = () => resolve((request.result || []).sort((left, right) => left.seq - right.seq));
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteTurnsForConversation(conversationId) {
    const turns = await getTurnsForConversation(conversationId);
    await withStore(STORES.turns, "readwrite", (store) => turns.forEach((turn) => store.delete(turn.id)));
  }

  return {
    dbName: resolvedDbName,
    available,
    async putTurn(turn) { await withStore(STORES.turns, "readwrite", (store) => store.put(turn)); return turn; },
    getTurn: (id) => getOne(STORES.turns, id),
    getTurnsForConversation,
    getAllTurns: () => getAll(STORES.turns),
    deleteTurnsForConversation,
    async putResource(resource) { await withStore(STORES.resources, "readwrite", (store) => store.put(resource)); return resource; },
    getResource: (id) => getOne(STORES.resources, id),
    async getAllResources() { return (await getAll(STORES.resources)).sort((a, b) => b.createdAt - a.createdAt); },
    deleteResource: (id) => withStore(STORES.resources, "readwrite", (store) => store.delete(id)),
    async putConversation(conversation) { await withStore(STORES.conversations, "readwrite", (store) => store.put(conversation)); return conversation; },
    getConversation: (id) => getOne(STORES.conversations, id),
    getAllConversations: () => getAll(STORES.conversations),
    async deleteConversation(id) {
      await deleteTurnsForConversation(id);
      await withStore(STORES.conversations, "readwrite", (store) => store.delete(id));
    },
    async putProject(project) { await withStore(STORES.projects, "readwrite", (store) => store.put(project)); return project; },
    getAllProjects: () => getAll(STORES.projects),
    resetConnection() { dbPromise = null; }
  };
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const createTurnId = () => createId("turn");
export const createResourceId = () => createId("res");
export const createConversationId = () => createId("conv");
export const createProjectId = () => createId("proj");
