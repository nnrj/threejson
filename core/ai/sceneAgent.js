/**
 * Scene agent with two independent concerns: `generationStrategy` controls full-JSON transport,
 * while `executionMode` controls whether a scene is authored directly or built incrementally.
 * Direct is the default and produces one complete, immediately usable scene. `draft_refine` is
 * reserved for genuinely complex scenes or a direct output-limit fallback. Incremental loops stop
 * on `# done`, an implicit completed response, repeated/no-op output, or consecutive invalid
 * results. A caller may provide an explicit budget, but core owns no quality-round ceiling.
 *
 * Generation and adjustment share the same commands/patch/full-JSON/done protocol, compact spatial
 * context and optional caller-budget semantics. Their small host adapters remain separate only because a
 * generated draft may be applied through a stateless callback while adjustment owns a reusable
 * live/off-screen runtime with refresh/exploration hooks.
 *
 * Repair/capability-review/layout-review still exist (real domain knowledge lives in
 * evaluateSceneCapabilityFit/buildLayoutReviewPrompt); capability/layout fixes now go through
 * runTargetedFixRound, which prefers a small commands/JSON-Patch fix and only falls back to a
 * full-scene-JSON rewrite when that isn't available or doesn't work out.
 */
import {
  generateSceneJsonString,
  generateSceneJsonFromImage,
  updateSceneJsonString,
  requestUpdatedSceneEditCommands,
  requestSceneRefinementStep,
  dryRunUpdateCommands,
  projectSceneJsonString,
  parseSceneJsonString
} from "./sceneAiService.js";
import {
  buildSceneCommandUpdateUserMessage,
  commandListHasMutatingOp,
  commandListIsEmptyOrCommentsOnly,
  commandScriptIndicatesDone,
  commandScriptRequestsContinuation
} from "./sceneCommandSkill.js";
import {
  validateSceneJsonWithNormalizer,
  requestSceneOutline,
  buildLayoutReviewPrompt,
  evaluateSceneCapabilityFit,
  buildCapabilityFixPrompt
} from "./agentTools.js";
import { matchIntentSignals } from "./sceneCapability.js";
import { fetchReferenceMaterial } from "./sceneReferenceCatalog.js";
import {
  buildObjectSpatialCardsFromSceneJson,
  buildSceneScaleProfile
} from "./sceneSpatialContext.js";

/**
 * @typedef {object} SceneAgentProgress
 * @property {number} step
 * @property {string} kind
 * @property {string} message
 * @property {object} [usageEstimate]
 */

/** An anomaly guard, not a quality budget. Consecutive invalid/no-progress responses mean the
 * provider is no longer participating in the protocol and must not create an infinite loop. */
const MAX_CONSECUTIVE_NO_PROGRESS = 3;
const MAX_CAPABILITY_REVIEW_ATTEMPTS = 1;
const MAX_REPAIR_ATTEMPTS = 2;

/**
 * @param {object} agentOptions
 * @returns {{ maxRefineRounds?: number }}
 */
function normalizeAgentOptions(agentOptions = {}) {
  const raw = Number(agentOptions?.maxRefineRounds);
  return Number.isFinite(raw) && raw > 0
    ? { maxRefineRounds: Math.max(1, Math.round(raw)) }
    : {};
}

/** Returns the first explicitly configured positive token ceiling. An absent value deliberately
 * remains absent so core/ai never manufactures a provider output limit. */
function resolveOptionalTokenLimit(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.max(1, Math.round(numeric));
    }
  }
  return undefined;
}

function normalizeExecutionMode(value) {
  return value === "draft_refine" ? "draft_refine" : "direct";
}

function normalizeComplexModelStrategy(value) {
  return ["auto", "full-coordinates", "progressive"].includes(value) ? value : "auto";
}

function normalizeModelQuality(value) {
  return ["draft", "balanced", "high", "custom"].includes(value) ? value : "balanced";
}

function combineAbortSignals(...signals) {
  const active = signals.filter((signal) => signal && typeof signal.addEventListener === "function");
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any(active);
  }
  const controller = new AbortController();
  const forward = (signal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of active) {
    if (signal.aborted) {
      forward(signal);
      break;
    }
    signal.addEventListener("abort", () => forward(signal), { once: true });
  }
  return controller.signal;
}

function createModelBudgetMonitor(options = {}) {
  const configured = options.modelBudget && typeof options.modelBudget === "object"
    ? options.modelBudget
    : options.agent?.modelBudget && typeof options.agent.modelBudget === "object"
      ? options.agent.modelBudget
      : {};
  const positive = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
  };
  const nonNegative = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
  };
  const maxTokens = positive(configured.maxTokens);
  const maxCost = positive(configured.maxCost);
  const controller = new AbortController();
  const state = { totalTokens: 0, totalCost: 0, completionCount: 0 };
  const externalMetadata = typeof options.onCompletionMetadata === "function"
    ? options.onCompletionMetadata
    : null;
  const estimateCost = typeof options.estimateModelCost === "function"
    ? options.estimateModelCost
    : typeof options.providerAdapter?.estimateCost === "function"
      ? (metadata) => options.providerAdapter.estimateCost(metadata, {
          provider: options.provider,
          model: options.model,
          requestContext: options.requestContext
        })
      : null;

  const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    error.modelBudget = { ...state, maxTokens, maxCost };
    if (!controller.signal.aborted) controller.abort(error);
    throw error;
  };

  const onCompletionMetadata = (metadata = {}) => {
    state.completionCount += 1;
    const usage = metadata.usage && typeof metadata.usage === "object" ? metadata.usage : {};
    const actualTokens = positive(usage.totalTokens) ?? positive(usage.completionTokens);
    const estimatedTokens = positive(usage.estimatedCompletionTokens);
    state.totalTokens += actualTokens ?? estimatedTokens ?? 0;

    const reportedCost = nonNegative(usage.cost) ?? nonNegative(metadata.cost);
    let estimatedCost;
    if (reportedCost === undefined && maxCost !== undefined && estimateCost) {
      estimatedCost = Number(estimateCost({ ...metadata, usage }));
      if (!Number.isFinite(estimatedCost) || estimatedCost < 0) estimatedCost = undefined;
    }
    if (reportedCost !== undefined || estimatedCost !== undefined) {
      state.totalCost += reportedCost ?? estimatedCost;
    }

    externalMetadata?.({ ...metadata, modelBudgetUsage: { ...state } });
    if (maxTokens !== undefined && state.totalTokens > maxTokens) {
      fail(
        "AI_MODEL_TOKEN_BUDGET_EXCEEDED",
        `AI scene turn exceeded the explicitly configured model token budget (${Math.round(state.totalTokens)} > ${Math.round(maxTokens)}).`
      );
    }
    if (maxCost !== undefined && reportedCost === undefined && estimatedCost === undefined) {
      fail(
        "AI_MODEL_COST_ESTIMATOR_REQUIRED",
        "A model cost budget was configured, but this provider supplied neither cost metadata nor a host estimateModelCost/providerAdapter.estimateCost callback."
      );
    }
    if (maxCost !== undefined && state.totalCost > maxCost) {
      fail(
        "AI_MODEL_COST_BUDGET_EXCEEDED",
        `AI scene turn exceeded the explicitly configured model cost budget (${state.totalCost} > ${maxCost}).`
      );
    }
  };

  return {
    signal: combineAbortSignals(options.signal, controller.signal),
    onCompletionMetadata,
    state,
    maxTokens,
    maxCost
  };
}

