/**
 * Shared AI "turn" orchestration core, used by both `threebox/` (chat transcript) and `editor/`
 * (apply straight to the live canvas) — extracted from ThreeBox's original
 * `threeBoxOrchestrator.js` (which is now a thin wrapper delegating here) plus a new
 * `runAiImageGenerateTurn`, ported from editor's own pre-existing `aiSidebar.js` image-generate
 * flow (ThreeBox never had a working image-to-scene path — see the ai-restructure plan's research
 * notes). Every exported "run*Turn" function returns plain `{ sceneJson, sceneJsonString, ... }`
 * data — no markdown, no DOM, no chat-transcript shape — so each host app is free to render the
 * result however fits its own UI (ThreeBox: a new scene card in the chat log; editor: apply
 * in-place onto the live scene/undo stack).
 *
 * Deliberately does NOT resolve `providerOptions` from a settings object — ThreeBox stores an
 * array of saved providers, editor a single scalar provider config; each host resolves its own
 * settings shape into the `{provider, apiKey, model, baseUrl}` shape `core/ai` expects and passes
 * the result in here.
 */
import {
  parseSceneJsonString,
  runSceneAgent,
  classifyTurnIntent,
  summarizeSceneTurn,
  generateSceneTitle,
  buildStructuredTurnEnvelope,
  buildObjectSpatialCardsFromSceneJson,
  buildSceneScaleProfile,
  matchIntentSignals,
  formatObjectGetFeedbackFromBatch,
  extractVisualFeedbackFromBatch,
  requestUpdatedSceneEditCommands,
  updateSceneJsonString as requestUpdatedSceneJsonString
} from "threejson/ai";
import {
  executeCommands,
  createCommandContext
} from "threejson/commands";
import { sceneToStandardJsonSimple } from "threejson/scene-export";
import { createJsonScene } from "threejson/runtime";
import { resolveSceneHostUrl, sceneHostAssetUrl } from "./sceneHostPaths.js";
import { captureMeshReviewViews } from "./meshViewCapture.js";

/** Resolves a repo-relative path (docs/zh/event-mechanism.md, assets/json/demo-show/...) to a
 * fetchable URL for core/ai/sceneReferenceCatalog.js's local doc/example retrieval — passed as
 * `resolveReferenceUrl` into runSceneAgent's options so the (environment-agnostic) agent loop
 * never needs to know how the host app is served. Shared by every scene-host app. */
export function resolveSceneAiReferenceUrl(repoRelativePath) {
  return resolveSceneHostUrl(repoRelativePath);
}

/**
 * Heuristic vision-capability gate for image/file attachments: DeepSeek's mainline chat models
 * don't accept image inputs; a "custom" OpenAI-compatible gateway's capability is unknowable
 * client-side, so it's allowed through (server-side will reject if unsupported). Deliberately
 * conservative (only hard-blocks the one provider known NOT to support vision) rather than trying
 * to enumerate which specific model names do.
 * @param {{provider?: string, model?: string}|null} provider a resolved provider config or a raw saved provider entry
 * @returns {boolean}
 */
export function isProviderVisionCapable(provider) {
  if (!provider) {
    return false;
  }
  return provider.provider !== "deepseek";
}

async function applyAiDraftCommands(commands, { sceneJsonString, visualReviewAvailable = false }) {
  const baseSceneJson = parseSceneJsonString(sceneJsonString);
  const runtime = await createOffscreenRuntimeFromSceneJsonString(sceneJsonString);
  try {
    const ctx = createCommandContextForRuntime(runtime, baseSceneJson, {
      renderMeshViews: visualReviewAvailable
        ? (request) => captureMeshReviewViews({ ...request, renderer: runtime.renderer })
        : undefined
    });
    const execResult = await executeCommands(ctx, commands);
    const results = Array.isArray(execResult.results) ? execResult.results : [];
    const ok = results.length ? results.every((item) => item.ok !== false) : execResult.ok !== false;
    if (!ok) {
      return {
        ok: false,
        error: results.find((item) => item.ok === false)?.error || "Draft refinement commands failed."
      };
    }
    return {
      ok: true,
      sceneJsonString: exportRuntimeSceneJsonString(runtime, baseSceneJson),
      objectGetFeedback: formatObjectGetFeedbackFromBatch(results),
      visualFeedback: extractVisualFeedbackFromBatch(results)
    };
  } finally {
    runtime.dispose?.();
  }
}

/** Compact, token-cheap description of a generated scene (object-type counts), for the summary call. */
export function buildResultDigest(sceneJson) {
  try {
    const counts = {};
    const worldInfo = sceneJson?.worldInfo;
    if (worldInfo && typeof worldInfo === "object") {
      for (const key of Object.keys(worldInfo)) {
        if (Array.isArray(worldInfo[key]) && worldInfo[key].length) {
          counts[key] = worldInfo[key].length;
        }
      }
    }
    if (Array.isArray(sceneJson?.objectList)) {
      counts.objectList = sceneJson.objectList.length;
    }
    return JSON.stringify(counts);
  } catch (_error) {
    return "";
  }
}

