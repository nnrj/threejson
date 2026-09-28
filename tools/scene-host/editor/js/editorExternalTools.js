import { connectSceneEditorBridge } from "../../shared/js/sceneEditorBridge.js";

let connection = null;
export async function toggleEditorExternalTools(host, button) {
  if (connection) { await connection.close(); connection = null; return; }
  const authoring = host.getAuthoringSession?.(), owner = authoring?.session;
  if (!owner) { host.showMessage("请先打开场景。", "warning"); return; }
  const pairingUrl = await host.getSceneNameModals().openSceneNameModalAndWait("", {
    title: "连接本机场景工具", nameLabel: "一次性配对地址", confirmLabel: "允许连接",
    hint: `仅连接您主动启动的本机 CLI。连接后，本机 Agent 可读取和修改当前场景，并使用同一撤销记录；切换场景后需重新配对。CLI: threejson editor-bridge --origin ${location.origin}。` });
  if (!pairingUrl) return;
  const onState = (state, error) => {
    if (button) button.textContent = state === "connected" ? "断开本机场景工具" : "连接本机场景工具…";
    if (state === "disconnected") connection = null;
    if (error) host.showMessage(error.message, "error");
  };
  try {
    connection = await connectSceneEditorBridge({ pairingUrl, onState,
      dispatch: async (method, params, options) => {
        if (authoring.session !== owner || owner.disposed) throw Object.assign(new Error("场景已切换，请重新配对。"), { code: "SESSION_EXPIRED" });
        if (method === "discover") return { ok: true, ...authoring.discover() };
        if (params.sessionId !== authoring.discover().sessionId) throw Object.assign(new Error("请先 discover 当前场景，再带 sessionId 操作。"), { code: "SESSION_ID_MISMATCH" });
        if (method === "execute" || method === "preflight") return authoring[method](params.commands, { ...params, ...options });
        if (method === "undo" || method === "redo") return authoring.executeHistory(method, { ...params, ...options });
        if (method === "export") return { ok: true, revision: owner.revision, json: authoring.export() };
        throw new Error("Unsupported editor operation.");
      } });
  } catch (error) { onState("error", error); }
}
