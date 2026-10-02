/** Optional composition card. Uses the same viewport pool as ordinary scenes;
 * it owns one frame producer, not a permanently live renderer per shot.
 */
import { loadMediaKit, createMediaAudioPlayback } from "./mediaStudio.js";
export function createMediaCardSession(options = {}) {
  let document = null, project = null, viewport = null, preview = null, disposed = false, time = 0, frame = 0, playing = false;
  let queue = Promise.resolve(), controller = new AbortController(), transport = null;
  let audioPlayback = null, mixerPrepared = false;
  let generation = 0, unlinkSignal = () => {};
  const key = {}, pool = options.viewportPool;
  const check = () => { if (disposed) throw new DOMException("Media card disposed.", "AbortError"); };
  const enqueue = fn => { const task = queue.then(() => { check(); return fn(); }); queue = task.catch(() => {}); return task; };
  const emit = dormant => options.onViewportStateChanged?.({ dormant, preview });
  const stop = () => { playing = false; cancelAnimationFrame(frame); audioPlayback?.pause(); };
  const hidden = () => { if (globalThis.document?.hidden) stop(); };
  globalThis.document?.addEventListener("visibilitychange", hidden);
  const release = () => { stop(); audioPlayback?.dispose(); audioPlayback = null; mixerPrepared = false; project?.dispose(); project = null; transport?.remove(); transport = null; viewport?.dispose(); viewport = null; };
  const suspend = () => enqueue(() => { try { preview = project?.canvas.toDataURL("image/png") || preview; } catch { /* tainted canvas has no snapshot */ } release(); emit(true); });
  const unregister = pool?.register(key, suspend);
  const run = fn => pool ? pool.run(key, () => enqueue(fn), options.getViewportLimit?.() ?? 1) : enqueue(fn);
  async function activate() {
    if (project) return;
    const lifetime = controller;
    check(); lifetime.signal.throwIfAborted(); await options.beforePrepare?.({ signal: lifetime.signal });
    const kit = await loadMediaKit();
    lifetime.signal.throwIfAborted(); check();
    const source = typeof document === "string" ? JSON.parse(document) : document;
    viewport = await options.createViewport?.();
    if (!viewport?.canvas) throw new Error("Composition card needs a viewport canvas.");
    try {
      project = await kit.createMediaProject(source, { canvas: viewport.canvas, width: viewport.canvas.width, height: viewport.canvas.height, signal: lifetime.signal,
        createScene: options.createRuntime, runtimeOptions: options.getRuntimeOptions?.({ authoritative: true }) });
      await project.renderAt(Math.min(time, Math.max(0, project.duration - .001))); check();
      viewport.commit({ resize() {}, renderOnce() {} });
      // A composition is a fixed-aspect movie, not an interactive perspective
      // camera. Scale the compositor when a chat/mobile viewport changes size.
      Object.assign(viewport.canvas.style, { width: "100%", height: "100%", objectFit: "contain" });
      options.onRuntimeChanged?.(null, null); emit(false);
      const owner = viewport.canvas.parentElement;
      if (owner) {
        transport = globalThis.document.createElement("div");
        Object.assign(transport.style, { position: "absolute", left: "8px", right: "8px", bottom: "8px", display: "flex", gap: "8px", alignItems: "center", background: "#111b", color: "white", padding: "6px", borderRadius: "6px" });
        const button = globalThis.document.createElement("button"), slider = globalThis.document.createElement("input"), label = globalThis.document.createElement("output");
        button.type = "button"; button.textContent = "▶"; button.title = "Play / Pause";
        slider.type = "range"; slider.min = "0"; slider.max = String(project.duration); slider.step = ".01"; slider.value = String(time); slider.setAttribute("aria-label", "Video time"); slider.style.flex = "1"; slider.style.minWidth = "35px";
        label.style.fontSize = "11px"; label.style.whiteSpace = "nowrap";
        label.textContent = `${time.toFixed(1)} / ${project.duration.toFixed(1)}s`;
        const paint = async value => { if (!project) return; time = value; await project.renderAt(Math.min(value, Math.max(0, project.duration - .000001))); slider.value = String(value); label.textContent = `${value.toFixed(1)} / ${project.duration.toFixed(1)}s`; };
        slider.oninput = () => { stop(); button.textContent = "▶"; void enqueue(() => paint(Number(slider.value))).catch(options.onError || console.warn); };
        button.onclick = async () => {
          if (playing) { stop(); button.textContent = "▶"; return; }
          playing = true; button.textContent = "❚❚"; if (time >= project.duration) time = 0;
          try {
            if (!mixerPrepared) {
              const ownerProject = project;
              const mixer = await kit.prepareProjectAudio(ownerProject, { signal: controller.signal });
              if (project !== ownerProject || disposed) return;
              const playback = mixer ? await createMediaAudioPlayback(mixer, { onError: options.onError }) : null;
              if (project !== ownerProject || disposed) { playback?.dispose(); return; }
              audioPlayback = playback;
              mixerPrepared = true;
            }
            if (!playing || !project || disposed) return;
            await audioPlayback?.play(time, { duration: project.duration });
          } catch (error) { options.onError?.(error); }
          if (!playing || !project || disposed) return;
          const start = performance.now() - time * 1000;
          const tick = async () => {
            if (!playing || !project || disposed) return;
            try { await enqueue(() => paint(Math.min(project.duration, audioPlayback?.playing ? audioPlayback.time : (performance.now() - start) / 1000))); }
            catch (e) { stop(); options.onError?.(e); }
            if (project && time >= project.duration) { stop(); button.textContent = "▶"; }
            if (playing) frame = requestAnimationFrame(tick);
          }; void tick();
        };
        const studio = globalThis.document.createElement("button"); studio.type = "button"; studio.textContent = "▣"; studio.title = "Timeline / audio / export";
        studio.onclick = async () => { stop(); button.textContent = "▶"; const { openSceneMediaStudio } = await import("./mediaStudio.js"); await openSceneMediaStudio(source); };
        const shots = globalThis.document.createElement("select"); shots.title = "分镜 / Shots"; shots.setAttribute("aria-label", shots.title); shots.style.maxWidth = "25%";
        for (const clip of source.timeline?.clips || []) {
          const item = globalThis.document.createElement("option"), metadata = source.production?.shots?.[clip.id];
          item.value = String(clip.start || 0); item.textContent = `${metadata?.stage === "planned" ? "◻ " : ""}${metadata?.title || clip.id}`; shots.append(item);
        }
        shots.onchange = () => { stop(); button.textContent = "▶"; void enqueue(() => paint(Number(shots.value))).catch(options.onError || console.warn); };
        if (source.production?.state === "storyboard" || source.production?.stopReason === "storyboard_approval_required") label.textContent = "分镜待确认 / Approve storyboard";
        transport.append(button, slider, label, shots, studio); owner.append(transport);
      }
    } catch (e) { release(); throw e; }
  }
  const api = {
    get runtime() { return null; }, get session() { return null; }, get document() { return typeof document === "string" ? JSON.parse(document) : document; },
    async render(input, settings = {}) {
      const captured = typeof input === "string" ? input : structuredClone(input);
      const current = ++generation;
      unlinkSignal(); controller.abort(); controller = new AbortController();
      const lifetime = controller, abort = () => lifetime.abort(settings.signal.reason);
      if (settings.signal?.aborted) abort(); else settings.signal?.addEventListener("abort", abort, { once: true });
      unlinkSignal = () => settings.signal?.removeEventListener("abort", abort);
      return (settings.defer ? enqueue : run)(async () => {
        if (current !== generation) throw new DOMException("Media card render superseded.", "AbortError");
        lifetime.signal.throwIfAborted(); release(); time = 0; document = captured; options.onDocumentChanged?.(api.export());
        if (!settings.defer) await activate(); else emit(true); return null;
      });
    },
    export() { return structuredClone(api.document); },
    update(input, settings) { return api.render(input, settings).then(() => api.export()); },
    suspend() { return pool ? pool.suspend(key) : suspend(); }, resume() { return run(activate); },
    setViewportLimit(value) { return pool?.setLimit(value); }, get preview() { return preview; },
    execute() { throw new Error("Use media.shot.edit / timeline.edit for a film, not scene commands on its composition root."); },
    withRuntime() { throw new Error("Select a shot in the media studio before model export/editing."); },
    dispose() { if (disposed) return; disposed = true; unlinkSignal(); controller.abort(); unregister?.(); globalThis.document?.removeEventListener("visibilitychange", hidden); release(); document = null; }
  };
  return api;
}
