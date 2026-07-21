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
  generateSceneJsonString,
  generateSceneJsonFromImage,
  parseSceneJsonString,
  runSceneAgent,
  classifyTurnIntent,
  summarizeSceneTurn,
  generateSceneTitle,
  buildStructuredTurnEnvelope,
  buildObjectSpatialCardsFromSceneJson,
  buildSceneScaleProfile,
  requestUpdatedSceneEditCommands,
  updateSceneJsonString as requestUpdatedSceneJsonString,
  executeCommands,
  createCommandContext,
  sceneToStandardJsonSimple,
  createJsonScene
} from "threejson";
import { resolveSceneHostUrl, sceneHostAssetUrl } from "./sceneHostPaths.js";

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

async function applyAiDraftCommands(commands, { sceneJsonString }) {
  const runtime = await createOffscreenRuntimeFromSceneJsonString(sceneJsonString);
  try {
    const ctx = createCommandContextForRuntime(runtime);
    const execResult = await executeCommands(ctx, commands);
    const results = Array.isArray(execResult.results) ? execResult.results : [];
    const ok = results.length ? results.every((item) => item.ok !== false) : execResult.ok !== false;
    if (!ok) {
      return {
        ok: false,
        error: results.find((item) => item.ok === false)?.error || "Draft refinement commands failed."
      };
    }
    return { ok: true, sceneJsonString: exportRuntimeSceneJsonString(runtime) };
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
 * First-turn (no prior context) generation: builds the structured JSON envelope and calls
 * core/ai's generateSceneJsonString with streaming enabled.
 * @param {{ userPrompt: string, providerOptions: object, onDelta?: (delta:string)=>void, onGenerationPhase?: (phase:object)=>void|Promise<void>, onSceneDraft?: (sceneJsonString:string)=>void|Promise<void>, signal?: AbortSignal, globalPromptPrefix?: string, agentOptions?: object, onAgentProgress?: (p: object)=>void, includeReferenceLinks?: boolean, locale?: string, onlineTextureHints?: boolean, generationStrategy?: "single"|"segmented"|"compact", estimatedSegments?: number, maxSceneSegments?: number }} input
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
  onlineTextureHints,
  generationStrategy = "single",
  estimatedSegments,
  maxSceneSegments,
  selectedCapabilityIds,
  requiresAnimation
}) {
  const envelope = buildStructuredTurnEnvelope({
    userPrompt,
    intent: "generate",
    globalPromptPrefix,
    includeReferenceLinks,
    generationStrategy,
    selectedCapabilityIds,
    requiresAnimation
  });
  if (agentOptions?.enabled) {
    const result = await runSceneAgent(
      { mode: "generate", prompt: envelope },
      {
        ...providerOptions,
        signal,
        agent: {
          enabled: true,
          depth: agentOptions.depth || "medium",
          progressiveRefinement: agentOptions.progressiveGenerate !== false
        },
        resolveReferenceUrl: resolveSceneAiReferenceUrl,
        capabilityLookup,
        onlineTextureHints,
        estimatedSegments,
        segmentedOutput: generationStrategy === "segmented",
        maxSceneSegments,
        selectedCapabilityIds,
        animationCapabilities: requiresAnimation === true,
        onGenerationPhase,
        applyDraftCommands: applyAiDraftCommands,
        locale,
        onProgress: onAgentProgress
      }
    );
    const sceneJson = parseSceneJsonString(result.sceneJsonString);
    return { sceneJson, sceneJsonString: result.sceneJsonString, agentResult: result };
  }
  const sceneJsonString = await generateSceneJsonString(envelope, {
    ...providerOptions,
    stream: true,
    onDelta,
    onGenerationPhase,
    onSceneDraft,
    signal,
    resolveReferenceUrl: resolveSceneAiReferenceUrl,
    capabilityLookup,
    onlineTextureHints,
    estimatedSegments,
    segmentedOutput: generationStrategy === "segmented",
    maxSceneSegments,
    selectedCapabilityIds,
    animationCapabilities: requiresAnimation === true,
    locale
  });
  const sceneJson = parseSceneJsonString(sceneJsonString);
  return { sceneJson, sceneJsonString };
}

