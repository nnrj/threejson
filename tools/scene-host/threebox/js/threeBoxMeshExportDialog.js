import { t } from "../../shared/i18n/index.js";

const THREEBOX_MESH_EXPORT_FORMATS = Object.freeze([
  { value: "glb", labelKey: "threebox.meshExport.formatGlb", fallback: "GLB（推荐）" },
  { value: "gltf", labelKey: "threebox.meshExport.formatGltf", fallback: "GLTF（JSON）" },
  { value: "obj", labelKey: "threebox.meshExport.formatObj", fallback: "OBJ（几何为主）" },
  { value: "stl", labelKey: "threebox.meshExport.formatStl", fallback: "STL（3D 打印）" },
  { value: "ply", labelKey: "threebox.meshExport.formatPly", fallback: "PLY" },
  { value: "usdz", labelKey: "threebox.meshExport.formatUsdz", fallback: "USDZ（AR）" }
]);

let activeClose = null;

/** Opens a lightweight ThreeBox-styled format picker and resolves to a format or null. */
function openThreeBoxMeshExportDialog(options = {}) {
  activeClose?.();
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "modalOverlay threeBoxMeshExportOverlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "threeBoxMeshExportTitle");

    const dialog = document.createElement("div");
    dialog.className = "modalDialog threeBoxMeshExportDialog";
    overlay.appendChild(dialog);

    const header = document.createElement("div");
    header.className = "modalHeader";
    header.id = "threeBoxMeshExportTitle";
    header.textContent = t("threebox.meshExport.title", "导出三方模型");
    dialog.appendChild(header);

    const body = document.createElement("div");
    body.className = "modalBody threeBoxMeshExportBody";
    dialog.appendChild(body);

    const field = document.createElement("label");
    field.className = "threeBoxMeshExportField";
    const fieldLabel = document.createElement("span");
    fieldLabel.textContent = t("threebox.meshExport.format", "导出格式");
    const select = document.createElement("select");
    select.setAttribute("aria-label", fieldLabel.textContent);
    for (const item of THREEBOX_MESH_EXPORT_FORMATS) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = t(item.labelKey, item.fallback);
      select.appendChild(option);
    }
    const initialFormat = String(options.initialFormat || "glb").toLowerCase();
    select.value = THREEBOX_MESH_EXPORT_FORMATS.some((item) => item.value === initialFormat)
      ? initialFormat
      : "glb";
    field.append(fieldLabel, select);
    body.appendChild(field);

    const scope = document.createElement("div");
    scope.className = "threeBoxMeshExportScope";
    const scopeLabel = document.createElement("span");
    scopeLabel.textContent = t("threebox.meshExport.scope", "导出范围");
    const scopeValue = document.createElement("strong");
    scopeValue.textContent = t("threebox.meshExport.wholeScene", "当前画布整场景");
    scope.append(scopeLabel, scopeValue);
    body.appendChild(scope);

    const hint = document.createElement("p");
    hint.className = "threeBoxMeshExportHint";
    hint.textContent = t(
      "threebox.meshExport.hint",
      "OBJ/STL/PLY 主要导出几何；USDZ 适合 iOS AR 预览。贴图丰富的场景建议使用 GLB。"
    );
    body.appendChild(hint);

    const footer = document.createElement("div");
    footer.className = "modalFooter";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = t("threebox.meshExport.cancel", "取消");
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "primary";
    confirmBtn.textContent = t("threebox.meshExport.confirm", "导出");
    footer.append(cancelBtn, confirmBtn);
    dialog.appendChild(footer);

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      activeClose = null;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") finish(null);
    };
    activeClose = () => finish(null);
    cancelBtn.addEventListener("click", () => finish(null));
    confirmBtn.addEventListener("click", () => finish(select.value));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
    select.focus();
  });
}

/** Keeps export warnings visible until the user explicitly dismisses them. */
function showThreeBoxMeshExportWarningDialog(warnings = []) {
  activeClose?.();
  const messages = (Array.isArray(warnings) ? warnings : [warnings])
    .map((entry) => String(entry?.message || entry || "").trim())
    .filter(Boolean);
  if (!messages.length) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "modalOverlay threeBoxMeshExportOverlay";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "threeBoxMeshExportWarningTitle");

    const dialog = document.createElement("div");
    dialog.className = "modalDialog threeBoxMeshExportDialog threeBoxMeshExportWarningDialog";
    overlay.appendChild(dialog);

    const header = document.createElement("div");
    header.className = "modalHeader";
    header.id = "threeBoxMeshExportWarningTitle";
    header.textContent = t("threebox.meshExport.warningTitle", "模型已导出，但有注意事项");
    dialog.appendChild(header);

    const body = document.createElement("div");
    body.className = "modalBody threeBoxMeshExportBody";
    const intro = document.createElement("p");
    intro.className = "threeBoxMeshExportWarningIntro";
    intro.textContent = t(
      "threebox.meshExport.warningIntro",
      "模型文件已下载。以下资源未能完整写入，请检查后再用于正式交付："
    );
    const list = document.createElement("ul");
    list.className = "threeBoxMeshExportWarningList";
    for (const message of messages) {
      const item = document.createElement("li");
      item.textContent = message;
      list.appendChild(item);
    }
    body.append(intro, list);
    dialog.appendChild(body);

    const footer = document.createElement("div");
    footer.className = "modalFooter";
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "primary";
    dismissBtn.textContent = t("threebox.meshExport.warningDismiss", "知道了");
    footer.appendChild(dismissBtn);
    dialog.appendChild(footer);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      activeClose = null;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
      resolve();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") finish();
    };
    activeClose = finish;
    dismissBtn.addEventListener("click", finish);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish();
    });
    document.addEventListener("keydown", onKeyDown);
    document.body.appendChild(overlay);
    dismissBtn.focus();
  });
}

export {
  THREEBOX_MESH_EXPORT_FORMATS,
  openThreeBoxMeshExportDialog,
  showThreeBoxMeshExportWarningDialog
};
