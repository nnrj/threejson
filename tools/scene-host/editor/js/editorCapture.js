import { captureSceneFrame, recordSceneVideo } from "threejson";

function buildCaptureTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function createEditorCapture(host) {
  const recordModal = document.getElementById("captureRecordModal");
  const fpsInput = document.getElementById("recordFpsInput");
  const mimeTypeSelect = document.getElementById("recordMimeTypeSelect");
  const bitrateInput = document.getElementById("recordBitrateInput");
  const recordStopFloatingBtn = document.getElementById("recordStopFloatingBtn");

  let activeRecorder = null;
  let recordStartAt = 0;
  let recordStopping = false;

  function buildCaptureContext() {
    const scene = host.getScene();
    const camera = host.getCamera();
    const renderer = host.getRenderer();
    if (!scene?.isScene || !camera || !renderer) {
      throw new Error("场景尚未就绪，无法执行捕获。");
    }
    return {
      scene,
      camera,
      renderer,
      composer: host.getEditorInteraction()?.getComposer?.() ?? null,
      renderLoop: host.getRenderLoop?.() ?? null,
      renderConfig: {
        renderMode: host.getSysConfig()?.renderMode
      }
    };
  }

  function applyCaptureDefaultsFromSettings() {
    const cap = host.getEditorSettings()?.capture;
    if (!cap) {
      return;
    }
    if (fpsInput && Number.isFinite(cap.recordFps)) {
      fpsInput.value = String(cap.recordFps);
    }
    if (mimeTypeSelect && cap.recordMimeType != null) {
      mimeTypeSelect.value = cap.recordMimeType;
    }
    if (bitrateInput) {
      bitrateInput.value =
        cap.recordBitrateBps != null && cap.recordBitrateBps > 0 ? String(cap.recordBitrateBps) : "";
    }
  }

  function isRecordingNow() {
    return Boolean(activeRecorder);
  }

  function syncRecordUi() {
    const menuBtn = document.getElementById("menuRecordVideoToggle");
    if (menuBtn) {
      menuBtn.textContent = isRecordingNow() ? "停止录制" : "开始录制";
    }
    if (recordStopFloatingBtn) {
      recordStopFloatingBtn.classList.toggle("visible", isRecordingNow());
    }
  }

  function openRecordModal() {
    applyCaptureDefaultsFromSettings();
    recordModal?.classList.add("visible");
  }

  function closeRecordModal() {
    recordModal?.classList.remove("visible");
  }

  function readRecordOptionsFromModal() {
    const fpsParsed = Number(fpsInput?.value);
    const fps =
      Number.isFinite(fpsParsed) && fpsParsed > 0
        ? fpsParsed
        : host.getEditorSettings()?.capture?.recordFps ?? 30;
    const mimeTypeRaw = String(mimeTypeSelect?.value || "").trim();
    const mimeType = mimeTypeRaw || undefined;
    const bitrateParsed = Number(bitrateInput?.value);
    const videoBitsPerSecond =
      Number.isFinite(bitrateParsed) && bitrateParsed > 0 ? bitrateParsed : undefined;
    return { fps, mimeType, videoBitsPerSecond };
  }

  async function captureFrame() {
    const ctx = buildCaptureContext();
    const result = await captureSceneFrame(ctx, {
      forceRender: true,
      mimeType: "image/png"
    });
    const filename = `${host.getEditorSettings()?.capture?.screenshotFilenamePrefix || "sceneEditor-snapshot-"}${buildCaptureTimestamp()}.png`;
    const downloaded = await host.getExportDownload()?.triggerBlobDownload?.(result.blob, filename, {
      promptFilename: false
    });
    if (!downloaded) {
      return;
    }
    host.showMessage(`截图完成：${filename}`, "success");
  }

  async function stopRecordingAndSave() {
    if (!activeRecorder || recordStopping) {
      return;
    }
    recordStopping = true;
    try {
      const blob = await activeRecorder.stop();
      const filename = `${host.getEditorSettings()?.capture?.recordFilenamePrefix || "sceneEditor-record-"}${buildCaptureTimestamp()}.webm`;
      await host.getExportDownload()?.triggerBlobDownload?.(blob, filename, { promptFilename: false });
      const seconds = recordStartAt ? Math.max(1, Math.round((Date.now() - recordStartAt) / 1000)) : null;
      host.showMessage(
        seconds ? `录制完成（约 ${seconds}s）：${filename}` : `录制完成：${filename}`,
        "success"
      );
    } catch (error) {
      console.error(error);
      host.showMessage(`停止录制失败：${error?.message || error}`, "error");
    } finally {
      activeRecorder = null;
      recordStartAt = 0;
      recordStopping = false;
      syncRecordUi();
    }
  }

  function startRecordingByModalOptions() {
    try {
      const ctx = buildCaptureContext();
      const options = readRecordOptionsFromModal();
      activeRecorder = recordSceneVideo(ctx, options);
      recordStartAt = Date.now();
      closeRecordModal();
      syncRecordUi();
      host.showMessage("已开始录制。可通过「捕获→停止录制」或右下角按钮停止。", "success");
    } catch (error) {
      console.error(error);
      host.showMessage(`开始录制失败：${error?.message || error}`, "error");
    }
  }

  async function onMenuRecordVideoToggleClick() {
    if (isRecordingNow()) {
      await stopRecordingAndSave();
      return;
    }
    openRecordModal();
  }

  function init() {
    applyCaptureDefaultsFromSettings();
    document.getElementById("menuCaptureFrame")?.addEventListener("click", () => {
      void captureFrame().catch((error) => {
        console.error(error);
        host.showMessage(`截图失败：${error?.message || error}`, "error");
      });
      host.closeAllDropdowns?.();
    });
    document.getElementById("menuRecordVideoToggle")?.addEventListener("click", () => {
      void onMenuRecordVideoToggleClick();
      host.closeAllDropdowns?.();
    });
    document.getElementById("recordModalCancelBtn")?.addEventListener("click", () => {
      closeRecordModal();
    });
    document.getElementById("recordModalStartBtn")?.addEventListener("click", () => {
      startRecordingByModalOptions();
    });
    recordModal?.addEventListener("click", (event) => {
      if (event.target === recordModal) {
        closeRecordModal();
      }
    });
    recordStopFloatingBtn?.addEventListener("click", () => {
      void stopRecordingAndSave();
    });
    syncRecordUi();
  }

  return { init, captureFrame, isRecordingNow, applyCaptureDefaultsFromSettings };
}
