/**
 * Composer attach flow, ported from tools/scene-host/threebox/js/threeBoxComposerStub.js (attach
 * half only — the textarea value and provider picker are owned by App.jsx). Clicking the + button
 * opens a type menu (场景JSON / .tjz包 / 图片 / 三方模型 / 其他文件 / 从资源库选择); the chosen kind
 * narrows the file picker's accept filter and drives how the file is processed. json/tjz/model
 * uploads are parsed into a scene and auto-attached as the composer's context (same effect as
 * picking a template); every upload is cached to the resource library regardless of kind.
 * Drag-drop bypasses the menu and infers the kind from the file extension.
 *
 * @param {{ getVisionCapable?: () => boolean, onResourceAdded?: () => void,
 *           attachedContext?: { setTemplate: (item: {id:string,title?:string}, sceneJson: object) => void },
 *           showToast?: (msg: string, kind?: string) => void }} [host]
 */
import { useCallback, useRef, useState } from "react";
import { t } from "@threejson/host-kit/i18n/index.js";
import { acceptForKind, processUploadedSceneFile } from "@threejson/host-kit/js/sceneFileUpload.js";
import { enqueueSceneAgentLoad } from "@threejson/react-scene-agent/scene-load-queue";
import { putResource, createResourceId } from "./lib/sceneAgentRepository.js";

/** Matches threeBoxComposerStub.js's attach-type menu order exactly (json/tjz/image/model/other). */
export const ATTACH_KIND_ORDER = [
  { kind: "json", labelKey: "threebox.shell.attachKindJson", fallback: "场景 JSON" },
  { kind: "tjz", labelKey: "threebox.shell.attachKindTjz", fallback: "场景 .tjz 包" },
  { kind: "image", labelKey: "threebox.shell.attachKindImage", fallback: "图片" },
  { kind: "model", labelKey: "threebox.shell.attachKindModel", fallback: "三方模型" },
  { kind: "other", labelKey: "threebox.shell.attachKindOther", fallback: "其他文件" }
];

/** Infers an attach-kind from a dropped file's extension, for drag-drop (no type-menu step). */
function inferKindFromFileName(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".tjz")) return "tjz";
  if (lower.endsWith(".json") || lower.endsWith(".threejson") || lower.endsWith(".tjson")) return "json";
  if (/\.(gltf|glb|obj|fbx)$/.test(lower)) return "model";
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(lower)) return "image";
  return "other";
}

export function useComposerAttach(host = {}) {
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef(null);
  const pendingKindRef = useRef("other");
  const dragDepthRef = useRef(0);
  const hostRef = useRef(host);
  hostRef.current = host;

  const showToast = useCallback((msg, kind) => hostRef.current.showToast?.(msg, kind), []);

  function checkVisionGate() {
    if (hostRef.current.getVisionCapable && !hostRef.current.getVisionCapable()) {
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
    hostRef.current.onResourceAdded?.();

    if (result.sceneJson && hostRef.current.attachedContext) {
      hostRef.current.attachedContext.setTemplate({ id: resource.id, title: result.name }, result.sceneJson);
      showToast(t("threebox.composer.loadedAsContext", "已加载「{name}」作为上下文。", { name: result.name }), "success");
    } else {
      showToast(t("threebox.composer.savedToLibrary", "已保存「{name}」到资源库。", { name: result.name }), "success");
    }
  }

  const handleFilesWithKind = useCallback(async (fileList, kind) => {
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
        const parse = () => processUploadedSceneFile(file, kind);
        const result = kind === "tjz" || kind === "model"
          ? await enqueueSceneAgentLoad(parse)
          : await parse();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeAttachMenu = useCallback(() => setAttachMenuOpen(false), []);
  const toggleAttachMenu = useCallback(() => setAttachMenuOpen((v) => !v), []);

  /** "从资源库选择": points at the sidebar's resource library section rather than re-uploading. */
  function revealResourceLibrary() {
    const section = document.getElementById("resourceLibrarySection");
    if (!section) {
      return;
    }
    section.open = true;
    section.scrollIntoView({ behavior: "smooth", block: "nearest" });
    section.classList.add("sidebarSectionHighlight");
    window.setTimeout(() => section.classList.remove("sidebarSectionHighlight"), 1500);
    showToast(t("threebox.composer.pickFromLibraryHint", "点击资源库中的条目即可直接附加，无需重新上传。"), "info");
  }

  const chooseKind = useCallback((kind) => {
    setAttachMenuOpen(false);
    if (kind === "library") {
      revealResourceLibrary();
      return;
    }
    if (kind === "image" && !checkVisionGate()) {
      return;
    }
    pendingKindRef.current = kind;
    const input = fileInputRef.current;
    if (input) {
      input.accept = acceptForKind(kind);
      input.click();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileInputChange = useCallback(() => {
    const input = fileInputRef.current;
    if (input?.files?.length) {
      void handleFilesWithKind(input.files, pendingKindRef.current);
      input.value = "";
    }
  }, [handleFilesWithKind]);

  const handleDragEnter = useCallback((event) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  }, []);
  const handleDragOver = useCallback((event) => {
    event.preventDefault();
  }, []);
  const handleDragLeave = useCallback(() => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDragOver(false);
    }
  }, []);
  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragOver(false);
      const files = Array.from(event.dataTransfer?.files || []);
      // Group a mixed drop by inferred kind so each file routes correctly.
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
    },
    [handleFilesWithKind]
  );

  return {
    attachMenuOpen,
    dragOver,
    fileInputRef,
    closeAttachMenu,
    toggleAttachMenu,
    chooseKind,
    handleFileInputChange,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop
  };
}
