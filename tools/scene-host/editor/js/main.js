import { bootstrapSceneHostEditor } from "./editorApp.js";

bootstrapSceneHostEditor().catch((error) => {
  console.error("[scene-editor editor]", error);
  const box = document.getElementById("messageBox");
  if (box) {
    box.textContent = `编辑器启动失败：${error?.message || error}`;
    box.className = "error";
    box.style.display = "block";
  }
});
