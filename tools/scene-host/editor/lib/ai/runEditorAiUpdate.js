import {
  requestUpdatedSceneEditCommands,
  requestUpdatedSceneJsonString
} from "../../../../../core/ai/sceneAiService.js";
import { runSceneAgent } from "../../../../../core/ai/sceneAgent.js";
import {
  attachAssemblyParentWarnings,
  batchResultsHaveSceneMutation,
  commandListHasMutatingOp,
  formatObjectGetFeedbackFromBatch
} from "../../../../../core/ai/sceneCommandSkill.js";
import { buildEditorUpdateContext } from "./commandPrompt.js";

const READ_ONLY_COMMAND_OPS = new Set(["object.get", "scene.list", "scene.validate"]);

/**
 * @param {object} result
 * @param {Array<{ op?: string, args?: object }>} commands
 * @returns {object}
 */
function withAssemblyWarnings(result, commands) {
  if (!result || !Array.isArray(commands) || commands.length === 0) {
    return result;
  }
  const batch = result.batch ? attachAssemblyParentWarnings(result.batch, commands) : result.batch;
  const assemblyWarnings = batch?.assemblyWarnings || [];
  if (assemblyWarnings.length === 0) {
    return result.batch === batch ? result : { ...result, batch };
  }
  return {
    ...result,
    batch,
    assemblyWarnings
  };
}

const AGENT_OUTPUT_MODES = new Set(["commands", "auto", "json-full"]);

/**
 * @param {{ outputMode?: string, agentEnabled?: boolean }} params
 * @returns {'agent'|'single'}
 */
export function resolveUpdateRoute({ outputMode = "commands", agentEnabled = false }) {
  const mode = String(outputMode || "commands").toLowerCase();
  if (agentEnabled && AGENT_OUTPUT_MODES.has(mode)) {
    return "agent";
  }
  return "single";
}

/**
 * @param {string} outputMode
 * @returns {'commands'|'json'|'auto'}
 */
function mapAgentOutputMode(outputMode) {
  const mode = String(outputMode || "commands").toLowerCase();
  if (mode === "json-full") {
    return "json";
  }
  if (mode === "auto") {
    return "auto";
  }
  return "commands";
}

/**
 * @param {import("../command/types.js").EditorApi} editorApi
 * @param {object} params
 * @returns {Promise<object>}
 */
async function refreshEditorAgentContext(editorApi, params) {
  const currentJson = params.getCurrentSceneJson
    ? await params.getCurrentSceneJson()
    : params.fullSceneJson;
  return buildEditorUpdateContext({
    prompt: params.prompt,
    editorApi,
    includeFullJson: params.includeFullJson,
    includeSpatialSummary: params.includeSpatialSummary,
    fullSceneJson: currentJson
  });
}

/**
 * Run editor-side AI scene update with output-mode and Agent routing.
 * @param {object} params
 * @param {string} params.prompt
 * @param {import("../command/types.js").EditorApi} params.editorApi
 * @param {object} [params.aiOptions] LLM transport options (apiKey, provider, model, …)
 * @param {boolean} [params.includeFullJson]
 * @param {boolean} [params.includeSpatialSummary]
 * @param {string} [params.fullSceneJson]
 * @param {() => Promise<string>} [params.getCurrentSceneJson]
 * @param {string} [params.label]
 * @param {'commands'|'json-full'|'json-incremental'|'auto'} [params.outputMode]
 * @param {boolean} [params.agentEnabled]
 * @param {object} [params.agentOptions] { enabled, depth, iterativeApply }
 * @param {((p: object) => void)} [params.onProgress]
 * @returns {Promise<object>}
 */