function buildComplexModelAuthoringHint(strategy, quality) {
  const qualityLine = `Complex-model quality target: ${quality}. Treat it as a completion target, not a fixed round count.`;
  if (strategy === "full-coordinates") {
    return [
      "COMPLEX MODEL STRATEGY (mandatory): full-coordinates.",
      qualityLine,
      "When the request needs a free-form complex model, author the complete raw bufferMesh attributes and indices requested by the user. Do not replace it with primitive assemblies, an external asset, or editableMesh merely because the coordinate output is long.",
      "Use segmented scene output when transport requires continuation; continue until the JSON and mesh transaction are complete. There is no engine-owned vertex, triangle, byte, or continuation-round limit."
    ].join("\n");
  }
  if (strategy === "progressive") {
    return [
      "COMPLEX MODEL STRATEGY (mandatory): progressive.",
      qualityLine,
      "Represent free-form models as editableMesh control topology with stable vertex/face IDs, semantic parts, and deterministic modifiers. Produce a useful coarse model first, then refine only the affected parts with mesh.inspect, mesh.getTopology and atomic mesh.edit operations.",
      "When the coarse silhouette/topology is already correct, prefer locally evaluated Catmull-Clark/Loop and optional Smooth modifiers over generating redundant control vertices. Add topology only where silhouette, features, or deformation require it.",
      "Do not rebuild the entire mesh each step and do not reduce the subject to a pile of boxes, cylinders, or spheres when an editable surface is appropriate. End each refinement response with # continue plus the next concrete stage, or # done when the quality target is met."
    ].join("\n");
  }
  return [
    "COMPLEX MODEL STRATEGY: automatic.",
    qualityLine,
    "Choose the least complex representation that faithfully expresses the final shape: primitives/native geometry/instancing/CSG for exact regular forms, compact surfaces or editableMesh for free-form progressive work, and raw bufferMesh when complete coordinates are appropriate. Never downgrade a complex subject to primitive assemblies solely to shorten output, and never use a complex mesh merely because quality is requested."
  ].join("\n");
}

/** Scene hosts pass a JSON envelope so routing/capability metadata reaches the generation prompt.
 * Local semantic checks must inspect only the actual user request: matching the envelope field
 * name `requiresAnimation` used to create a false animation gap even when its value was `false`. */
function extractUserRequest(prompt) {
  const raw = String(prompt || "").trim();
  try {
    const envelope = JSON.parse(raw);
    if (envelope && typeof envelope === "object" && typeof envelope.userRequest === "string") {
      return envelope.userRequest.trim() || raw;
    }
  } catch {
    /* plain prompt or an envelope followed by extra authoring guidance */
  }
  return raw;
}

function normalizedSceneSignature(sceneJsonString) {
  try {
    return JSON.stringify(parseSceneJsonString(sceneJsonString));
  } catch {
    return String(sceneJsonString || "").trim();
  }
}

function isSceneOutputLimitError(error) {
  if (error?.code === "SCENE_OUTPUT_LIMIT") {
    return true;
  }
  return /output limit|not completed after .*segments|maximum output|token limit/i.test(
    String(error?.message || error || "")
  );
}

