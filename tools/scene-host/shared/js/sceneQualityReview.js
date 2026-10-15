import { runCreationQualityReview, providerSupportsVision, observeSceneRuntime, captureSceneFrame, measureSubjectRegions, sceneQualityRevision } from "threejson/visual-quality";
import { resolveCreationQuality, qualityReportMessage } from "./creationQualityPolicy.js";
import { requestChatCompletion, updateSceneJsonString, parseSceneJsonString, validateSceneJson } from "threejson/ai";
import { createJsonScene } from "threejson/runtime";
import { sceneHostAssetUrl } from "./sceneHostPaths.js";
import { loadMediaKit } from "./mediaStudio.js";

export function mediaReviewSamples(document, profile) {
  const times = [];
  for (const clip of document.timeline?.clips || []) {
    if (clip.enabled === false || !(clip.duration > 0)) continue;
    for (let i = 0; i < profile.samplesPerShot; i++) times.push({ clipId: clip.id, time: (clip.start || 0) + clip.duration * (i + 1) / (profile.samplesPerShot + 1) });
    if (profile.samplesPerShot > 1 && (clip.fadeIn || clip.transitionIn?.duration)) times.push({ clipId: clip.id, time: (clip.start || 0) + Math.min(clip.duration, clip.fadeIn || clip.transitionIn.duration) / 2 });
  }
  const sorted = times.sort((a, b) => a.time - b.time);
  // Bound local inspection, not authored duration/frame rate. Every skipped
  // frame remains in the work and export; the report states sampled coverage.
  return sorted.length <= 96 ? sorted : Array.from({ length: 96 }, (_, i) => sorted[Math.round(i * (sorted.length - 1) / 95)]);
}

export async function inspectMediaQuality(document, { profile = resolveCreationQuality(), signal, runtimeOptions, shotId } = {}) {
  if (typeof globalThis.document?.createElement !== "function") return { available: false, warnings: [], views: [] };
  const kit = await loadMediaKit(), samples = mediaReviewSamples(shotId ? { timeline: { ...document.timeline, clips: document.timeline.clips.filter(clip => clip.id === shotId) } } : document, profile);
  const width = 640, height = Math.max(160, Math.min(960, Math.round(width * (document.output?.height || 9) / (document.output?.width || 16))));
  const project = await kit.createMediaProject(document, { width, height, signal, runtimeOptions, previewPerformance: false, preloadNext: false });
  const views = [], warnings = [], observations = [];
  const viewLimit = profile.reviewVisual ? (profile.maxReviewViews ?? { standard: 6, fine: 12, ultimate: 18 }[profile.id] ?? profile.views * profile.samplesPerShot) : 0;
  const imageIndices = new Set(Array.from({ length: Math.min(viewLimit, samples.length) }, (_, i) => Math.round(i * (samples.length - 1) / Math.max(1, Math.min(viewLimit, samples.length) - 1))));
  try {
    for (const sample of samples) {
      signal?.throwIfAborted();
      await project.renderAt(sample.time);
      const observation = await project.observeCurrentFrame({ maxObjects: 100, maxTriangles: 2000, maxVertices: 6000, occlusion: false });
      observations.push({ ...sample, observation });
      for (const shot of observation.filter(shot => !shotId || shot.clipId === shotId)) warnings.push(...shot.warnings.map(w => ({ ...w, clipId: shot.clipId, time: sample.time })));
      if (imageIndices.has(observations.length - 1)) views.push({ ...sample, name: `${sample.clipId}@${sample.time.toFixed(2)}s`, dataUrl: project.canvas.toDataURL("image/jpeg", .8), diagnosticRelighting: false });
    }
    const structural = kit.diagnoseMediaDocument(document);
    warnings.push(...(structural.diagnostics || []).filter(d => !shotId || d.shotId === shotId).map(d => ({ ...d, severity: d.severity || "error" })));
    return { available: true, warnings, views, observations, lighting: "authored", coverage: "sampled-frames-not-continuous", imageSampleCount: views.length, sampledTimes: samples, resourceReadiness: project.resourceDiagnostics };
  } finally { project.dispose(); }
}

