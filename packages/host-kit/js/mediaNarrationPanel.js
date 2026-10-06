import { createLocalNarrationHost } from "./localSpeech.js";
import { collectExportNarration, synthesizeExportNarration } from "./mediaNarrationExport.js";

/** Explicit export-time PCM narration, shared by native and React media studio. */
export function createMediaNarrationPanel(container, options) {
  const text = options.text, node = (tag, content, owner = container) => {
    const item = document.createElement(tag); if (content !== undefined) item.textContent = content;
    owner.append(item); return item;
  };
  node("strong", text("本地 TTS 旁白", "Local TTS narration"));
  const help = node("p", text("“带音轨”只导出已有声音，不会自动朗读字幕。先安装并启用模型，再点击生成旁白；保留原配乐，仅用于本次预览和导出，不修改聊天中的 JSON。", "Include audio exports existing sound; it does not read captions. Install and enable a model, then generate narration. Original music is kept. Generated speech is used in this preview/export only; the chat JSON stays unchanged."));
  help.style.fontSize = "12px";
  const controls = node("div"); controls.className = "mediaRow";
  const sourceLabel = node("label", text("朗读来源", "Speech source"), controls), source = node("select", undefined, sourceLabel);
  source.setAttribute("aria-label", text("朗读来源", "Speech source"));
  sourceLabel.style.cssText = "flex:1 1 100%;align-items:flex-start;flex-direction:column;min-width:0";
  for (const [value, label] of [["auto", text("自动：字幕优先，其次分镜台词", "Auto: captions, then shot narration")], ["captions", text("时间线字幕", "Timeline captions")], ["shots", text("分镜台词", "Shot narration")], ["custom", text("自填文本", "Custom text")]]) node("option", label, source).value = value;
  source.style.maxWidth = "100%";
  const speedLabel = node("label", text("语速", "Speech speed"), controls), speed = node("input", undefined, speedLabel);
  speed.setAttribute("aria-label", text("语速", "Speech speed"));
  speed.type = "number"; speed.min = "0.1"; speed.step = "0.1"; speed.value = "1";
  const custom = node("textarea"); custom.rows = 3; custom.hidden = true;
  custom.setAttribute("aria-label", text("旁白文本", "Narration text")); custom.style.cssText = "width:100%;resize:vertical;min-height:80px;font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--panel2);color:var(--text)";
  const script = node("details"), summary = node("summary", text("待朗读文本", "Narration script"), script), preview = node("pre", "", script);
  preview.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;font:inherit";
  const actions = node("div"); actions.className = "mediaRow";
  const generate = node("button", text("生成本地旁白", "Generate local narration"), actions);
  const cancel = node("button", text("取消生成", "Cancel narration"), actions); cancel.hidden = true;
  const manage = node("button", text("管理语音模型", "Manage speech models"), actions);
  const useLabel = node("label", text("使用生成的旁白", "Use generated narration"), actions), use = node("input", undefined, useLabel);
  use.type = "checkbox"; use.checked = true; useLabel.hidden = true;
  const availability = node("p"), status = node("p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  let clips = [], busy = false, ready = false, disposed = false, operation, planSequence = 0;
  function buttons() { generate.disabled = !ready || busy; source.disabled = speed.disabled = custom.disabled = manage.disabled = use.disabled = busy; }
  async function readPlan(signal) {
    const kit = await options.loadMediaKit(), opened = await kit.openMediaDocument(options.getSource(), { ...options.projectOptions, signal });
    try { return await collectExportNarration(opened.document, { duration: options.getDuration(), mode: source.value, text: custom.value, loadScene: opened.loadScene, audioClips: await options.getAudioClips(), signal }); }
    finally { opened.dispose(); }
  }
  const report = error => {
    if (disposed) return;
    status.textContent = error.name === "AbortError" ? text("已取消生成旁白。", "Narration cancelled.")
      : error.code === "LOCAL_NARRATION_UNAVAILABLE" ? text("尚未安装并启用本地语音模型。请打开“管理语音模型”。", "Install and enable a local speech model under Manage speech models.")
        : error.code === "NARRATION_EXCEEDS_CUE" ? text(`第 ${error.cue} 段旁白需 ${error.required.toFixed(2)} 秒，可用 ${error.available.toFixed(2)} 秒。请提高语速、缩短文字或延长对应字幕/分镜，再重新生成；未截断旁白。`, `Cue ${error.cue} needs ${error.required.toFixed(2)}s, but has ${error.available.toFixed(2)}s. Increase speech speed, shorten the text or extend its caption/shot. Speech was not truncated.`)
          : error.code === "NARRATION_CUES_OVERLAP" ? text("字幕时间重叠，无法同时朗读。请改用分镜台词或自填文本。", "Overlapping captions cannot be narrated simultaneously. Use shot narration or custom text.") : String(error.message || error);
  };
  async function refreshScript() {
    const sequence = ++planSequence;
    try {
      const plan = await readPlan(options.signal);
      if (disposed || sequence !== planSequence) return;
      preview.textContent = plan.cues.map(c => `${c.start.toFixed(2)}s · ${c.text}`).join("\n") || text("没有可朗读的字幕/台词，可选择“自填文本”。", "No narration text found. Select Custom text.");
      summary.textContent = text(`待朗读文本 · ${plan.cues.length} 段${plan.skipped ? `（跳过 ${plan.skipped} 段已有旁白）` : ""}`, `Narration script · ${plan.cues.length} cues${plan.skipped ? ` (${plan.skipped} with existing narration skipped)` : ""}`);
    } catch (error) { report(error); }
  }
  async function refreshAvailability() {
    let host;
    try {
      host = await (options.createNarrationHost || createLocalNarrationHost)();
      if (!disposed) availability.textContent = host.available ? text(`本地模型已就绪：${host.model}。可在本机生成或更新旁白。`, `Local model ready: ${host.model}. Narration can be generated or updated on this device.`)
        : text("本地旁白未就绪：仅选择模型不等于已下载或启用。", "Local narration is not ready: selecting a model does not install or enable it.");
    } catch (error) { report(error); } finally { host?.dispose(); }
  }
  async function invalidate() {
    custom.hidden = source.value !== "custom";
    const hadAudio = clips.length > 0; clips = []; useLabel.hidden = true; status.textContent = "";
    if (hadAudio) await options.onChange();
    await refreshScript();
  }
  source.onchange = speed.onchange = custom.oninput = () => void invalidate().catch(report);
  manage.onclick = () => options.openModels();
  use.onchange = () => {
    status.textContent = use.checked ? text("本次预览与导出已启用生成的旁白。", "Generated narration is enabled for this preview/export.") : text("已停用生成的旁白，原有音轨不受影响。", "Generated narration is disabled; original audio is unchanged.");
    void options.onChange({enableAudio:use.checked}).catch(report);
  };
  cancel.onclick = () => operation?.abort();
  generate.onclick = async () => {
    if (!ready || busy) return;
    if (!(Number.isFinite(Number(speed.value)) && Number(speed.value) > 0)) { report(new Error(text("语速必须为正数。", "Speech speed must be positive."))); return; }
    busy = true; options.onBusy(true); buttons(); cancel.hidden = false; operation = new AbortController();
    const signal = AbortSignal.any([operation.signal, options.signal]);
    let host;
    try {
      status.textContent = text("正在准备本地旁白…", "Preparing local narration…");
      const plan = await readPlan(signal);
      if (!plan.cues.length) throw new Error(plan.skipped ? text("对应段落已有旁白，无需重复合成。", "These cues already have narration; no synthesis is needed.") : text("没有可朗读的字幕或台词。请选择“自填文本”并填写旁白。", "No captions or narration found. Select Custom text and enter narration."));
      host = await (options.createNarrationHost || createLocalNarrationHost)();
      const generated = await synthesizeExportNarration(plan, host, { speed: Number(speed.value), signal, onProgress: p => { status.textContent = text(`正在本地合成旁白 ${p.cue}/${p.cues}…`, `Synthesizing local narration ${p.cue}/${p.cues}…`); } });
      signal.throwIfAborted(); clips = generated; use.checked = true; useLabel.hidden = false;
      await options.onChange({enableAudio:true});
      status.textContent = text(`已生成 ${plan.cues.length} 段旁白，将随“带音轨”一起导出。点击播放可试听。`, `Generated ${plan.cues.length} narration cues. Include audio will export them. Press Play to preview.`);
    } catch (error) { report(error); }
    finally { host?.dispose(); busy = false; if (!disposed) { cancel.hidden = true; options.onBusy(false); buttons(); } }
  };
  buttons(); void refreshAvailability();
  return {
    getAudioClips: () => use.checked ? clips : [],
    setState(value) { ready = value.ready; busy = value.busy; buttons(); },
    refreshScript, refreshAvailability,
    dispose() { disposed = true; operation?.abort(); clips = []; }
  };
}
