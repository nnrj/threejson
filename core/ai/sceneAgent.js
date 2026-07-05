/**
 * Optional multi-step scene agent. Disabled unless agent.enabled === true.
 */
import {
  generateSceneJsonString,
  generateSceneJsonFromImage,
  updateSceneJsonString,
  requestUpdatedSceneEditCommands,
  dryRunUpdateCommands
} from "./sceneAiService.js";
import {
  buildSceneCommandUpdateUserMessage,
  commandListHasMutatingOp,
  commandListIsEmptyOrCommentsOnly,
  commandScriptIndicatesDone
} from "./sceneCommandSkill.js";
import { resolveAgentDepth } from "./agentDepth.js";
import {
  validateSceneJson,
  validateSceneJsonWithNormalizer,
  listTexturePointersSummary,
  requestSceneOutline,
  planTexturesDry,
  buildLayoutReviewPrompt,
  evaluateSceneCapabilityFit,
  buildCapabilityFixPrompt
} from "./agentTools.js";
import { fillTextureUrls, createOpenAiImageProvider } from "./textureAiService.js";
import { parseSceneJsonString } from "./sceneAiService.js";

/**
 * @typedef {object} SceneAgentProgress
 * @property {number} step
 * @property {string} kind
 * @property {string} message
 * @property {object} [usageEstimate]
 */

/**
 * @param {object} agentOptions
 * @returns {{ enabled: boolean, depth: string }}
 */
function normalizeAgentOptions(agentOptions = {}) {
  const enabled = agentOptions.enabled === true;
  const depth = agentOptions.depth || "simple";
  return { enabled, depth };
}

/**
 * @param {SceneAgentProgress|undefined} payload
 * @param {((p: SceneAgentProgress) => void)|undefined} onProgress
 */
function emitProgress(payload, onProgress) {
  if (typeof onProgress === "function" && payload) {
    onProgress(payload);
  }
}

/**
 * @param {object} params
 * @param {string} params.sceneJsonString
 * @param {((p: object) => void)|undefined} params.onProgress
 * @param {() => number} params.getStepIndex
 * @param {(value: number) => void} params.setStepIndex
 * @param {string} [params.message]
 */
function emitStagePreview({ sceneJsonString, onProgress, getStepIndex, setStepIndex, message }) {
  if (!sceneJsonString?.trim()) {
    return;
  }
  setStepIndex(getStepIndex() + 1);
  emitProgress(
    {
      step: getStepIndex(),
      kind: "stage_preview",
      message: message || "Stage preview ready.",
      sceneJsonString
    },
    onProgress
  );
}

/**
 * @param {object} params
 * @returns {Promise<object>}
 */
