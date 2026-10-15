import { BufferGeometry, BufferAttribute, Vector2 } from "three";

export const FULL_PREVIEW_BUDGET = Object.freeze({ mode: "full", maxPixelRatio: Infinity, maxPixels: Infinity, maxPoints: Infinity, lodBias: 1 });

/** Numeric execution limits, not product/device presets. Omission is unlimited. */
export function resolvePreviewBudget(options) {
  if (options == null || options === false || options === "full") return FULL_PREVIEW_BUDGET;
  if (typeof options !== "object") throw new TypeError("Preview performance requires numeric limits or an injected policy object.");
  const input = options.getBudget ? options.getBudget() : options;
  if (!input || typeof input !== "object") throw new TypeError("Preview policy must return a budget object.");
  const profile = { ...FULL_PREVIEW_BUDGET };
  for (const key of ["maxPixelRatio", "maxPixels", "maxPoints", "lodBias"]) {
    const value = input[key] ?? profile[key];
    if (typeof value !== "number" || !(value > 0) || (key === "lodBias" && !Number.isFinite(value))) throw new RangeError(`Invalid preview budget ${key}.`);
    profile[key] = value;
  }
  if (profile.maxPoints !== Infinity && !Number.isSafeInteger(profile.maxPoints)) throw new RangeError("Preview maxPoints must be an integer.");
  if (profile.maxPixelRatio !== Infinity || profile.maxPixels !== Infinity || profile.maxPoints !== Infinity || profile.lodBias !== 1) profile.mode = "limited";
  return profile;
}

/** Draw-only budgets: original geometry, LOD state and document survive even a
 * renderer failure. Simulations/time are never skipped, so random seeks stay
 * deterministic. Post-processing keeps every authored pass, at capped resolution.
 * This is not a simulation-memory limiter or an automatic mesh simplifier. */
export function createPreviewPerformance(options) {
  const size = new Vector2(), geometries = new Map();
  let resolution = null;
  const pixelRatio = (requested, width, height, profile = resolvePreviewBudget(options)) => Math.min(requested, profile.maxPixelRatio,
    Math.sqrt(profile.maxPixels / Math.max(1, width * height)));
  function restoreResolution() {
    if (!resolution) return;
    const { renderer, composer, requested, applied, composerRequested, composerApplied } = resolution;
    if (renderer.getPixelRatio() === applied && requested !== applied) renderer.setPixelRatio(requested);
    if (composer?.setPixelRatio && composer._pixelRatio === composerApplied && composerRequested !== composerApplied) composer.setPixelRatio(composerRequested);
    resolution = null;
  }
  function constrainResolution(renderer, composer) {
    if (!renderer?.getSize || !renderer.getPixelRatio || !renderer.setPixelRatio) return;
    if (resolution && (resolution.renderer !== renderer || resolution.composer !== composer)) restoreResolution();
    if (!resolution) resolution = { renderer, composer, requested: renderer.getPixelRatio(), composerRequested: composer?._pixelRatio ?? renderer.getPixelRatio() };
    // An explicit host resize overrides the remembered request, not vice versa.
    if (resolution.applied !== undefined && renderer.getPixelRatio() !== resolution.applied) resolution.requested = renderer.getPixelRatio();
    if (resolution.composerApplied !== undefined && composer?._pixelRatio !== undefined && composer._pixelRatio !== resolution.composerApplied) resolution.composerRequested = composer._pixelRatio;
    renderer.getSize(size);
    const next = pixelRatio(resolution.requested, size.x, size.y), nextComposer = pixelRatio(resolution.composerRequested, size.x, size.y);
    if (Math.abs(renderer.getPixelRatio() - next) > 1e-6) renderer.setPixelRatio(next);
    if (composer?.setPixelRatio && composer._pixelRatio !== nextComposer) composer.setPixelRatio(nextComposer);
    resolution.applied = next; resolution.composerApplied = nextComposer;
  }
  function sampledGeometry(original, start, count, limit) {
    let entry = geometries.get(original);
    if (!entry) {
      entry = { geometry: new BufferGeometry(), key: "" }; geometries.set(original, entry);
      entry.dispose = () => { entry.geometry.dispose(); original.removeEventListener("dispose", entry.dispose); geometries.delete(original); };
      original.addEventListener("dispose", entry.dispose);
    }
    const geometry = entry.geometry, key = `${start}:${count}:${limit}:${original.index?.version || 0}`;
    if (entry.key !== key || entry.index !== original.index) {
      // Evenly cover the complete point set, not its first N vertices (which can
      // erase the end of a particle title or one side of a point-cloud object).
      const indices = new Uint32Array(limit);
      for (let i = 0; i < limit; i++) {
        const source = start + Math.min(count - 1, Math.floor((i + .5) * count / limit));
        indices[i] = original.index ? original.index.getX(source) : source;
      }
      // Reuse the allocation while population/limit stay stable. Disposal also
      // frees an old GPU index when a dynamic emitter changes its population.
      geometry.dispose(); geometry.setIndex(new BufferAttribute(indices, 1));
      entry.key = key; entry.index = original.index;
    }
    geometry.attributes = original.attributes;
    geometry.morphAttributes = original.morphAttributes; geometry.morphTargetsRelative = original.morphTargetsRelative;
    geometry.boundingBox = original.boundingBox; geometry.boundingSphere = original.boundingSphere;
    return geometry;
  }
  function draw(scene, camera, renderer, composer, render) {
    const profile = resolvePreviewBudget(options);
    if (profile.mode === "full" && !resolution) return render();
    constrainResolution(renderer, composer);
    if (profile.mode === "full") {
      for (const entry of [...geometries.values()]) entry.dispose();
      return render();
    }
    const points = [], restores = [], used = new Set();
    let total = 0;
    try {
      scene?.traverseVisible?.(object => {
        if (object.isLOD && object.autoUpdate !== false) {
          const levels = object.levels.map(level => ({ level, distance: level.distance, visible: level.object.visible })), current = object._currentLevel;
          restores.push(() => { for (const { level, distance, visible } of levels) { level.distance = distance; level.object.visible = visible; } object._currentLevel = current; });
          for (const { level } of levels) level.distance /= profile.lodBias;
        }
        const g = object.geometry;
        if (!object.isPoints || !g?.attributes?.position || g.isInstancedBufferGeometry || g.groups.length) return;
        const length = g.index?.count ?? g.attributes.position.count;
        const start = Math.max(0, Math.floor(g.drawRange.start || 0));
        const count = Math.max(0, Math.min(length - start, g.drawRange.count));
        if (count > 0) { points.push({ object, g, start, count }); total += count; }
      });
      if (total > profile.maxPoints) for (const { object, g, start, count } of points) {
        const limit = Math.max(1, Math.floor(count * profile.maxPoints / total));
        if (count <= limit) continue;
        restores.push(() => { object.geometry = g; }); used.add(g);
        object.geometry = sampledGeometry(g, start, count, limit);
      }
      return render();
    } finally {
      for (let i = restores.length - 1; i >= 0; i--) restores[i]();
      for (const [original, entry] of geometries) if (!used.has(original)) entry.dispose();
    }
  }
  return { get profile() { return resolvePreviewBudget(options); }, pixelRatio, constrainResolution, draw,
    reportFrame(sample) { options?.onFrame?.(sample); },
    resetFeedback() { options?.resetFeedback?.(); },
    dispose() { restoreResolution(); for (const entry of [...geometries.values()]) entry.dispose(); } };
}
