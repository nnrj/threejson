import { prepareDefaultLocalNarrationHost } from "./localSpeech.js";
import { collectExportNarration, synthesizeExportNarration } from "./mediaNarrationExport.js";

/** Advanced settings only. Export/preview owns the single cancellable operation;
 * there is deliberately no separate Generate/Install/Enable workflow here.
 */
export function createMediaNarrationPanel(container, options) {
  const text = options.text, node = (tag, content, owner = container) => {
    const item = document.createElement(tag); if (content !== undefined) item.textContent = content;
    owner.append(item); return item;
  };
  const controls = node("div"); controls.className = "mediaRow";
  const sourceLabel = node("label", text("朗读来源", "Speech source"), controls), source = node("select", undefined, sourceLabel);
  source.setAttribute("aria-label", text("朗读来源", "Speech source"));
  for (const [value, label] of [["auto", text("自动：字幕优先，其次分镜台词", "Auto: captions, then shot narration")], ["captions", text("时间线字幕", "Timeline captions")], ["shots", text("分镜台词", "Shot narration")], ["custom", text("自填文本", "Custom text")]]) node("option", label, source).value = value;
  const speedLabel = node("label", text("语速", "Speech speed"), controls), speed = node("input", undefined, speedLabel);
  speed.type = "number"; speed.min = "0.5"; speed.max = "2"; speed.step = "0.1"; speed.value = "1";
  const fitLabel = node("label", text("自动适应字幕时长", "Fit speech to cue timing"), controls), fit = node("input", undefined, fitLabel);
  fit.type = "checkbox"; fit.checked = true;
  const custom = node("textarea"); custom.rows = 3; custom.hidden = true;
  custom.setAttribute("aria-label", text("旁白文本", "Narration text"));
  const script = node("details"), summary = node("summary", text("待朗读文本", "Narration script"), script), preview = node("pre", "", script);
  preview.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;font:inherit";
  node("p", text("导出或播放时自动合成，保留原有配乐，不修改聊天中的 JSON。自动适时只会适度加速，不截断台词。网页无法录出浏览器/Windows 内置朗读的音频，因此使用可写入视频的本地配音引擎，不调用付费接口。", "Speech is generated automatically on export or play. Existing music and the chat JSON are preserved. Timing adjustment uses moderate acceleration, never truncated speech. Web pages cannot capture browser/Windows speech output, so this uses a local engine with exportable audio, not a paid API."));
  let clips = [], cacheKey = null, disposed = false, planSequence = 0;

  async function readPlan(signal) {
    const kit = await options.loadMediaKit(), opened = await kit.openMediaDocument(options.getSource(), { ...options.projectOptions, signal });
    try { return await collectExportNarration(opened.document, { duration: options.getDuration(), mode: source.value, text: custom.value, loadScene: opened.loadScene, audioClips: await options.getAudioClips(), signal }); }
    finally { opened.dispose(); }
  }
  function describe(plan) {
    preview.textContent = plan.cues.map(c => `${c.start.toFixed(2)}s · ${c.text}`).join("\n") || text("没有可朗读的字幕/台词，可选择“自填文本”。", "No narration text found. Select Custom text.");
    summary.textContent = text(`待朗读文本 · ${plan.cues.length} 段${plan.skipped ? `（跳过 ${plan.skipped} 段已有旁白）` : ""}`, `Narration script · ${plan.cues.length} cues${plan.skipped ? ` (${plan.skipped} with existing narration skipped)` : ""}`);
    options.onSummary?.({ cues: plan.cues.length, skipped: plan.skipped, prepared: clips.length > 0 });
  }
  async function refreshScript() {
    const sequence = ++planSequence;
    try { const plan = await readPlan(options.signal); if (!disposed && sequence === planSequence) describe(plan); }
    catch (error) { if (!disposed && error.name !== "AbortError") options.onError?.(error); }
  }
  function friendlyError(error) {
    if (error.code === "LOCAL_NARRATION_DOWNLOAD_FAILED") error.message = text("配音资源下载失败，未导出无声视频。请检查网络后重新导出；也可在高级设置中离线导入，或主动选择“仅原有音轨”。", "Speech resource download failed; no silent video was exported. Check the connection and retry, import resources in advanced settings, or explicitly select Existing audio only.");
    else if (error.code === "LOCAL_NARRATION_UNAVAILABLE") error.message = text("本地配音引擎不可用，未导出无声视频。请重试，或主动选择“仅原有音轨”。", "The local speech engine is unavailable; no silent video was exported. Retry, or explicitly select Existing audio only.");
    else if (error.code === "NARRATION_EXCEEDS_CUE") error.message = text(`第 ${error.cue} 段旁白需 ${error.required.toFixed(1)} 秒，可用 ${error.available.toFixed(1)} 秒，未截断台词。请在更多设置中调整语速/文本，或延长对应字幕。`, `Cue ${error.cue} needs ${error.required.toFixed(1)}s, but has ${error.available.toFixed(1)}s; speech was not truncated. Adjust the text/speed in More settings or extend the caption.`);
    else if (error.code === "NARRATION_CUES_OVERLAP") error.message = text("字幕时间重叠，无法同时朗读。请在更多设置中选择分镜台词或自填文本。", "Overlapping captions cannot be narrated simultaneously. Choose shot narration or custom text in More settings.");
    return error;
  }
  const invalidate = () => {
    custom.hidden = source.value !== "custom";
    clips = []; cacheKey = null;
    void Promise.resolve(options.onChange?.()).then(refreshScript).catch(error => options.onError?.(error));
  };
  source.onchange = speed.onchange = fit.onchange = custom.onchange = invalidate;
  return {
    getAudioClips: () => clips,
    setState({ busy }) { for (const input of [source, speed, fit, custom]) input.disabled = busy; },
    refreshScript,
    async prepare({ signal, onProgress } = {}) {
      signal?.throwIfAborted();
      const speechSpeed = Number(speed.value);
      if (!Number.isFinite(speechSpeed) || speechSpeed < .5 || speechSpeed > 2) throw new Error(text("语速应为 0.5～2。", "Speech speed must be between 0.5 and 2."));
      const plan = await readPlan(signal), key = JSON.stringify([plan, speechSpeed, fit.checked]);
      if (key === cacheKey) return clips;
      // No text (or already-narrated cues) must never trigger a model download.
      if (!plan.cues.length) { clips = []; cacheKey = key; describe(plan); return clips; }
      let host;
      try {
        onProgress?.({ stage: "narration-prepare" });
        host = await (options.createNarrationHost || prepareDefaultLocalNarrationHost)({ signal, onProgress });
        const generated = await synthesizeExportNarration(plan, host, { speed: speechSpeed, maxSpeed: fit.checked ? Math.min(2, speechSpeed * 1.5) : speechSpeed, signal, onProgress });
        signal?.throwIfAborted();
        if (disposed) throw new DOMException("Narration disposed", "AbortError");
        clips = generated; cacheKey = key; describe(plan);
        return clips;
      } catch (error) { throw friendlyError(error); }
      finally { host?.dispose(); }
    },
    dispose() { disposed = true; clips = []; cacheKey = null; }
  };
}
