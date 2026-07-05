import { writeUserScenePreset } from "../../shared/js/scenePresetsStore.js";
import {
  fingerprintSessionJsonText,
  hasUserSavedBaseline,
  writeUserSavedBaseline
} from "../../shared/js/userBaselineStore.js";
import { captureCurrentSessionJsonText, buildCaptureOptionsForContext } from "./editorSessionCapture.js";



function assignNewSceneDocumentThreeJsonId(payload) {

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {

    return "";

  }

  delete payload.threeJsonId;

  const next =

    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"

      ? crypto.randomUUID()

      : `scene-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  payload.threeJsonId = next;

  return next;

}



function ensureSceneDocumentThreeJsonId(payload) {

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {

    return "";

  }

  const current = String(payload.threeJsonId || "").trim();

  if (current) {

    return current;

  }

  return assignNewSceneDocumentThreeJsonId(payload);

}



function applySceneDocumentLabel(payload, label) {

  const text = String(label || "").trim();

  if (!text || !payload || typeof payload !== "object") {

    return;

  }

  payload.label = text;

  payload.name = text;

}



function readSceneDocumentNameFromPayload(payload) {

  const label = String(payload?.label || "").trim();

  if (label) {

    return label;

  }

  return String(payload?.name || "").trim();

}



function resolveDefaultSceneDocumentLabel(host, payload) {

  const current = String(host.getCurrentSceneLabel?.() || "").trim();

  if (current) {

    return current;

  }

  return readSceneDocumentNameFromPayload(payload) || "未命名场景";

}



async function captureSessionJsonText(host, captureOptions = {}) {
  return captureCurrentSessionJsonText(host, captureOptions);
}



function promptSceneLabel(defaultName, title = "场景名称") {

  const raw = window.prompt(title, String(defaultName || "").trim());

  if (raw == null) {

    return null;

  }

  const label = String(raw).trim();

  if (!label) {

    return null;

  }

  return label;

}



async function askSceneLabel(host, defaultName, modalOptions) {

  const modals = host.getSceneNameModals?.();

  if (modals?.openSceneNameModalAndWait) {

    return modals.openSceneNameModalAndWait(defaultName, modalOptions);

  }

  return promptSceneLabel(defaultName, modalOptions?.title || "场景名称");

}



async function askSaveAsCopyLabel(host, defaultName) {

  const modals = host.getSceneNameModals?.();

  if (modals?.openSaveSceneAsCopyModalAndWait) {

    return modals.openSaveSceneAsCopyModalAndWait(defaultName);

  }

  return promptSceneLabel(defaultName, "请输入副本名称");

}



export function createSceneDocumentOps(host) {

  async function persistUserSceneBaseline(silentFlag = false) {

    if (!host.getScene()?.isScene) {

      if (!silentFlag) {

        host.showMessage("当前没有已加载的场景。", "warning");

      }

      return;

    }

    try {

      const previewRaw = await captureSessionJsonText(
        host,
        buildCaptureOptionsForContext(host, "fullReplace")
      );

      const previewPayload = JSON.parse(previewRaw);

      const previewId = ensureSceneDocumentThreeJsonId(previewPayload);

      let saveLabel = String(host.getCurrentSceneLabel?.() || "").trim();



      if (!(await hasUserSavedBaseline(previewId))) {

        if (!silentFlag) {

          host.closeAllDropdowns?.();

        }

        const defaultName = resolveDefaultSceneDocumentLabel(host, previewPayload);

        const picked = await askSceneLabel(host, defaultName, {

          title: "保存场景",

          nameLabel: "场景名称",

          hint: "为当前场景指定名称，将用于标题栏与最近打开列表。",

          confirmLabel: "保存"

        });

        if (!picked) {

          return;

        }

        saveLabel = picked;

      }



      await host.runWithLoadingMask("正在保存场景...", async () => {

        const jsonRaw = await captureSessionJsonText(
          host,
          buildCaptureOptionsForContext(host, "fullReplace")
        );

        const payload = JSON.parse(jsonRaw);

        const sceneThreeJsonId = ensureSceneDocumentThreeJsonId(payload);

        if (saveLabel) {

          applySceneDocumentLabel(payload, saveLabel);

        }

        const json = JSON.stringify(payload, null, 2);

        const sysConfig = host.getSysConfig();

        sysConfig.jsonData = payload;

        sysConfig.jsonData.threeJsonId = sceneThreeJsonId;

        const fp = await fingerprintSessionJsonText(json);

        const labelForStore = saveLabel || host.getCurrentSceneLabel?.() || "已保存场景";

        await writeUserSavedBaseline(sceneThreeJsonId, {

          json,

          fingerprint: fp,

          label: labelForStore

        });

        await host.getRecentScenes()?.writeSceneSnapshot?.(sceneThreeJsonId, json);

        await host.getRecentScenes()?.upsertEntry?.({

          sceneThreeJsonId,

          label: labelForStore,

          name: readSceneDocumentNameFromPayload(payload) || labelForStore

        });

        host.updateSceneTitle?.(labelForStore);
        host.getRightSidebarCache?.()?.invalidateRightSidebarSceneJsonTextCache?.();
        if (host.getCodeEditor()?.isCodeEditMode?.()) {
          host.getCodeEditor()?.setActiveCodeJsonText?.(json);
        }
        await host.getSessionRecovery?.()?.syncAutoSnapshotAfterSave?.(json);
      });

      host.getSceneReserialize?.()?.markSceneDocumentSynced?.();
      host.markSceneSaved?.();

      if (!silentFlag) {
        host.getEditorDomainExport?.()?.warnIfAny?.();
        host.showMessage("场景已保存。", "success");
      } else {
        host.getEditorDomainExport?.()?.warnIfAny?.({ silent: true });
      }

    } catch (error) {

      console.error(error);

      if (!silentFlag) {

        host.showMessage(`场景保存失败：${error?.message || error}`, "error");
      }

    }

  }



  async function saveSceneAsCopy() {

    if (!host.getScene()?.isScene) {

      host.showMessage("当前没有已加载的场景。", "warning");

      return;

    }

    const defaultName = `${resolveDefaultSceneDocumentLabel(host, host.getSysConfig()?.jsonData)} (副本)`;

    const label = await askSaveAsCopyLabel(host, defaultName);

    if (!label) {

      return;

    }

    try {

      await host.runWithLoadingMask("正在另存为副本...", async () => {

        const jsonRaw = await captureSessionJsonText(
          host,
          buildCaptureOptionsForContext(host, "fullReplace")
        );

        const payload = JSON.parse(jsonRaw);

        assignNewSceneDocumentThreeJsonId(payload);

        applySceneDocumentLabel(payload, label);

        const newId = payload.threeJsonId;

        const json = JSON.stringify(payload, null, 2);

        const fp = await fingerprintSessionJsonText(json);

        await writeUserSavedBaseline(newId, {

          json,

          fingerprint: fp,

          label

        });

        await host.getRecentScenes()?.writeSceneSnapshot?.(newId, json);

        await host.getRecentScenes()?.upsertEntry?.({

          sceneThreeJsonId: newId,

          label,

          name: readSceneDocumentNameFromPayload(payload) || label

        });

        const loaded = await host.ingestScenePayload(payload, label);

        if (!loaded) {

          throw new Error("载入副本失败。");

        }

        host.markSceneSaved?.();

        host.getEditorDomainExport?.()?.warnIfAny?.();

      });

      host.showMessage(`已另存为副本「${label}」。`, "success");

    } catch (error) {

      host.showMessage(`另存为副本失败：${error?.message || error}`, "error");

      console.error(error);

    }

  }



  async function saveCurrentSceneDocument() {

    await persistUserSceneBaseline(false);

  }



  async function saveScenePreset() {

    if (!host.getScene()?.isScene) {

      host.showMessage("当前没有已加载的场景。", "warning");

      return;

    }

    const defaultName = String(host.getCurrentSceneLabel() || "未命名预设").trim() || "未命名预设";

    const label = await askSceneLabel(host, defaultName, {

      title: "保存为预设",

      nameLabel: "预设名称",

      hint: "预设将保存在本地缓存，可在左栏「场景预设」中快速打开。",

      confirmLabel: "保存"

    });

    if (!label) {

      return;

    }

    try {

      await host.runWithLoadingMask("正在保存预设...", async () => {

        const json = await captureSessionJsonText(host);

        await writeUserScenePreset({ label, json });

      });

      await host.getPresetScenePanel()?.refresh?.();

      host.showMessage(`已保存为预设「${label}」。`, "success");

    } catch (error) {

      host.showMessage(`保存预设失败：${error?.message || error}`, "error");

      console.warn(error);

    }

  }



  return {

    saveSceneAsCopy,

    saveScenePreset,

    saveCurrentSceneDocument,

    persistUserSceneBaseline

  };

}


