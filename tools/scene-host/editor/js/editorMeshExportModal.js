import { runEditorMeshExport } from "./editorObjectExport.js";

export function createEditorMeshExportModal(host) {
  const modal = document.getElementById("meshExportModal");
  const formatSelect = document.getElementById("meshExportFormatSelect");
  const scopeSelect = document.getElementById("meshExportScopeSelect");

  function open() {
    modal?.classList.add("visible");
  }

  function close() {
    modal?.classList.remove("visible");
  }

  function readOptions() {
    return {
      format: formatSelect?.value || "glb",
      scope: scopeSelect?.value || "scene"
    };
  }

  function init() {
    document.getElementById("meshExportCancelBtn")?.addEventListener("click", () => {
      close();
    });
    document.getElementById("meshExportConfirmBtn")?.addEventListener("click", () => {
      const { format, scope } = readOptions();
      close();
      host.closeAllDropdowns?.();
      void runEditorMeshExport(host, {
        format,
        scope,
        title: `导出 ${String(format).toUpperCase()}`
      });
    });
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) {
        close();
      }
    });
    document.getElementById("menuExportMeshGlbScene")?.addEventListener("click", () => {
      void runEditorMeshExport(host, {
        format: "glb",
        scope: "scene",
        title: "导出 GLB（整场景）"
      });
      host.closeAllDropdowns?.();
    });
    document.getElementById("menuExportMeshGlbSelection")?.addEventListener("click", () => {
      void runEditorMeshExport(host, {
        format: "glb",
        scope: "selection",
        title: "导出 GLB（选中对象）"
      });
      host.closeAllDropdowns?.();
    });
    document.getElementById("menuExportMeshMore")?.addEventListener("click", () => {
      open();
      host.closeAllDropdowns?.();
    });
  }

  return { init, open, close };
}