async function runSceneAgentCommandsUpdate(params) {
  const {
    userPrompt,
    currentSceneJsonString,
    updateContext = {},
    updateOutputMode,
    preset,
    outline,
    chatOptions,
    onProgress,
    steps,
    getStepIndex,
    setStepIndex,
    depth,
    validateCommands
  } = params;

  const maxCommandRounds =
    preset.maxRefineRounds ?? Math.max(preset.maxRepairAttempts ?? 1, 4);
  let round = 0;
  let lastError = "";
  let lastRawContent = "";

  const baseContext = {
    ...updateContext,
    currentSceneJsonString
  };

  while (round < maxCommandRounds) {
    round += 1;
    const isRepair = Boolean(lastError);
    setStepIndex(getStepIndex() + 1);
    const progressMessage = isRepair
      ? `Command repair (${round}/${maxCommandRounds}): ${lastError}`
      : baseContext.objectGetFeedback && round > 1
        ? `Continuing after scene inspection (${round}/${maxCommandRounds})...`
        : "Generating scene edit commands...";
    emitProgress(
      {
        step: getStepIndex(),
        kind: isRepair ? "repair" : baseContext.objectGetFeedback && round > 1 ? "explore" : "commands",
        message: progressMessage
      },
      onProgress
    );

    const requestPrompt = isRepair
      ? `Fix the command script. Error: ${lastError}. User intent: ${userPrompt}`
      : outline && round === 1
        ? `${userPrompt}\n\nFollow this outline:\n${outline}`
        : userPrompt;

    const context = { ...baseContext };
    if (isRepair || baseContext.objectGetFeedback || round > 1) {
      context.userMessage = [
        buildSceneCommandUpdateUserMessage({
          modificationRequest: requestPrompt,
          objectList: baseContext.objectListForMessage ?? baseContext.objectList,
          selectionId: baseContext.selectionId ?? null,
          selectionDescriptor: baseContext.selectionDescriptor ?? null,
          fullSceneJson: baseContext.fullSceneJson,
          objectGetFeedback: baseContext.objectGetFeedback,
          objectSpatialCards: baseContext.objectSpatialCards,
          sceneScaleProfile: baseContext.sceneScaleProfile,
          referenceObjects: baseContext.referenceObjects,
          placementHints: baseContext.placementHints,
          assemblyIntentHints: baseContext.assemblyIntentHints,
          singleRound: false,
          agentRound: true
        }),
        lastRawContent ? `Previous invalid output:\n${lastRawContent}` : ""
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    let commandResult;
    try {
      commandResult = await requestUpdatedSceneEditCommands(requestPrompt, context, {
        ...chatOptions,
        outputMode: updateOutputMode,
        fallbackToJson: false,
        agentRound: true,
        singleRound: false,
        maxTokens: isRepair ? preset.repairMaxTokens : preset.generateMaxTokens
      });
    } catch (err) {
      lastError = String(err?.message || err);
      steps.push({
        kind: isRepair ? "repair" : "commands",
        attempt: round,
        ok: false,
        error: lastError
      });
      continue;
    }

    lastRawContent = String(commandResult.rawContent || commandResult.commandScript || "");

    if (commandResult.outputMode === "json") {
      const validation = await validateSceneJsonWithNormalizer(commandResult.sceneJsonString);
      steps.push({
        kind: updateOutputMode === "auto" ? "auto_json" : "json",
        attempt: round,
        ok: validation.ok,
        error: validation.error
      });
      if (validation.ok) {
        return {
          outputMode: "json",
          sceneJsonString: commandResult.sceneJsonString,
          steps,
          agentUsed: true,
          tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
        };
      }
      lastError = validation.error || "Scene JSON validation failed.";
      continue;
    }

    const dryRun = await dryRunUpdateCommands(commandResult.commands, baseContext.currentSceneJsonString);
    if (!dryRun.ok) {
      const fail = dryRun.results?.find((item) => !item.ok);
      lastError = fail?.error || "Command dry-run failed.";
      steps.push({
        kind: isRepair ? "repair" : "commands",
        attempt: round,
        ok: false,
        error: lastError
      });
      continue;
    }

    if (!commandListHasMutatingOp(commandResult.commands)) {
      if (typeof validateCommands === "function") {
        const external = await validateCommands(commandResult.commands, { baseContext });
        if (external?.objectGetFeedback) {
          baseContext.objectGetFeedback = external.objectGetFeedback;
        }
        if (!external?.ok) {
          if (external?.objectGetFeedback) {
            steps.push({
              kind: "explore",
              attempt: round,
              ok: true
            });
            lastError = "";
            continue;
          }
          lastError = external?.error || "Command set has no mutating commands.";
          steps.push({
            kind: "repair",
            attempt: round,
            ok: false,
            error: lastError
          });
          continue;
        }
      } else {
        lastError =
          "Session ended with read-only commands only (object.get / scene.list). Output mutating commands or full scene JSON.";
        steps.push({
          kind: "repair",
          attempt: round,
          ok: false,
          error: lastError
        });
        continue;
      }
    } else if (typeof validateCommands === "function") {
      const external = await validateCommands(commandResult.commands, { baseContext });
      if (!external?.ok) {
        lastError = external?.error || "Command validation failed.";
        steps.push({
          kind: "repair",
          attempt: round,
          ok: false,
          error: lastError
        });
        continue;
      }
    }

    lastError = "";
    steps.push({
      kind: "commands",
      attempt: round,
      ok: true,
      count: commandResult.commands.length
    });
    return {
      outputMode: "commands",
      commandScript: commandResult.commandScript,
      commands: commandResult.commands,
      steps,
      agentUsed: true,
      tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
    };
  }

  throw new Error(lastError || `Command agent failed after ${maxCommandRounds} round(s).`);
}

/**
 * Iterative apply loop: exec mutating commands each round, refresh context, continue until # done.
 * @param {object} params
 * @returns {Promise<object>}
 */
async function runSceneAgentCommandsUpdateIterative(params) {
  const {
    userPrompt,
    currentSceneJsonString,
    updateContext = {},
    updateOutputMode,
    preset,
    outline,
    chatOptions,
    onProgress,
    steps,
    getStepIndex,
    setStepIndex,
    depth,
    applyCommands,
    refreshContext
  } = params;

  if (typeof applyCommands !== "function" || typeof refreshContext !== "function") {
    throw new Error("iterativeApply requires applyCommands and refreshContext callbacks.");
  }

  const maxRefineRounds = preset.maxRefineRounds ?? 4;
  const baseContext = {
    ...updateContext,
    currentSceneJsonString
  };
  let lastError = "";
  let lastRawContent = "";
  let appliedRounds = 0;
  let anySceneMutated = false;
  let lastCommands = [];

  for (let refineRound = 1; refineRound <= maxRefineRounds; refineRound += 1) {
    setStepIndex(getStepIndex() + 1);
    emitProgress(
      {
        step: getStepIndex(),
        kind: "refine",
        message: `Agent refine round ${refineRound}/${maxRefineRounds}...`
      },
      onProgress
    );

    const requestPrompt =
      refineRound === 1
        ? outline
          ? `${userPrompt}\n\nFollow this outline:\n${outline}`
          : userPrompt
        : `${userPrompt}\n\nContinue refining the scene on canvas. Output the next small patch, or # done when satisfied.`;

    const context = { ...baseContext };
    context.userMessage = buildSceneCommandUpdateUserMessage({
      modificationRequest: requestPrompt,
      objectList: baseContext.objectListForMessage ?? baseContext.objectList,
      selectionId: baseContext.selectionId ?? null,
      selectionDescriptor: baseContext.selectionDescriptor ?? null,
      fullSceneJson: baseContext.fullSceneJson,
      objectGetFeedback: baseContext.objectGetFeedback,
      objectSpatialCards: baseContext.objectSpatialCards,
      sceneScaleProfile: baseContext.sceneScaleProfile,
      referenceObjects: baseContext.referenceObjects,
      placementHints: baseContext.placementHints,
      assemblyIntentHints: baseContext.assemblyIntentHints,
      singleRound: false,
      agentRound: true
    });
    if (lastRawContent && refineRound > 1) {
      context.userMessage = `${context.userMessage}\n\nPrevious output:\n${lastRawContent}`;
    }
    if (lastError) {
      context.userMessage = `${context.userMessage}\n\nPrevious error: ${lastError}`;
    }

    let commandResult;
    try {
      commandResult = await requestUpdatedSceneEditCommands(requestPrompt, context, {
        ...chatOptions,
        outputMode: updateOutputMode,
        fallbackToJson: false,
        agentRound: true,
        iterativeApply: true,
        singleRound: false,
        maxTokens: preset.generateMaxTokens
      });
    } catch (err) {
      lastError = String(err?.message || err);
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      continue;
    }

    lastRawContent = String(commandResult.rawContent || commandResult.commandScript || "");
    lastError = "";

    if (commandResult.outputMode === "json") {
      const validation = await validateSceneJsonWithNormalizer(commandResult.sceneJsonString);
      steps.push({
        kind: updateOutputMode === "auto" ? "auto_json" : "json",
        round: refineRound,
        ok: validation.ok,
        error: validation.error
      });
      if (validation.ok) {
        return {
          outputMode: "json",
          sceneJsonString: commandResult.sceneJsonString,
          steps,
          agentUsed: true,
          iterativeApplied: true,
          tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
        };
      }
      lastError = validation.error || "Scene JSON validation failed.";
      continue;
    }

    const commands = commandResult.commands;
    if (commandScriptIndicatesDone(lastRawContent)) {
      steps.push({ kind: "refine_done", round: refineRound, ok: true, appliedRounds });
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: lastCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: anySceneMutated,
        execOk: true,
        tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
      };
    }
    if (commandListIsEmptyOrCommentsOnly(commands)) {
      lastError = "Output mutating commands or # done when finished.";
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      continue;
    }

    const dryRun = await dryRunUpdateCommands(commands, baseContext.currentSceneJsonString);
    if (!dryRun.ok) {
      const fail = dryRun.results?.find((item) => !item.ok);
      lastError = fail?.error || "Command dry-run failed.";
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      continue;
    }

    const readOnly = !commandListHasMutatingOp(commands);
    const applied = await applyCommands(commands, {
      round: refineRound,
      readOnly,
      label: `AI Agent round ${refineRound}`
    });
    if (!applied.ok) {
      lastError = applied.error || "Command apply failed.";
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      continue;
    }
    if (applied.objectGetFeedback) {
      baseContext.objectGetFeedback = [baseContext.objectGetFeedback, applied.objectGetFeedback]
        .filter(Boolean)
        .join("\n\n");
    }

    if (!readOnly) {
      appliedRounds += 1;
      lastCommands = commands;
      anySceneMutated = anySceneMutated || applied.sceneMutated === true;
      emitProgress(
        {
          step: getStepIndex(),
          kind: "commands_applied",
          round: refineRound,
          message: `Applied round ${refineRound} to scene.`,
          sceneMutated: applied.sceneMutated === true
        },
        onProgress
      );
    }

    const fresh = await refreshContext();
    if (fresh && typeof fresh === "object") {
      Object.assign(baseContext, fresh);
    }

    steps.push({
      kind: readOnly ? "explore" : "refine_apply",
      round: refineRound,
      ok: true,
      count: commands.length
    });

    if (commandScriptIndicatesDone(lastRawContent)) {
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: lastCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: anySceneMutated,
        execOk: appliedRounds > 0,
        tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
      };
    }
  }

  if (appliedRounds > 0) {
    return {
      outputMode: "commands",
      commands: lastCommands,
      steps,
      agentUsed: true,
      iterativeApplied: true,
      skipFinalExec: true,
      appliedRounds,
      sceneMutated: anySceneMutated,
      execOk: true,
      tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
    };
  }

  throw new Error(lastError || "Iterative agent finished without applying changes.");
}

