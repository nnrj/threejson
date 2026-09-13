const english = () => (typeof document !== "undefined" ? document.documentElement.lang : "").toLowerCase().startsWith("en");

export const sceneDiagnosticTitle = () => english() ? "Scene notices" : "场景提示";
const languageListeners = new Set();
let languageObserver;
export function subscribeSceneDiagnosticLanguage(listener) {
  languageListeners.add(listener);
  if (!languageObserver && typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    languageObserver = new MutationObserver(() => {
      for (const notify of languageListeners) notify();
    });
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  }
  return () => {
    languageListeners.delete(listener);
    if (!languageListeners.size) { languageObserver?.disconnect(); languageObserver = null; }
  };
}

export function describeSceneDiagnostic(item) {
  const en = english();
  const labels = {
    TEXTURE_RESOURCE_FAILED: en ? "Texture unavailable; the previous map or base material is retained." : "纹理未能加载，已保留原贴图或基础材质。",
    BACKDROP_RESOURCE_FAILED: en ? "Background/environment unavailable; the previous value is retained." : "背景或环境贴图未能加载，已保留原设置。",
    MODEL_RESOURCE_FAILED: en ? "An imported model resource is unavailable." : "导入模型的部分资源未能加载。",
    GEOMETRY_MAIN_THREAD_FALLBACK: en ? "Worker unavailable; geometry was computed locally on the main thread." : "Worker 不可用，几何已改用本地主线程计算。"
  };
  let source = typeof item.source === "string" ? item.source : "";
  if (/^(data|blob):/i.test(source)) source = source.slice(0, source.indexOf(":")) + ":…";
  else {
    try { const url = new URL(source); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; source = url.href; }
    catch { source = source.split(/[?#]/)[0]; }
  }
  // Untrusted provider errors may contain credentials/full inline data. Show a stable
  // code and sanitized source here; diagnostics subscribers can inspect raw details.
  return `${labels[item.code] || (en ? "Scene resource warning." : "场景资源提示。")}${source ? ` ${source}` : ""} [${item.code}]`;
}

export function createSceneResourceDiagnosticsView() {
  const element = document.createElement("details");
  element.className = "sceneResourceDiagnostics"; element.hidden = true;
  Object.assign(element.style, { fontSize: "12px", lineHeight: "1.5", padding: "6px 10px", color: "inherit",
    border: "1px solid color-mix(in srgb, currentColor 18%, transparent)", borderRadius: "6px",
    background: "var(--panel-bg, var(--panel, Canvas))", maxHeight: "180px", overflow: "auto", overflowWrap: "anywhere" });
  const summary = document.createElement("summary"), list = document.createElement("ul");
  summary.style.cursor = "pointer"; list.style.paddingInlineStart = "18px";
  element.append(summary, list);
  let items = [];
  const refresh = () => {
    element.hidden = !items.length;
    summary.textContent = `${sceneDiagnosticTitle()} · ${items.length}`;
    list.replaceChildren(...items.map((item) => { const line = document.createElement("li"); line.textContent = describeSceneDiagnostic(item); return line; }));
  };
  const unsubscribe = subscribeSceneDiagnosticLanguage(refresh);
  return { element, refresh, update(next = []) { items = next; refresh(); }, dispose() { unsubscribe(); element.remove(); } };
}

export function createSceneResourceDiagnosticsOverlay(mount) {
  const view = createSceneResourceDiagnosticsView();
  Object.assign(view.element.style, { position: "absolute", bottom: "10px", left: "10px", zIndex: "25", maxWidth: "min(520px, 80%)" });
  mount?.appendChild(view.element);
  // A diagnostic click should never select or transform an object behind it.
  for (const type of ["pointerdown", "click", "dblclick", "contextmenu"]) view.element.addEventListener(type, (event) => event.stopPropagation());
  return view;
}
