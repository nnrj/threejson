import {
  cloneSceneGraphForNativeExport,
  estimateThreeNativeJsonPayloadChars,
  NATIVE_EXPORT_JSON_CHAR_SOFT_LIMIT,
  omitExternalFileModelsForNativeExport
} from "../../../../core/util/util.js";
import { embedPortableImageUrlsIntoThreeExportJson } from "../../../../core/builder/nativeObjectLoader.js";

function formatNativeExportOmitSummary(omitted) {
  if (!Array.isArray(omitted) || !omitted.length) {
    return "";
  }
  const labels = omitted.slice(0, 5).map((entry) => {
    const base = entry.name || entry.modelPath || "未命名";
    if (Number.isFinite(entry.triangleCount) && entry.triangleCount > 0) {
      return `${base}（约 ${entry.triangleCount} 面）`;
    }
    return base;
  });
  const tail = omitted.length > 5 ? ` 等 ${omitted.length} 项` : "";
  return `${labels.join("、")}${tail}`;
}

export async function exportNativeSceneJson(host, { silent = false } = {}) {
  const scene = host.getScene();
  const ui = host.getUi?.();
  const editorExportDownload = host.getEditorExportDownload?.();
  const transformControlsHelper = host.getTransformControlsHelper?.();
  const boxEdgeHelper = host.getBoxEdgeHelper?.();

  let omittedExternalModels = [];
  let exportText = "";
  try {
    await ui.runWithLoadingMask(
      "正在导出 Three.js 原生 JSON…",
      async (setProgress, tick) => {
        if (!scene?.isScene) {
          throw new Error("场景未就绪");
        }
        let exportRoot = null;
        try {
          setProgress("正在克隆场景…");
          await tick();
          exportRoot = cloneSceneGraphForNativeExport(scene, [
            transformControlsHelper,
            boxEdgeHelper
          ].filter(Boolean));

          setProgress("正在检查外部模型复杂度…");
          await tick();
          const omitResult = omitExternalFileModelsForNativeExport(exportRoot);
          omittedExternalModels = omitResult.omitted || [];

          setProgress("正在序列化几何（toJSON）…");
          await tick();
          let payload;
          try {
            payload = exportRoot.toJSON();
          } catch (e1) {
            console.warn("克隆场景 toJSON 首次失败，尝试清空 userData 后再导出。", e1);
            exportRoot.traverse((obj) => {
              try {
                obj.userData = {};
              } catch {
                /* ignore */
              }
            });
            payload = exportRoot.toJSON();
          }
          embedPortableImageUrlsIntoThreeExportJson(exportRoot, payload);

          setProgress("正在打包 JSON…");
          await tick();
          const roughChars = estimateThreeNativeJsonPayloadChars(payload);
          if (roughChars > NATIVE_EXPORT_JSON_CHAR_SOFT_LIMIT) {
            throw new Error(
              `导出体积过大（约 ${Math.round(roughChars / 1_000_000)}M 字符），可能仍含大型网格。请用 ThreeJSON 导出保留 modelPath，或减少场景中的外部模型。`
            );
          }
          try {
            exportText = JSON.stringify(payload);
          } catch (e3) {
            const msg = e3?.message || String(e3);
            if (/invalid string length/i.test(msg)) {
              throw new Error(
                "序列化结果超过浏览器字符串上限。完整场景请使用 ThreeJSON 导出；过重的外部模型已自动跳过。"
              );
            }
            throw new Error(msg);
          }
        } finally {
          if (exportRoot) {
            try {
              exportRoot.clear();
            } catch {
              /* ignore */
            }
          }
        }
      },
      { showActivity: true }
    );
    const downloaded = await editorExportDownload.downloadJsonText(
      exportText,
      `sceneEditor-three-native-${Date.now()}.json`,
      { title: "导出原生 JSON" }
    );
    if (!downloaded) {
      return;
    }
    if (!silent) {
      if (omittedExternalModels.length > 0) {
        const summary = formatNativeExportOmitSummary(omittedExternalModels);
        ui.showMessage(
          `Three.js 原生 JSON 已导出。已跳过 ${omittedExternalModels.length} 个过重的三方模型（${summary}）；完整场景请用 ThreeJSON 导出。`,
          "warning"
        );
      } else {
        ui.showMessage("Three.js 原生 JSON 已导出。", "success");
      }
    }
  } catch (error) {
    console.error(error);
    ui.showMessage(`导出原生 JSON 失败：${error.message || error}`, "error");
  }
}
