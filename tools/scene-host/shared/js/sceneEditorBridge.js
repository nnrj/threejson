/** Browser-side opt-in adapter. No MCP, Node, model key or file-system dependency. */
export async function connectSceneEditorBridge({ pairingUrl, dispatch, signal, onState } = {}) {
  const url = new URL(pairingUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.hash) throw new Error("请输入本机 CLI 生成的完整配对地址（含 # 后的一次性令牌）。");
  const base = url.origin, pairingToken = url.hash.slice(1), controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  let token, stopped = false;
  const request = async (pathname, body) => {
    const response = await fetch(base + pathname, { method: body ? "POST" : "GET", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, credentials: "omit" });
    const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || result.code || "Bridge request failed."); return result;
  };
  let paired;
  try { paired = await request("/pair", { token: pairingToken }); token = paired.token; }
  catch (error) { signal?.removeEventListener("abort", abort); throw error; }
  const sleep = () => new Promise((resolve) => { const timer = setTimeout(done, 300); function done() { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); } controller.signal.addEventListener("abort", done, { once: true }); });
  const run = async () => {
    onState?.("connected");
    try {
      while (!controller.signal.aborted && Date.now() < paired.expiresAt) {
        const message = (await request("/editor/poll")).request;
        if (!message) { await sleep(); continue; }
        let result;
        try { result = await dispatch(message.method, message.params, { signal: controller.signal, requestId: message.requestId }); }
        catch (error) { result = { ok: false, code: error.code || "EDITOR_OPERATION_FAILED", error: error.message }; }
        await request("/editor/result", { requestId: message.requestId, result });
      }
    } catch (error) { if (!controller.signal.aborted) onState?.("error", error); }
    finally { stopped = true; signal?.removeEventListener("abort", abort); onState?.("disconnected"); }
  };
  const done = run();
  return { expiresAt: paired.expiresAt, done, async close() {
    if (!stopped) {
      controller.abort();
      await fetch(base + "/editor/disconnect", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}", credentials: "omit", signal: AbortSignal.timeout(3000) }).catch(() => {});
    }
    await done;
  } };
}
