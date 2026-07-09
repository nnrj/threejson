import { packJsonSceneArchive, sceneToJson } from "threejson";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  jsonStringForScript,
  buildHtmlTemplate,
  buildPackageJson,
  buildTemplateFiles
} from "../../shared/js/templateExportBuilders.js";

function addTextFile(zipEntries, path, text) {
  zipEntries[path] = strToU8(text);
}

function rewritePackRefsForTemplate(value) {
  if (typeof value === "string") {
    return value.trim().toLowerCase().startsWith("pack://")
      ? `./${value.trim().slice("pack://".length).replace(/^\/+/, "")}`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewritePackRefsForTemplate(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = rewritePackRefsForTemplate(item);
    }
    return out;
  }
  return value;
}

export function createEditorTemplateExportModal(host) {
  const modal = document.getElementById("templateExportModal");
  const typeSelect = document.getElementById("templateExportTypeSelect");
  const formatSelect = document.getElementById("templateExportFormatSelect");
  const jsonLocationSelect = document.getElementById("templateExportJsonLocationSelect");
  const assetPolicySelect = document.getElementById("templateExportAssetPolicySelect");
  const fetchExternalUrlsCheckbox = document.getElementById("templateExportFetchExternalUrlsCheckbox");

  function close() {
    modal?.classList.remove("visible");
  }

  function syncDefaults() {
    const type = typeSelect?.value || "html";
    if (jsonLocationSelect) {
      jsonLocationSelect.value = type === "html" ? "inline" : "external";
    }
    if (formatSelect) {
      const sceneJson = host.getEditorSettings()?.sceneJson;
      formatSelect.value =
        sceneJson?.codeViewFormatWriteback &&
        (sceneJson?.codeViewFormat === "friendly" || sceneJson?.codeViewFormat === "standard")
          ? sceneJson.codeViewFormat
          : "standard";
    }
    syncControls();
  }

  function syncControls() {
    const packMode = assetPolicySelect?.value === "tryPack";
    if (fetchExternalUrlsCheckbox) {
      fetchExternalUrlsCheckbox.disabled = !packMode;
      if (!packMode) {
        fetchExternalUrlsCheckbox.checked = false;
      }
    }
  }

  function open() {
    syncDefaults();
    modal?.classList.add("visible");
  }

  async function buildScenePayload(format) {
    await host.ensureCanvasSyncedBeforeExport?.();
    const scene = host.getScene();
    if (!scene?.isScene) {
      throw new Error("场景尚未初始化，无法导出。");
    }
    return sceneToJson(
      scene,
      host.buildSceneToJsonOptions?.({
        merge: false,
        format
      }) ?? { format }
    );
  }

  async function buildPackedScenePayloadAndAssets(format, fetchExternalUrls) {
    const scene = host.getScene();
    const sceneRuntime = host.getSceneRuntime?.();
    const bytes = await packJsonSceneArchive(sceneRuntime || scene, {
      format,
      assetPolicy: "tryPack",
      fetchExternalUrls,
      includeRuntimeRecords: true,
      outputType: "bytes"
    });
    const unzipped = unzipSync(bytes);
    const textDecoder = new TextDecoder();
    const sceneJsonBytes = unzipped["scene.json"];
    if (!sceneJsonBytes) {
      throw new Error("tryPack 结果缺少 scene.json。");
    }
    const payload = rewritePackRefsForTemplate(JSON.parse(textDecoder.decode(sceneJsonBytes)));
    const assets = {};
    for (const [path, data] of Object.entries(unzipped)) {
      if (path.startsWith("assets/")) {
        assets[path] = data;
      }
    }
    return { payload, assets };
  }

  async function confirmExport() {
    const type = typeSelect?.value || "html";
    const format = formatSelect?.value || "standard";
    const jsonLocation = jsonLocationSelect?.value || (type === "html" ? "inline" : "external");
    const assetPolicy = assetPolicySelect?.value || "preserve";
    close();
    host.closeAllDropdowns?.();
    try {
      await host.runWithLoadingMask?.("正在导出模板...", async () => {
        const packMode = assetPolicy === "tryPack";
        const packed = packMode
          ? await buildPackedScenePayloadAndAssets(format, Boolean(fetchExternalUrlsCheckbox?.checked))
          : null;
        const payload = packed?.payload ?? (await buildScenePayload(format));
        const sceneJsonText = jsonStringForScript(payload, host.getEditorSettings()?.io?.exportJsonIndent ?? 2);
        const inlineJson = jsonLocation === "inline";
        const html = buildHtmlTemplate({ sceneJsonText, inlineJson });
        const downloader = host.getExportDownload?.();
        if (type === "html" && inlineJson && assetPolicy !== "tryPack") {
          const blob = new Blob([html], { type: "text/html" });
          const ok = await downloader?.triggerBlobDownload?.(blob, `threejson-template-${Date.now()}.html`, {
            title: "导出 HTML 模板"
          });
          if (!ok) {
            throw new Error("__export_cancelled__");
          }
          return;
        }
        const entries = {};
        if (type === "html") {
          addTextFile(entries, "index.html", html);
        } else {
          addTextFile(entries, "package.json", buildPackageJson(type));
          const files = buildTemplateFiles(type);
          for (const [path, text] of Object.entries(files)) {
            addTextFile(entries, path, text);
          }
        }
        if (!inlineJson || type !== "html") {
          addTextFile(entries, "assets/json/scene.json", `${sceneJsonText}\n`);
        }
        if (packed?.assets) {
          for (const [path, data] of Object.entries(packed.assets)) {
            entries[path] = data;
          }
        }
        const zip = zipSync(entries, { level: 6 });
        const blob = new Blob([zip], { type: "application/zip" });
        const ok = await downloader?.triggerBlobDownload?.(blob, `threejson-template-${type}-${Date.now()}.zip`, {
          title: "导出模板"
        });
        if (!ok) {
          throw new Error("__export_cancelled__");
        }
      });
      host.showMessage("模板已导出。", "success");
    } catch (error) {
      if (String(error?.message || error) === "__export_cancelled__") {
        return;
      }
      console.error(error);
      host.showMessage(`导出模板失败：${error?.message || error}`, "error");
    }
  }

  function init() {
    typeSelect?.addEventListener("change", syncDefaults);
    assetPolicySelect?.addEventListener("change", syncControls);
    document.getElementById("templateExportCancelBtn")?.addEventListener("click", close);
    document.getElementById("templateExportConfirmBtn")?.addEventListener("click", () => {
      void confirmExport();
    });
    modal?.addEventListener("click", (event) => {
      if (event.target === modal) {
        close();
      }
    });
    document.getElementById("menuExportTemplate")?.addEventListener("click", () => {
      open();
      host.closeAllDropdowns?.();
    });
  }

  return { init, open, close, confirmExport };
}