export async function runEditorAiUpdate({
  prompt,
  editorApi,
  aiOptions = {},
  includeFullJson = false,
  includeSpatialSummary = false,
  fullSceneJson = "",
  getCurrentSceneJson,
  label = "AI 调整",
  outputMode = "commands",
  agentEnabled = false,
  agentOptions = {},
  onProgress
}) {
  const trimmedPrompt = String(prompt || "").trim();
  if (!trimmedPrompt) {
    throw new Error("prompt is required.");
  }
  if (!editorApi || typeof editorApi.execCoreCommands !== "function") {
    throw new Error("editorApi.execCoreCommands is required.");
  }

  const normalizedMode = String(outputMode || "commands").toLowerCase();
  const context = await buildEditorUpdateContext({
    prompt: trimmedPrompt,
    editorApi,
    includeFullJson,
    includeSpatialSummary,
    fullSceneJson
  });

  const jsonFallbackOptions = {
    ...aiOptions,
    updateMode: normalizedMode === "json-incremental" ? "incremental" : "full"
  };

  const route = resolveUpdateRoute({ outputMode: normalizedMode, agentEnabled });
  const iterativeApply = agentOptions.iterativeApply === true;

  if (route === "agent") {
    const agentOutputMode = mapAgentOutputMode(normalizedMode);
    const agentContext = { ...context };
    const refreshParams = {
      prompt: trimmedPrompt,
      includeFullJson,
      includeSpatialSummary,
      fullSceneJson,
      getCurrentSceneJson
    };

    try {
      const agentResult = await runSceneAgent(
        {
          mode: "update",
          prompt: trimmedPrompt,
          currentSceneJsonString: context.currentSceneJsonString || fullSceneJson,
          outputMode: agentOutputMode,
          updateContext: agentContext
        },
        {
          ...aiOptions,
          agent: {
            enabled: true,
            depth: agentOptions.depth || "medium",
            iterativeApply
          },
          onProgress,
          applyCommands: async function applyAgentCommands(commands, meta = {}) {
            const roundLabel = meta.label || label;
            const batch = await editorApi.execCoreCommands(commands, { label: roundLabel });
            if (!batch.ok) {
              const execError =
                batch.results?.find((item) => !item.ok)?.error || "command execution failed";
              return { ok: false, error: execError };
            }
            const feedback = formatObjectGetFeedbackFromBatch(batch.results);
            return {
              ok: true,
              sceneMutated: batchResultsHaveSceneMutation(batch.results),
              objectGetFeedback: feedback || undefined,
              batch
            };
          },
          refreshContext: async function refreshAgentContext() {
            const fresh = await refreshEditorAgentContext(editorApi, refreshParams);
            Object.assign(agentContext, fresh);
            return fresh;
          },
          validateCommands: async function validateAgentCommands(commands, meta = {}) {
            const ctx = meta.baseContext || agentContext;
            if (iterativeApply) {
              return { ok: false, error: "validateCommands should not run in iterativeApply mode." };
            }
            if (commandListHasMutatingOp(commands)) {
              return { ok: true };
            }
            const allReadOnly =
              Array.isArray(commands) &&
              commands.length > 0 &&
              commands.every((cmd) => READ_ONLY_COMMAND_OPS.has(String(cmd?.op || "")));
            if (!allReadOnly) {
              return {
                ok: false,
                error:
                  "Command set has no mutating commands. Output object.patch, material.patch, object.add, object.remove, scene.applyPatch, or full scene JSON."
              };
            }
            const batch = await editorApi.execCoreCommands(commands, { label });
            if (!batch.ok) {
              const execError =
                batch.results?.find((item) => !item.ok)?.error || "read-only command execution failed";
              return { ok: false, error: execError };
            }
            const feedback = formatObjectGetFeedbackFromBatch(batch.results);
            if (feedback) {
              ctx.objectGetFeedback = [ctx.objectGetFeedback, feedback].filter(Boolean).join("\n\n");
              return {
                ok: false,
                objectGetFeedback: ctx.objectGetFeedback,
                error:
                  "Read-only exploration round complete. Use the Object get results above and output mutating commands in the next round."
              };
            }
            return {
              ok: false,
              error:
                "Session ended with read-only commands only. Output mutating commands or full scene JSON."
            };
          }
        }
      );

      if (agentResult.skipFinalExec === true) {
        return withAssemblyWarnings(
          {
            ...agentResult,
            outputMode: "commands",
            execOk: agentResult.execOk === true,
            sceneMutated: agentResult.sceneMutated === true
          },
          agentResult.commands || []
        );
      }

      if (agentResult.outputMode === "commands" && Array.isArray(agentResult.commands)) {
        const batch = await editorApi.execCoreCommands(agentResult.commands, { label });
        if (!batch.ok) {
          const execError =
            batch.results?.find((item) => !item.ok)?.error || "command execution failed";
          const sceneJsonString = await requestUpdatedSceneJsonString(
            trimmedPrompt,
            context.currentSceneJsonString || fullSceneJson,
            { ...jsonFallbackOptions, updateMode: "full" }
          );
          return {
            outputMode: "json",
            sceneJsonString,
            fallbackUsed: true,
            fallbackReason: execError,
            commandAttempt: agentResult
          };
        }
        return withAssemblyWarnings(
          {
            ...agentResult,
            outputMode: "commands",
            execOk: true,
            sceneMutated: batchResultsHaveSceneMutation(batch.results),
            batch
          },
          agentResult.commands
        );
      }

      return agentResult;
    } catch (err) {
      if (agentOutputMode === "json") {
        throw err;
      }
      const sceneJsonString = await requestUpdatedSceneJsonString(
        trimmedPrompt,
        context.currentSceneJsonString || fullSceneJson,
        { ...jsonFallbackOptions, updateMode: "full" }
      );
      return {
        outputMode: "json",
        sceneJsonString,
        fallbackUsed: true,
        fallbackReason: String(err?.message || err),
        agentFailed: true
      };
    }
  }

  if (normalizedMode === "json-full" || normalizedMode === "json-incremental") {
    const sceneJsonString = await requestUpdatedSceneJsonString(
      trimmedPrompt,
      context.currentSceneJsonString || fullSceneJson,
      jsonFallbackOptions
    );
    return {
      outputMode: "json",
      sceneJsonString,
      fallbackUsed: false,
      updateMode: jsonFallbackOptions.updateMode
    };
  }

  const commandRequestMode = normalizedMode === "auto" ? "auto" : "commands";
  const aiResult = await requestUpdatedSceneEditCommands(trimmedPrompt, context, {
    outputMode: commandRequestMode,
    fallbackToJson: normalizedMode !== "commands",
    ...aiOptions
  });

  if (aiResult.outputMode === "json" || aiResult.fallbackUsed) {
    return aiResult;
  }

  if (!Array.isArray(aiResult.commands) || aiResult.commands.length === 0) {
    const sceneJsonString = await requestUpdatedSceneJsonString(
      trimmedPrompt,
      context.currentSceneJsonString || fullSceneJson,
      jsonFallbackOptions
    );
    return {
      outputMode: "json",
      sceneJsonString,
      fallbackUsed: true,
      fallbackReason: "empty_commands"
    };
  }

  const batch = await editorApi.execCoreCommands(aiResult.commands, { label });
  if (batch.ok) {
    return withAssemblyWarnings(
      {
        ...aiResult,
        outputMode: "commands",
        execOk: true,
        sceneMutated: batchResultsHaveSceneMutation(batch.results),
        batch
      },
      aiResult.commands
    );
  }

  const execError =
    batch.results?.find((item) => !item.ok)?.error || "command execution failed";
  const sceneJsonString = await requestUpdatedSceneJsonString(
    trimmedPrompt,
    context.currentSceneJsonString || fullSceneJson,
    { ...jsonFallbackOptions, updateMode: "full" }
  );
  return {
    outputMode: "json",
    sceneJsonString,
    fallbackUsed: true,
    fallbackReason: execError,
    commandAttempt: aiResult
  };
}
