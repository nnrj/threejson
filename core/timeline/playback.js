import { createSceneClock } from "./clock.js";
import { validateTimeline, getTimelineDuration, finiteTime, timelineError } from "./schema.js";
import { compileTimelineTracks } from "./tracks.js";
import { evaluateDeclarativeAnimationsAt } from "../handler/animationHandler.js";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";
import { whenTextureReady, getMaterialTextureRequests } from "../resource/textureRequest.js";
import { getSceneMediaTextureControllers } from "../resource/mediaTextureTimeline.js";
import { whenObjectReady } from "../resource/objectReadiness.js";
const wrappedDisposers = new WeakSet();

function untilAborted(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}

/** Await resources actually used by this scene, including shader textures. */
export async function prepareTimelineResources(runtime, options = {}) {
  const textures = new Set(), pending = [];
  const visit = (value) => { if (value?.isTexture) textures.add(value); };
  runtime.scene.traverse((object) => {
    for (const material of [].concat(object.material || [])) {
      getMaterialTextureRequests(material).forEach(visit);
      Object.values(material).forEach(visit);
      Object.values(material.uniforms || {}).forEach((uniform) => {
        if (Array.isArray(uniform.value)) uniform.value.forEach(visit); else visit(uniform.value);
      });
    }
    pending.push(whenObjectReady(object));
  });
  visit(runtime.scene.background); visit(runtime.scene.environment);
  await untilAborted(Promise.all([...textures].map(whenTextureReady).concat(pending)), options.signal);
  const errors = runtime.runtimeContext?.resourceDiagnostics?.filter((entry) => entry.status === "failed" || entry.severity === "error" || /FAILED|MISSING/.test(entry.code)) || [];
  if (errors.length) throw timelineError("TIMELINE_RESOURCE_FAILED", "Scene resources failed to load.", { diagnostics: errors });
}

