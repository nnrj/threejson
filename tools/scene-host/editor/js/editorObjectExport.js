import {
  exportJsonObject,
  exportMesh,
  exportMeshObject,
  packJsonObjectArchive
} from "threejson";

export function buildObjectExportFilenameStem(record, fallbackUuid = "") {
  const source = String(record?.name || record?.objType || fallbackUuid || "object");
  const cleaned = source.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").trim();
  return cleaned || "object";
}

function summarizeMeshExportWarnings(warnings) {
  if (!Array.isArray(warnings) || !warnings.length) {
    return "";
  }
  return warnings.map((entry) => entry.message).filter(Boolean).join(" ");
}

async function downloadBlob(host, blob, defaultFilename, options = {}) {
  return host.getExportDownload()?.triggerBlobDownload?.(blob, defaultFilename, options) ?? false;
}

async function downloadMeshExportResult(host, result, options = {}) {
  const payload = result.data instanceof ArrayBuffer ? result.data : String(result.data || "");
  const blob = new Blob([payload], { type: result.mimeType || "application/octet-stream" });
  const defaultName = result.fileNameHint || `mesh-${Date.now()}.${result.extension || "glb"}`;
  return downloadBlob(host, blob, defaultName, options);
}

export async function exportSceneTreeContextObjectJson(host, objectUuid) {
  const uuid = String(objectUuid || "").trim();
  if (!uuid) {
    host.showMessage("未定位到要导出的对象。", "warning");
    return false;
  }
  const root = host.getScene();
  if (!root?.isScene) {
    host.showMessage("场景未就绪，无法导出。", "warning");
    return false;
  }
  const record = exportJsonObject(root, uuid, { by: "uuid" });
  const stem = buildObjectExportFilenameStem(record, uuid.slice(0, 8));
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  await downloadBlob(host, blob, `${stem}-${Date.now()}.json`, { title: "导出对象 JSON" });
  host.showMessage("对象 JSON 已导出。", "success");
  return true;
}

export async function exportSceneTreeContextObjectTjz(host, objectUuid) {
  const uuid = String(objectUuid || "").trim();
  if (!uuid) {
    host.showMessage("未定位到要导出的对象。", "warning");
    return false;
  }
  const root = host.getScene();
  if (!root?.isScene) {
    host.showMessage("场景未就绪，无法导出。", "warning");
    return false;
  }
  const record = exportJsonObject(root, uuid, { by: "uuid" });
  let downloaded = false;
  await host.runWithLoadingMask("正在导出对象 .tjz...", async () => {
    const archiveBlob = await packJsonObjectArchive(root, uuid, {
      by: "uuid",
      outputType: "blob"
    });
    const stem = buildObjectExportFilenameStem(record, uuid.slice(0, 8));
    downloaded = await downloadBlob(host, archiveBlob, `${stem}-${Date.now()}.tjz`, { title: "导出对象 .tjz" });
  });
  if (!downloaded) {
    return false;
  }
  host.showMessage("对象 .tjz 已导出。", "success");
  return true;
}

export async function runEditorMeshExport(host, options = {}) {
  const format = String(options.format || "glb").trim().toLowerCase();
  const scope = String(options.scope || "scene").trim().toLowerCase();
  const objectUuid = String(options.objectUuid || "").trim();
  const root = host.getScene();
  if (!root?.isScene) {
    host.showMessage("场景未就绪，无法导出。", "warning");
    return false;
  }
  const shouldSkipObject = (obj) => host.getSceneTree()?.isRuntimeOnlyObject?.(obj) ?? false;
  const formatLabel = format.toUpperCase();
  const selectedObj = host.getSelectedObject();

  if (scope === "selection" && !objectUuid && !selectedObj) {
    host.showMessage("请先选中要导出的对象。", "warning");
    return false;
  }

  let result;
  const baseOptions = {
    format,
    shouldSkipObject,
    externalModelPolicy: "include",
    renderer: host.getRenderer()
  };

  try {
    await host.runWithLoadingMask(`正在导出 ${formatLabel}...`, async () => {
      if (objectUuid) {
        const obj = host.getSceneTree()?.getObjectByUuid?.(objectUuid);
        const stem = buildObjectExportFilenameStem(obj?.userData?.objJson, objectUuid.slice(0, 8));
        result = await exportMeshObject(root, objectUuid, {
          ...baseOptions,
          by: "uuid",
          fileNameStem: stem
        });
        return;
      }
      if (scope === "selection") {
        result = await exportMesh(root, {
          ...baseOptions,
          scope: "selection",
          selectedObject3D: selectedObj,
          fileNameStem: buildObjectExportFilenameStem(selectedObj?.userData?.objJson, "selection")
        });
        return;
      }
      result = await exportMesh(root, {
        ...baseOptions,
        scope: "scene",
        fileNameStem: "scene"
      });
    });
  } catch (error) {
    console.error(error);
    host.showMessage(`导出 ${formatLabel} 失败：${error.message || error}`, "error");
    return false;
  }

  const warningText = summarizeMeshExportWarnings(result?.warnings);
  const downloaded = await downloadMeshExportResult(host, result, {
    title: options.title || `导出 ${formatLabel}`
  });
  if (!downloaded) {
    return false;
  }
  host.showMessage(
    warningText ? `3D 模型已导出。${warningText}` : "3D 模型已导出。",
    warningText ? "warning" : "success"
  );
  return true;
}

export async function exportSceneTreeContextObjectGlb(host, objectUuid) {
  const uuid = String(objectUuid || "").trim();
  if (!uuid) {
    host.showMessage("未定位到要导出的对象。", "warning");
    return false;
  }
  return runEditorMeshExport(host, {
    format: "glb",
    objectUuid: uuid,
    title: "导出对象 GLB"
  });
}
