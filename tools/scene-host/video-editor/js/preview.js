import { createMediaProject, prepareProjectAudio } from "@threejson/media-kit";
import { createPcmPlayback } from "@threejson/audio-kit";
import { createHostPreviewPerformance, resolvePreviewPerformance } from "../../shared/js/previewPerformancePolicy.js";

/** One serialized preview worker. Stale revisions never paint over newer ones. */
export function createEditorPreview({ canvas, resolveDocument, onStatus, onTime, onError }) {
  let snapshot, revision = -1, runtimeRevision = -2, project, pending, drain, time = 0, disposed = false, controller, audio;
  let playing = false, generation = 0, origin = 0, playStart = 0, raf, context;
  let performanceMode = "auto";
  let previewRevision = 0, activePreviewRevision = -1;
  let performancePolicy, lastPreviewFrame = null;
  const pause = () => { playing = false; generation++; lastPreviewFrame = null; performancePolicy?.resetFeedback?.(); cancelAnimationFrame(raf); if (audio?.playing) time = audio.time; audio?.pause(); onTime(time, false); };
  async function getProject() {
    if (project && runtimeRevision === revision && activePreviewRevision === previewRevision) return project;
    project?.dispose(); project = undefined; audio?.dispose(); audio = undefined;
    controller?.abort(); controller = new AbortController();
    const captured = revision, capturedPreview = previewRevision;
    const resolved = await resolveDocument(snapshot);
    performancePolicy = createHostPreviewPerformance(performanceMode);
    const w = resolved.output?.width || 1920, h = resolved.output?.height || 1080;
    // This editor's preview viewport size is independent of authored output and
    // of the adaptive renderer budget, which can recover without a project rebuild.
    const ratio = Math.min(1, 960 / w);
    const next = await createMediaProject(resolved, { width: Math.max(2, Math.round(w * ratio)), height: Math.max(2, Math.round(h * ratio)), signal: controller.signal, preloadNext: false, previewPerformance: performancePolicy });
    if (disposed || captured !== revision || capturedPreview !== previewRevision) { next.dispose(); return null; }
    project = next; runtimeRevision = captured; activePreviewRevision = capturedPreview; return project;
  }
  async function pump() {
    while (pending && !disposed) {
      const job = pending; pending = null;
      try {
        onStatus("正在准备预览…");
        const runtime = await getProject(); if (!runtime) continue;
        const started = performance.now();
        await runtime.renderAt(job.time);
        if (playing) { performancePolicy?.onFrame?.({ workTimeMs: performance.now() - started, frameIntervalMs: lastPreviewFrame === null ? null : started - lastPreviewFrame, realtime: true }); lastPreviewFrame = started; }
        if (job.revision !== revision || job.previewRevision !== previewRevision || pending) continue;
        canvas.width = runtime.width; canvas.height = runtime.height; canvas.getContext("2d").drawImage(runtime.canvas, 0, 0);
        onStatus(`${playing ? "播放中" : "预览已更新"} · 正式照明 · ${runtime.width}×${runtime.height}${performancePolicy && performancePolicy.mode !== "full" ? " 节能" : ""}预览（不改变导出质量）${runtime.resourceDiagnostics?.length ? ` · ${runtime.resourceDiagnostics.length} 项资源提示` : ""}`);
      } catch (error) { if (error.name !== "AbortError") { pause(); onStatus("预览失败 · 保留上一帧"); onError(error); } }
    }
  }
  function render(at = time) {
    time = at; pending = { time: at, revision, previewRevision };
    if (!drain) drain = pump().finally(() => { drain = null; if (pending) render(pending.time); });
    return drain;
  }
  function tick() {
    if (!playing) return;
    time = Math.min(project.duration, audio ? audio.time : playStart + (performance.now() - origin) / 1000);
    onTime(time, true); render(time);
    if (time >= project.duration) { pause(); return; }
    raf = requestAnimationFrame(tick);
  }
  return {
    get time() { return time; }, get playing() { return playing; },
    setPerformance(mode) { resolvePreviewPerformance(mode); pause(); performanceMode = mode; previewRevision++; controller?.abort(); return snapshot ? render(time) : Promise.resolve(); },
    async setDocument(value, version) { pause(); snapshot = value; revision = version; controller?.abort(); time = Math.min(time, Math.max(0, value.timeline?.duration || Math.max(0, ...(value.timeline?.clips || []).map(c => (c.start || 0) + c.duration)))); onTime(time, false); return render(time); },
    seek(at) { pause(); time = at; onTime(time, false); return render(at); },
    pause,
    async inspect() {
      pause(); await render(time);
      if (!project) throw new Error("当前没有可检查的预览。");
      // A reduced preview is never the evidence used for final-quality inspection.
      const inspection = await createMediaProject(await resolveDocument(snapshot), { width: project.width, height: project.height, signal: controller.signal, preloadNext: false });
      try { await inspection.renderAt(time); return { time, width: inspection.width, height: inspection.height, lighting: "authored", previewPerformance: "full", revision, resources: inspection.resourceDiagnostics, observations: await inspection.observeCurrentFrame({ occlusion: true }) }; }
      finally { inspection.dispose(); }
    },
    async play(sound = true) {
      if (playing) { pause(); return; }
      // Resume while this is still a user gesture (before loading/decoding).
      if (sound) { context ??= new AudioContext(); await context.resume(); }
      const token = ++generation;
      await render(time); if (!project || token !== generation || disposed) return;
      if (project.duration <= 0) return;
      if (time >= project.duration) time = 0;
      if (sound) {
        const mixer = await prepareProjectAudio(project, { signal: controller.signal });
        if (token !== generation || disposed) return;
        audio?.dispose(); audio = mixer ? createPcmPlayback(mixer, { context, onError }) : null;
        if (audio) await audio.play(time, { duration: project.duration });
      } else { audio?.dispose(); audio = null; }
      if (token !== generation || disposed) { audio?.pause(); return; }
      playing = true; playStart = time; origin = performance.now(); tick();
    },
    async dispose() { disposed = true; pause(); controller?.abort(); await drain; project?.dispose(); audio?.dispose(); await context?.close(); }
  };
}
