/** Generic, reusable yes/no confirm dialog styled like the editor's other custom modals
 * (.tjzExportDialog — see editorOverwriteModal/scenePresetNameModal in _shell-body.html), so every
 * "are you sure?" in the app looks consistent instead of a jarring native window.confirm() popup.
 * Native browser dialogs are kept ONLY for beforeunload (editorSessionRecovery.js) — that one is
 * enforced by the browser itself and can't be replaced. */

function bindEditorModalActionButton(button, handler) {
  if (!button || typeof handler !== "function") {
    return;
  }
  const onAction = (event) => {
    event.preventDefault();
    event.stopPropagation();
    handler();
  };
  button.addEventListener("pointerdown", onAction, { once: true });
}

export function createEditorConfirmModal() {
  const modal = document.getElementById("editorConfirmModal");
  const titleEl = document.getElementById("editorConfirmModalTitle");
  const messageEl = document.getElementById("editorConfirmModalMessage");
  const cancelBtn = document.getElementById("editorConfirmModalCancelBtn");
  const confirmBtn = document.getElementById("editorConfirmModalConfirmBtn");

  /**
   * @param {string} message
   * @param {{ title?: string, confirmLabel?: string, cancelLabel?: string }} [options]
   * @returns {Promise<boolean>} true if confirmed, false if cancelled/dismissed
   */
  function openConfirmModalAndWait(message, options = {}) {
    const title = String(options.title || "确认").trim() || "确认";
    const confirmLabel = String(options.confirmLabel || "确定").trim() || "确定";
    const cancelLabel = String(options.cancelLabel || "取消").trim() || "取消";
    if (titleEl) {
      titleEl.textContent = title;
    }
    if (messageEl) {
      messageEl.textContent = String(message || "");
    }
    if (confirmBtn) {
      confirmBtn.textContent = confirmLabel;
    }
    if (cancelBtn) {
      cancelBtn.textContent = cancelLabel;
    }
    modal?.classList.add("visible");
    requestAnimationFrame(() => confirmBtn?.focus({ preventScroll: true }));

    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        modal?.classList.remove("visible");
        document.removeEventListener("keydown", onKeydown);
      };
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const onMask = (event) => {
        if (event.target === modal) {
          finish(false);
        }
      };
      const onKeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        } else if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        }
      };
      const dialogPanel = modal?.querySelector(".tjzExportDialog");
      const stopDialogBubble = (event) => {
        event.stopPropagation();
      };
      const once = { once: true };
      bindEditorModalActionButton(cancelBtn, () => finish(false));
      bindEditorModalActionButton(confirmBtn, () => finish(true));
      dialogPanel?.addEventListener("pointerdown", stopDialogBubble, once);
      modal?.addEventListener("click", onMask, once);
      document.addEventListener("keydown", onKeydown);
    });
  }

  return { openConfirmModalAndWait };
}