/** Runtime-only playback: never writes authoring JSON, undo history or business events. */
export function createSceneTimelineController(runtime, input = {}, options = {}) {
  if (!runtime?.scene) throw new TypeError("Timeline requires a scene runtime.");
  const timeline = validateTimeline(input);
  const inferredDuration = getTimelineDuration(timeline);
  const duration = options.duration ?? (timeline.duration !== undefined || inferredDuration > 0 ? inferredDuration : Infinity);
  const clock = createSceneClock({ duration, loop: timeline.loop, rate: timeline.rate ?? 1 });
  const ctx = runtime.runtimeContext || resolveRuntimeContext(runtime.scene, { fallback: false });
  ctx?.particleSimulationExtension?.assertSeekable();
  const step = timeline.simulationStep ?? 1 / 60;
  let ticks = 0, disposed = false, evaluatedTime = null;
  const media = getSceneMediaTextureControllers(runtime.scene);
  let pendingMedia = Promise.resolve();
  const initial = new Map();
  const capture = (object) => initial.set(object, {
    position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
    visible: object.visible, morph: object.morphTargetInfluences?.slice()
  });
  runtime.scene.traverse((object) => {
    if (object.userData?.objJson?.animations || timeline.tracks.some((track) => track.property === "lookAt" && track.target === (object.userData?.threeJsonId || object.userData?.objJson?.threeJsonId))) capture(object);
  });
  const controlsLocked = timeline.tracks.some((track) => track.enabled !== false &&
    (track.target === "$camera" || track.target === (runtime.camera?.userData?.threeJsonId || runtime.camera?.userData?.objJson?.threeJsonId)));
  if (controlsLocked && runtime.camera && !initial.has(runtime.camera)) capture(runtime.camera);
  const tracks = compileTimelineTracks(runtime, timeline.tracks, options);
  function restoreTransforms() {
    for (const [object, state] of initial) {
      object.position.copy(state.position); object.quaternion.copy(state.quaternion); object.scale.copy(state.scale); object.visible = state.visible;
      if (state.morph) for (let i = 0; i < state.morph.length; i++) object.morphTargetInfluences[i] = state.morph[i];
    }
    tracks.restore();
  }
  function resetSimulation() {
    ticks = 0;
    options.effects?.reset?.();
    ctx?.particleCpuSimulation?.resetTime(); ctx?.particleGpuCompute?.resetTime();
    ctx?.particleSimulationExtension?.resetTime(); ctx?.animationStateMachine?.resetTime();
  }
  function evaluateAt(value) {
    if (disposed) throw timelineError("TIMELINE_DISPOSED", "Timeline has been disposed.");
    finiteTime(value, "time");
    const time = Math.min(value, duration), targetTicks = Math.floor(time / step + 1e-9);
    if (time === evaluatedTime) return time;
    restoreTransforms();
    options.effects?.restore?.();
    if (targetTicks < ticks) resetSimulation();
    // Integer ticks, never rounded frame deltas: all output fps share the same
    // simulation sequence, including backward/random seeks.
    while (ticks < targetTicks) {
      ctx?.particleCpuSimulation?.update(step); ctx?.particleGpuCompute?.updateParticleGpuCompute(step);
      ctx?.particleSimulationExtension?.update(step); ctx?.animationStateMachine?.updateAnimationStateMachines(runtime.scene, step);
      ticks++;
    }
    evaluateDeclarativeAnimationsAt(runtime.scene, time);
    ctx?.animationMixer?.evaluateAt(time); ctx?.pointsMotion?.evaluateAt(time);
    ctx?.planeScrollMotion?.evaluateAt(time); ctx?.shaderMotion?.evaluateAt(time, { scene: runtime.scene });
    tracks.evaluate(time);
    options.effects?.evaluateAt(time);
    runtime.scene.updateMatrixWorld(true); runtime.camera?.updateMatrixWorld(true);
    evaluatedTime = time;
    // Serialise decoding seeks. Exports await this; interactive playback can show
    // the last decoded frame instead of blocking the browser event loop.
    pendingMedia = pendingMedia.catch(() => {}).then(() => Promise.all(media.map((item) => item.evaluateAt(time))));
    pendingMedia.catch(() => {}); // renderAt observes and reports decode errors.
    return time;
  }
  const api = {
    timeline, clock, controlsLocked, get time() { return clock.time; }, get duration() { return duration; }, get playing() { return clock.playing; },
    evaluateAt,
    seek(time) { clock.seek(time); evaluateAt(clock.time); runtime.renderLoop?.renderCurrentFrame(); return clock.time; },
    advance(delta) { clock.advance(delta); evaluateAt(clock.time); },
    play() { clock.play(); runtime.renderLoop?.start(); }, pause() { clock.pause(); },
    reset() { clock.reset(); evaluatedTime = null; resetSimulation(); return api.seek(0); },
    async renderAt(time) { clock.seek(time); evaluateAt(clock.time); await pendingMedia; await options.beforeRender?.(clock.time, runtime); runtime.renderLoop?.renderCurrentFrame(); return runtime.renderer?.domElement; },
    dispose() { if (disposed) return; disposed = true; clock.pause(); runtime.renderLoop?.setTimeDriver(null); initial.clear(); }
  };
  resetSimulation(); evaluateAt(0);
  runtime.renderLoop?.setTimeDriver(api);
  return api;
}

export async function attachSceneTimeline(runtime, timeline, options = {}) {
  runtime.timeline?.dispose();
  await prepareTimelineResources(runtime, options);
  if (timeline.effects?.length) {
    const { prepareParticleEffects } = await import("./particleEffects.js");
    options = { ...options, effects: await prepareParticleEffects(runtime, timeline.effects) };
  }
  options.signal?.throwIfAborted();
  const controller = createSceneTimelineController(runtime, timeline, options);
  runtime.timeline = controller;
  if (!wrappedDisposers.has(runtime)) {
    const dispose = runtime.dispose;
    runtime.dispose = () => { runtime.timeline?.dispose(); dispose?.call(runtime); };
    wrappedDisposers.add(runtime);
  }
  if (options.autoPlay !== false) controller.play();
  return controller;
}
