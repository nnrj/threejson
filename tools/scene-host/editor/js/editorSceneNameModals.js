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

export function createEditorSceneNameModals(host) {
  const scenePresetNameModal = document.getElementById("scenePresetNameModal");
  const scenePresetNameModalTitle = document.getElementById("scenePresetNameModalTitle");
  const scenePresetNameInputLabel = document.getElementById("scenePresetNameInputLabel");
  const scenePresetNameModalHint = document.getElementById("scenePresetNameModalHint");
  const scenePresetNameInput = document.getElementById("scenePresetNameInput");
  const scenePresetNameCancelBtn = document.getElementById("scenePresetNameCancelBtn");
  const scenePresetNameConfirmBtn = document.getElementById("scenePresetNameConfirmBtn");

  const sceneSaveAsCopyModal = document.getElementById("sceneSaveAsCopyModal");
  const sceneSaveAsCopyNameInput = document.getElementById("sceneSaveAsCopyNameInput");
  const sceneSaveAsCopyCancelBtn = document.getElementById("sceneSaveAsCopyCancelBtn");
  const sceneSaveAsCopyContinueBtn = document.getElementById("sceneSaveAsCopyContinueBtn");

  function openSceneNameModalAndWait(defaultName, options = {}) {
    const title = String(options.title || "场景名称").trim() || "场景名称";
    const nameLabel = String(options.nameLabel || "名称").trim() || "名称";
    const hint = String(options.hint || "").trim();
    const confirmLabel = String(options.confirmLabel || "确定").trim() || "确定";
    if (scenePresetNameModalTitle) {
      scenePresetNameModalTitle.textContent = title;
    }
    if (scenePresetNameInputLabel) {
      scenePresetNameInputLabel.textContent = nameLabel;
    }
    if (scenePresetNameModalHint) {
      if (hint) {
        scenePresetNameModalHint.textContent = hint;
        scenePresetNameModalHint.removeAttribute("hidden");
      } else {
        scenePresetNameModalHint.textContent = "";
        scenePresetNameModalHint.setAttribute("hidden", "");
      }
    }
    if (scenePresetNameConfirmBtn) {
      scenePresetNameConfirmBtn.textContent = confirmLabel;
    }
    if (scenePresetNameInput) {
      scenePresetNameInput.value = String(defaultName || "");
    }
    scenePresetNameModal?.classList.add("visible");
    requestAnimationFrame(() => {
      scenePresetNameInput?.focus({ preventScroll: true });
      scenePresetNameInput?.select();
    });
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        scenePresetNameModal?.classList.remove("visible");
        scenePresetNameModalHint?.removeAttribute("hidden");
      };
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const onConfirm = () => {
        const raw = String(scenePresetNameInput?.value || "").trim();
        if (!raw) {
          host.showMessage("请输入名称。", "warning");
          return;
        }
        finish(raw);
      };
      const onMask = (event) => {
        if (event.target === scenePresetNameModal) {
          finish(null);
        }
      };
      const dialogPanel = scenePresetNameModal?.querySelector(".tjzExportDialog");
      const stopDialogBubble = (event) => {
        event.stopPropagation();
      };
      const once = { once: true };
      const onInputKeydown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onConfirm();
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      };
      bindEditorModalActionButton(scenePresetNameCancelBtn, () => finish(null));
      bindEditorModalActionButton(scenePresetNameConfirmBtn, onConfirm);
      dialogPanel?.addEventListener("pointerdown", stopDialogBubble, once);
      scenePresetNameModal?.addEventListener("click", onMask, once);
      scenePresetNameInput?.addEventListener("keydown", onInputKeydown, once);
    });
  }

  function openSaveSceneAsCopyModalAndWait(defaultName) {
    if (sceneSaveAsCopyNameInput) {
      sceneSaveAsCopyNameInput.value = String(defaultName || "");
    }
    sceneSaveAsCopyModal?.classList.add("visible");
    requestAnimationFrame(() => {
      sceneSaveAsCopyNameInput?.focus({ preventScroll: true });
      sceneSaveAsCopyNameInput?.select();
    });
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        sceneSaveAsCopyModal?.classList.remove("visible");
      };
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };
      const onContinue = () => {
        const raw = String(sceneSaveAsCopyNameInput?.value || "").trim();
        if (!raw) {
          host.showMessage("请输入场景名称。", "warning");
          return;
        }
        finish(raw);
      };
      const onMask = (event) => {
        if (event.target === sceneSaveAsCopyModal) {
          finish(null);
        }
      };
      const dialogPanel = sceneSaveAsCopyModal?.querySelector(".tjzExportDialog");
      const stopDialogBubble = (event) => {
        event.stopPropagation();
      };
      const once = { once: true };
      const onInputKeydown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onContinue();
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(null);
        }
      };
      bindEditorModalActionButton(sceneSaveAsCopyCancelBtn, () => finish(null));
      bindEditorModalActionButton(sceneSaveAsCopyContinueBtn, onContinue);
      dialogPanel?.addEventListener("pointerdown", stopDialogBubble, once);
      sceneSaveAsCopyModal?.addEventListener("click", onMask, once);
      sceneSaveAsCopyNameInput?.addEventListener("keydown", onInputKeydown, once);
    });
  }

  return {
    openSceneNameModalAndWait,
    openSaveSceneAsCopyModalAndWait
  };
}