/**
 * Generates a scene from a reference image — ThreeBox never wired this up (no call site ever
 * requested `mode: "fromImage"`); this is ported from editor's pre-existing `aiSidebar.js`
 * `onImageGenerate`/`runSidebarSceneAgent(..., {mode:"fromImage", ...})` flow, generalized the
 * same way `runAiGenerateTurn` above is.
 * @param {{ prompt?: string, image: string|{base64:string, mimeType?:string}, providerOptions: object, agentOptions?: object, imageDetail?: "auto"|"low"|"high", maxTokens?: number, onAgentProgress?: (p:object)=>void, onGenerationPhase?: (phase:object)=>void|Promise<void>, signal?: AbortSignal, locale?: string, capabilityLookup?: boolean, onlineTextureHints?: boolean }} input
 */
export async function runAiImageGenerateTurn({
  prompt = "",
  image,
  providerOptions,
  agentOptions,
  imageDetail = "auto",
  maxTokens = 8192,
  onAgentProgress,
  onGenerationPhase,
  signal,
  locale,
  capabilityLookup,
  onlineTextureHints
}) {
  if (!image) {
    throw new Error("runAiImageGenerateTurn: image is required.");
  }
  if (agentOptions?.enabled) {
    const result = await runSceneAgent(
      { mode: "fromImage", prompt, image },
      {
        ...providerOptions,
        signal,
        imageDetail,
        maxTokens,
        agent: {
          enabled: true,
          depth: agentOptions.depth || "medium",
          progressiveRefinement: agentOptions.progressiveGenerate !== false
        },
        resolveReferenceUrl: resolveSceneAiReferenceUrl,
        capabilityLookup,
        onlineTextureHints,
        onGenerationPhase,
        locale,
        onProgress: onAgentProgress
      }
    );
    const sceneJson = parseSceneJsonString(result.sceneJsonString);
    return { sceneJson, sceneJsonString: result.sceneJsonString, agentResult: result };
  }
  const sceneJsonString = await generateSceneJsonFromImage(
    { prompt, image },
    {
      ...providerOptions,
      imageDetail,
      maxTokens,
      signal,
      resolveReferenceUrl: resolveSceneAiReferenceUrl,
      capabilityLookup,
      onlineTextureHints,
      locale
    }
  );
  const sceneJson = parseSceneJsonString(sceneJsonString);
  return { sceneJson, sceneJsonString };
}

/**
 * Classifies whether a follow-up message is a new generation or an adjustment of a prior turn.
 * @param {{ userPrompt: string, history: Array<{turnId:string, summary:string}> }} input
 * @param {object} providerOptions
 */