/**
 * Generation uses an execution policy independent from the JSON transport policy. `direct`
 * returns a complete usable scene in one generation call; `draft_refine` is reserved for scenes
 * that genuinely need incremental construction. A direct output-limit failure may still escalate
 * safely inside core/ai. Raw deltas are forwarded only for the direct generation call.
 * @param {{ userPrompt: string, providerOptions: object, onDelta?: (delta:string, metadata?:object)=>void, onGenerationPhase?: (phase:object)=>void|Promise<void>, onSceneDraft?: (sceneJsonString:string)=>void|Promise<void>, signal?: AbortSignal, globalPromptPrefix?: string, agentOptions?: {maxRefineRounds?: number}, onAgentProgress?: (p: object)=>void, includeReferenceLinks?: boolean, locale?: string, generationStrategy?: "single"|"segmented"|"compact", executionMode?: "direct"|"draft_refine", refinementGoals?: string[], estimatedSegments?: number, estimatedOutputTokens?: {min:number,max:number}, maxSceneSegments?: number, maxTokens?: number }} input
 */
export async function runAiGenerateTurn({
  userPrompt,
  providerOptions,
  onDelta,
  onGenerationPhase,
  onSceneDraft,
  signal,
  globalPromptPrefix,
  agentOptions,
  onAgentProgress,
  includeReferenceLinks,
  locale,
  capabilityLookup,
  generationStrategy = "single",
  executionMode = "direct",
  refinementGoals = [],
  estimatedSegments,
  estimatedOutputTokens,
  maxSceneSegments,
  maxTokens,
  selectedCapabilityIds,
  complexModelStrategy = "auto",
  modelQuality = "balanced",
  modelBudget,
  requiresAnimation
}) {
  const visualReviewAvailable = isProviderVisionCapable(providerOptions);
  const animationCapabilities = typeof requiresAnimation === "boolean"
    ? requiresAnimation
    : Array.isArray(selectedCapabilityIds)
      ? selectedCapabilityIds.some((id) => ["events", "lifecycle", "declarativeAnimation", "animationGraph"].includes(id))
      : matchIntentSignals(userPrompt).some((signal) =>
          ["events", "lifecycle", "declarativeAnimation", "animationGraph"].includes(signal.id)
        );
  const envelope = buildStructuredTurnEnvelope({
    userPrompt,
    intent: "generate",
    globalPromptPrefix,
    includeReferenceLinks,
    generationStrategy,
    estimatedOutputTokens,
    executionMode,
    refinementGoals,
    selectedCapabilityIds,
    complexModelStrategy,
    modelQuality,
    modelBudget,
    requiresAnimation
  });
  const result = await runSceneAgent(
    { mode: "generate", prompt: envelope },
    {
      ...providerOptions,
      signal,
      maxTokens: maxTokens ?? providerOptions?.maxTokens,
      stream: true,
      onDelta,
      agent: {
        maxRefineRounds: agentOptions?.maxRefineRounds,
        complexModelStrategy,
        modelQuality,
        modelBudget
      },
      executionMode,
      complexModelStrategy,
      modelQuality,
      modelBudget,
      refinementGoals,
      resolveReferenceUrl: resolveSceneAiReferenceUrl,
      capabilityLookup,
      // Full-JSON transport metadata remains independent from the execution policy above.
      generationStrategy,
      estimatedSegments,
      segmentedOutput: generationStrategy === "segmented",
      maxSceneSegments,
      selectedCapabilityIds,
      animationCapabilities,
      visualReviewAvailable,
      onGenerationPhase,
      onSceneDraft,
      applyDraftCommands: (commands, context) => applyAiDraftCommands(commands, {
        ...context,
        visualReviewAvailable
      }),
      locale,
      onProgress: onAgentProgress
    }
  );
  const sceneJson = parseSceneJsonString(result.sceneJsonString);
  return { sceneJson, sceneJsonString: result.sceneJsonString, agentResult: result };
}

/**
 * Generates a scene from a reference image — ThreeBox never wired this up (no call site ever
 * requested `mode: "fromImage"`); this is ported from editor's pre-existing `aiSidebar.js`
 * `onImageGenerate`/`runSidebarSceneAgent(..., {mode:"fromImage", ...})` flow, generalized the
 * same way `runAiGenerateTurn` above is.
 * @param {{ prompt?: string, image: string|{base64:string, mimeType?:string}, providerOptions: object, agentOptions?: object, imageDetail?: "auto"|"low"|"high", maxTokens?: number, executionMode?: "direct"|"draft_refine", refinementGoals?: string[], selectedCapabilityIds?: string[], requiresAnimation?: boolean, onAgentProgress?: (p:object)=>void, onGenerationPhase?: (phase:object)=>void|Promise<void>, onSceneDraft?: (sceneJsonString:string, meta?:object)=>void|Promise<void>, signal?: AbortSignal, locale?: string, capabilityLookup?: boolean }} input
 */