function completionReasonIndicatesCutoff(reason) {
  return /length|max[_ -]?tokens?|token[_ -]?limit|incomplete|truncat/i.test(String(reason || ""));
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
function emitStagePreview({ sceneJsonString, onProgress, getStepIndex, setStepIndex, message, stage, round, maxRounds, commands, outputMode }) {
  if (!sceneJsonString?.trim()) {
    return;
  }
  setStepIndex(getStepIndex() + 1);
  emitProgress(
    {
      step: getStepIndex(),
      kind: "stage_preview",
      // `stage` is the stable, i18n-friendly identifier (e.g. "initial_draft", "repair",
      // "draft_refinement", "capability_review", "layout_review"); `message` stays as the
      // English fallback for non-i18n callers (CLI tools, MCP server).
      stage,
      round,
      maxRounds,
      commands,
      outputMode,
      message: message || "Stage preview ready.",
      sceneJsonString
    },
    onProgress
  );
}

/** Best-effort, once-per-turn lookup of local docs/example material for capabilities the user's
 * prompt needs but the always-injected system-prompt catalog only mentions in passing (event
 * mechanism, scripts, business domains, etc. — see sceneReferenceCatalog.js). No-ops (returns "")
 * unless the host opted in by passing `chatOptions.resolveReferenceUrl`; never throws, so a
 * fetch failure never blocks the agent turn it was meant to help. */
async function resolveAgentReferenceMaterial(userPrompt, chatOptions) {
  if (chatOptions?.capabilityLookup === false || typeof chatOptions?.resolveReferenceUrl !== "function") {
    return "";
  }
  try {
    const signals = Array.isArray(chatOptions?.selectedCapabilityIds)
      ? chatOptions.selectedCapabilityIds.map((id) => ({ id }))
      : matchIntentSignals(userPrompt);
    return await fetchReferenceMaterial(signals, {
      resolveUrl: chatOptions.resolveReferenceUrl,
      locale: chatOptions.locale
    });
  } catch (_err) {
    return "";
  }
}

/**
 * A `requestUpdatedSceneEditCommands` result with `outputMode:"patch"` has already had its RFC
 * 6902 patch applied locally (see sceneAiService.js's tryApplyContentAsPatch) — it just needs to
 * reach the runtime. Wrapping the already-patched JSON in a single `scene.load` command lets it
 * flow through the exact same dry-run/apply/undo machinery as ordinary commands, with no special
 * casing needed anywhere else (the executor and every applyCommands closure already support
 * `scene.load`'s `args.json`).
 * @param {{outputMode:"patch", sceneJsonString: string}} patchResult
 * @returns {{op:"scene.load", args:{json: object}}[]}
 */
function commandsFromPatchResult(patchResult) {
  return [{ op: "scene.load", args: { json: parseSceneJsonString(patchResult.sceneJsonString) } }];
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
    validateCommands,
    createOutputStreamOptions
  } = params;

  // This path returns one usable update. Extra attempts repair invalid provider output; they are
  // not scene-quality/refinement rounds and therefore do not inherit a quality budget.
  const maxCommandAttempts = Math.max(1, preset.maxCommandRepairAttempts ?? 3);
  let round = 0;
  let lastError = "";
  let lastRawContent = "";

  const baseContext = {
    ...updateContext,
    currentSceneJsonString
  };

  // Resolved once for the whole turn (not per round) — same material is relevant across repair
  // attempts, and this avoids refetching on every round.
  const referenceMaterial = await resolveAgentReferenceMaterial(userPrompt, chatOptions);

  while (round < maxCommandAttempts) {
    round += 1;
    const isRepair = Boolean(lastError);
    setStepIndex(getStepIndex() + 1);
    const progressMessage = isRepair
      ? `Repairing an invalid command response: ${lastError}`
      : baseContext.objectGetFeedback && round > 1
        ? "Continuing after scene inspection..."
        : "Generating scene edit commands...";
    emitProgress(
      {
        step: getStepIndex(),
        kind: isRepair ? "repair" : baseContext.objectGetFeedback && round > 1 ? "explore" : "commands",
        round,
        error: isRepair ? lastError : undefined,
        message: progressMessage
      },
      onProgress
    );

    const requestPrompt = isRepair
      ? `Fix the command script. Error: ${lastError}. User intent: ${userPrompt}`
      : outline && round === 1
        ? `${userPrompt}\n\nFollow this outline:\n${outline}`
        : userPrompt;

    // Always explicitly built now (previously only for repair/feedback/round>1 rounds, leaving
    // round 1 to requestUpdatedSceneEditCommands's own internal fallback construction — which
    // used the exact same fields, so this is behavior-preserving for round 1 except for also
    // attaching referenceMaterial there, which is the point: proactively giving the agent
    // relevant docs/examples from round 1 avoids burning repair rounds on gaps the base prompt
    // catalog doesn't cover, rather than only reacting after a failure).
    const context = { ...baseContext };
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
      referenceMaterial,
      lastRawContent ? `Previous invalid output:\n${lastRawContent}` : ""
    ]
      .filter(Boolean)
      .join("\n\n");

    let commandResult;
    try {
      commandResult = await requestUpdatedSceneEditCommands(requestPrompt, context, {
        ...createOutputStreamOptions(chatOptions, {
          stage: isRepair ? "adjust_command_repair" : "adjust_commands",
          outputMode: updateOutputMode === "commands" ? "commands" : "auto",
          round,
          attempt: round
        }),
        outputMode: updateOutputMode,
        fallbackToJson: false,
        agentRound: true,
        singleRound: false,
        maxTokens: isRepair ? preset.repairMaxTokens : preset.commandMaxTokens
      });
    } catch (err) {
      if (isSceneOutputLimitError(err)) {
        throw err;
      }
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

    if (commandResult.outputMode === "patch") {
      commandResult = { ...commandResult, commands: commandsFromPatchResult(commandResult) };
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

  throw new Error(lastError || "The command provider repeatedly returned unusable output.");
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
    refreshContext,
    createOutputStreamOptions
  } = params;

  if (typeof applyCommands !== "function" || typeof refreshContext !== "function") {
    throw new Error("iterativeApply requires applyCommands and refreshContext callbacks.");
  }

  const maxRefineRounds = preset.maxRefineRounds;
  const baseContext = {
    ...updateContext,
    currentSceneJsonString
  };
  let lastError = "";
  let lastRawContent = "";
  let appliedRounds = 0;
  let anySceneMutated = false;
  const appliedCommands = [];
  let previousMutatingSignature = "";
  let previousReadbackSignature = "";
  let consecutiveNoProgress = 0;
  let refineRound = 0;
  let explicitBudgetExhausted = false;

  // Resolved once for the whole turn — see runSceneAgentCommandsUpdate's matching comment.
  const referenceMaterial = await resolveAgentReferenceMaterial(userPrompt, chatOptions);

  while (true) {
    if (maxRefineRounds && refineRound >= maxRefineRounds) {
      explicitBudgetExhausted = true;
      break;
    }
    refineRound += 1;
    chatOptions?.signal?.throwIfAborted?.();
    setStepIndex(getStepIndex() + 1);
    emitProgress(
      {
        step: getStepIndex(),
        kind: "refine",
        round: refineRound,
        message: refineRound === 1
          ? "Applying the requested scene adjustment..."
          : "Continuing the next meaningful scene adjustment..."
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
    if (referenceMaterial) {
      context.userMessage = `${context.userMessage}\n\n${referenceMaterial}`;
    }
    if (lastRawContent && refineRound > 1) {
      context.userMessage = `${context.userMessage}\n\nPrevious output:\n${lastRawContent}`;
    }
    if (lastError) {
      context.userMessage = `${context.userMessage}\n\nPrevious error: ${lastError}`;
    }
    if (Array.isArray(baseContext.visualFeedback) && baseContext.visualFeedback.length > 0) {
      context.visualFeedback = baseContext.visualFeedback;
    }

    let commandResult;
    try {
      commandResult = await requestUpdatedSceneEditCommands(requestPrompt, context, {
        ...createOutputStreamOptions(chatOptions, {
          stage: "adjust_refinement",
          outputMode: updateOutputMode === "commands" ? "commands" : "auto",
          round: refineRound
        }),
        outputMode: updateOutputMode,
        fallbackToJson: false,
        agentRound: true,
        iterativeApply: true,
        singleRound: false,
        maxTokens: preset.commandMaxTokens
      });
      baseContext.visualFeedback = [];
    } catch (err) {
      if (isSceneOutputLimitError(err)) {
        throw err;
      }
      lastError = String(err?.message || err);
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      consecutiveNoProgress += 1;
      if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) break;
      continue;
    }

    const priorRoundError = lastError;
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
      consecutiveNoProgress += 1;
      if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) break;
      continue;
    }

    if (commandResult.outputMode === "patch") {
      commandResult = { ...commandResult, commands: commandsFromPatchResult(commandResult) };
    }

    const commands = commandResult.commands;
    const modelSaysDone = commandScriptIndicatesDone(lastRawContent);
    const modelRequestsContinuation = commandScriptRequestsContinuation(lastRawContent);
    const responseWasCutOff = completionReasonIndicatesCutoff(commandResult.finishReason);
    if (commandListIsEmptyOrCommentsOnly(commands) && modelSaysDone) {
      // Do not let a follow-up `# done` erase evidence that the preceding command batch reported
      // success but left the exported scene unchanged. Give the model another repair opportunity;
      // if the guard is exhausted the caller will enter its verified JSON-Patch/full-JSON fallback.
      if (priorRoundError && appliedRounds === 0) {
        lastError = priorRoundError;
        steps.push({ kind: "refine_done", round: refineRound, ok: false, error: priorRoundError });
        consecutiveNoProgress += 1;
        if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) break;
        continue;
      }
      steps.push({ kind: "refine_done", round: refineRound, ok: true, appliedRounds });
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: appliedCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: anySceneMutated,
        execOk: true,
        completed: true,
        stopReason: "model_done",
        tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
      };
    }
    if (commandListIsEmptyOrCommentsOnly(commands)) {
      lastError = "Output mutating commands or # done when finished.";
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      consecutiveNoProgress += 1;
      if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) break;
      continue;
    }

    const dryRun = await dryRunUpdateCommands(commands, baseContext.currentSceneJsonString);
    if (!dryRun.ok) {
      const fail = dryRun.results?.find((item) => !item.ok);
      lastError = fail?.error || "Command dry-run failed.";
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      consecutiveNoProgress += 1;
      if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) break;
      continue;
    }

    const readOnly = !commandListHasMutatingOp(commands);
    const mutatingSignature = readOnly ? "" : JSON.stringify(commands);
    if (mutatingSignature && mutatingSignature === previousMutatingSignature) {
      steps.push({ kind: "refine_done", round: refineRound, ok: true, appliedRounds, reason: "repeated_output" });
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: appliedCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: anySceneMutated,
        execOk: appliedRounds > 0,
        completed: true,
        stopReason: "repeated_output",
        tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
      };
    }
    const sceneSignatureBeforeApply = normalizedSceneSignature(baseContext.currentSceneJsonString);
    chatOptions?.signal?.throwIfAborted?.();
    const applied = await applyCommands(commands, {
      round: refineRound,
      readOnly,
      label: `AI Agent round ${refineRound}`
    });
    if (!applied.ok) {
      lastError = applied.error || "Command apply failed.";
      steps.push({ kind: "refine", round: refineRound, ok: false, error: lastError });
      consecutiveNoProgress += 1;
      if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) break;
      continue;
    }

    if (applied.objectGetFeedback) {
      baseContext.objectGetFeedback = [baseContext.objectGetFeedback, applied.objectGetFeedback]
        .filter(Boolean)
        .join("\n\n");
    }
    if (Array.isArray(applied.visualFeedback) && applied.visualFeedback.length > 0) {
      baseContext.visualFeedback = applied.visualFeedback;
    }

    const fresh = await refreshContext();
    if (fresh && typeof fresh === "object") {
      Object.assign(baseContext, fresh);
    }
    const hasFreshSceneJson = typeof baseContext.currentSceneJsonString === "string";
    const sceneUnchanged = !readOnly && hasFreshSceneJson &&
      normalizedSceneSignature(baseContext.currentSceneJsonString) === sceneSignatureBeforeApply;
    const verifiedSceneMutation = !readOnly && (
      hasFreshSceneJson ? !sceneUnchanged : applied.sceneMutated === true
    );

    if (readOnly) {
      steps.push({ kind: "explore", round: refineRound, ok: true, count: commands.length });
      const readbackSignature = String(applied.objectGetFeedback || "").trim();
      if (readbackSignature && readbackSignature !== previousReadbackSignature) {
        previousReadbackSignature = readbackSignature;
        consecutiveNoProgress = 0;
      } else {
        consecutiveNoProgress += 1;
      }
      if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) break;
      continue;
    }

    if (!verifiedSceneMutation) {
      previousMutatingSignature = mutatingSignature;
      lastError = "The command batch reported success, but the refreshed scene JSON did not change.";
      steps.push({ kind: "refine_apply", round: refineRound, ok: false, count: commands.length, error: lastError });
      consecutiveNoProgress += 1;
      if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) break;
      continue;
    }

    previousMutatingSignature = mutatingSignature;
    consecutiveNoProgress = 0;
    appliedRounds += 1;
    anySceneMutated = true;
    appliedCommands.push(...commands);
    emitProgress(
      {
        step: getStepIndex(),
        kind: "commands_applied",
        round: refineRound,
        message: "Applied the latest refinement to the scene.",
        sceneMutated: true
      },
      onProgress
    );

    if (hasFreshSceneJson) {
      emitStagePreview({
        sceneJsonString: baseContext.currentSceneJsonString,
        onProgress,
        getStepIndex,
        setStepIndex,
        stage: "adjustment_refinement",
        round: refineRound,
        commands,
        outputMode: commandResult.outputMode,
        message: "The latest adjustment is visible."
      });
    }

    steps.push({
      kind: "refine_apply",
      round: refineRound,
      ok: true,
      count: commands.length
    });

    if (modelSaysDone) {
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: appliedCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: anySceneMutated,
        execOk: appliedRounds > 0,
        completed: true,
        stopReason: "model_done",
        tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
      };
    }

    if (!modelRequestsContinuation && !responseWasCutOff) {
      return {
        outputMode: "commands",
        commandScript: commandResult.commandScript,
        commands: appliedCommands,
        steps,
        agentUsed: true,
        iterativeApplied: true,
        skipFinalExec: true,
        appliedRounds,
        sceneMutated: true,
        execOk: true,
        completed: true,
        stopReason: "implicit_complete",
        tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
      };
    }
  }

  if (appliedRounds > 0) {
    return {
      outputMode: "commands",
      commands: appliedCommands,
      steps,
      agentUsed: true,
      iterativeApplied: true,
      skipFinalExec: true,
      appliedRounds,
      sceneMutated: anySceneMutated,
      execOk: true,
      completed: false,
      stopReason: explicitBudgetExhausted ? "budget_exhausted" : "no_progress",
      tokenHint: { rounds: getStepIndex(), depth, maxSteps: preset.maxSteps }
    };
  }

  throw new Error(lastError || "The provider repeatedly made no usable progress.");
}

