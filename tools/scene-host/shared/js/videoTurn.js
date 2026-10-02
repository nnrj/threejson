import { runVideoAgent } from "threejson/ai";
import { loadMediaKit, createLocalNarrationHost } from "./mediaStudio.js";

/** Optional host bridge; no media/codecs/model downloads in the ordinary scene path. */
export async function runAiVideoTurn(input = {}) {
  const kit = await loadMediaKit();
  const { providerOptions = {}, userPrompt, signal, onAgentProgress, onSceneDraft, videoOptions = {} } = input;
  const initial = input.targetSceneJsonString ? JSON.parse(input.targetSceneJsonString) : input.project;
  const session = kit.createMediaProjectSession(initial, { duration: videoOptions.duration || initial?.timeline?.duration || 120 });
  const visionAvailable = videoOptions.visionAvailable ?? (videoOptions.visualReview === "enabled" || videoOptions.visualReview !== "disabled" && providerOptions.capabilities?.vision === true);
  const runtimeOptions = input.runtimeOptions || {};
  const captureFrames = async (document, args, context) => {
    const project = await kit.createMediaProject(document, { width: args.width || 640, height: args.height || 360, runtimeOptions, signal: context.signal });
    try {
      const frames = [];
      for (const time of args.times) { await project.renderAt(time); frames.push({ time, dataUrl: project.canvas.toDataURL("image/png"), kind: "actual-project" }); }
      return frames;
    } finally { project.dispose(); }
  };
  let narration;
  try { narration = await createLocalNarrationHost(); }
  catch (error) { narration = { available: false, dispose() {} }; onAgentProgress?.({ type: "video", stage: "audio_unavailable", stageLabel: `本地配音不可用：${error.message}；继续生成画面。` }); }
  const service = kit.createMediaOperationService({ session, adapters: { captureFrames: input.captureFrames || captureFrames, ...(narration.available ? { narrate: narration.narrate } : {}) } });
  let draftPublished = false;
  try {
    const result = await runVideoAgent({ ...providerOptions, service, prompt: [input.globalPromptPrefix, userPrompt].filter(Boolean).join("\n\n"), signal, request: input.request,
      maxTokens: input.maxTokens ?? providerOptions.maxTokens, modelBudget: Object.fromEntries(Object.entries(videoOptions.budget || input.modelBudget || {}).filter(([, value]) => value != null && value !== 0)),
      duration: videoOptions.duration, quality: videoOptions.quality || "balanced", confirmStoryboard: videoOptions.confirmStoryboard === true,
      visionAvailable, selectedCapabilityIds: input.selectedCapabilityIds,
      onProgress: progress => onAgentProgress?.({ ...progress, type: "video", stageLabel: progress.stage === "reasoning" ? "正在编排或细化镜头" : progress.operations?.join(", ") || progress.stage }),
      onReceipt: async receipt => {
        if (!receipt.ok || receipt.status !== "committed") return;
        const sceneJsonString = JSON.stringify(session.snapshot(), null, 2), project = session.inspect();
        // Both native and React already persist and preview these standard progress
        // snapshots. They contain authored shots, never camera playback state.
        await onAgentProgress?.({ type: "video", kind: "stage_preview", stage: "draft", phase: "draft", sceneJsonString, mediaProject: project, revision: session.revision });
        await input.onProjectDraft?.(session.snapshot(), project);
        if (!draftPublished) { draftPublished = true; await onSceneDraft?.(sceneJsonString, { mediaProject: project }); }
      }
    });
    const sceneJson = structuredClone(session.snapshot());
    if (!sceneJson.timeline.clips.length) {
      const e = new Error(result.error?.message || result.message || "Video generation did not produce a storyboard."); e.agentResult = result; throw e;
    }
    sceneJson.production = { ...sceneJson.production, state: result.completed ? "complete" : "paused", stopReason: result.stopReason };
    return { stage: "media", sceneJson, sceneJsonString: JSON.stringify(sceneJson, null, 2), agentResult: result, mediaProject: session.inspect() };
  } finally { narration.dispose(); session.dispose(); }
}