export async function runAiImageGenerateTurn({
  prompt = "",
  image,
  providerOptions,
  agentOptions,
  imageDetail = "auto",
  maxTokens,
  executionMode = "direct",
  refinementGoals = [],
  selectedCapabilityIds,
  complexModelStrategy = "auto",
  modelQuality = "balanced",
  modelBudget,
  requiresAnimation,
  onAgentProgress,
  onGenerationPhase,
  onSceneDraft,
  signal,
  locale,
  capabilityLookup
}) {
  if (!image) {
    throw new Error("runAiImageGenerateTurn: image is required.");
  }
  const visualReviewAvailable = isProviderVisionCapable(providerOptions);
  const animationCapabilities = typeof requiresAnimation === "boolean"
    ? requiresAnimation
    : Array.isArray(selectedCapabilityIds)
      ? selectedCapabilityIds.some((id) => ["events", "lifecycle", "declarativeAnimation", "animationGraph"].includes(id))
      : matchIntentSignals(prompt).some((signal) =>
          ["events", "lifecycle", "declarativeAnimation", "animationGraph"].includes(signal.id)
        );
  const result = await runSceneAgent(
    { mode: "fromImage", prompt, image },
    {
      ...providerOptions,
      signal,
      imageDetail,
      maxTokens: maxTokens ?? providerOptions?.maxTokens,
      executionMode,
      refinementGoals,
      agent: {
        maxRefineRounds: agentOptions?.maxRefineRounds,
        complexModelStrategy,
        modelQuality,
        modelBudget
      },
      complexModelStrategy,
      modelQuality,
      modelBudget,
      resolveReferenceUrl: resolveSceneAiReferenceUrl,
      capabilityLookup,
      selectedCapabilityIds,
      animationCapabilities,
      visualReviewAvailable,
      onGenerationPhase,
      onSceneDraft,
      applyDraftCommands: (commands, context) => applyAiDraftCommands(commands, {
        ...context,
        visualReviewAvailable
      }),
      locale,
      onProgress: onAgentProgress
    }
  );
  const sceneJson = parseSceneJsonString(result.sceneJsonString);
  return { sceneJson, sceneJsonString: result.sceneJsonString, agentResult: result };
}

/**
 * Negotiates generation policy and, only when history exists, classifies new generation versus
 * adjustment. core/ai fixes an empty-history request to generation without model-based routing.
 * @param {{ userPrompt: string, history: Array<{turnId:string, summary:string}> }} input
 * @param {object} providerOptions
 */
export async function classifyAiTurnIntent({ userPrompt, history }, providerOptions) {
  const immediate = resolveImmediateDirectGeneration({ userPrompt, history }, providerOptions);
  if (immediate) {
    return immediate;
  }
  return classifyTurnIntent({ userPrompt, history }, providerOptions);
}

/**
 * Keeps the zero-risk local route for an obvious adjustment of the latest scene. A first-scene
 * generation skips policy negotiation only when the user explicitly selected complete generation;
 * automatic mode still lets core/ai judge construction complexity, but never the first-turn route.
 */
