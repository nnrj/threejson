export function createEditorExportDownload(host) {
  const modal = document.getElementById("exportFilenameModal");
  const titleEl = document.getElementById("exportFilenameModalTitle");
  const inputEl = document.getElementById("exportFilenameInput");
  const cancelBtn = document.getElementById("exportFilenameCancelBtn");
  const confirmBtn = document.getElementById("exportFilenameConfirmBtn");

  function shouldPromptExportFilename() {
    return host.getEditorSettings()?.io?.promptExportFilename !== false;
  }

  function sanitizeExportFilename(name) {
    const cleaned = String(name || "")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/[\u0000-\u001f\u007f]+/g, "");
    return cleaned || "export";
  }

  function ensureExportFilenameExtension(name, defaultFilename) {
    const fallback = String(defaultFilename || "");
    const dot = fallback.lastIndexOf(".");
    if (dot <= 0 || dot === fallback.length - 1) {
      return name;
    }
    const ext = fallback.slice(dot);
    if (name.toLowerCase().endsWith(ext.toLowerCase())) {
      return name;
    }
    if (!name.includes(".")) {
      return `${name}${ext}`;
    }
    return name;
  }

  function openExportFilenameModalAndWait(defaultFilename, options = {}) {
    const title = String(options.title || "导出文件").trim() || "导出文件";
    if (titleEl) {
      titleEl.textContent = title;
    }
    if (inputEl) {
      inputEl.value = String(defaultFilename || "");
    }
    modal?.classList.add("visible");
    requestAnimationFrame(() => {
      inputEl?.focus({ preventScroll: true });
      inputEl?.select();
    });
    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        modal?.classList.remove("visible");
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
        const raw = inputEl?.value ?? "";
        const sanitized = sanitizeExportFilename(raw);
        if (!String(raw || "").trim()) {
          finish(null);
          return;
        }
        finish(ensureExportFilenameExtension(sanitized, defaultFilename));
      };
      const onMask = (event) => {
        if (event.target === modal) {
          finish(null);
        }
      };
      const dialogPanel = modal?.querySelector(".tjzExportDialog");
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
      cancelBtn?.addEventListener("click", () => finish(null), once);
      confirmBtn?.addEventListener("click", onConfirm, once);
      dialogPanel?.addEventListener("pointerdown", stopDialogBubble, once);
      modal?.addEventListener("click", onMask, once);
      inputEl?.addEventListener("keydown", onInputKeydown, once);
    });
  }

  async function resolveExportFilename(defaultFilename, options = {}) {
    if (options.promptFilename === false || !shouldPromptExportFilename()) {
      return ensureExportFilenameExtension(sanitizeExportFilename(defaultFilename), defaultFilename);
    }
    return openExportFilenameModalAndWait(defaultFilename, options);
  }

  async function triggerBlobDownload(blob, defaultFilename, options = {}) {
    const filename = await resolveExportFilename(defaultFilename, options);
    if (!filename) {
      return false;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  }

  async function downloadJsonText(text, defaultFilename, options = {}) {
    const blob = new Blob([text], { type: "application/json" });
    return triggerBlobDownload(blob, defaultFilename, options);
  }

  return {
    triggerBlobDownload,
    downloadJsonText,
    resolveExportFilename
  };
}
