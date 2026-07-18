import { showToast } from "./threeBoxUiFeedback.js";
import { processUploadedFile, acceptForKind } from "./threeBoxUploadHandler.js";
import { putResource, createResourceId } from "./threeBoxSessionStore.js";
import { t, getHostLocale } from "../../shared/i18n/index.js";

/** Reuses the sidebar's attach-kind catalog entries (threebox.shell.attachKind*) so kind labels
 * stay in one place — computed fresh on each call rather than once at module-load time, since the
 * locale catalog may not be loaded yet when this module is first evaluated. */
function getKindLabels() {
  return {
    json: t("threebox.shell.attachKindJson", "场景 JSON"),
    tjz: t("threebox.shell.attachKindTjz", "场景 .tjz 包"),
    image: t("threebox.shell.attachKindImage", "图片"),
    model: t("threebox.shell.attachKindModel", "三方模型"),
    other: t("threebox.shell.attachKindOther", "其他文件")
  };
}

/** Infers an attach-kind from a dropped file's extension, for drag-drop (which has no explicit
 * type-menu step) — falls back to "other" for anything unrecognized. */
function inferKindFromFileName(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".tjz")) return "tjz";
  if (lower.endsWith(".json") || lower.endsWith(".threejson") || lower.endsWith(".tjson")) return "json";
  if (/\.(gltf|glb|obj|fbx)$/.test(lower)) return "model";
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return "image";
  return "other";
}

/**
 * Composer attach flow: clicking the + button opens a type-choice menu (场景JSON / .tjz包 / 图片 /
 * 三方模型 / 其他文件); the chosen kind narrows the file picker's `accept` filter and drives how
 * the selected file is processed. JSON/.tjz/3rd-party-model uploads are parsed into a scene JSON
 * (threeBoxUploadHandler.js) and auto-loaded as the composer's attached context (same effect as
 * clicking a template); every upload is cached to the resource library regardless of kind.
 * Drag-drop bypasses the type menu and infers the kind from the file extension instead.
 * @param {{ getVisionCapable?: () => boolean, attachedContext?: object, onResourceAdded?: () => void }} [host]
 */