export async function classifyAiTurnIntent({ userPrompt, history }, providerOptions) {
  return classifyTurnIntent({ userPrompt, history }, providerOptions);
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
export function exportRuntimeSceneJsonString(runtime) {
  return JSON.stringify(
    sceneToStandardJsonSimple(runtime.scene, { merge: false, runtimeTarget: runtime }),
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

function createCommandContextForRuntime(runtime) {
  return createCommandContext({
    scene: runtime.scene,
    camera: runtime.camera,
    renderer: runtime.renderer,
    controls: runtime.controls
  });
}

async function runAiAgentAdjustTurn({
  userPrompt,
  envelope,
  targetSceneJsonString,
  providerOptions,
  agentOptions,
  updateOutputMode,
  resolveContextPayload,
  onAgentProgress,
  locale,
  capabilityLookup,
  onlineTextureHints,
  selectedCapabilityIds,
  animationCapabilities,
  signal
}) {
  const mode = mapUpdateOutputModeToAgentInput(updateOutputMode);
  const baseSceneJson = parseSceneJsonString(targetSceneJsonString);
  const baseContextPayload = resolveContextPayload?.(baseSceneJson) || {};
  const updateContext = {
    ...baseContextPayload,
    userMessage: envelope,
    currentSceneJsonString: targetSceneJsonString,
    fullSceneJson: targetSceneJsonString
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
        updateMode: mode.updateMode,
        agent: { enabled: true, depth: agentOptions.depth || "medium" },
        resolveReferenceUrl: resolveSceneAiReferenceUrl,
        capabilityLookup,
        onlineTextureHints,
        selectedCapabilityIds,
        animationCapabilities,
        locale,
        signal,
        onProgress: onAgentProgress
      }
    );
    return {
      stage: mode.stage,
      patch: null,
      sceneJson: parseSceneJsonString(result.sceneJsonString),
      sceneJsonString: result.sceneJsonString,
      agentResult: result
    };
  }

  const offscreenRuntime = await createOffscreenRuntimeFromSceneJsonString(targetSceneJsonString);
  try {
    let latestSceneJsonString = targetSceneJsonString;
    const refreshContext = async () => {
      latestSceneJsonString = exportRuntimeSceneJsonString(offscreenRuntime);
      const latestSceneJson = parseSceneJsonString(latestSceneJsonString);
      const contextPayload = resolveContextPayload?.(latestSceneJson) || {};
      return {
        ...contextPayload,
        currentSceneJsonString: latestSceneJsonString,
        fullSceneJson: latestSceneJsonString
      };
    };
    const applyCommands = async (commands) => {
      const ctx = createCommandContextForRuntime(offscreenRuntime);
      const execResult = await executeCommands(ctx, commands);
      const results = Array.isArray(execResult.results) ? execResult.results : [];
      const ok = results.length ? results.every((r) => r.ok !== false) : execResult.ok !== false;
      const sceneMutated = results.some((r) => r.ok);
      return { ok, sceneMutated, execResult, error: results.find((r) => !r.ok)?.error };
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
        agent: {
          enabled: true,
          depth: agentOptions.depth || "medium",
          iterativeApply: agentOptions.iterativeApply !== false
        },
        resolveReferenceUrl: resolveSceneAiReferenceUrl,
        capabilityLookup,
        onlineTextureHints,
        selectedCapabilityIds,
        animationCapabilities,
        locale,
        signal,
        applyCommands,
        refreshContext,
        onProgress: onAgentProgress
      }
    );
    if (result.outputMode === "json") {
      return {
        stage: "json-full",
        sceneJson: parseSceneJsonString(result.sceneJsonString),
        sceneJsonString: result.sceneJsonString,
        agentResult: result
      };
    }
    if (!result.skipFinalExec && Array.isArray(result.commands) && result.commands.length) {
      const applied = await applyCommands(result.commands);
      if (!applied.ok) {
        throw new Error(applied.error || "Agent command apply failed.");
      }
    }
    const sceneJsonString = exportRuntimeSceneJsonString(offscreenRuntime);
    return {
      stage: "commands",
      commands: result.commands || [],
      execResult: { ok: result.execOk !== false },
      sceneJson: parseSceneJsonString(sceneJsonString),
      sceneJsonString,
      agentResult: result
    };
  } finally {
    offscreenRuntime.dispose?.();
  }
}

