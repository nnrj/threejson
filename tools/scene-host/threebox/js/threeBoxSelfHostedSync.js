/** Optional self-hosted conversation sync. Its server owns auth and retention. GET
 * /conversations returns {items}; POST /conversations/sync receives {protocolVersion,clientId,items}.
 * Merge is last-write-wins by conversation.updatedAt and never deletes a local record. */
import { getAllConversations, getTurnsForConversation, putConversation, putTurn } from "./threeBoxSessionStore.js";

function localClientId() {
  const key = "threejson.threebox.selfHostedSync.clientId";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

export function createThreeBoxSelfHostedSync(settingsProvider) {
  let timer = null;
  const config = () => {
    const sync = settingsProvider?.()?.sync || {};
    return { enabled: sync.enabled === true, endpoint: String(sync.endpoint || "").replace(/\/$/, ""), accessToken: String(sync.accessToken || "") };
  };
  async function request(path, init = {}) {
    const current = config();
    if (!current.enabled || !current.endpoint) throw new Error("SELF_HOSTED_SYNC_NOT_CONFIGURED");
    const response = await fetch(`${current.endpoint}${path}`, { headers: { "Content-Type": "application/json", ...(current.accessToken ? { Authorization: `Bearer ${current.accessToken}` } : {}), ...(init.headers || {}) }, ...init });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.error || "SELF_HOSTED_SYNC_FAILED");
    return body;
  }
  async function snapshot() {
    return Promise.all((await getAllConversations()).map(async (conversation) => ({ conversation, turns: await getTurnsForConversation(conversation.id) })));
  }
  async function merge(items) {
    const localById = new Map((await getAllConversations()).map((entry) => [entry.id, entry]));
    for (const item of Array.isArray(items) ? items : []) {
      const remote = item?.conversation;
      if (!remote?.id || Number(localById.get(remote.id)?.updatedAt || 0) > Number(remote.updatedAt || 0)) continue;
      await putConversation(remote);
      for (const turn of Array.isArray(item.turns) ? item.turns : []) await putTurn(turn);
    }
  }
  async function syncNow() {
    const pulled = await request("/conversations");
    await merge(pulled.items);
    return request("/conversations/sync", { method: "POST", body: JSON.stringify({ protocolVersion: 1, clientId: localClientId(), items: await snapshot() }) });
  }
  return {
    isConfigured: () => { const current = config(); return current.enabled && Boolean(current.endpoint); },
    syncNow,
    scheduleSync() { if (!this.isConfigured()) return; clearTimeout(timer); timer = setTimeout(() => void syncNow().catch((error) => console.warn("[threebox sync]", error)), 1200); }
  };
}
