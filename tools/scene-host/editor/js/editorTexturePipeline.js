import { sceneToStandardJsonSimple } from "threejson";
import { isBuiltinPrivacyAccepted } from "../../shared/js/builtinProviderPrivacy.js";
import {
  findChangedTextureObjectIds,
  runHostSceneTexturePipeline
} from "../../shared/js/sceneTextureOrchestrator.js";

export function resolveEditorTextureService(settings) {
  const customUrl = String(settings?.ai?.textureServiceUrl || "").trim();
  const customKey = String(settings?.ai?.textureServiceApiKey || "").trim();
  const builtin = settings?.ai?.providers?.find((provider) => provider.provider === "threebox-builtin");
  const mayUseBuiltin = isBuiltinPrivacyAccepted("editor");
  return {
    baseUrl: customUrl || (mayUseBuiltin ? String(settings?.ai?.builtinBackendUrl || "").trim() : ""),
    apiKey: customKey || (mayUseBuiltin ? String(builtin?.apiKey || "").trim() : "")
  };
}

function exportCurrentScene(host) {
  if (host.getAuthoringSession?.()?.session) return host.getAuthoringSession().export();
  const scene = host.getScene?.();
  if (!scene?.isScene) return null;
  return sceneToStandardJsonSimple(scene, {
    ...host.buildSceneToJsonOptionsForDisplay?.({ merge: false, format: "standard" }),
    merge: false,
    format: "standard",
    runtimeTarget: host.getSceneRuntime?.()
  });
}

function formatTextureProgress(event) {
  const total = Math.max(0, Number(event?.total) || 0);
  const completed = Math.max(0, Number(event?.completed) || 0);
  if (event?.phase === "planned" && total) return `场景已载入，正在完善纹理 0/${total}…`;
  if ((event?.phase === "acquiring" || event?.phase === "task-complete") && total) {
    return `场景已载入，正在完善纹理 ${completed}/${total}…`;
  }
  if (event?.phase === "complete" && Number(event.pendingLicense) > 0) {
    return `${Number(event.pendingLicense)} 项候选纹理因许可未知未自动应用；可在设置中确认后允许。`;
  }
  return "";
}

/** Runs after the Editor has rendered the scene. All assignments are grouped into one undo entry. */
export async function runEditorSceneTexturePipeline(host, options = {}) {
  const settings = host.getEditorSettings?.();
  if (settings?.ai?.texturePipelineEnabled === false) return { skipped: "disabled", assignments: [] };
  await host.ensureCanvasSyncedBeforeExport?.();
  await host.getAuthoringSession?.()?.flush();
  const sceneJson = exportCurrentScene(host);
  const runtime = host.getSceneRuntime?.();
  if (!sceneJson || !runtime) return { skipped: "runtime_not_ready", assignments: [] };

  const history = host.getEditorHistory?.();
  const before = (await history?.captureSceneSnapshotAsync?.()) || history?.captureSceneSnapshot?.();
  const authoring = host.getAuthoringSession?.();
  const ownerSession = authoring?.session;
  const textureHistoryGroup = `texture-${globalThis.crypto?.randomUUID?.() || Date.now()}`;
  let result;
  try {
    result = await runHostSceneTexturePipeline({
      scene: sceneJson,
      runtime,
      prompt: options.prompt,
      aiProviderOptions: options.providerOptions,
      textureService: resolveEditorTextureService(settings),
      enabled: true,
      strategy: settings.ai?.textureStrategy || "semantic-hybrid",
      pbr: settings.ai?.texturePbr !== false,
      allowUnknownLicense: settings.ai?.textureAllowUnknownLicense === true,
      persistenceMode: settings.ai?.texturePersistenceMode || "remote",
      cache: settings.ai?.textureLocalCache !== false,
      changedObjectIds: options.previousScene
        ? findChangedTextureObjectIds(options.previousScene, sceneJson)
        : undefined,
      signal: options.signal,
      isCurrent: () => !ownerSession || authoring.session === ownerSession,
      applyAssignment: ownerSession ? (_runtime, assignment, assignmentOptions) => authoring.applyTextureAssignment(assignment, {
        ...assignmentOptions, historyGroup: textureHistoryGroup, label: "AI 纹理完善"
      }) : undefined,
      onProgress: (event) => {
        const text = formatTextureProgress(event);
        if (text) options.onProgress?.(text, event);
      },
      onAssignment: () => {
        host.markSceneDirty?.();
        host.getSceneTree?.()?.render?.();
      }
    });
  } catch (error) {
    if (!options.signal?.aborted && error?.name !== "AbortError") throw error;
    // The scene was already successfully rendered before texture enrichment started. Cancelling
    // that optional follow-up must not turn the completed generation/adjustment into a failure.
    result = { scene: sceneJson, assignments: [], taskResults: [], skipped: "aborted" };
  }
  if (result.assignments?.length && before && !ownerSession) {
    history?.pushCapturedSceneSnapshot?.(before, "AI 纹理完善");
    host.markSceneDirty?.();
  }
  return result;
}