/**
 * Three-stage adjust fallback chain: try operation commands against a private offscreen clone of
 * the target scene first (no full JSON regeneration needed); if that produces no usable mutation,
 * fall back to an RFC 6902 JSON-Patch regeneration; if that also fails, fall back to a full scene
 * JSON regeneration (always succeeds or throws). Never touches any "live" scene — every path
 * returns a fresh `sceneJson`/`sceneJsonString` for the CALLER to apply however it wants (a new
 * chat scene card, or an in-place replace of the caller's own live canvas).
 *
 * @param {{
 *   userPrompt: string,
 *   envelope: string,
 *   targetSceneJsonString: string,
 *   providerOptions: object,
 *   onDelta?: (delta: string) => void,
 *   agentOptions?: object,
 *   updateOutputMode?: string,
 *   resolveContextPayload?: (sceneJson: object) => object,
 *   onAgentProgress?: (p: object) => void,
 *   locale?: string,
 *   onlineTextureHints?: boolean,
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
  onlineTextureHints,
  selectedCapabilityIds,
  animationCapabilities,
  signal
}) {
  if (agentOptions?.enabled) {
    return runAiAgentAdjustTurn({
      userPrompt,
      envelope,
      targetSceneJsonString,
      providerOptions,
      agentOptions,
      updateOutputMode,
      resolveContextPayload,
      onAgentProgress,
      locale,
      capabilityLookup,
      onlineTextureHints,
      selectedCapabilityIds,
      animationCapabilities,
      signal
    });
  }

  // strictOutputMode forces exactly the requested single stage with no cascade — opt-in and
  // default-off so existing callers (ThreeBox never passes it) keep the always-cascade behavior
  // below unchanged. Used by Editor's AI-edit quick controls: "auto" (strictOutputMode left off)
  // means "let the cascade decide"; picking a specific mode forces it.
  if (strictOutputMode && updateOutputMode !== "auto") {
    if (updateOutputMode === "json-full") {
      const fullJsonString = await requestUpdatedSceneJsonString(userPrompt, targetSceneJsonString, {
        ...providerOptions,
        updateMode: "full",
        stream: true,
        onDelta,
        signal,
        resolveReferenceUrl: resolveSceneAiReferenceUrl,
        capabilityLookup,
        onlineTextureHints,
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
          updateMode: "incremental",
          includePatch: true,
          stream: true,
          onDelta,
          signal,
          resolveReferenceUrl: resolveSceneAiReferenceUrl,
          capabilityLookup,
          onlineTextureHints,
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
      { userMessage: envelope, currentSceneJsonString: targetSceneJsonString, fullSceneJson: targetSceneJsonString },
      {
        ...providerOptions,
        outputMode: "commands",
        fallbackToJson: false,
        stream: true,
        onDelta,
        signal,
        resolveReferenceUrl: resolveSceneAiReferenceUrl,
        capabilityLookup,
        onlineTextureHints,
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
      const ctx = createCommandContext({
        scene: offscreenRuntime.scene,
        camera: offscreenRuntime.camera,
        renderer: offscreenRuntime.renderer,
        controls: offscreenRuntime.controls
      });
      const execResult = await executeCommands(ctx, cmdResult.commands);
      if (!execResult.results.some((r) => r.ok)) {
        throw new Error(execResult.results.find((r) => !r.ok)?.error || "命令执行失败。");
      }
      const sceneJsonString = exportRuntimeSceneJsonString(offscreenRuntime);
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

  try {
    const cmdResult = await requestUpdatedSceneEditCommands(
      userPrompt,
      { userMessage: envelope, currentSceneJsonString: targetSceneJsonString, fullSceneJson: targetSceneJsonString },
      {
        ...providerOptions,
        outputMode: "commands",
        fallbackToJson: false,
        stream: true,
        onDelta,
        signal,
        resolveReferenceUrl: resolveSceneAiReferenceUrl,
        capabilityLookup,
        onlineTextureHints,
        selectedCapabilityIds,
        animationCapabilities,
        locale
      }
    );
    if (cmdResult.outputMode === "commands" && cmdResult.commands?.length) {
      const offscreenRuntime = await createOffscreenRuntimeFromSceneJsonString(targetSceneJsonString);
      try {
        const ctx = createCommandContext({
          scene: offscreenRuntime.scene,
          camera: offscreenRuntime.camera,
          renderer: offscreenRuntime.renderer,
          controls: offscreenRuntime.controls
        });
        const execResult = await executeCommands(ctx, cmdResult.commands);
        if (execResult.results.some((r) => r.ok)) {
          const sceneJsonString = exportRuntimeSceneJsonString(offscreenRuntime);
          return {
            stage: "commands",
            commands: cmdResult.commands,
            execResult,
            sceneJson: parseSceneJsonString(sceneJsonString),
            sceneJsonString
          };
        }
      } finally {
        offscreenRuntime.dispose?.();
      }
    }
  } catch (_error) {
    /* fall through to json-incremental */
  }

  try {
    const { sceneJsonString: patchedJsonString, patch } = await requestUpdatedSceneJsonString(userPrompt, targetSceneJsonString, {
      ...providerOptions,
      updateMode: "incremental",
      includePatch: true,
      stream: true,
      onDelta,
      signal,
      resolveReferenceUrl: resolveSceneAiReferenceUrl,
      capabilityLookup,
      onlineTextureHints,
      selectedCapabilityIds,
      animationCapabilities,
      locale
    });
    return {
      stage: "json-incremental",
      patch,
      sceneJson: parseSceneJsonString(patchedJsonString),
      sceneJsonString: patchedJsonString
    };
  } catch (_error) {
    /* fall through to json-full */
  }

  const fullJsonString = await requestUpdatedSceneJsonString(userPrompt, targetSceneJsonString, {
    ...providerOptions,
    updateMode: "full",
    stream: true,
    onDelta,
    signal,
    resolveReferenceUrl: resolveSceneAiReferenceUrl,
    capabilityLookup,
    onlineTextureHints,
    selectedCapabilityIds,
    animationCapabilities,
    locale
  });
  return { stage: "json-full", sceneJson: parseSceneJsonString(fullJsonString), sceneJsonString: fullJsonString };
}
