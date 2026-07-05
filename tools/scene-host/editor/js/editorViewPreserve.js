export function createEditorViewPreserve(host) {
  let captureTimer = null;

  function getEditorSceneId() {
    const label = String(host.getCurrentSceneLabel?.() || "").trim();
    if (label) {
      return label;
    }
    const payload = host.getSysConfig()?.jsonData;
    const docId = payload?.threeJsonId ?? payload?.name;
    return docId != null && String(docId).trim() ? String(docId).trim() : "untitled";
  }

  function editorViewSessionKey() {
    return `editorView:${getEditorSceneId()}`;
  }

  function isEditorViewPreserveEnabled() {
    const checkbox = document.getElementById("codeEditorCameraLockCheckbox");
    if (checkbox) {
      return checkbox.checked;
    }
    return host.getEditorSettings()?.sceneJson?.cameraLockDefault !== false;
  }

  function captureEditorViewToSession() {
    const camera = host.getCamera();
    const controls = host.getControls();
    if (!camera || !controls) {
      return;
    }
    const p = camera.position;
    const t = controls.target;
    const data = {
      position: { x: p.x, y: p.y, z: p.z },
      target: { x: t.x, y: t.y, z: t.z }
    };
    try {
      sessionStorage.setItem(editorViewSessionKey(), JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  function scheduleCaptureEditorViewToSession() {
    if (!isEditorViewPreserveEnabled()) {
      return;
    }
    if (captureTimer) {
      window.clearTimeout(captureTimer);
    }
    captureTimer = window.setTimeout(() => {
      captureTimer = null;
      captureEditorViewToSession();
    }, 200);
  }

  function loadEditorViewFromSession() {
    try {
      const raw = sessionStorage.getItem(editorViewSessionKey());
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!parsed?.position || !parsed?.target) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function applyPreservedEditorView() {
    const view = loadEditorViewFromSession();
    const camera = host.getCamera();
    const controls = host.getControls();
    if (!view || !camera || !controls) {
      return false;
    }
    const p = view.position;
    const t = view.target;
    camera.position.set(p.x, p.y, p.z);
    controls.target.set(t.x, t.y, t.z);
    controls.update();
    return true;
  }

  function bindEditorViewPreserveListeners() {
    const controls = host.getControls();
    if (!controls || controls.__editorViewPreserveBound) {
      return;
    }
    controls.__editorViewPreserveBound = true;
    controls.addEventListener("change", scheduleCaptureEditorViewToSession);
    controls.addEventListener("end", scheduleCaptureEditorViewToSession);
  }

  async function postIngestSceneViewAdjust(ingestOptions = {}, loadGeneration) {
    if (loadGeneration != null && loadGeneration !== host.getSceneLoadGeneration?.()) {
      return;
    }
    if (ingestOptions.historyReplay === true) {
      return;
    }
    if (isEditorViewPreserveEnabled()) {
      const restored = applyPreservedEditorView();
      if (!restored) {
        try {
          await host.fitViewToScene?.({ silent: true });
        } catch (error) {
          console.warn("[scene-editor] postIngest fit", error);
        }
      }
      return;
    }
    try {
      await host.fitViewToScene?.({ silent: true });
    } catch (error) {
      console.warn("[scene-editor] postIngest fit", error);
    }
  }

  return {
    isEditorViewPreserveEnabled,
    captureEditorViewToSession,
    scheduleCaptureEditorViewToSession,
    applyPreservedEditorView,
    bindEditorViewPreserveListeners,
    postIngestSceneViewAdjust
  };
}
