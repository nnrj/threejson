import { showToast } from "./threeBoxUiFeedback.js";

/**
 * Composer bits that stay stubs for now: attach/upload UI + drag-drop (no vision-generation
 * backend wiring yet — see the "image understanding" TODO below), suggestion-chip fill, and
 * textarea auto-grow. Send/Enter-to-send is owned by threeBoxChatPanel.js (real logic).
 * @param {{ getVisionCapable?: () => boolean }} [host] host.getVisionCapable checks whether the
 *   currently-selected AI provider accepts image input (threeBoxOrchestrator.js's
 *   isProviderVisionCapable) — gates both the attach button and drag-drop per the product
 *   requirement that adding an image should be blocked (with an explanation) rather than silently
 *   failing later when the provider rejects the request.
 */
export function wireThreeBoxComposerStub(host = {}) {
  const composerInput = document.getElementById("composerInput");
  const composerAttachBtn = document.getElementById("composerAttachBtn");
  const composerFileInput = document.getElementById("composerFileInput");
  const chatComposer = document.getElementById("chatComposer");
  const suggestions = document.getElementById("chatHeroSuggestions");

  function autoGrow() {
    if (!composerInput) {
      return;
    }
    composerInput.style.height = "auto";
    composerInput.style.height = `${Math.min(200, composerInput.scrollHeight)}px`;
  }

  composerInput?.addEventListener("input", autoGrow);

  suggestions?.querySelectorAll(".chatSuggestionChip").forEach((chip) => {
    chip.addEventListener("click", () => {
      if (!composerInput) {
        return;
      }
      composerInput.value = chip.dataset.prompt || chip.textContent || "";
      composerInput.focus();
      autoGrow();
    });
  });

  function checkVisionGate() {
    if (host.getVisionCapable && !host.getVisionCapable()) {
      showToast("当前选择的模型供应商不支持图片输入，无法添加图片。请在发送按钮左侧切换到支持视觉的供应商。", "warning");
      return false;
    }
    return true;
  }

  function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      showToast("目前仅支持拖入图片文件。", "info");
      return;
    }
    if (!checkVisionGate()) {
      return;
    }
    // TODO: wire actual image-understanding generation (generateSceneJsonFromImage) — this
    // milestone only ships the attach UI + capability gate, per product scope for this batch.
    showToast(`已选择 ${imageFiles.length} 张图片（看图生成将在后续里程碑接入）。`, "info");
  }

  composerAttachBtn?.addEventListener("click", () => {
    if (!checkVisionGate()) {
      return;
    }
    composerFileInput?.click();
  });
  composerFileInput?.addEventListener("change", () => {
    if (composerFileInput.files?.length) {
      handleFiles(composerFileInput.files);
      composerFileInput.value = "";
    }
  });

  if (chatComposer) {
    let dragDepth = 0;
    chatComposer.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dragDepth += 1;
      chatComposer.classList.add("dragOver");
    });
    chatComposer.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    chatComposer.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        chatComposer.classList.remove("dragOver");
      }
    });
    chatComposer.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      chatComposer.classList.remove("dragOver");
      handleFiles(event.dataTransfer?.files);
    });
  }
}