export function resolveImmediateDirectGeneration({ userPrompt, history }, providerOptions = {}) {
  const text = String(userPrompt || "").trim();
  if (!text || text.length > 280) {
    return null;
  }
  const priorTurns = Array.isArray(history) ? history.filter((turn) => turn?.turnId) : [];
  if (priorTurns.length > 0) {
    const explicitlyNewScene = /(?:创建|生成|新建|重做|重新生成|另一个|全新)(?:一个|一座|一幅|新的)?|\b(?:create|generate|start|build)\b.{0,16}\b(?:new|another)\b|\bnew\s+scene\b/i.test(text);
    const obviousAdjustment = /(?:^|[，。,.!！?？\s])(?:把|将|让|给|再|继续|改|变|换|设|调整|修改|添加|增加|删除|移除|替换|移动|旋转|缩放|放大|缩小|隐藏|显示)|(?:颜色|材质|位置|大小|尺寸|纹理|灯光|相机).{0,12}(?:改|变|换|设|调整)|\b(?:change|make|turn|set|recolor|adjust|modify|add|remove|delete|replace|move|rotate|resize|scale|hide|show|continue)\b/i.test(text);
    if (!explicitlyNewScene && obviousAdjustment) {
      const targetTurnId = priorTurns[priorTurns.length - 1].turnId;
      const animationMode = providerOptions?.animationCapabilityMode;
      return {
        intent: "adjust",
        targetTurnId,
        note: "local fast path: obvious adjustment of latest scene",
        classificationFailed: false,
        generationStrategy: "single",
        estimatedSegments: 1,
        executionMode: "direct",
        refinementGoals: [],
        selectedCapabilityIds: undefined,
        requiresAnimation: animationMode === "on" ? true : animationMode === "off" ? false : undefined
      };
    }
    return null;
  }
  if (providerOptions?.sceneGenerationMode !== "direct") {
    return null;
  }
  const explicitlyLarge = /(?:very\s+large|massive|large[- ]scale|\bcomplex\b|\bmany\b|multi[- ]district|\bdistricts?\b|\bmetropolis\b|\bcity(?:scape)?\b|\binfrastructure\b|\bhundreds?\b|\bthousands?\b|\bevery\s+building\b|复杂|超大|巨型|大规模|大量|许多|众多|多区域|多个区域|分区|城市|基础设施|数百|上千|每栋建筑)/i.test(text);
  const numericCounts = [...text.matchAll(/(?:^|\D)(\d{2,})(?=\D|$)/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  if (explicitlyLarge || numericCounts.some((count) => count > 32)) {
    return null;
  }
  const animationMode = providerOptions?.animationCapabilityMode;
  return {
    intent: "generate",
    targetTurnId: null,
    note: "local fast path: clearly bounded first generation",
    classificationFailed: false,
    generationStrategy: "single",
    estimatedSegments: 1,
    executionMode: "direct",
    refinementGoals: [],
    // Undefined deliberately enables the local capability matcher in runAiGenerateTurn.
    selectedCapabilityIds: undefined,
    requiresAnimation: animationMode === "on" ? true : animationMode === "off" ? false : undefined
  };
}

/**
 * Best-effort post-turn recap; never throws (returns "" on failure) so a failed summary call
 * never blocks the turn from being cached/displayed. `responseLanguage` (e.g. "Simplified
 * Chinese"/"English") keeps the recap's language following the host's current UI locale setting
 * rather than whatever language the user happened to type their prompt in.
 */
export async function runAiTurnSummary({ userPrompt, mode, targetTurnId, turnId, resultDigest, providerOptions, responseLanguage, selfName }) {
  return summarizeSceneTurn({ userPrompt, mode, targetTurnId, turnId, resultDigest, responseLanguage, selfName }, providerOptions);
}

/**
 * Best-effort scene title for a display label / export file name; never throws (returns "" on
 * failure) so a failed title call never blocks rendering — callers should fall back to the raw
 * user prompt.
 */
export async function runAiSceneTitle({ userPrompt, resultDigest, providerOptions, responseLanguage, previousTitle }) {
  return generateSceneTitle({ userPrompt, resultDigest, responseLanguage, previousTitle }, providerOptions);
}

/**
 * Resolves the context payload attached to an adjust turn's structured envelope, per the caller's
 * settings: a compact spatial summary by default (cheap), or the full target scene JSON when the
 * user has explicitly opted into that (expensive, but sometimes necessary for the model to "see"
 * the whole scene).
 * @param {object} targetSceneJson parsed scene JSON of the turn being adjusted
 * @param {{ includeFullJson?: boolean, includeSpatialSummary?: boolean }} settings
 */
export function resolveAiAdjustContextPayload(targetSceneJson, settings = {}) {
  if (settings.includeFullJson) {
    return { fullSceneJson: targetSceneJson };
  }
  if (settings.includeSpatialSummary !== false) {
    const { cards, truncated, totalCount } = buildObjectSpatialCardsFromSceneJson(targetSceneJson);
    const scaleProfile = buildSceneScaleProfile(cards, { truncated, totalCount });
    return { objectSpatialCards: cards, sceneScaleProfile: scaleProfile };
  }
  return {};
}

/** Serializes a runtime's current scene state back to a standard JSON string. `runtimeTarget:
 * runtime` is required — without it, sceneToStandardJsonSimple has no camera/renderer/controls to
 * read, so the exported sceneConfig silently drops the camera entirely. Exported (not just used
 * internally) because ThreeBox's turn-store diff-reconstruction (`resolveTurnSceneJsonString` in
 * threeBoxOrchestrator.js) needs the exact same offscreen-runtime-to-JSON round trip outside of
 * any of the run*Turn functions above. */
export function exportRuntimeSceneJsonString(runtime, basePayload = null) {
  return JSON.stringify(
    sceneToStandardJsonSimple(runtime.scene, {
      merge: false,
      runtimeTarget: runtime,
      ...(basePayload && typeof basePayload === "object" ? { basePayload } : {})
    }),
    null,
    2
  );
}

/**
 * Builds a throwaway, off-screen runtime from a scene JSON string purely so the commands stage
 * has a real `core/command` scene context to mutate, without touching whatever the caller's own
 * live/on-screen scene is. Callers that DO want results applied to their live scene take the
 * returned `sceneJsonString` and apply it themselves via their own scene-loading path. Exported
 * for the same reason as `exportRuntimeSceneJsonString` above.
 */
export async function createOffscreenRuntimeFromSceneJsonString(sceneJsonString) {
  const sceneJson = parseSceneJsonString(sceneJsonString);
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  return createJsonScene(sceneJson, {
    canvas,
    resetScene: true,
    assetsBase: sceneHostAssetUrl("assets/")
  });
}

function mapUpdateOutputModeToAgentInput(updateOutputMode) {
  if (updateOutputMode === "json-full") {
    return { outputMode: "json", updateMode: "full", stage: "json-full" };
  }
  if (updateOutputMode === "json-incremental") {
    return { outputMode: "json", updateMode: "incremental", stage: "json-incremental" };
  }
  return { outputMode: "commands", updateMode: undefined, stage: "commands" };
}

function createCommandContextForRuntime(runtime, documentPayload = null, options = {}) {
  return createCommandContext({
    scene: runtime.scene,
    camera: runtime.camera,
    renderer: runtime.renderer,
    controls: runtime.controls,
    runtime,
    document: documentPayload,
    options
  });
}

function normalizedSceneJsonSignature(sceneJsonString) {
  return JSON.stringify(parseSceneJsonString(String(sceneJsonString || "")));
}

function assertAdjustedSceneChanged(sceneJsonString, targetSceneJsonString, message) {
  if (normalizedSceneJsonSignature(sceneJsonString) === normalizedSceneJsonSignature(targetSceneJsonString)) {
    const error = new Error(message || "AI adjustment completed without changing the scene.");
    error.code = "AI_ADJUST_NO_CHANGE";
    throw error;
  }
}

function createScopedOutputDelta(onDelta, metadata = {}, streamId = "output-1") {
  if (typeof onDelta !== "function") {
    return undefined;
  }
  let firstDelta = true;
  return (delta) => {
    onDelta(delta, {
      ...metadata,
      streamId,
      reset: firstDelta
    });
    firstDelta = false;
  };
}

function isAbortOrTurnTimeout(error, signal) {
  return signal?.aborted || error?.name === "AbortError" || error?.code === "AI_TURN_TIMEOUT";
}

async function runAiAgentAdjustTurn({
  userPrompt,
  envelope,
  targetSceneJsonString,
  providerOptions,
  agentOptions,
  updateOutputMode,
  resolveContextPayload,
  onDelta,
  onAgentProgress,
  locale,
  capabilityLookup,
  selectedCapabilityIds,
  complexModelStrategy,
  modelQuality,
  modelBudget,
  rendererBackend,
  includePreviewCapabilities,
  animationCapabilities,
  generationStrategy,
  estimatedSegments,
  maxTokens,
  applyCommands: hostApplyCommands,
  refreshContext: hostRefreshContext,
  signal
}) {
  const mode = mapUpdateOutputModeToAgentInput(updateOutputMode);
  const visualReviewAvailable = isProviderVisionCapable(providerOptions);
  const baseSceneJson = parseSceneJsonString(targetSceneJsonString);
  const baseContextPayload = resolveContextPayload?.(baseSceneJson) || {};
  const updateContext = {
    ...baseContextPayload,
    userMessage: envelope,
    // Execution needs the authoritative full JSON locally, but the model must see it only when
    // resolveContextPayload explicitly selected fullSceneJson. Keeping these concerns separate
    // makes the default spatial-summary setting effective for large scenes.
    currentSceneJsonString: targetSceneJsonString
  };

  if (mode.outputMode !== "commands") {
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: envelope,
        currentSceneJsonString: targetSceneJsonString,
        outputMode: mode.outputMode
      },
      {
        ...providerOptions,
        maxTokens: maxTokens ?? providerOptions?.maxTokens,
        stream: true,
        updateMode: mode.updateMode,
        agent: {
          maxRefineRounds: agentOptions?.maxRefineRounds,
          complexModelStrategy,
          modelQuality,
          modelBudget
        },
        complexModelStrategy,
        modelQuality,
        modelBudget,
        resolveReferenceUrl: resolveSceneAiReferenceUrl,
        capabilityLookup,
        selectedCapabilityIds,
        rendererBackend,
        includePreviewCapabilities,
        animationCapabilities,
        generationStrategy,
        estimatedSegments,
        locale,
        signal,
        onDelta,
        onProgress: onAgentProgress
      }
    );
    assertAdjustedSceneChanged(
      result.sceneJsonString,
      targetSceneJsonString,
      "AI JSON adjustment returned the original scene unchanged."
    );
    return {
      stage: mode.stage,
      patch: null,
      sceneJson: parseSceneJsonString(result.sceneJsonString),
      sceneJsonString: result.sceneJsonString,
      agentResult: result
    };
  }

  const usesHostRuntime =
    typeof hostApplyCommands === "function" && typeof hostRefreshContext === "function";
  let offscreenRuntime = null;
  let offscreenBaseSceneJson = baseSceneJson;
  let offscreenCommandContext = null;
  const getOffscreenRuntime = async () => {
    if (!offscreenRuntime) {
      offscreenRuntime = await createOffscreenRuntimeFromSceneJsonString(targetSceneJsonString);
      offscreenCommandContext = createCommandContextForRuntime(
        offscreenRuntime,
        offscreenBaseSceneJson,
        {
          renderMeshViews: visualReviewAvailable
            ? (request) => captureMeshReviewViews({ ...request, renderer: offscreenRuntime.renderer })
            : undefined
        }
      );
    }
    return offscreenRuntime;
  };
  try {
    let latestSceneJsonString = targetSceneJsonString;
    let latestRefreshContext = null;
    const refreshContext = async () => {
      if (usesHostRuntime) {
        latestRefreshContext = await hostRefreshContext();
        return latestRefreshContext;
      }
      const runtime = await getOffscreenRuntime();
      latestSceneJsonString = exportRuntimeSceneJsonString(runtime, offscreenBaseSceneJson);
      offscreenBaseSceneJson = parseSceneJsonString(latestSceneJsonString);
      if (offscreenCommandContext) {
        offscreenCommandContext.document = offscreenBaseSceneJson;
      }
      const latestSceneJson = parseSceneJsonString(latestSceneJsonString);
      const contextPayload = resolveContextPayload?.(latestSceneJson) || {};
      latestRefreshContext = {
        ...contextPayload,
        currentSceneJsonString: latestSceneJsonString
      };
      return latestRefreshContext;
    };
    const applyCommands = usesHostRuntime ? hostApplyCommands : async (commands) => {
      await getOffscreenRuntime();
      const execResult = await executeCommands(offscreenCommandContext, commands);
      const results = Array.isArray(execResult.results) ? execResult.results : [];
      const ok = results.length ? results.every((r) => r.ok !== false) : execResult.ok !== false;
      const sceneMutated = results.some((r) => r.ok && ![
        "object.get",
        "scene.list",
        "scene.validate",
        "scene.export",
        "mesh.inspect",
        "mesh.getTopology",
        "mesh.validate",
        "mesh.renderViews"
      ].includes(r.op));
      return {
        ok,
        sceneMutated,
        execResult,
        objectGetFeedback: formatObjectGetFeedbackFromBatch(results),
        visualFeedback: extractVisualFeedbackFromBatch(results),
        error: results.find((r) => !r.ok)?.error
      };
    };
    const result = await runSceneAgent(
      {
        mode: "update",
        prompt: envelope,
        currentSceneJsonString: targetSceneJsonString,
        outputMode: "commands",
        updateContext
      },
      {
        ...providerOptions,
        maxTokens: maxTokens ?? providerOptions?.maxTokens,
        stream: true,
        // These callbacks opt the core runner into apply-as-you-go adjustment. The model stops as
        // soon as it is satisfied via # done; the configured round count is only a safety budget.
        agent: {
          maxRefineRounds: agentOptions?.maxRefineRounds,
          complexModelStrategy,
          modelQuality,
          modelBudget
        },
        complexModelStrategy,
        modelQuality,
        modelBudget,
        resolveReferenceUrl: resolveSceneAiReferenceUrl,
        capabilityLookup,
        selectedCapabilityIds,
        rendererBackend,
        includePreviewCapabilities,
        animationCapabilities,
        generationStrategy,
        estimatedSegments,
        visualReviewAvailable,
        locale,
        signal,
        applyCommands,
        refreshContext,
        onDelta,
        onProgress: onAgentProgress
      }
    );
    if (result.outputMode === "json") {
      assertAdjustedSceneChanged(
        result.sceneJsonString,
        targetSceneJsonString,
        "Agent JSON adjustment returned the original scene unchanged."
      );
      return {
        stage: "json-full",
        sceneJson: parseSceneJsonString(result.sceneJsonString),
        sceneJsonString: result.sceneJsonString,
        agentResult: result
      };
    }
    if (result.execOk === false) {
      const error = new Error("Agent commands did not produce a verified scene mutation.");
      error.code = "AI_ADJUST_NO_CHANGE";
      throw error;
    }
    if (!result.skipFinalExec && Array.isArray(result.commands) && result.commands.length) {
      const applied = await applyCommands(result.commands);
      if (!applied.ok) {
        throw new Error(applied.error || "Agent command apply failed.");
      }
      // A compatibility runner may defer its only mutation batch until this point. Any context
      // captured before that batch is stale and must not become the returned scene JSON.
      latestRefreshContext = null;
    }
    const finalContext = latestRefreshContext || await refreshContext();
    const sceneJsonString = String(
      finalContext?.currentSceneJsonString ||
      finalContext?.fullSceneJson ||
      latestSceneJsonString
    );
    assertAdjustedSceneChanged(
      sceneJsonString,
      targetSceneJsonString,
      "Agent commands reported success, but the resulting scene JSON is unchanged."
    );
    return {
      stage: "commands",
      commands: result.commands || [],
      execResult: { ok: result.execOk !== false },
      liveApplied: usesHostRuntime,
      sceneJson: parseSceneJsonString(sceneJsonString),
      sceneJsonString,
      agentResult: result
    };
  } finally {
    offscreenRuntime?.dispose?.();
  }
}