export function wireThreeBoxComposerStub(host = {}) {
  const composerInput = document.getElementById("composerInput");
  const composerAttachBtn = document.getElementById("composerAttachBtn");
  const composerFileInput = document.getElementById("composerFileInput");
  const chatComposer = document.getElementById("chatComposer");
  const suggestions = document.getElementById("chatHeroSuggestions");
  const attachTypeMenu = document.getElementById("attachTypeMenu");

  let pendingKind = "other";

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
      const localizedPrompt = getHostLocale() === "en-US" ? chip.dataset.promptEn : chip.dataset.prompt;
      composerInput.value = localizedPrompt || chip.dataset.prompt || chip.textContent || "";
      composerInput.focus();
      autoGrow();
    });
  });

  function checkVisionGate() {
    if (host.getVisionCapable && !host.getVisionCapable()) {
      showToast(
        t(
          "threebox.composer.visionUnsupported",
          "当前选择的模型供应商不支持图片输入，无法添加图片。请在发送按钮左侧切换到支持视觉的供应商。"
        ),
        "warning"
      );
      return false;
    }
    return true;
  }

  function closeAttachTypeMenu() {
    if (attachTypeMenu) {
      attachTypeMenu.hidden = true;
    }
  }

  function openAttachTypeMenu() {
    if (!attachTypeMenu || !composerAttachBtn) {
      return;
    }
    attachTypeMenu.hidden = false;
    const btnRect = composerAttachBtn.getBoundingClientRect();
    const menuRect = attachTypeMenu.getBoundingClientRect();
    let top = btnRect.top - menuRect.height - 8;
    if (top < 8) {
      top = btnRect.bottom + 8;
    }
    attachTypeMenu.style.left = `${Math.max(8, Math.round(btnRect.left))}px`;
    attachTypeMenu.style.top = `${Math.max(8, Math.round(top))}px`;
  }

  async function persistAndAttach(result) {
    const resource = {
      id: createResourceId(),
      kind: result.kind,
      name: result.name,
      sceneJson: result.sceneJson ? JSON.stringify(result.sceneJson) : null,
      blob: result.sceneJson ? null : result.file,
      createdAt: Date.now()
    };
    await putResource(resource).catch(() => {});
    host.onResourceAdded?.();

    if (result.sceneJson && host.attachedContext) {
      host.attachedContext.setTemplate({ id: resource.id, title: result.name }, result.sceneJson);
      showToast(t("threebox.composer.loadedAsContext", "已加载「{name}」作为上下文。", { name: result.name }), "success");
    } else {
      showToast(t("threebox.composer.savedToLibrary", "已保存「{name}」到资源库。", { name: result.name }), "success");
    }
  }

  async function handleFilesWithKind(fileList, kind) {
    const files = Array.from(fileList || []);
    if (!files.length) {
      return;
    }
    if (kind === "image" && !checkVisionGate()) {
      return;
    }
    for (const file of files) {
      showToast(t("threebox.composer.processing", "正在处理「{name}」…", { name: file.name }), "info");
      try {
        const result = await processUploadedFile(file, kind);
        await persistAndAttach(result);
      } catch (error) {
        showToast(
          t("threebox.composer.processingFailed", "处理「{name}」失败：{error}", {
            name: file.name,
            error: error?.message || error
          }),
          "error"
        );
      }
    }
  }

  composerAttachBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (attachTypeMenu?.hidden === false) {
      closeAttachTypeMenu();
      return;
    }
    openAttachTypeMenu();
  });

  attachTypeMenu?.querySelectorAll("button[data-kind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.kind;
      closeAttachTypeMenu();
      if (kind === "library") {
        revealResourceLibrary();
        return;
      }
      if (kind === "image" && !checkVisionGate()) {
        return;
      }
      pendingKind = kind;
      if (composerFileInput) {
        composerFileInput.accept = acceptForKind(kind);
        composerFileInput.click();
      }
    });
  });

  /** "从资源库选择": rather than re-uploading, points the user at the already-visible sidebar
   * resource library (threeBoxResourceLibrary.js) where loadable resources (json/tjz/model) can
   * be clicked directly to attach as context — same click handler the library already has. */
  function revealResourceLibrary() {
    const section = document.getElementById("resourceLibrarySection");
    if (!section) {
      return;
    }
    section.open = true;
    section.scrollIntoView({ behavior: "smooth", block: "nearest" });
    section.classList.add("sidebarSectionHighlight");
    window.setTimeout(() => section.classList.remove("sidebarSectionHighlight"), 1500);
    showToast(
      t("threebox.composer.pickFromLibraryHint", "点击资源库中的条目即可直接附加，无需重新上传。"),
      "info"
    );
  }

  document.addEventListener("click", (event) => {
    if (attachTypeMenu && !attachTypeMenu.hidden && !attachTypeMenu.contains(event.target) && event.target !== composerAttachBtn) {
      closeAttachTypeMenu();
    }
  });

  composerFileInput?.addEventListener("change", () => {
    if (composerFileInput.files?.length) {
      void handleFilesWithKind(composerFileInput.files, pendingKind);
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
      const files = Array.from(event.dataTransfer?.files || []);
      // Drag-drop has no explicit type-menu step — group by inferred kind so a mixed drop still
      // routes each file correctly instead of guessing a single kind for the whole batch.
      const byKind = new Map();
      for (const file of files) {
        const kind = inferKindFromFileName(file.name);
        if (!byKind.has(kind)) {
          byKind.set(kind, []);
        }
        byKind.get(kind).push(file);
      }
      for (const [kind, kindFiles] of byKind) {
        void handleFilesWithKind(kindFiles, kind);
      }
    });
  }
}

export { getKindLabels };
