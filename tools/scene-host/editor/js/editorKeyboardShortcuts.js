export function bindEditorKeyboardShortcuts(host) {
  function isCodeEditorFocused() {
    return host.getCodeEditor()?.isCodeMirrorFocused?.() === true;
  }

  function onKeyDown(event) {
    if (event.key === "F5") {
      event.preventDefault();
      void host.getRunScenePreview?.()?.runScene?.();
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.altKey) {
      return;
    }
    if (isCodeEditorFocused()) {
      return;
    }
    const key = String(event.key || "").toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      void host.getEditorHistory()?.undo?.();
      return;
    }
    if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      void host.getEditorHistory()?.redo?.();
      return;
    }
    if (key === "s" && !event.shiftKey) {
      event.preventDefault();
      void host.getSceneDocumentOps?.()?.saveCurrentSceneDocument?.();
    }
  }

  document.addEventListener("keydown", onKeyDown);

  return () => {
    document.removeEventListener("keydown", onKeyDown);
  };
}