/** A real authored-lighting renderer. It never borrows ThreeBox's helper lights. */
export async function inspectSceneQuality(document, { profile = resolveCreationQuality(), signal, runtimeOptions } = {}) {
  if (typeof globalThis.document?.createElement !== "function") return { available: false, warnings: [], views: [] };
  const canvas = globalThis.document.createElement("canvas");
  const aspect = (document.sceneConfig?.canvasWidth || 16) / (document.sceneConfig?.canvasHeight || 9);
  const width = 640, height = Math.max(160, Math.min(960, Math.round(width / aspect)));
  const input = structuredClone(document);
  input.sceneConfig = { ...input.sceneConfig, canvasWidth: width, canvasHeight: height, renderLoop: { ...input.sceneConfig?.renderLoop, autoStart: false, autoResize: false }, renderer: { ...input.sceneConfig?.renderer, ratioRate: 1, preserveDrawingBuffer: true } };
  const runtime = await createJsonScene(input, { ...runtimeOptions, previewPerformance: "full", canvas, signal, viewportSize: { width, height }, assetsBase: sceneHostAssetUrl("assets/") });
  try {
    signal?.throwIfAborted();
    await runtime.ready;
    await runtime.renderer?.compileAsync?.(runtime.scene, runtime.camera);
    runtime.stop?.();
    if (runtime.controls) runtime.controls.enabled = false;
    await runtime.renderLoop.renderCurrentFrame();
    const observation = observeSceneRuntime(runtime, { occlusion: profile.id !== "quick" });
    try { observation.subjectRegions = measureSubjectRegions(runtime.renderer.domElement, observation); }
    catch (error) { observation.warnings.push({ code: "PIXEL_READBACK_UNAVAILABLE", message: error.message }); }
    const views = [];
    if (profile.reviewVisual) {
      // The first image always preserves the authored camera. Alternative views
      // are explicitly named, use the same light, and never edit the source.
      views.push(...(await captureSceneFrame(runtime, { signal })).views);
      if (profile.views > 1 && runtime.camera?.isPerspectiveCamera) {
        const { Box3, Vector3 } = await import("three");
        const bounds = new Box3();
        runtime.scene.traverseVisible(object => { if ((object.isMesh || object.isPoints || object.isLine) && !object.userData?.editorOnly) bounds.expandByObject(object); });
        const center = bounds.isEmpty() ? new Vector3() : bounds.getCenter(new Vector3());
        const offset = runtime.camera.position.clone().sub(center), original = runtime.camera.quaternion.clone();
        for (let i = 1; i < profile.views; i++) {
          const proposal = profile.alternatives > 1 && i === 1;
          runtime.camera.position.copy(center).add(offset.clone().applyAxisAngle(new Vector3(0, 1, 0), proposal ? Math.PI / 10 : i * Math.PI / 3).multiplyScalar(proposal ? .9 : 1));
          runtime.camera.lookAt(center); runtime.camera.updateMatrixWorld();
          const captured = await captureSceneFrame(runtime, { signal });
          views.push(...captured.views.map(view => ({ ...view, name: proposal ? "composition-proposal-B" : `inspection-camera-${i}`, camera: { position: runtime.camera.position.toArray(), lookAt: center.toArray(), fov: runtime.camera.fov }, diagnosticRelighting: false })));
        }
        runtime.camera.position.copy(center).add(offset); runtime.camera.quaternion.copy(original);
      }
    }
    return { ...observation, views, lighting: "authored", resourceReadiness: observation.resources?.status };
  } finally { runtime.dispose?.(); }
}