/**
 * @param {object} input
 * @param {string} input.mode generate | update | fromImage
 * @param {string} [input.prompt]
 * @param {string} [input.currentSceneJsonString]
 * @param {string|{base64:string,mimeType?:string}} [input.image]
 * @param {object} [options]
 * @param {object} [options.agent]
 * @param {((p: SceneAgentProgress) => void)} [options.onProgress]
 * @returns {Promise<{ sceneJsonString: string, steps: object[], agentUsed: boolean, tokenHint: object }>}
 */
async function runSceneAgent(input = {}, options = {}) {
  const mode = input.mode || "generate";
  const prompt = String(input.prompt || "").trim();
  const { enabled, depth } = normalizeAgentOptions(options.agent);
  const onProgress = options.onProgress;
  const steps = [];
  let stepIndex = 0;
  const streamPreview = options.streamPreview === true;
  const chatTransport = {
    stream: options.stream === true,
    signal: options.signal,
    onDelta:
      streamPreview && typeof onProgress === "function"
        ? (previewDelta) => {
            emitProgress(
              { step: stepIndex, kind: "stream", message: "Streaming…", previewDelta },
              onProgress
            );
          }
        : options.onDelta
  };
  const chatOptions = { ...options, ...chatTransport };
  const textureOptions = options.texture || {};
  delete chatOptions.agent;
  delete chatOptions.onProgress;
  delete chatOptions.texture;
  delete chatOptions.streamPreview;

  /** Agent repair/layout steps always use full-scene JSON, not incremental patch. */
  const chatOptionsFullUpdate = { ...chatOptions };
  delete chatOptionsFullUpdate.updateMode;

  /** Avoid duplicate capability review inside generate when agent loop handles it. */
  const chatOptionsGenerate = {
    ...chatOptions,
    capabilityReview: false,
    planFirst: chatOptions.planFirst === true && !enabled
  };

  const maybeFillTextures = async (sceneJsonString) => {
    if (!textureOptions.enabled) {
      return { sceneJsonString, textureFillWarning: undefined };
    }
    try {
      const sink = textureOptions.sink;
      const imageProvider =
        textureOptions.imageProvider ||
        (textureOptions.imageApiKey || chatOptions.apiKey
          ? createOpenAiImageProvider({
              apiKey:
                textureOptions.imageApiKey ||
                textureOptions.image?.apiKey ||
                chatOptions.apiKey,
              baseUrl: textureOptions.imageBaseUrl || textureOptions.image?.baseUrl || chatOptions.baseUrl,
              model:
                textureOptions.imageModel ||
                textureOptions.image?.model ||
                chatOptions.imageModel ||
                "dall-e-3"
            })
          : null);
      if (!imageProvider) {
        throw new Error(
          "texture.enabled requires imageProvider or apiKey (llm.apiKey / chat apiKey)."
        );
      }
      if (!sink?.saveLocal && !sink?.upload) {
        throw new Error(
          "texture.enabled requires sink.saveLocal or sink.upload (browser: directory/upload sink; external Node tools: core/util/nodeTextureSink)."
        );
      }
      stepIndex += 1;
      emitProgress(
        {
          step: stepIndex,
          kind: "fill_textures",
          message: "Filling textureUrl slots..."
        },
        onProgress
      );
      const filled = await fillTextureUrls(sceneJsonString, {
        userHint: prompt,
        sink,
        imageProvider,
        projectRoot: textureOptions.projectRoot,
        overwriteExisting: Boolean(textureOptions.overwriteExisting),
        concurrency: textureOptions.concurrency ?? 2,
        chatOptions: {
          provider: chatOptions.provider,
          apiKey: chatOptions.apiKey,
          model: chatOptions.model,
          baseUrl: chatOptions.baseUrl,
          temperature: chatOptions.temperature
        }
      });
      steps.push({
        kind: "fill_textures",
        ok: true,
        applied: filled.taskResults?.length ?? 0,
        skipped: filled.skipped?.length ?? 0
      });
      return { sceneJsonString: filled.sceneJsonString, textureFillWarning: undefined };
    } catch (err) {
      steps.push({
        kind: "fill_textures",
        ok: false,
        error: String(err?.message || err)
      });
      return {
        sceneJsonString,
        textureFillWarning: String(err?.message || err)
      };
    }
  };

  const emitSceneReady = (sceneJsonString) => {
    stepIndex += 1;
    emitProgress(
      {
        step: stepIndex,
        kind: "scene_ready",
        message: "Scene JSON ready.",
        sceneJsonString
      },
      onProgress
    );
  };

  const runSingleShot = async () => {
    if (mode === "update") {
      if (!prompt) {
        throw new Error("prompt is required for update mode.");
      }
      if (!input.currentSceneJsonString?.trim()) {
        throw new Error("currentSceneJsonString is required for update mode.");
      }
      return updateSceneJsonString(prompt, input.currentSceneJsonString, chatOptions);
    }
    if (mode === "fromImage") {
      if (input.image === undefined || input.image === null) {
        throw new Error("image is required for fromImage mode.");
      }
      return generateSceneJsonFromImage(
        { prompt: prompt || undefined, image: input.image },
        chatOptions
      );
    }
    if (!prompt) {
      throw new Error("prompt is required for generate mode.");
    }
    return generateSceneJsonString(prompt, chatOptions);
  };

  if (!enabled) {
    let sceneJsonString = await runSingleShot();
    steps.push({ kind: "single", ok: true });
    const singleValidation = await validateSceneJson(sceneJsonString);
    if (!singleValidation.ok) {
      throw new Error(singleValidation.error || "Scene JSON validation failed.");
    }
    emitSceneReady(sceneJsonString);
    const fillResult = await maybeFillTextures(sceneJsonString);
    return {
      sceneJsonString: fillResult.sceneJsonString,
      textureFillWarning: fillResult.textureFillWarning,
      steps,
      agentUsed: false,
      tokenHint: { rounds: stepIndex || 1, depth: "simple" }
    };
  }

  const preset = resolveAgentDepth(depth);
  let outline = "";
  let sceneJsonString = "";

  const updateOutputMode = String(input.outputMode || options.outputMode || "json").toLowerCase();
  const commandUpdateModes = new Set(["commands", "auto"]);

  if (mode === "update" && commandUpdateModes.has(updateOutputMode)) {
    if (!prompt) {
      throw new Error("prompt is required for update mode.");
    }
    if (!input.currentSceneJsonString?.trim()) {
      throw new Error("currentSceneJsonString is required for update mode.");
    }

    if (preset.runOutline) {
      stepIndex += 1;
      emitProgress(
        { step: stepIndex, kind: "outline", message: "Planning scene outline..." },
        onProgress
      );
      outline = await requestSceneOutline(
        { prompt, mode },
        {
          ...chatOptions,
          maxTokens: preset.outlineMaxTokens
        }
      );
      steps.push({ kind: "outline", ok: true, length: outline.length });
    }

    let commandStepIndex = stepIndex;
    const iterativeApply = options.agent?.iterativeApply === true;
    const commandRunner = iterativeApply
      ? runSceneAgentCommandsUpdateIterative
      : runSceneAgentCommandsUpdate;
    const commandResult = await commandRunner({
      userPrompt: prompt,
      currentSceneJsonString: input.currentSceneJsonString,
      updateContext: input.updateContext || {},
      updateOutputMode,
      preset,
      outline,
      chatOptions,
      onProgress,
      steps,
      getStepIndex: () => commandStepIndex,
      setStepIndex: (value) => {
        commandStepIndex = value;
        stepIndex = value;
      },
      depth,
      validateCommands: options.validateCommands,
      applyCommands: options.applyCommands,
      refreshContext: options.refreshContext
    });

    stepIndex = commandStepIndex;

    if (commandResult.outputMode === "json") {
      emitSceneReady(commandResult.sceneJsonString);
      const fillResult = await maybeFillTextures(commandResult.sceneJsonString);
      return {
        ...commandResult,
        sceneJsonString: fillResult.sceneJsonString,
        textureFillWarning: fillResult.textureFillWarning,
        tokenHint: commandResult.tokenHint
      };
    }

    stepIndex += 1;
    emitProgress(
      {
        step: stepIndex,
        kind: "commands_ready",
        message: "Scene edit commands ready.",
        commands: commandResult.commands
      },
      onProgress
    );
    return {
      ...commandResult,
      textureFillWarning: undefined,
      tokenHint: commandResult.tokenHint
    };
  }

  if (preset.runOutline) {
    stepIndex += 1;
    emitProgress(
      { step: stepIndex, kind: "outline", message: "Planning scene outline..." },
      onProgress
    );
    outline = await requestSceneOutline(
      { prompt, mode },
      {
        ...chatOptions,
        maxTokens: preset.outlineMaxTokens
      }
    );
    steps.push({ kind: "outline", ok: true, length: outline.length });
  }

  stepIndex += 1;
  emitProgress(
    { step: stepIndex, kind: "generate", message: "Generating full scene JSON..." },
    onProgress
  );

  const generatePrompt =
    outline && preset.runOutline
      ? `${prompt}\n\nFollow this outline:\n${outline}`
      : prompt;

  if (mode === "update") {
    sceneJsonString = await updateSceneJsonString(
      generatePrompt || prompt,
      input.currentSceneJsonString,
      { ...chatOptionsGenerate, maxTokens: preset.generateMaxTokens }
    );
  } else if (mode === "fromImage") {
    sceneJsonString = await generateSceneJsonFromImage(
      { prompt: generatePrompt || prompt || undefined, image: input.image },
      { ...chatOptionsGenerate, maxTokens: preset.generateMaxTokens }
    );
  } else {
    sceneJsonString = await generateSceneJsonString(generatePrompt, {
      ...chatOptionsGenerate,
      maxTokens: preset.generateMaxTokens
    });
  }
  steps.push({ kind: "generate", ok: true });

  let validation = await validateSceneJsonWithNormalizer(sceneJsonString);
  if (validation.ok) {
    emitStagePreview({
      sceneJsonString,
      onProgress,
      getStepIndex: () => stepIndex,
      setStepIndex: (value) => {
        stepIndex = value;
      },
      message: "Initial draft ready."
    });
  }
  const maxRepairAttempts = preset.maxRepairAttempts ?? (preset.stopWhenValid ? 3 : 1);
  let repairAttempt = 0;
  while (!validation.ok && preset.runRepair && repairAttempt < maxRepairAttempts) {
    repairAttempt += 1;
    stepIndex += 1;
    emitProgress(
      {
        step: stepIndex,
        kind: "repair",
        message: `Validation failed (attempt ${repairAttempt}/${maxRepairAttempts}): ${validation.error}`
      },
      onProgress
    );
    const repairPrompt = `Fix the scene JSON so it is valid ThreeJSON. Previous error: ${validation.error}. User intent: ${prompt}`;
    sceneJsonString = await updateSceneJsonString(repairPrompt, sceneJsonString, {
      ...chatOptionsFullUpdate,
      maxTokens: preset.repairMaxTokens
    });
    validation = await validateSceneJsonWithNormalizer(sceneJsonString);
    steps.push({
      kind: "repair",
      attempt: repairAttempt,
      ok: validation.ok,
      error: validation.error
    });
    if (validation.ok) {
      emitStagePreview({
        sceneJsonString,
        onProgress,
        getStepIndex: () => stepIndex,
        setStepIndex: (value) => {
          stepIndex = value;
        },
        message: `Repair preview (attempt ${repairAttempt}).`
      });
    }
    if (validation.ok && preset.stopWhenValid) {
      break;
    }
  }

  if (validation.ok && preset.runCapabilityReview) {
    const maxCapAttempts = preset.maxCapabilityReviewAttempts ?? 1;
    let capAttempt = 0;
    while (capAttempt < maxCapAttempts) {
      const parsed = parseSceneJsonString(sceneJsonString);
      const fit = evaluateSceneCapabilityFit(prompt, parsed);
      if (fit.ok) {
        steps.push({ kind: "capability_review", ok: true, matchedSignals: fit.matchedSignals });
        break;
      }
      capAttempt += 1;
      stepIndex += 1;
      emitProgress(
        {
          step: stepIndex,
          kind: "capability_review",
          message: `Capability fit review (attempt ${capAttempt}/${maxCapAttempts})...`
        },
        onProgress
      );
      const fixPrompt = buildCapabilityFixPrompt(prompt, fit);
      sceneJsonString = await updateSceneJsonString(fixPrompt, sceneJsonString, {
        ...chatOptionsFullUpdate,
        maxTokens: preset.repairMaxTokens || preset.generateMaxTokens
      });
      validation = await validateSceneJsonWithNormalizer(sceneJsonString);
      steps.push({
        kind: "capability_review",
        attempt: capAttempt,
        ok: fit.ok,
        gaps: fit.gaps,
        validationOk: validation.ok
      });
      if (!validation.ok) {
        break;
      }
      const refit = evaluateSceneCapabilityFit(prompt, parseSceneJsonString(sceneJsonString));
      if (refit.ok) {
        break;
      }
    }
    if (validation.ok) {
      emitStagePreview({
        sceneJsonString,
        onProgress,
        getStepIndex: () => stepIndex,
        setStepIndex: (value) => {
          stepIndex = value;
        },
        message: "Capability review preview."
      });
    }
  }

  if (validation.ok && preset.runLayoutReview) {
    stepIndex += 1;
    const pointerSummary = listTexturePointersSummary(sceneJsonString);
    const capabilityFit = evaluateSceneCapabilityFit(prompt, parseSceneJsonString(sceneJsonString));
    emitProgress(
      {
        step: stepIndex,
        kind: "layout_review",
        message: `Layout/material review (${pointerSummary.count} texture slot(s))...`
      },
      onProgress
    );
    const reviewPrompt = buildLayoutReviewPrompt(
      sceneJsonString,
      prompt,
      pointerSummary,
      capabilityFit
    );
    sceneJsonString = await updateSceneJsonString(reviewPrompt, sceneJsonString, {
      ...chatOptionsFullUpdate,
      maxTokens: preset.layoutReviewMaxTokens || preset.repairMaxTokens
    });
    validation = await validateSceneJsonWithNormalizer(sceneJsonString);
    steps.push({ kind: "layout_review", ok: validation.ok, error: validation.error });
    if (validation.ok) {
      emitStagePreview({
        sceneJsonString,
        onProgress,
        getStepIndex: () => stepIndex,
        setStepIndex: (value) => {
          stepIndex = value;
        },
        message: "Layout review preview."
      });
    }
  }

  if (preset.runTextureReview && validation.ok) {
    stepIndex += 1;
    const summary = listTexturePointersSummary(sceneJsonString);
    emitProgress(
      {
        step: stepIndex,
        kind: "texture_review",
        message: `Found ${summary.count} textureUrl slot(s). Planning dry-run...`
      },
      onProgress
    );
    try {
      const dry = await planTexturesDry(sceneJsonString, prompt, {
        ...chatOptions,
        maxTokens: preset.reviewMaxTokens || 800
      });
      steps.push({
        kind: "texture_review",
        ok: true,
        taskCount: dry.taskCount,
        note: dry.note
      });
    } catch (err) {
      steps.push({
        kind: "texture_review",
        ok: false,
        error: String(err?.message || err)
      });
    }
  }

  if (!validation.ok) {
    throw new Error(validation.error || "Scene JSON validation failed after agent run.");
  }

  if (preset.stopWhenValid && validation.ok) {
    steps.push({ kind: "complete", ok: true, depth });
  }

  emitSceneReady(sceneJsonString);
  const fillResult = await maybeFillTextures(sceneJsonString);

  return {
    sceneJsonString: fillResult.sceneJsonString,
    textureFillWarning: fillResult.textureFillWarning,
    steps,
    agentUsed: true,
    tokenHint: {
      rounds: stepIndex,
      depth,
      maxSteps: preset.maxSteps
    }
  };
}

export { runSceneAgent, normalizeAgentOptions };