/**
 * Three-stage adjust fallback chain. Command mode can either apply each refinement round through
 * caller-supplied live-runtime callbacks or use a private offscreen clone. If commands cannot
 * produce a usable mutation, the non-strict fallback path tries RFC 6902 JSON Patch and then full
 * scene JSON. Every path returns the resulting `sceneJson`/`sceneJsonString`.
 *
 * @param {{
 *   userPrompt: string,
 *   envelope: string,
 *   targetSceneJsonString: string,
 *   providerOptions: object,
 *   onDelta?: (delta: string, metadata?: object) => void,
 *   agentOptions?: object,
 *   updateOutputMode?: string,
 *   resolveContextPayload?: (sceneJson: object) => object,
 *   applyCommands?: (commands: object[], meta?: object) => object|Promise<object>,
 *   refreshContext?: () => object|Promise<object>,
 *   onAgentProgress?: (p: object) => void,
 *   locale?: string,
 *   signal?: AbortSignal
 * }} input
 * @returns {Promise<
 *   | { stage: "commands", commands: object[], execResult: object, sceneJson: object, sceneJsonString: string }
 *   | { stage: "json-incremental", patch: object[]|null, sceneJson: object, sceneJsonString: string }
 *   | { stage: "json-full", sceneJson: object, sceneJsonString: string }
 * >}
 */
