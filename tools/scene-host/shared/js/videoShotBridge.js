import { createEditorStorage } from "./videoProjectStorage.js";

/** Loaded only when the ordinary scene editor is opened from a video project. */
export async function readVideoShotHandoff(token) {
  const storage = await createEditorStorage();
  try {
    const record = await storage.getHandoff(token);
    if (record?.type !== "scene-edit" || !record.sceneJson) throw new Error("镜头编辑请求不存在或已失效。");
    return record;
  } finally { storage.close(); }
}
export function mountVideoShotReturn({ token, capture, showMessage }) {
  const button = document.createElement("button"); button.type = "button"; button.textContent = "应用到视频工程";
  button.style.cssText = "position:fixed;right:16px;top:54px;z-index:1200;padding:9px 14px;background:#85e4d0;color:#102822;border:1px solid #48796e;border-radius:6px;cursor:pointer;font:13px system-ui;max-width:calc(100vw - 32px)";
  button.addEventListener("click", async () => {
    button.disabled = true;
    let storage;
    try {
      const text = await capture(), sceneJson = typeof text === "string" ? JSON.parse(text) : text;
      if (!sceneJson || typeof sceneJson !== "object") throw new Error("当前镜头无法导出。");
      storage = await createEditorStorage(); await storage.saveHandoff(`${token}:reply`, { sceneJson, returnedAt: Date.now() });
      const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("threejson-video-editor") : null;
      channel?.postMessage({ action: "shot-return", token }); channel?.close();
      showMessage("镜头已发送。请回到视频编辑器检查应用结果；若工程版本冲突，不会覆盖新修改。", "success");
    } catch (error) { showMessage(`镜头返回失败：${error.message}`, "error"); }
    finally { storage?.close(); button.disabled = false; }
  });
  document.body.append(button); return () => button.remove();
}
