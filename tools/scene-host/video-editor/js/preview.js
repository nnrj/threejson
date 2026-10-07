import { createMediaProject, prepareProjectAudio } from "@threejson/media-kit";
import { createPcmPlayback } from "@threejson/audio-kit";

/** One serialized preview worker. Stale revisions never paint over newer ones. */
export function createEditorPreview({ canvas, resolveDocument, onStatus, onTime, onError }) {
  let snapshot, revision = -1, runtimeRevision = -2, project, pending, drain, time = 0, disposed = false, controller, audio;
  let playing = false, generation = 0, origin = 0, playStart = 0, raf, context;
  const pause = () => { playing = false; generation++; cancelAnimationFrame(raf); if (audio?.playing) time = audio.time; audio?.pause(); onTime(time, false); };
  async function getProject() {
    if (project && runtimeRevision === revision) return project;
    project?.dispose(); project = undefined; audio?.dispose(); audio = undefined;
    controller?.abort(); controller = new AbortController();
    const captured = revision;
    const resolved = await resolveDocument(snapshot);
    const ratio = Math.min(1, 960 / (resolved.output?.width || 1920));
    const next = await createMediaProject(resolved, { width: Math.max(2, Math.round((resolved.output?.width || 1920) * ratio)), height: Math.max(2, Math.round((resolved.output?.height || 1080) * ratio)), signal: controller.signal, preloadNext: false });
    if (disposed || captured !== revision) { next.dispose(); return null; }
    project = next; runtimeRevision = captured; return project;
  }
  async function pump() {
    while (pending && !disposed) {
      const job = pending; pending = null;
      try {
        onStatus("正在准备预览…");
        const runtime = await getProject(); if (!runtime) continue;
        await runtime.renderAt(job.time);
        if (job.revision !== revision || pending) continue;
        canvas.width = runtime.width; canvas.height = runtime.height; canvas.getContext("2d").drawImage(runtime.canvas, 0, 0);
        onStatus(playing ? "播放中 · 低分辨率预览" : "预览已更新");
      } catch (error) { if (error.name !== "AbortError") { pause(); onStatus("预览失败 · 保留上一帧"); onError(error); } }
    }
  }
  function render(at = time) {
    time = at; pending = { time: at, revision };
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
    async setDocument(value, version) { pause(); snapshot = value; revision = version; controller?.abort(); time = Math.min(time, Math.max(0, value.timeline?.duration || Math.max(0, ...(value.timeline?.clips || []).map(c => (c.start || 0) + c.duration)))); onTime(time, false); return render(time); },
    seek(at) { pause(); time = at; onTime(time, false); return render(at); },
    pause,
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
