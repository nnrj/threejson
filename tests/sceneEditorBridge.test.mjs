import test from "node:test";
import assert from "node:assert/strict";
import { startEditorBridge, callEditorBridge } from "../packages/scene-tools/js/editor-bridge.js";

test("localhost editor pairing is one-use, origin-bound, explicit and reconciles request IDs", async () => {
  const origin = "http://localhost:5173", bridge = await startEditorBridge({ origin });
  const browser = (url, body, token, from = origin) => fetch(bridge.url + url, { method: body ? "POST" : "GET", headers: { Origin: from, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }).then((res) => res.json());
  const token = new URL(bridge.pairingUrl).hash.slice(1);
  try {
    assert.equal((await callEditorBridge({ url: bridge.url, token: bridge.agentToken, method: "discover" })).code, "EDITOR_NOT_PAIRED");
    assert.equal((await browser("/pair", { token }, null, "https://unexpected.invalid")).code, "BRIDGE_ORIGIN_REJECTED");
    const pair = await browser("/pair", { token }); assert.equal(pair.ok, true);
    assert.equal((await browser("/pair", { token })).code, "PAIRING_REJECTED");
    const request = { url: bridge.url, token: bridge.agentToken, method: "execute", params: { commands: [{ op: "scene.query" }] }, requestId: "edit-1" };
    assert.equal((await callEditorBridge(request)).status, "queued");
    assert.equal((await callEditorBridge(request)).status, "queued");
    assert.equal((await callEditorBridge({ ...request, method: "undo" })).code, "REQUEST_ID_CONFLICT");
    assert.equal((await browser("/editor/poll", null, pair.token)).request.requestId, "edit-1");
    assert.equal((await browser("/editor/poll", null, pair.token)).request, null);
    await browser("/editor/result", { requestId: "edit-1", result: { ok: true, revision: 1 } }, pair.token);
    const receipt = await callEditorBridge({ url: bridge.url, token: bridge.agentToken, requestId: "edit-1" });
    assert.equal(receipt.result.revision, 1); assert.equal(receipt.status, "completed");
    await browser("/editor/disconnect", {}, pair.token);
    assert.equal((await callEditorBridge({ ...request, requestId: "edit-2" })).code, "EDITOR_NOT_PAIRED");
  } finally { await bridge.close(); }
});
