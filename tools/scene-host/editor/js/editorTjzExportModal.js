import { packJsonSceneArchive } from "threejson";

export function createEditorTjzExportModal(host) {
  const modal = document.getElementById("tjzExportModal");
  const formatSelect = document.getElementById("tjzExportFormatSelect");
  const assetPolicySelect = document.getElementById("tjzExportAssetPolicySelect");
  const includeRuntimeCheckbox = document.getElementById("tjzExportIncludeRuntimeCheckbox");
  const fetchExternalUrlsCheckbox = document.getElementById("tjzExportFetchExternalUrlsCheckbox");
  const hintEl = document.getElementById("tjzExportHint");

  function applyDefaultsFromSettings() {
    const tjz = host.getEditorSettings()?.io?.tjzExport;
    if (!tjz) {
      return;
    }
    if (formatSelect && tjz.format) {
      formatSelect.value = tjz.format;
    }
    if (assetPolicySelect && tjz.assetPolicy) {
      assetPolicySelect.value = tjz.assetPolicy;
    }
    if (includeRuntimeCheckbox) {
      includeRuntimeCheckbox.checked = tjz.includeRuntime !== false;
    }
    if (fetchExternalUrlsCheckbox) {
      fetchExternalUrlsCheckbox.checked = Boolean(tjz.fetchExternalUrls);
    }
  }

  function syncHint() {
    const format = formatSelect?.value || "standard";
    const policy = assetPolicySelect?.value || "preserve";
    const nativeMode = format === "three-native";
    const includeRuntime = includeRuntimeCheckbox?.checked !== false;
    const packMode = policy === "tryPack";
    if (fetchExternalUrlsCheckbox) {
      fetchExternalUrlsCheckbox.disabled = nativeMode || !packMode;
      if (nativeMode || !packMode) {
        fetchExternalUrlsCheckbox.checked = false;
      }
    }
    if (!hintEl) {
      return;
    }
    if (!includeRuntime && !nativeMode) {
      hintEl.textContent = "提示：已关闭 runtime 导出，导入到空场景时可能需要手动补光/相机。";
      return;
    }
    if (nativeMode) {
      hintEl.textContent = "提示：three-native 模式不会抽取 assets，纹理/材质按原生 JSON 结果原样打包。";
      return;
    }
    if (packMode) {
      hintEl.textContent = "提示：tryPack 会尝试将可解析资源改写为 pack://；抓取外链 URL 可能受 CORS 限制。";
      return;
    }
    hintEl.textContent = "提示：preserve 模式会保留原始 URL/路径，不会写入 assets。";
  }

  function readOptions() {
    return {
      format: formatSelect?.value || "standard",
      assetPolicy: assetPolicySelect?.value || "preserve",
      fetchExternalUrls: Boolean(fetchExternalUrlsCheckbox?.checked),
      includeRuntimeRecords: includeRuntimeCheckbox?.checked !== false
    };
  }

  function open() {
    applyDefaultsFromSettings();
    syncHint();
    modal?.classList.add("visible");
  }

  function close() {
    modal?.classList.remove("visible");
  }

  async function confirmExport() {
    const scene = host.getScene();
    const sceneRuntime = host.getSceneRuntime?.();
    if (!sceneRuntime && !scene?.isScene) {
      host.showMessage("场景尚未初始化，无法导出。", "warning");
      return;
    }
    const exportOptions = readOptions();
    close();
    host.closeAllDropdowns?.();
    try {
      await host.runWithLoadingMask("正在导出 .tjz 包...", async () => {
        const archiveBlob = await packJsonSceneArchive(sceneRuntime || scene, {
          format: exportOptions.format,
          assetPolicy: exportOptions.assetPolicy,
          fetchExternalUrls: exportOptions.fetchExternalUrls,
          includeRuntimeRecords: exportOptions.includeRuntimeRecords,
          outputType: "blob"
        });
        const downloaded = await host.getExportDownload()?.triggerBlobDownload?.(
          archiveBlob,
          `sceneEditor-scene-${Date.now()}.tjz`,
          { title: "导出 .tjz 包" }
        );
        if (!downloaded) {
          throw new Error("__export_cancelled__");
        }
      });
      if (exportOptions.format === "three-native" && exportOptions.assetPolicy === "tryPack") {
        host.showMessage("已导出 .tjz（three-native 模式不执行 assets 抽取，已按原生 JSON 原样打包）。", "warning");
        return;
      }
      host.showMessage("已导出 .tjz 包。", "success");
    } catch (error) {
      if (String(error?.message || error) === "__export_cancelled__") {
        return;
      }
      console.error(error);
      host.showMessage(`导出 .tjz 失败：${error.message || error}`, "error");
    }
  }

  function init() {
    formatSelect?.addEventListener("change", syncHint);
    assetPolicySelect?.addEventListener("change", syncHint);
    includeRuntimeCheckbox?.addEventListener("change", syncHint);
    document.getElementById("tjzExportCancelBtn")?.addEventListener("click", () => {
      close();
    });
    document.getElementById("tjzExportConfirmBtn")?.addEventListener("click", () => {
      void confirmExport();
    });
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) {
        close();
      }
    });
    document.getElementById("menuExportTjzArchive")?.addEventListener("click", () => {
      open();
      host.closeAllDropdowns?.();
    });
  }

  return { init, open, close, confirmExport, applyDefaultsFromSettings };
}