async function runAutomaticDraftRefinement(params) {
  const {
    userPrompt,
    initialSceneJsonString,
    preset,
    chatOptions,
    onProgress,
    steps,
    getStepIndex,
    setStepIndex,
    applyDraftCommands,
    maxRounds,
    refinementGoals = [],
    createOutputStreamOptions
  } = params;
  let current = initialSceneJsonString;
  let feedback = "";
  let completed = false;
  let stopReason = "model_done";
  let previousOutputSignature = "";
  let consecutiveNoProgress = 0;
  let round = 0;
  let explicitBudgetExhausted = false;
  let visualFeedback = [];

  while (true) {
    if (maxRounds && round >= maxRounds) {
      explicitBudgetExhausted = true;
      stopReason = "budget_exhausted";
      break;
    }
    round += 1;
    chatOptions?.signal?.throwIfAborted?.();
    setStepIndex(getStepIndex() + 1);
    emitProgress(
      {
        step: getStepIndex(),
        kind: "draft_refinement",
        round,
        message: round === 1
          ? "Refining the visible structural draft..."
          : "Building the next requested model or scene detail..."
      },
      onProgress
    );

    let refinement;
    try {
      const currentScene = parseSceneJsonString(current);
      const spatial = buildObjectSpatialCardsFromSceneJson(currentScene);
      const sceneScaleProfile = buildSceneScaleProfile(spatial.cards, spatial);
      const context = {
        currentSceneJsonString: current,
        objectSpatialCards: spatial.cards,
        sceneScaleProfile,
        visualFeedback
      };
      context.userMessage = [
        buildSceneCommandUpdateUserMessage({
          modificationRequest: userPrompt,
          objectSpatialCards: spatial.cards,
          sceneScaleProfile,
          singleRound: false,
          agentRound: true
        }),
        refinementGoals.length
          ? `Concrete refinement goals (finish as many as possible now; do not invent extra goals):\n${refinementGoals.map((goal) => `- ${goal}`).join("\n")}`
          : "Complete only meaningful work still required by the original request; do not add ceremonial polish or review-only changes.",
        feedback ? `Previous refinement feedback:\n${feedback}` : ""
      ].filter(Boolean).join("\n\n");
      refinement = await requestUpdatedSceneEditCommands(userPrompt, context, {
        ...createOutputStreamOptions(chatOptions, {
          stage: "draft_refinement",
          outputMode: "auto",
          round
        }),
        outputMode: "auto",
        fallbackToJson: false,
        agentRound: true,
        iterativeApply: true,
        singleRound: false,
        maxTokens: preset.repairMaxTokens ?? preset.generateMaxTokens
      });
      visualFeedback = [];
    } catch (error) {
      feedback = String(error?.message || error);
      steps.push({ kind: "draft_refinement", round, ok: false, error: feedback });
      consecutiveNoProgress += 1;
      if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) {
        stopReason = "no_progress";
        break;
      }
      continue;
    }

    const rawRefinement = String(refinement.rawContent || refinement.commandScript || "");
    const modelSaysDone = commandScriptIndicatesDone(rawRefinement);
    if (
      refinement.outputMode === "done" ||
      (refinement.outputMode === "commands" && commandListIsEmptyOrCommentsOnly(refinement.commands) && modelSaysDone)
    ) {
      steps.push({ kind: "draft_refinement_done", round, ok: true });
      completed = true;
      stopReason = "model_done";
      break;
    }

    const outputSignature = rawRefinement.trim() || JSON.stringify(refinement.commands || refinement.patch || []);
    if (outputSignature && outputSignature === previousOutputSignature) {
      steps.push({ kind: "draft_refinement_done", round, ok: true, reason: "repeated_output" });
      completed = true;
      stopReason = "repeated_output";
      break;
    }
    previousOutputSignature = outputSignature;

    let candidate = refinement.sceneJsonString || "";
    let appliedFeedback = "";
    if (refinement.outputMode === "commands") {
      try {
        if (typeof applyDraftCommands !== "function") {
          throw new Error("This host cannot execute command refinements; return JSON Patch instead.");
        }
        chatOptions?.signal?.throwIfAborted?.();
        const applied = await applyDraftCommands(refinement.commands, {
          round,
          sceneJsonString: current,
          commandScript: refinement.commandScript
        });
        candidate =
          typeof applied === "string"
            ? applied
            : String(applied?.sceneJsonString || "");
        if (applied && typeof applied === "object" && applied.ok === false) {
          throw new Error(applied.error || "Draft refinement commands failed.");
        }
        appliedFeedback = typeof applied?.objectGetFeedback === "string"
          ? applied.objectGetFeedback.trim()
          : "";
        visualFeedback = Array.isArray(applied?.visualFeedback) ? applied.visualFeedback : [];
      } catch (error) {
        feedback = String(error?.message || error);
        steps.push({
          kind: "draft_refinement",
          round,
          outputMode: "commands",
          ok: false,
          error: feedback
        });
        consecutiveNoProgress += 1;
        if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) {
          stopReason = "no_progress";
          break;
        }
        continue;
      }
      if (!commandListHasMutatingOp(refinement.commands)) {
        if (!appliedFeedback && visualFeedback.length === 0) {
          feedback = "The read-only mesh inspection returned no usable feedback. Inspect a valid mesh/part or output a mutating mesh.edit batch.";
          consecutiveNoProgress += 1;
          if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) {
            stopReason = "no_progress";
            break;
          }
        } else {
          feedback = [
            appliedFeedback,
            "Use these inspection results to output the next concrete mesh.edit batch, or # done if the selected quality target is already met."
          ].filter(Boolean).join("\n\n");
          consecutiveNoProgress = 0;
        }
        steps.push({ kind: "draft_refinement_explore", round, ok: true, count: refinement.commands?.length || 0 });
        continue;
      }
    }

    const validation = await validateSceneJsonWithNormalizer(candidate);
    steps.push({
      kind: "draft_refinement",
      round,
      outputMode: refinement.outputMode,
      count:
        refinement.outputMode === "commands"
          ? refinement.commands?.length
          : refinement.outputMode === "patch"
            ? refinement.patch?.length
            : undefined,
      ok: validation.ok,
      error: validation.error
    });
    if (!validation.ok) {
      feedback = validation.error || "Refined scene JSON is invalid.";
      consecutiveNoProgress += 1;
      if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) {
        stopReason = "no_progress";
        break;
      }
      continue;
    }

    if (normalizedSceneSignature(candidate) === normalizedSceneSignature(current)) {
      steps.push({ kind: "draft_refinement_done", round, ok: true, reason: "no_change" });
      completed = true;
      stopReason = "no_change";
      break;
    }

    current = candidate;
    consecutiveNoProgress = 0;
    feedback = [
      appliedFeedback,
      "The previous refinement was applied successfully. Continue only if another meaningful improvement is needed."
    ].filter(Boolean).join("\n\n");
    emitStagePreview({
      sceneJsonString: current,
      onProgress,
      getStepIndex,
      setStepIndex,
      stage: "draft_refinement",
      round,
      commands: refinement.outputMode === "commands" ? refinement.commands : undefined,
      outputMode: refinement.outputMode,
      message: "The latest model refinement is visible."
    });
    if (modelSaysDone) {
      steps.push({ kind: "draft_refinement_done", round, ok: true });
      completed = true;
      stopReason = "model_done";
      break;
    }
    const responseWasCutOff = completionReasonIndicatesCutoff(refinement.finishReason);
    if (!commandScriptRequestsContinuation(rawRefinement) && !responseWasCutOff) {
      steps.push({ kind: "draft_refinement_done", round, ok: true, reason: "implicit_complete" });
      completed = true;
      stopReason = "implicit_complete";
      break;
    }
  }

  if (!completed && explicitBudgetExhausted) {
    steps.push({ kind: "draft_refinement_budget_exhausted", ok: true, maxRounds });
  } else if (!completed) {
    steps.push({ kind: "draft_refinement_stopped", ok: false, reason: stopReason });
  }
  return { sceneJsonString: current, completed, stopReason };
}

