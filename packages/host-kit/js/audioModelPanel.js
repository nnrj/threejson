import { getLocalSpeechPreference, setLocalSpeechPreference } from "./localSpeech.js";
/** Optional, explicit local-model management. No catalog downloads on open. */
export function createAudioModelPanel(container, options = {}) {
  const text = options.text || ((zh) => zh), abort = new AbortController();
  const element = (tag, content, parent = container) => {
    const node = document.createElement(tag);
    if (content !== undefined) node.textContent = content;
    parent.append(node); return node;
  };
  element("p", text(
    "通常无需操作这里：播放或导出时会自动准备默认配音资源。这里仅用于离线导入、清理缓存或选择高级运行库。AI 创作配音开关仅控制 Agent 创作阶段，不影响本次导出的自动旁白。资源不会随场景分享。",
    "Normally no action is needed here: play/export prepares the default voice automatically. These advanced controls support offline import, cache cleanup and custom runtimes. The AI-creation switch affects Agent generation only, not automatic export narration. Resources are not shared with scenes."
  ));
  const status = element("p"); status.setAttribute("role", "status");
  const controls = element("div"); controls.className = "mediaRow";
  const choose = element("button", text("读取模型清单 JSON", "Open model manifest JSON"), controls);
  const manifestInput = element("input", undefined, controls);
  manifestInput.type = "file"; manifestInput.accept = ".json"; manifestInput.hidden = true;
  const persist = element("button", text("申请持久保存", "Request persistent storage"), controls);
  const catalog = element("select", undefined, controls);
  catalog.setAttribute("aria-label", text("可选模型", "Optional models"));
  element("option", text("选择宿主提供的模型…", "Select a host-provided model…"), catalog).value = "";
  (options.catalog || []).forEach((manifest, index) => { element("option", `${manifest.id} / ${manifest.version}`, catalog).value = String(index); });
  catalog.hidden = !options.catalog?.length;
  const description = element("p"), actions = element("div"); actions.className = "mediaRow";
  const download = element("button", text("下载并缓存", "Download and cache"), actions);
  const cancel = element("button", text("取消", "Cancel"), actions); cancel.hidden = true;
  const offline=element("details");element("summary",text("从本地文件离线导入","Offline import from local files"),offline);
  const files=element("div",undefined,offline),local=element("button",text("导入所选文件","Import selected files"),offline);
  const list = element("ul");
  let manager, manifest, operation, disposed = false, busy = false, disabled = false, availableCatalog = options.catalog || [];
  const imports = new Map();
  const error = (value) => { if (!disposed) status.textContent = value.name === "AbortError" ? text("操作已取消。", "Cancelled.") : value.message; };
  function updateButtons() {
    choose.disabled = catalog.disabled = persist.disabled = busy || disabled;
    download.disabled = busy || disabled || !manifest || manifest.files.some((file) => !file.url);
    local.disabled = busy || disabled || !manifest || manifest.files.some((file) => !imports.get(file.role)?.files[0]);
    for (const button of list.querySelectorAll("button")) button.disabled = busy || disabled;
    cancel.hidden = !busy;
  }
  async function refresh() {
    if (!manager || disposed) return;
    const saved = await manager.list(), estimate = await manager.estimate();
    if (disposed) return;
    list.replaceChildren();
    for (const item of saved.filter(Boolean)) {
      const row = element("li", `${item.id} / ${item.version} · ${item.adapter} `, list);
      if (availableCatalog.some(model => model.id === item.id && model.adapter === "threejson-melo-wasm-v1")) {
        const enabled = getLocalSpeechPreference() === item.id;
        const activate = element("button", enabled ? text("停用 AI 创作配音", "Disable voice during AI creation") : text("用于 AI 创作配音", "Enable voice during AI creation"), row);
        activate.onclick = async () => { if(busy||disabled)return;try { setLocalSpeechPreference(enabled ? null : item.id); await refresh(); } catch (failure) { error(failure); } };
      }
      const remove = element("button", text("删除缓存", "Remove cache"), row);
      remove.onclick = async () => {
        if (busy || disabled) return;
        if (remove.dataset.confirm !== "yes") { remove.dataset.confirm = "yes"; remove.textContent = text("确认删除缓存", "Confirm removal"); return; }
        try { await manager.remove(item); if(getLocalSpeechPreference()===item.id)setLocalSpeechPreference(null);await refresh(); } catch (failure) { error(failure); }
      };
    }
    if (!saved.length) element("li", text("没有已缓存的模型。", "No cached models."), list);
    if (estimate?.quota) status.textContent = text(
      `站点存储已用 ${(estimate.usage / 1048576).toFixed(1)} MiB / ${(estimate.quota / 1048576).toFixed(1)} MiB；浏览器仍可能清理缓存。`,
      `Site storage: ${(estimate.usage / 1048576).toFixed(1)} / ${(estimate.quota / 1048576).toFixed(1)} MiB. Browsers may still evict data.`
    );
    updateButtons();options.onChange?.();
  }
  async function select(input) {
    const { validateAudioModelManifest } = await import("@threejson/audio-kit/models");
    if (disposed) return;
    manifest = validateAudioModelManifest(input); imports.clear(); files.replaceChildren();
    description.textContent = `${manifest.id} / ${manifest.version} · ${manifest.adapter} · ${manifest.license} · ${(manifest.files.reduce((total, file) => total + file.bytes, 0) / 1048576).toFixed(1)} MiB. ${manifest.description || ""}`;
    for (const file of manifest.files) {
      const label = element("label", `${file.role} (${file.path || file.role}): `, files);
      label.style.whiteSpace = "normal";
      const input = element("input", undefined, label); input.type = "file"; input.style.maxWidth = "100%";
      input.onchange = updateButtons; imports.set(file.role, input);
    }
    updateButtons();
  }
  async function install(fromFiles) {
    if (!manager || !manifest || busy || disabled) return;
    busy = true; operation = new AbortController(); updateButtons();
    const request = { signal: AbortSignal.any([operation.signal, abort.signal]), onProgress: (value) => { status.textContent = `${value.role}: ${Math.round(value.loaded / value.total * 100)}%`; } };
    try {
      if (fromFiles) await manager.import(manifest, Object.fromEntries([...imports].map(([role, input]) => [role, input.files[0]])), request);
      else await manager.download(manifest, request);
      await refresh();
    } catch (failure) { error(failure); }
    finally { busy = false; if (!disposed) updateButtons(); else manager.close(); }
  }
  choose.onclick = () => manifestInput.click();
  manifestInput.onchange = async () => { try { if (manifestInput.files[0]) await select(JSON.parse(await manifestInput.files[0].text())); } catch (failure) { error(failure); } };
  catalog.onchange = () => { if (catalog.value !== "") void select(availableCatalog[Number(catalog.value)]).catch(error); };
  persist.onclick = async () => { try { status.textContent = await manager.persist() ? text("已获准持久保存。", "Persistent storage granted.") : text("浏览器未批准；仍可使用普通缓存。", "Not granted; ordinary cache remains usable."); } catch (failure) { error(failure); } };
  download.onclick = () => void install(false); local.onclick = () => void install(true); cancel.onclick = () => operation?.abort();
  updateButtons();
  const ready = (async () => {
    const sdk = await import("@threejson/audio-kit/models");
    availableCatalog = options.catalog || sdk.getBuiltinAudioModels();
    if (!disposed) {
      catalog.replaceChildren(); element("option", text("选择可选模型…", "Select an optional model…"), catalog).value = "";
      availableCatalog.forEach((manifest, index) => { element("option", manifest.title || `${manifest.id} / ${manifest.version}`, catalog).value = String(index); });
      catalog.hidden = !availableCatalog.length;
    }
    const storage = await sdk.createBrowserAudioModelStorage();
    if (disposed) { storage.close?.(); return; }
    manager = sdk.createAudioModelManager(storage);
    if(availableCatalog.length){catalog.value="0";await select(availableCatalog[0]);}
    await refresh();
  })().catch(error);
  return { ready, setDisabled(value) { disabled=Boolean(value);updateButtons(); }, dispose() { disposed = true; abort.abort(); if (!busy) manager?.close(); } };
}