export async function runAiAdjustTurn({
  userPrompt,
  envelope,
  targetSceneJsonString,
  providerOptions,
  onDelta,
  agentOptions,
  updateOutputMode = "commands",
  strictOutputMode = false,
  resolveContextPayload,
  onAgentProgress,
  locale,
  capabilityLookup,
  selectedCapabilityIds,
  complexModelStrategy = "auto",
  modelQuality = "balanced",
  modelBudget,
  rendererBackend,
  includePreviewCapabilities,
  animationCapabilities,
  generationStrategy,
  estimatedSegments,
  maxTokens,
  applyCommands,
  refreshContext,
  signal
}) {
  let outputStreamSequence = 0;
  const scopedOutputDelta = (metadata) => {
    outputStreamSequence += 1;
    return createScopedOutputDelta(onDelta, metadata, `adjust-turn-${outputStreamSequence}`);
  };
  // strictOutputMode forces exactly the requested single stage with no cascade and no round
  // budget — a deliberate one-shot escape hatch, unrelated to the always-iterative behavior
  // below. Used by Editor's AI-edit quick controls: "auto" (strictOutputMode left off) means "let
  // the iterative loop decide"; picking a specific mode forces it. Checked first, ahead of the
  // always-iterative default, so it stays a true escape hatch regardless of round-budget settings.
  if (strictOutputMode && updateOutputMode !== "auto") {
    if (updateOutputMode === "json-full") {
      const fullJsonString = await requestUpdatedSceneJsonString(userPrompt, targetSceneJsonString, {
        ...providerOptions,
        maxTokens: maxTokens ?? providerOptions?.maxTokens,
        updateMode: "full",
        stream: true,
        onDelta: scopedOutputDelta({ stage: "adjust_full_json", outputMode: "json" }),
        signal,
        resolveReferenceUrl: resolveSceneAiReferenceUrl,
        capabilityLookup,
        selectedCapabilityIds,
        animationCapabilities,
        locale
      });
      return { stage: "json-full", sceneJson: parseSceneJsonString(fullJsonString), sceneJsonString: fullJsonString };
    }
    if (updateOutputMode === "json-incremental") {
      const { sceneJsonString: patchedJsonString, patch } = await requestUpdatedSceneJsonString(
        userPrompt,
        targetSceneJsonString,
        {
          ...providerOptions,
          maxTokens: maxTokens ?? providerOptions?.maxTokens,
          updateMode: "incremental",
          includePatch: true,
          stream: true,
          onDelta: scopedOutputDelta({ stage: "adjust_json_patch", outputMode: "patch" }),
          signal,
          resolveReferenceUrl: resolveSceneAiReferenceUrl,
          capabilityLookup,
          selectedCapabilityIds,
          animationCapabilities,
          locale
        }
      );
      return {
        stage: "json-incremental",
        patch,
        sceneJson: parseSceneJsonString(patchedJsonString),
        sceneJsonString: patchedJsonString
      };
    }
    // updateOutputMode === "commands": no fallback to JSON on empty/failed commands — surface the
    // error instead, since the user explicitly asked for commands-only.
    const cmdResult = await requestUpdatedSceneEditCommands(
      userPrompt,
      { userMessage: envelope, currentSceneJsonString: targetSceneJsonString },
      {
        ...providerOptions,
        maxTokens: maxTokens ?? providerOptions?.maxTokens,
        outputMode: "commands",
        fallbackToJson: false,
        stream: true,
        onDelta: scopedOutputDelta({ stage: "adjust_commands", outputMode: "commands" }),
        signal,
        resolveReferenceUrl: resolveSceneAiReferenceUrl,
        capabilityLookup,
        selectedCapabilityIds,
        animationCapabilities,
        locale
      }
    );
    if (!cmdResult.commands?.length) {
      throw new Error("AI 未返回可执行的命令。");
    }
    const offscreenRuntime = await createOffscreenRuntimeFromSceneJsonString(targetSceneJsonString);
    try {
      const ctx = createCommandContextForRuntime(
        offscreenRuntime,
        parseSceneJsonString(targetSceneJsonString)
      );
      const execResult = await executeCommands(ctx, cmdResult.commands);
      if (!execResult.results.some((r) => r.ok)) {
        throw new Error(execResult.results.find((r) => !r.ok)?.error || "命令执行失败。");
      }
      const sceneJsonString = exportRuntimeSceneJsonString(
        offscreenRuntime,
        parseSceneJsonString(targetSceneJsonString)
      );
      return {
        stage: "commands",
        commands: cmdResult.commands,
        execResult,
        sceneJson: parseSceneJsonString(sceneJsonString),
        sceneJsonString
      };
    } finally {
      offscreenRuntime.dispose?.();
    }
  }

  // Everything else uses the adaptive adjustment runner — commands preferred, JSON Patch next,
  // and a full-scene rewrite only as a last resort (see core/ai/sceneAgent.js). The model can
  // complete the request in its first response; additional calls happen only while it returns a
  // concrete, non-repeated change. The numeric setting below is solely a runaway guard.
  try {
    return await runAiAgentAdjustTurn({
      userPrompt,
      envelope,
      targetSceneJsonString,
      providerOptions,
      agentOptions,
      updateOutputMode,
      resolveContextPayload,
      onDelta,
      onAgentProgress,
      locale,
      capabilityLookup,
      selectedCapabilityIds,
      complexModelStrategy,
      modelQuality,
      modelBudget,
      rendererBackend,
      includePreviewCapabilities,
      animationCapabilities,
      generationStrategy,
      estimatedSegments,
      maxTokens,
      applyCommands,
      refreshContext,
      signal
    });
  } catch (commandError) {
    if (isAbortOrTurnTimeout(commandError, signal)) {
      throw commandError;
    }
    const commonFallbackOptions = {
      ...providerOptions,
      maxTokens: maxTokens ?? providerOptions?.maxTokens,
      stream: true,
      signal,
      resolveReferenceUrl: resolveSceneAiReferenceUrl,
      capabilityLookup,
      selectedCapabilityIds,
      rendererBackend,
      includePreviewCapabilities,
      animationCapabilities,
      locale
    };
    try {
      const { sceneJsonString, patch } = await requestUpdatedSceneJsonString(
        userPrompt,
        targetSceneJsonString,
        {
          ...commonFallbackOptions,
          updateMode: "incremental",
          includePatch: true,
          onDelta: scopedOutputDelta({ stage: "adjust_json_patch_fallback", outputMode: "patch" })
        }
      );
      if (normalizedSceneJsonSignature(sceneJsonString) !== normalizedSceneJsonSignature(targetSceneJsonString)) {
        return {
          stage: "json-incremental",
          patch,
          sceneJson: parseSceneJsonString(sceneJsonString),
          sceneJsonString,
          agentResult: {
            agentUsed: true,
            completed: true,
            stopReason: "json_patch_fallback",
            steps: [
              { kind: "commands", ok: false, error: String(commandError?.message || commandError) },
              { kind: "json_patch_fallback", ok: true }
            ]
          }
        };
      }
    } catch (patchError) {
      if (isAbortOrTurnTimeout(patchError, signal)) throw patchError;
    }

    const sceneJsonString = await requestUpdatedSceneJsonString(
      userPrompt,
      targetSceneJsonString,
      {
        ...commonFallbackOptions,
        updateMode: "full",
        onDelta: scopedOutputDelta({ stage: "adjust_full_json_fallback", outputMode: "json" })
      }
    );
    if (normalizedSceneJsonSignature(sceneJsonString) === normalizedSceneJsonSignature(targetSceneJsonString)) {
      const error = new Error("AI adjustment completed without changing the scene.");
      error.code = "AI_ADJUST_NO_CHANGE";
      throw error;
    }
    return {
      stage: "json-full",
      sceneJson: parseSceneJsonString(sceneJsonString),
      sceneJsonString,
      agentResult: {
        agentUsed: true,
        completed: true,
        stopReason: "json_full_fallback",
        steps: [
          { kind: "commands", ok: false, error: String(commandError?.message || commandError) },
          { kind: "json_full_fallback", ok: true }
        ]
      }
    };
  }
}