export async function reviewSceneResult(result, input = {}) {
  if (!result?.sceneJsonString) return result;
  const media = result.sceneJson?.documentType === "composition";
  const unfinished = result.agentResult?.completed === false;
  const creationQuality = unfinished ? "quick" : input.creationQuality ?? input.agentOptions?.creationQuality ?? "quick";
  // A paused draft gets local diagnostics, not a fresh paid refinement budget.
  const profile = resolveCreationQuality(creationQuality, unfinished ? {} : input.qualityProfile ?? input.agentOptions?.qualityProfile);
  if (media && input.videoOptions?.visualReview === "disabled") profile.reviewVisual = false;
  const provider = input.qualityReviewerOptions || input.providerOptions || {};
  const request = input.qualityRequest || requestChatCompletion;
  const checked = await runCreationQualityReview(media ? JSON.parse(result.sceneJsonString) : parseSceneJsonString(result.sceneJsonString), {
    profile, signal: input.signal, visionAvailable: providerSupportsVision(provider),
    onProgress: event => input.onAgentProgress?.({ ...event, message: qualityReportMessage(event.qualityReport, input.locale) }),
    inspect: input.inspectSceneQuality || ((document, options) => (media ? inspectMediaQuality : inspectSceneQuality)(document, { ...options, runtimeOptions: input.runtimeOptions })),
    review: async ({ observed, signal }) => {
      const requestOptions = input.qualityBudget?.requestOptions(provider, input.maxTokens) || { ...provider, maxTokens: input.maxTokens ?? provider.maxTokens };
      const raw = await request({ ...requestOptions, signal, stream: false, taskKind: "visual-review", messages: [
        { role: "system", content: 'Review the actual scene images against the user request. Return only JSON {"satisfied":boolean,"issues":[{"code":string,"severity":"warning"|"error","message":string}]}. Check silhouette/proportions, readable subject, framing, materials, lighting and text. Respect intentional darkness/stylization; do not demand floors or more polygons. Alternative cameras are labeled, not the authored composition. If composition-proposal-B is supplied, compare it with the active camera and explicitly justify retaining A or recommend the supplied B camera in an issue for targeted repair. Inspection cameras do not replace the authored camera. Video frames are samples, never evidence that every frame is correct. No claims beyond supplied evidence.' },
        { role: "user", content: [{ type: "text", text: JSON.stringify({ request: input.userPrompt || input.prompt, observation: { ...observed, views: observed.views.map(({ dataUrl, ...v }) => v) } }) }, ...observed.views.map(v => ({ type: "image_url", image_url: { url: v.dataUrl } }))] }
      ] });
      return JSON.parse(String(raw).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
    },
    repair: async (document, { issues, signal }) => {
      const repairOptions = input.qualityBudget?.requestOptions(input.providerOptions, input.maxTokens) || { ...input.providerOptions, maxTokens: input.maxTokens };
      if (media) {
        if (!input.repairMediaDocument) throw new Error("Media quality repair adapter unavailable.");
        return input.repairMediaDocument(document, { issues, signal, providerOptions: repairOptions });
      }
      const text = await updateSceneJsonString(`Preserve all accepted work. Fix only the following verified issues; do not replace the subject, add a floor, or override intentional style. Original request: ${input.userPrompt || input.prompt || ""}\n${JSON.stringify(issues)}`, JSON.stringify(document), { ...repairOptions, signal, stream: false, updateMode: "incremental", taskKind: "quality-repair" });
      const parsed = parseSceneJsonString(text);
      return input.creationPolicy ? input.creationPolicy.prepare(parsed) : parsed;
    },
    validate: input.validateQualityDocument || (async document => media ? (await loadMediaKit()).diagnoseMediaDocument(document).satisfied : validateSceneJson(JSON.stringify(document)).ok)
  });
  // Production metadata must not promise a finished film while its final check
  // still has errors. This status-only edit does not alter inspected pixels.
  if (media && checked.report.completed === false && checked.document.production?.state === "complete") {
    checked.document.production = { ...checked.document.production, state: "paused", stopReason: checked.report.stopReason, lastError: checked.report.message };
    checked.report.observedRevision = checked.report.sourceRevision;
    checked.report.sourceRevision = await sceneQualityRevision(checked.document);
  }
  checked.report.referencedAssets = collectReferencedAssets(checked.document);
  const sceneJsonString = JSON.stringify(checked.document, null, 2);
  return { ...result, ...(media ? { mediaProject: (await loadMediaKit()).inspectMediaDocument(checked.document) } : {}), ...(checked.report.repairs ? { liveApplied: false } : {}), sceneJson: checked.document, sceneJsonString, qualityReport: checked.report,
    agentResult: { ...result.agentResult, qualityReport: checked.report, ...(checked.report.completed || result.agentResult?.completed === false ? {} : { completed: false, generationStopReason: result.agentResult?.stopReason, stopReason: checked.report.stopReason }) } };
}

function collectReferencedAssets(document) {
  const assets = new Map();
  const walk = value => {
    if (!value || typeof value !== "object") return;
    const asset = value.userData?.assetProvenance;
    if (asset?.referencedAsset) assets.set(asset.sha256 || asset.url, { name: asset.name, source: asset.source, license: asset.license, author: asset.author, landingUrl: asset.landingUrl });
    for (const [key, child] of Object.entries(value)) if (key !== "userData" && child && typeof child === "object") walk(child);
  };
  walk(document); return [...assets.values()];
}