/**
 * Repair/capability-review/layout-review all need to turn "here's what's wrong" into "here's a
 * fixed scene" — previously always via a full-scene-JSON rewrite (updateSceneJsonString). This
 * tries the same commands/JSON-Patch-preferring single round `requestSceneRefinementStep` uses
 * for draft refinement first (same LLM call count as before, just a cheaper/more targeted output
 * format when the model can manage it), and only falls back to the full-JSON rewrite — kept
 * available, just now the last resort — when that attempt throws or produces something invalid.
 * @param {string} fixPrompt describes the specific problem to fix
 * @param {string} sceneJsonString current (valid) scene JSON to fix
 * @param {{chatOptions: object, chatOptionsFullUpdate: object, applyDraftCommands?: Function, refineMaxTokens?: number, fullRewriteMaxTokens?: number}} config
 * @returns {Promise<string>}
 */
/**
 * Never throws (except on explicit user abort) — a capability/layout review round only ever
 * exists to *improve* an already-valid scene, so it must never be able to turn that valid scene
 * into a reported generation failure (timeout, transient network/provider error, empty response,
 * malformed fix — all just fall through to "keep what we had"). Same discipline as
 * sceneAiService.js's maybeApplyCapabilityReview, applied at this layer too.
 */
async function runTargetedFixRound(fixPrompt, sceneJsonString, config) {
  const {
    chatOptions,
    chatOptionsFullUpdate,
    applyDraftCommands,
    refineMaxTokens,
    fullRewriteMaxTokens,
    createOutputStreamOptions,
    streamStage = "targeted_fix",
    streamRound
  } = config;
  try {
    const refinement = await requestSceneRefinementStep(fixPrompt, sceneJsonString, {
      ...createOutputStreamOptions(chatOptions, {
        stage: streamStage,
        outputMode: "auto",
        round: streamRound
      }),
      allowCommands: typeof applyDraftCommands === "function",
      maxTokens: refineMaxTokens
    });
    if (refinement.outputMode === "done") {
      return sceneJsonString;
    }
    let candidate = refinement.sceneJsonString || "";
    if (refinement.outputMode === "commands") {
      const applied = await applyDraftCommands(refinement.commands, {
        sceneJsonString,
        commandScript: refinement.commandScript
      });
      candidate = typeof applied === "string" ? applied : String(applied?.sceneJsonString || "");
      if (applied && typeof applied === "object" && applied.ok === false) {
        throw new Error(applied.error || "Targeted fix commands failed.");
      }
    }
    const validation = await validateSceneJsonWithNormalizer(candidate);
    if (!validation.ok) {
      throw new Error(validation.error || "Targeted fix produced invalid scene JSON.");
    }
    return candidate;
  } catch (error) {
    if (chatOptions?.signal?.aborted) {
      throw error;
    }
    try {
      return await updateSceneJsonString(fixPrompt, sceneJsonString, {
        ...createOutputStreamOptions(chatOptionsFullUpdate, {
          stage: `${streamStage}_full_json_fallback`,
          outputMode: "json",
          round: streamRound
        }),
        maxTokens: fullRewriteMaxTokens
      });
    } catch (fallbackError) {
      if (chatOptionsFullUpdate?.signal?.aborted) {
        throw fallbackError;
      }
      return sceneJsonString;
    }
  }
}

/**
 * The outline is a cheap, best-effort planning aid, not a required step — a failure here (empty
 * response, transient network/provider error) must never abort the whole turn before a single
 * scene JSON call has even been attempted. Never throws except on explicit user abort; returns ""
 * (no outline) on any other failure so the caller just proceeds without one.
 */
async function requestOptionalOutline({ prompt, mode }, chatOptions, maxTokens) {
  try {
    return await requestSceneOutline({ prompt, mode }, { ...chatOptions, maxTokens });
  } catch (error) {
    if (chatOptions?.signal?.aborted) {
      throw error;
    }
    return "";
  }
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
 * @param {((delta: string, metadata?: {streamId?: string, reset?: boolean, stage?: string, outputMode?: string, round?: number, attempt?: number}) => void)} [options.onDelta]
 * @returns {Promise<{ sceneJsonString: string, steps: object[], agentUsed: boolean, tokenHint: object }>}
 */
async function runSceneAgent(input = {}, options = {}) {
  const mode = input.mode || "generate";
  const prompt = String(input.prompt || "").trim();
  const userRequest = extractUserRequest(prompt);
  const { maxRefineRounds } = normalizeAgentOptions(options.agent);
  const complexModelStrategy = normalizeComplexModelStrategy(
    options.complexModelStrategy ?? options.agent?.complexModelStrategy
  );
  const modelQuality = normalizeModelQuality(options.modelQuality ?? options.agent?.modelQuality);
  const requestedExecutionMode = complexModelStrategy === "progressive"
    ? "draft_refine"
    : normalizeExecutionMode(options.executionMode ?? options.agent?.executionMode);
  const refinementGoals = Array.isArray(options.refinementGoals)
    ? [...new Set(options.refinementGoals.map((goal) => String(goal || "").trim()).filter(Boolean))]
    : [];
  // Fixed metadata label — there is no more "depth" concept to report (see the module docblock);
  // kept only so tokenHint's shape doesn't change for anything reading it.
  const depth = "standard";
  const onProgress = options.onProgress;
  const steps = [];
  let stepIndex = 0;
  const streamPreview = options.streamPreview === true;
  const requestedOutputFormat = options.outputFormat === "friendly" ? "friendly" : "standard";
  // Raw authoring output is opt-in per request below. Keeping it out of the shared transport bag
  // prevents intent/outline/review calls from being concatenated with scene JSON, commands or
  // JSON Patch while still allowing every user-visible authoring round to stream independently.
  const rawOnDelta = typeof options.onDelta === "function" ? options.onDelta : undefined;
  const modelBudgetMonitor = createModelBudgetMonitor(options);
  const chatTransport = {
    stream: options.stream === true,
    signal: modelBudgetMonitor.signal,
    onCompletionMetadata: modelBudgetMonitor.onCompletionMetadata,
    onDelta:
      streamPreview && typeof onProgress === "function"
        ? (previewDelta) => {
            emitProgress(
              { step: stepIndex, kind: "stream", message: "Streaming…", previewDelta },
              onProgress
            );
          }
        : undefined
  };
  const chatOptions = { ...options, ...chatTransport };
  let outputStreamSequence = 0;
  const createOutputStreamOptions = (baseOptions = {}, metadata = {}) => {
    const baseOnDelta = typeof baseOptions.onDelta === "function" ? baseOptions.onDelta : undefined;
    if (!rawOnDelta) {
      return { ...baseOptions };
    }
    outputStreamSequence += 1;
    const streamMetadata = {
      ...metadata,
      streamId: `scene-agent-${outputStreamSequence}`
    };
    let firstDelta = true;
    return {
      ...baseOptions,
      onDelta: (delta) => {
        if (baseOnDelta && baseOnDelta !== rawOnDelta) {
          baseOnDelta(delta);
        }
        rawOnDelta(delta, {
          ...streamMetadata,
          reset: firstDelta
        });
        firstDelta = false;
      }
    };
  };
  const configuredTurnTimeoutMs = Number(
    options.turnTimeoutMs ?? options.modelBudget?.maxTimeMs ?? options.agent?.modelBudget?.maxTimeMs
  );
  if (!(Number.isFinite(Number(chatOptions.turnDeadlineAt)) && Number(chatOptions.turnDeadlineAt) > 0)) {
    if (Number.isFinite(configuredTurnTimeoutMs) && configuredTurnTimeoutMs > 0) {
      chatOptions.turnDeadlineAt = Date.now() + Math.max(1000, Math.round(configuredTurnTimeoutMs));
    }
  }
  const applyDraftCommands = options.applyDraftCommands;
  delete chatOptions.agent;
  delete chatOptions.onProgress;
  delete chatOptions.texture;
  delete chatOptions.streamPreview;
  delete chatOptions.applyDraftCommands;
  // Every agent step operates on the same standard scheme-B representation. A friendly
  // projection is applied only once, at the public return boundary.
  chatOptions.outputFormat = "standard";

  const projectFinalScene = (sceneJsonString) =>
    projectSceneJsonString(sceneJsonString, requestedOutputFormat);

  /** Lowest-priority fallback for repair/capability/layout fixes — a full-scene-JSON rewrite,
   * only reached when a targeted commands/patch fix (runTargetedFixRound below) isn't available
   * or doesn't work out. */
  const chatOptionsFullUpdate = { ...chatOptions, allowInvalidSceneDraft: true };
  delete chatOptionsFullUpdate.updateMode;

  /** Avoid duplicate capability review inside generate — this module's own capability-review
   * pass below (preset.runCapabilityReview) is the one that runs. */
  const chatOptionsGenerate = {
    ...chatOptions,
    capabilityReview: false,
    allowInvalidSceneDraft: true,
    planFirst: false,
    // SceneAgent emits the first validated, asset-normalized preview itself. Letting the lower
    // layer emit earlier would briefly render an unvalidated version and race the stage queue.
    onSceneDraft: undefined
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

  // Layout/material review is opt-in. Capability review is local-first and only spends another
  // model call when a concrete requested capability is missing.
  const tokenBudget = options.tokenBudget && typeof options.tokenBudget === "object"
    ? options.tokenBudget
    : {};
  const commonMaxTokens = resolveOptionalTokenLimit(
    options.maxTokens,
    tokenBudget.maxTokens,
    modelBudgetMonitor.maxTokens
  );
  const preset = {
    maxSteps: maxRefineRounds,
    maxRefineRounds,
    outlineMaxTokens: resolveOptionalTokenLimit(
      options.outlineMaxTokens,
      tokenBudget.outlineMaxTokens,
      commonMaxTokens
    ),
    draftMaxTokens: resolveOptionalTokenLimit(
      options.draftMaxTokens,
      tokenBudget.draftMaxTokens,
      commonMaxTokens
    ),
    generateMaxTokens: resolveOptionalTokenLimit(
      options.generateMaxTokens,
      tokenBudget.generateMaxTokens,
      commonMaxTokens
    ),
    repairMaxTokens: resolveOptionalTokenLimit(
      options.repairMaxTokens,
      tokenBudget.repairMaxTokens,
      commonMaxTokens
    ),
    commandMaxTokens: resolveOptionalTokenLimit(
      options.commandMaxTokens,
      tokenBudget.commandMaxTokens,
      mode === "update" ? commonMaxTokens : undefined
    ),
    layoutReviewMaxTokens: resolveOptionalTokenLimit(
      options.layoutReviewMaxTokens,
      tokenBudget.layoutReviewMaxTokens,
      commonMaxTokens
    ),
    fullRewriteMaxTokens: resolveOptionalTokenLimit(
      options.fullRewriteMaxTokens,
      tokenBudget.fullRewriteMaxTokens,
      commonMaxTokens
    ),
    runOutline: requestedExecutionMode === "draft_refine",
    runRepair: true,
    runCapabilityReview: true,
    runLayoutReview: options.agent?.layoutReview === true,
    maxCapabilityReviewAttempts: MAX_CAPABILITY_REVIEW_ATTEMPTS,
    maxRepairAttempts: MAX_REPAIR_ATTEMPTS,
    maxCommandRepairAttempts: MAX_CONSECUTIVE_NO_PROGRESS
  };
  let outline = "";
  let sceneJsonString = "";
  let effectiveExecutionMode = requestedExecutionMode;

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
      outline = await requestOptionalOutline({ prompt: userRequest, mode }, chatOptions, preset.outlineMaxTokens);
      steps.push({ kind: "outline", ok: Boolean(outline), length: outline.length });
    }

    let commandStepIndex = stepIndex;
    const canIterate =
      typeof options.applyCommands === "function" && typeof options.refreshContext === "function";
    const commandRunner = canIterate
      ? runSceneAgentCommandsUpdateIterative
      : runSceneAgentCommandsUpdate;
    const commandResult = await commandRunner({
      userPrompt: userRequest,
      currentSceneJsonString: input.currentSceneJsonString,
      updateContext: input.updateContext || {},
      updateOutputMode,
      preset,
      outline,
      chatOptions,
      createOutputStreamOptions,
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
      return {
        ...commandResult,
        sceneJsonString: projectFinalScene(commandResult.sceneJsonString),
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
      tokenHint: commandResult.tokenHint
    };
  }

  if (preset.runOutline) {
    stepIndex += 1;
    emitProgress(
      { step: stepIndex, kind: "outline", message: "Planning scene outline..." },
      onProgress
    );
    outline = await requestOptionalOutline({ prompt: userRequest, mode }, chatOptions, preset.outlineMaxTokens);
    steps.push({ kind: "outline", ok: Boolean(outline), length: outline.length });
  }

  stepIndex += 1;
  emitProgress(
    { step: stepIndex, kind: "generate", message: "Generating full scene JSON..." },
    onProgress
  );

  // Resolved once for the whole agent run — see resolveAgentReferenceMaterial's docblock. Folded
  // directly into the plain-text prompt strings below (rather than a message-builder field) since
  // this generate/repair path already passes prompt as free text to generateSceneJsonString /
  // updateSceneJsonString.
  const referenceMaterial = await resolveAgentReferenceMaterial(userRequest, chatOptions);
  const complexModelHint = buildComplexModelAuthoringHint(complexModelStrategy, modelQuality);

  const buildInitialPrompt = () => {
    const draftHint =
      effectiveExecutionMode === "draft_refine" && (mode === "generate" || mode === "fromImage")
        ? [
            "",
            "STRUCTURAL DRAFT CONTRACT (mandatory):",
            "This is the first usable blockout of an incrementally built scene, not the final detailed scene.",
            "Return one complete valid standard scheme-B JSON document. Use compact JSON formatting and ensure syntactic closure before adding secondary content.",
            "Keep only the primary visual anchors needed for a useful first render. Consolidate repeated elements with instancedList/transforms, bounded representative samples, and reusable materials; do not obey or invent an arbitrary token or object-count quota.",
            "Include every primary subject, semantically accurate materials, requested primary animation, basic lighting, and a fitted camera now. Do not invent texture URLs; a separate host pipeline acquires trusted textures after this draft is visible. Defer secondary props, decoration, and large populations to later incremental command rounds.",
            "For a genuinely free-form primary subject, make the draft a recognizable low-density editableMesh or compact surface that remains the source for later refinement. Do not build a disposable primitive proxy merely to ask for confirmation before starting the real mesh.",
            "Primitive/CSG blockouts are appropriate for scene layout, hard-surface assemblies, and objects whose final shape they already express faithfully. They are not a mandatory pre-stage for every complex model.",
            "Do not expand every outline bullet into separate objects and do not create a visually unreadable placeholder."
          ].join("\n")
        : "\n\nReturn the complete, immediately usable scene now. Include semantically accurate materials, requested animation, lighting, and a fitted camera; do not invent texture URLs or reserve ordinary scene work for later review rounds. A separate host pipeline may acquire trusted textures after first render.";
    return (
      (outline && effectiveExecutionMode === "draft_refine" ? `${prompt}\n\nFollow this outline:\n${outline}` : prompt) +
      (mode === "generate" || mode === "fromImage" ? draftHint : "") +
      (mode === "generate" || mode === "fromImage" ? `\n\n${complexModelHint}` : "") +
      (referenceMaterial ? `\n\n${referenceMaterial}` : "")
    );
  };

  const generateInitialScene = async () => {
    const generatePrompt = buildInitialPrompt();
    const incrementalDraft =
      effectiveExecutionMode === "draft_refine" && (mode === "generate" || mode === "fromImage");
    const initialOutputMode = mode === "update" && options.updateMode === "incremental"
      ? "patch"
      : "json";
    const generationOptions = {
      ...createOutputStreamOptions(chatOptionsGenerate, {
        stage: mode === "update"
          ? initialOutputMode === "patch" ? "adjust_json_patch" : "adjust_full_json"
          : incrementalDraft ? "initial_draft" : "direct_scene",
        outputMode: initialOutputMode
      }),
      maxTokens: effectiveExecutionMode === "draft_refine" ? preset.draftMaxTokens : preset.generateMaxTokens,
      // A direct cutoff switches policies immediately instead of repeating another whole final
      // scene. A structural draft is already the incremental policy, so a genuine cutoff restarts
      // under the compact segmented-continuation protocol instead of becoming a visible failure.
      // A user-forced full-coordinate model must stay a full-coordinate model. A provider
      // cutoff changes only the transport: restart under exact segmented continuation instead
      // of silently switching representation to a compact control cage or primitive draft.
      compactRetryOnTruncation: incrementalDraft || complexModelStrategy === "full-coordinates",
      incrementalDraft,
      segmentedOutput:
        effectiveExecutionMode === "draft_refine" ? false : chatOptionsGenerate.segmentedOutput
    };
    if (mode === "update") {
      return updateSceneJsonString(generatePrompt || prompt, input.currentSceneJsonString, generationOptions);
    }
    if (mode === "fromImage") {
      return generateSceneJsonFromImage(
        { prompt: generatePrompt || prompt || undefined, image: input.image },
        generationOptions
      );
    }
    return generateSceneJsonString(generatePrompt, generationOptions);
  };

  try {
    sceneJsonString = await generateInitialScene();
  } catch (error) {
    const canEscalate =
      effectiveExecutionMode === "direct" &&
      complexModelStrategy !== "full-coordinates" &&
      (mode === "generate" || mode === "fromImage") &&
      isSceneOutputLimitError(error);
    if (!canEscalate) throw error;

    effectiveExecutionMode = "draft_refine";
    stepIndex += 1;
    emitProgress(
      {
        step: stepIndex,
        kind: "execution_fallback",
        message: "The complete scene exceeded the provider output limit; switching to incremental construction."
      },
      onProgress
    );
    outline = await requestOptionalOutline({ prompt: userRequest, mode }, chatOptions, preset.outlineMaxTokens);
    steps.push({ kind: "execution_fallback", ok: true, reason: "output_limit" });
    steps.push({ kind: "outline", ok: Boolean(outline), length: outline.length });
    sceneJsonString = await generateInitialScene();
  }

  steps.push({
    kind: "generate",
    ok: true,
    executionMode: effectiveExecutionMode
  });

  let validation = await validateSceneJsonWithNormalizer(sceneJsonString);
  if (validation.ok) {
    emitStagePreview({
      sceneJsonString,
      onProgress,
      getStepIndex: () => stepIndex,
      setStepIndex: (value) => {
        stepIndex = value;
      },
      stage: effectiveExecutionMode === "draft_refine" ? "initial_draft" : "direct_scene",
      message: effectiveExecutionMode === "draft_refine" ? "Initial draft ready." : "Scene preview ready."
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
        attempt: repairAttempt,
        maxAttempts: maxRepairAttempts,
        error: validation.error,
        message: `Validation failed (attempt ${repairAttempt}/${maxRepairAttempts}): ${validation.error}`
      },
      onProgress
    );
    // Repair fixes genuinely invalid/malformed JSON — requestSceneRefinementStep (used by
    // runTargetedFixRound for capability/layout review below) is documented for refining an
    // already-*valid* draft and starts by re-parsing the current scene, so it isn't a good fit
    // here; a full-scene-JSON rewrite stays the direct, single-call repair path.
    const repairPrompt =
      `Fix the scene JSON so it is valid ThreeJSON. Previous error: ${validation.error}. User intent: ${userRequest}` +
      (referenceMaterial ? `\n\n${referenceMaterial}` : "");
    // A single flaky repair call (timeout, empty response) must not abort the whole turn — that
    // just means this attempt didn't help; the loop tries again (or exits and reports the last
    // real validation error below, same as if this attempt had returned invalid JSON).
    let repairedSceneJsonString = null;
    try {
      repairedSceneJsonString = await updateSceneJsonString(repairPrompt, sceneJsonString, {
        ...createOutputStreamOptions(chatOptionsFullUpdate, {
          stage: "scene_json_repair",
          outputMode: "json",
          round: repairAttempt,
          attempt: repairAttempt
        }),
        maxTokens: preset.repairMaxTokens
      });
    } catch (error) {
      if (chatOptionsFullUpdate?.signal?.aborted) {
        throw error;
      }
      steps.push({ kind: "repair", attempt: repairAttempt, ok: false, error: String(error?.message || error) });
      continue;
    }
    sceneJsonString = repairedSceneJsonString;
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
        stage: "repair",
        round: repairAttempt,
        maxRounds: maxRepairAttempts,
        message: `Repair preview (attempt ${repairAttempt}).`
      });
    }
    if (validation.ok && preset.stopWhenValid) {
      break;
    }
  }

  // Only genuinely incremental scenes enter the refine loop. Direct scenes finish after local
  // validation (plus a targeted capability fix only when a concrete requested feature is absent).
  let refinementCompleted = true;
  let refinementStopReason = effectiveExecutionMode === "direct" ? "direct_complete" : "model_done";
  if (
    validation.ok &&
    effectiveExecutionMode === "draft_refine" &&
    (mode === "generate" || mode === "fromImage")
  ) {
    const refinementResult = await runAutomaticDraftRefinement({
      userPrompt: userRequest || "Reconstruct and improve the scene represented by the reference image.",
      initialSceneJsonString: sceneJsonString,
      preset,
      chatOptions,
      onProgress,
      steps,
      getStepIndex: () => stepIndex,
      setStepIndex: (value) => {
        stepIndex = value;
      },
      applyDraftCommands,
      maxRounds: preset.maxRefineRounds,
      refinementGoals,
      createOutputStreamOptions
    });
    sceneJsonString = refinementResult.sceneJsonString;
    refinementCompleted = refinementResult.completed;
    refinementStopReason = refinementResult.stopReason;
    validation = await validateSceneJsonWithNormalizer(sceneJsonString);
  }

  if (validation.ok && preset.runCapabilityReview) {
    const maxCapAttempts = preset.maxCapabilityReviewAttempts ?? 1;
    let capAttempt = 0;
    let capabilityFixApplied = false;
    while (capAttempt < maxCapAttempts) {
      const parsed = parseSceneJsonString(sceneJsonString);
      const fit = evaluateSceneCapabilityFit(userRequest, parsed);
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
          attempt: capAttempt,
          maxAttempts: maxCapAttempts,
          message: `Capability fit review (attempt ${capAttempt}/${maxCapAttempts})...`
        },
        onProgress
      );
      const fixPrompt = buildCapabilityFixPrompt(userRequest, fit);
      const beforeFixSignature = normalizedSceneSignature(sceneJsonString);
      sceneJsonString = await runTargetedFixRound(fixPrompt, sceneJsonString, {
        chatOptions,
        chatOptionsFullUpdate,
        applyDraftCommands,
        refineMaxTokens: preset.repairMaxTokens ?? preset.generateMaxTokens,
        fullRewriteMaxTokens: preset.fullRewriteMaxTokens,
        createOutputStreamOptions,
        streamStage: "capability_fix",
        streamRound: capAttempt
      });
      capabilityFixApplied = normalizedSceneSignature(sceneJsonString) !== beforeFixSignature;
      validation = await validateSceneJsonWithNormalizer(sceneJsonString);
      const refit = validation.ok
        ? evaluateSceneCapabilityFit(userRequest, parseSceneJsonString(sceneJsonString))
        : null;
      steps.push({
        kind: "capability_review",
        attempt: capAttempt,
        ok: refit?.ok === true,
        gaps: fit.gaps,
        validationOk: validation.ok
      });
      if (!validation.ok) {
        break;
      }
      if (refit?.ok) {
        break;
      }
    }
    if (validation.ok && capabilityFixApplied) {
      emitStagePreview({
        sceneJsonString,
        onProgress,
        getStepIndex: () => stepIndex,
        setStepIndex: (value) => {
          stepIndex = value;
        },
        stage: "capability_review",
        message: "Capability review preview."
      });
    }
  }

  if (validation.ok && preset.runLayoutReview) {
    stepIndex += 1;
    const capabilityFit = evaluateSceneCapabilityFit(userRequest, parseSceneJsonString(sceneJsonString));
    emitProgress(
      {
        step: stepIndex,
        kind: "layout_review",
        message: "Layout/material review..."
      },
      onProgress
    );
    const reviewPrompt = buildLayoutReviewPrompt(
      sceneJsonString,
      userRequest,
      capabilityFit
    );
    sceneJsonString = await runTargetedFixRound(reviewPrompt, sceneJsonString, {
      chatOptions,
      chatOptionsFullUpdate,
      applyDraftCommands,
      refineMaxTokens: preset.layoutReviewMaxTokens ?? preset.repairMaxTokens,
      fullRewriteMaxTokens: preset.fullRewriteMaxTokens,
      createOutputStreamOptions,
      streamStage: "layout_fix"
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
        stage: "layout_review",
        message: "Layout review preview."
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

  return {
    sceneJsonString: projectFinalScene(sceneJsonString),
    steps,
    agentUsed: true,
    executionMode: effectiveExecutionMode,
    completed: refinementCompleted,
    stopReason: refinementStopReason,
    tokenHint: {
      rounds: stepIndex,
      depth,
      maxSteps: preset.maxSteps
    }
  };
}

export { runSceneAgent, normalizeAgentOptions };
