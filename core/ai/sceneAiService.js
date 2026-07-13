/**
 * Scene AI service: calls OpenAI (ChatGPT) / DeepSeek and other compatible APIs to generate or edit ThreeJSON;
 * supports reading and writing local .json/.js scene files (Node).
 */
import {
  buildSceneGenerationSystemPrompt,
  buildSceneImageGenerationSystemPrompt,
  buildSceneUpdateSystemPrompt,
  buildSceneIncrementalUpdateSystemPrompt
} from "./threeJsonCoreSkill.js";
import {
  buildSceneCommandAutoUpdateSystemPrompt,
  buildSceneCommandUpdateSystemPrompt,
  buildSceneCommandUpdateUserMessage,
  extractCommandScriptText,
  isAiSceneUpdateCommandOp,
  isLikelyCommandScriptText,
  resolveOutputKind
} from "./sceneCommandSkill.js";
import {
  createCommandContext,
  createCommandRegistry,
  executeCommands,
  parseCommandScript
} from "../command/index.js";
import { extractPatchOperations, applySceneJsonPatch } from "./scenePatch.js";
import {
  buildIntentHints,
  evaluateCapabilityFit,
  buildCapabilityFixPrompt
} from "./sceneCapability.js";
import { requestSceneOutline } from "./agentTools.js";
import { buildSanitizedJsonParseErrorMessage, sanitizeAiJsonText } from "./sceneJsonSanitize.js";
import { isLoadableScenePayload } from "../handler/sceneFriendlyNormalizer.js";

const PROVIDERS = {
  chatgpt: {
    apiBase: "https://api.openai.com/v1",
    endpoint: "/chat/completions",
    defaultModel: "gpt-4o-mini"
  },
  deepseek: {
    apiBase: "https://api.deepseek.com",
    endpoint: "/chat/completions",
    defaultModel: "deepseek-chat"
  },
  custom: {
    apiBase: "",
    endpoint: "/chat/completions",
    defaultModel: "gpt-4o-mini"
  }
};

/** @param {*} value */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureProvider(provider) {
  const normalized = String(provider || "chatgpt").toLowerCase();
  if (!PROVIDERS[normalized]) {
    throw new Error(`Unsupported provider "${provider}". Use "chatgpt", "deepseek", or "custom".`);
  }
  return normalized;
}

function extractJsonText(rawText) {
  if (typeof rawText !== "string") {
    throw new Error("AI response is not a string.");
  }
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return rawText.slice(firstBrace, lastBrace + 1).trim();
  }
  return rawText.trim();
}

function normalizeSceneJsonObject(sceneObj) {
  if (!isObject(sceneObj)) {
    throw new Error("Generated scene JSON must be an object.");
  }
  if (!isLoadableScenePayload(sceneObj)) {
    throw new Error(
      "Generated scene JSON must contain worldInfo or standard objectList/sceneConfig."
    );
  }
  if (isObject(sceneObj.worldInfo) && !Array.isArray(sceneObj.worldInfo.boxModelList)) {
    sceneObj.worldInfo.boxModelList = [];
  }
  return sceneObj;
}

function parseSceneJsonString(sceneJsonString) {
  const raw = String(sceneJsonString || "").trim();
  const sanitized = sanitizeAiJsonText(raw);
  let parsed;
  try {
    parsed = JSON.parse(sanitized);
  } catch (err) {
    throw new SyntaxError(buildSanitizedJsonParseErrorMessage(sanitized, err));
  }
  return normalizeSceneJsonObject(parsed);
}

function prettyJson(sceneObj) {
  return JSON.stringify(sceneObj, null, 2);
}

function normalizeMimeTypeForDataUrl(mimeType) {
  const raw = String(mimeType || "image/png").trim();
  if (!raw) return "image/png";
  if (raw.includes("/")) return raw;
  return `image/${raw.replace(/^image\//i, "")}`;
}

function sanitizeBase64Payload(payload) {
  const s = String(payload).trim();
  const idx = s.indexOf("base64,");
  if (s.startsWith("data:") && idx >= 0) {
    return s.slice(idx + "base64,".length).replace(/\s+/g, "");
  }
  return s.replace(/\s+/g, "");
}

/**
 * Normalize `generateSceneJsonFromImage` `image` to the vision API `image_url.url` (https or data:image/*;base64,...).
 * @param {string | { base64: string, mimeType?: string, mime?: string }} image
 * @returns {string}
 */
function resolveVisionImageUrl(image) {
  if (typeof image === "string") {
    const s = image.trim();
    if (!s) {
      throw new Error("image string is empty.");
    }
    if (/^data:image\//i.test(s)) {
      return s;
    }
    if (/^https?:\/\//i.test(s)) {
      return s;
    }
    throw new Error(
      'image string must be an http(s) URL or data:image/*;base64,...; use { base64, mimeType } for raw base64.'
    );
  }
  if (!isObject(image)) {
    throw new Error('image must be a string or { base64, mimeType? } object.');
  }
  const mime = normalizeMimeTypeForDataUrl(image.mimeType ?? image.mime);
  const body = sanitizeBase64Payload(image.base64);
  if (!body) {
    throw new Error("image.base64 is empty.");
  }
  return `data:${mime};base64,${body}`;
}

/**
 * Low-level HTTP: call an OpenAI-compatible chat/completions endpoint and parse choices[0].message.content.
 * @param {object} params
 * @param {string} [params.provider='chatgpt']
 * @param {string} params.apiKey
 * @param {Array<{role:string,content:string|Array}>} params.messages
 * @param {string} [params.model]
 * @param {number} [params.temperature=0.2]
 * @param {number} [params.maxTokens=4000]
 * @param {string} [params.baseUrl] Override default apiBase
 */
/**
 * @param {ReadableStream<Uint8Array>} body
 * @param {(chunk: string) => void} [onDelta]
 * @returns {Promise<string>}
 */
async function readSseChatCompletionStream(body, onDelta) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") {
        continue;
      }
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          content += delta;
          if (typeof onDelta === "function") {
            onDelta(delta);
          }
        }
      } catch {
        /* ignore malformed SSE chunks */
      }
    }
  }
  return content;
}

async function requestChatCompletion({
  provider = "chatgpt",
  apiKey,
  messages,
  model,
  temperature = 0.2,
  maxTokens = 4000,
  baseUrl,
  stream = false,
  signal,
  onDelta
}) {
  const normalizedProvider = ensureProvider(provider);
  const providerConfig = PROVIDERS[normalizedProvider];
  if (!apiKey) {
    throw new Error("Missing apiKey.");
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be a non-empty array.");
  }

  const endpointBase = (baseUrl || providerConfig.apiBase || "").replace(/\/$/, "");
  if (!endpointBase) {
    throw new Error(
      'provider "custom" requires options.baseUrl (OpenAI-compatible API root URL, e.g. https://api.openai.com/v1).'
    );
  }
  const url = `${endpointBase}${providerConfig.endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    signal,
    body: JSON.stringify({
      model: model || providerConfig.defaultModel,
      temperature,
      max_tokens: maxTokens,
      messages,
      stream: stream === true
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI request failed (${response.status}): ${detail}`);
  }

  if (stream === true && response.body) {
    const content = await readSseChatCompletionStream(response.body, onDelta);
    if (!content.trim()) {
      throw new Error("AI stream response content is empty.");
    }
    return content;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI response content is empty.");
  }
  return content;
}

/**
 * Strip streaming / UI-only fields before passing options to nested LLM calls.
 * @param {object} options
 */
function stripChatTransportOptions(options = {}) {
  const next = { ...options };
  delete next.stream;
  delete next.signal;
  delete next.onDelta;
  delete next.streamPreview;
  delete next.updateMode;
  delete next.outputMode;
  delete next.fallbackToJson;
  delete next.planFirst;
  delete next.capabilityReview;
  delete next.maxCapabilityReviewAttempts;
  return next;
}

/**
 * @param {import("../command/types.js").ParsedCommand[]} commands
 * @returns {import("../command/types.js").ParsedCommand[]}
 */
function filterCoreUpdateCommands(commands) {
  return commands.filter((cmd) => isAiSceneUpdateCommandOp(cmd.op));
}

/**
 * Dry-run core update commands against a scene JSON document.
 * @param {import("../command/types.js").ParsedCommand[]} commands
 * @param {string} sceneJsonString
 * @returns {Promise<{ ok: boolean, results: import("../command/types.js").CommandResult[] }>}
 */
async function dryRunUpdateCommands(commands, sceneJsonString) {
  const parsed = parseSceneJsonString(String(sceneJsonString || ""));
  const ctx = createCommandContext({ document: parsed });
  const registry = createCommandRegistry();
  return executeCommands(ctx, commands, {
    registry,
    dryRun: true,
    executeMode: "auto"
  });
}

const DEFAULT_GENERATE_MAX_TOKENS = 6000;

/**
 * @param {string} prompt
 * @param {string} [outline]
 * @returns {string}
 */
function buildGenerateUserMessage(prompt, outline = "") {
  const trimmed = String(prompt || "").trim();
  const hints = buildIntentHints(trimmed);
  const parts = [`User prompt:\n${trimmed}`];
  if (hints) {
    parts.push(hints);
  }
  if (outline && String(outline).trim()) {
    parts.push(`Scene plan:\n${String(outline).trim()}`);
  }
  return parts.join("\n\n");
}

/**
 * @param {string} prompt
 * @param {object} options
 * @returns {Promise<string>}
 */
async function resolveEffectiveGeneratePrompt(prompt, options = {}) {
  if (options.planFirst !== true) {
    return prompt;
  }
  const outline = await requestSceneOutline(
    { prompt, mode: "generate" },
    {
      ...stripChatTransportOptions(options),
      maxTokens: options.outlineMaxTokens || 1000,
      temperature: options.outlineTemperature ?? 0.3
    }
  );
  return `${prompt}\n\nFollow this outline:\n${outline}`;
}

/**
 * @param {string} prompt
 * @param {string} sceneJsonString
 * @param {object} options
 * @returns {Promise<string>}
 */
async function maybeApplyCapabilityReview(prompt, sceneJsonString, options = {}) {
  if (options.capabilityReview === false) {
    return sceneJsonString;
  }
  const maxAttempts =
    options.maxCapabilityReviewAttempts ??
    (options.capabilityReview === true ? 1 : 1);
  if (maxAttempts <= 0) {
    return sceneJsonString;
  }

  let current = sceneJsonString;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const parsed = parseSceneJsonString(current);
    const fit = evaluateCapabilityFit(prompt, parsed);
    if (fit.ok) {
      break;
    }
    const fixPrompt = buildCapabilityFixPrompt(prompt, fit);
    current = await requestUpdatedSceneJsonString(fixPrompt, current, {
      ...stripChatTransportOptions(options),
      maxTokens: options.capabilityReviewMaxTokens || options.maxTokens || DEFAULT_GENERATE_MAX_TOKENS
    });
  }
  return current;
}

/**
 * Generate a formatted full-scene JSON string from natural language.
 * @param {string} prompt User requirement description
 * @param {object} [options={}] apiKey, provider, model, temperature, baseUrl, etc.; forwarded to requestChatCompletion
 * @returns {Promise<string>}
 */
async function generateSceneJsonString(prompt, options = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error("prompt is required.");
  }

  const trimmedPrompt = String(prompt).trim();
  const effectivePrompt = await resolveEffectiveGeneratePrompt(trimmedPrompt, options);
  const chatOpts = stripChatTransportOptions(options);
  const maxTokens = options.maxTokens ?? DEFAULT_GENERATE_MAX_TOKENS;

  const content = await requestChatCompletion({
    ...options,
    maxTokens,
    messages: [
      {
        role: "system",
        content: buildSceneGenerationSystemPrompt()
      },
      {
        role: "user",
        content: buildGenerateUserMessage(effectivePrompt)
      }
    ]
  });

  let jsonText = extractJsonText(content);
  let sceneJsonString = prettyJson(parseSceneJsonString(jsonText));
  sceneJsonString = await maybeApplyCapabilityReview(trimmedPrompt, sceneJsonString, {
    ...options,
    maxTokens
  });
  return sceneJsonString;
}

const DEFAULT_SCENE_IMAGE_PROMPT =
  "Recreate the spatial layout and main visible objects from the reference image as a ThreeJSON scene. Map visible shapes to appropriate lists and objTypes (floor, wall, glass, sphere, modelList primitives, line, infoPanel, group, points, native, etc.). Use reasonable approximate sizes and positions.";

/**
 * Generate a formatted full-scene JSON string from a reference image (URL, data URL, or raw base64 object).
 * Uses `requestChatCompletion` multimodal user messages.
 * @param {{ prompt?: string, image: string | { base64: string, mimeType?: string } }} input
 * @param {object} [options={}] Same as generateSceneJsonString; also supports `imageDetail`: `auto`|`low`|`high` (written to image_url.detail)
 * @returns {Promise<string>}
 */
async function generateSceneJsonFromImage(input = {}, options = {}) {
  if (!input || input.image === undefined || input.image === null) {
    throw new Error("input.image is required.");
  }

  const { imageDetail = "auto", ...chatOptions } = options;
  const detail = ["low", "high", "auto"].includes(String(imageDetail)) ? imageDetail : "auto";
  const imageUrlForApi = resolveVisionImageUrl(input.image);
  const trimmedPrompt =
    input.prompt !== undefined && String(input.prompt).trim()
      ? String(input.prompt).trim()
      : DEFAULT_SCENE_IMAGE_PROMPT;

  const effectivePrompt = await resolveEffectiveGeneratePrompt(trimmedPrompt, chatOptions);
  const maxTokens = chatOptions.maxTokens ?? DEFAULT_GENERATE_MAX_TOKENS;

  const content = await requestChatCompletion({
    ...options,
    maxTokens,
    messages: [
      {
        role: "system",
        content: buildSceneImageGenerationSystemPrompt()
      },
      {
        role: "user",
        content: [
          { type: "text", text: buildGenerateUserMessage(effectivePrompt) },
          {
            type: "image_url",
            image_url: {
              url: imageUrlForApi,
              detail
            }
          }
        ]
      }
    ]
  });

  let jsonText = extractJsonText(content);
  let sceneJsonString = prettyJson(parseSceneJsonString(jsonText));
  sceneJsonString = await maybeApplyCapabilityReview(trimmedPrompt, sceneJsonString, {
    ...options,
    maxTokens
  });
  return sceneJsonString;
}

/**
 * Request a model update with the full current scene and return a formatted JSON string (also
 * importable from external Node tools). Pass `options.includePatch: true` to additionally get
 * back the raw RFC-6902-ish patch ops the model produced for `updateMode: "incremental"` (e.g.
 * so a chat-style host can show the user "what changed" instead of only the merged result) — this
 * is opt-in and changes the return shape to `{ sceneJsonString, patch }`; existing callers that
 * don't pass it keep getting a plain string back.
 */
async function requestUpdatedSceneJsonString(prompt, currentSceneJsonString, options = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error("prompt is required.");
  }
  if (!currentSceneJsonString || !String(currentSceneJsonString).trim()) {
    throw new Error("currentSceneJsonString is required.");
  }

  const updateMode = options.updateMode === "incremental" ? "incremental" : "full";
  const includePatch = options.includePatch === true;
  const chatOpts = stripChatTransportOptions(options);
  const currentSceneObj = parseSceneJsonString(String(currentSceneJsonString));

  if (updateMode === "incremental") {
    const currentScenePrettyJson = prettyJson(currentSceneObj);
    const content = await requestChatCompletion({
      ...options,
      ...chatOpts,
      messages: [
        {
          role: "system",
          content: buildSceneIncrementalUpdateSystemPrompt()
        },
        {
          role: "user",
          content: `Modification request:\n${String(prompt).trim()}\n\nCurrent scene JSON:\n${currentScenePrettyJson}`
        }
      ]
    });
    const patch = extractPatchOperations(content);
    const applied = applySceneJsonPatch(currentSceneObj, patch);
    if (!applied.ok) {
      throw new Error(`incremental patch failed: ${applied.error}`);
    }
    let sceneJsonString;
    try {
      const { normalizeScenePayload } = await import("../handler/sceneFriendlyNormalizer.js");
      const normalized = normalizeScenePayload(applied.scene);
      sceneJsonString = prettyJson(normalized.compatPayload || normalized.sourcePayload || applied.scene);
    } catch {
      sceneJsonString = prettyJson(applied.scene);
    }
    return includePatch ? { sceneJsonString, patch } : sceneJsonString;
  }

  const currentScenePrettyJson = prettyJson(currentSceneObj);
  const content = await requestChatCompletion({
    ...options,
    ...chatOpts,
    messages: [
      {
        role: "system",
        content: buildSceneUpdateSystemPrompt()
      },
      {
        role: "user",
        content: `Modification request:\n${String(prompt).trim()}\n\nCurrent scene JSON:\n${currentScenePrettyJson}`
      }
    ]
  });

  const updatedJsonText = extractJsonText(content);
  const updatedSceneObj = parseSceneJsonString(updatedJsonText);
  const sceneJsonString = prettyJson(updatedSceneObj);
  return includePatch ? { sceneJsonString, patch: null } : sceneJsonString;
}

/**
 * Incrementally edit an existing scene JSON string from a description and return the updated full JSON string.
 * @param {string} prompt Modification instructions
 * @param {string} currentSceneJsonString Current scene JSON
 * @param {object} [options={}]
 */
async function updateSceneJsonString(prompt, currentSceneJsonString, options = {}) {
  return requestUpdatedSceneJsonString(prompt, currentSceneJsonString, options);
}

/**
 * Request scene edit commands from LLM (core scene.* / object.* only).
 * @param {string} prompt Modification request
 * @param {object} [context={}] objectList, selectionId, selectionDescriptor, fullSceneJson, currentSceneJsonString
 * @param {object} [options={}] outputMode: 'commands'|'json'|'auto', fallbackToJson (default true)
 * @returns {Promise<object>}
 */
async function requestUpdatedSceneEditCommands(prompt, context = {}, options = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error("prompt is required.");
  }

  const rawOutputMode = String(options.outputMode || "commands").toLowerCase();
  const outputMode =
    rawOutputMode === "json" ? "json" : rawOutputMode === "auto" ? "auto" : "commands";
  const currentSceneJsonString = String(
    context.currentSceneJsonString || context.fullSceneJson || ""
  ).trim();

  if (outputMode === "json") {
    if (!currentSceneJsonString) {
      throw new Error("currentSceneJsonString is required for json outputMode.");
    }
    const sceneJsonString = await requestUpdatedSceneJsonString(
      prompt,
      currentSceneJsonString,
      options
    );
    return { outputMode: "json", sceneJsonString };
  }

  const agentRound = options.agentRound === true;
  const iterativeApply = options.iterativeApply === true;
  const singleRound = options.singleRound !== false && !agentRound && !iterativeApply;

  const userContent =
    typeof context.userMessage === "string" && context.userMessage.trim()
      ? context.userMessage.trim()
      : buildSceneCommandUpdateUserMessage({
          modificationRequest: prompt,
          objectList: context.objectListForMessage ?? context.objectList,
          selectionId: context.selectionId ?? null,
          selectionDescriptor: context.selectionDescriptor ?? null,
          fullSceneJson: context.fullSceneJson,
          objectGetFeedback: context.objectGetFeedback,
          objectSpatialCards: context.objectSpatialCards,
          sceneScaleProfile: context.sceneScaleProfile,
          referenceObjects: context.referenceObjects,
          placementHints: context.placementHints,
          assemblyIntentHints: context.assemblyIntentHints,
          singleRound,
          agentRound
        });

  // Whenever the model is given the "auto" system prompt (commands preferred, full JSON allowed
  // for large restructures), the response parser below must accept both forms too — agent/
  // iterative rounds always get that prompt regardless of the caller's `outputMode` (ThreeBox's
  // "commands" setting never becomes literal outputMode:"auto"), so gating the JSON-detection
  // branch on `outputMode === "auto"` alone let the model follow its own prompt's advice and
  // return valid scene JSON, only to have it rejected as "not a valid command script" with no
  // fallback (agent calls always pass fallbackToJson:false) — the whole agent turn then failed
  // after burning through every repair round on responses that were never actually invalid.
  const allowAutoOutputKind = outputMode === "auto" || agentRound || iterativeApply;
  const systemPrompt = allowAutoOutputKind
    ? buildSceneCommandAutoUpdateSystemPrompt({ agentRound: agentRound || iterativeApply, iterativeApply })
    : buildSceneCommandUpdateSystemPrompt();

  const content = await requestChatCompletion({
    ...options,
    ...stripChatTransportOptions(options),
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent }
    ]
  });

  const fallbackToJson = options.fallbackToJson !== false;
  const tryJsonFallback = async (reason) => {
    if (!fallbackToJson || !currentSceneJsonString) {
      throw new Error(reason);
    }
    const sceneJsonString = await requestUpdatedSceneJsonString(
      prompt,
      currentSceneJsonString,
      options
    );
    return {
      outputMode: "json",
      sceneJsonString,
      fallbackUsed: true,
      fallbackReason: reason,
      rawContent: content
    };
  };

  if (allowAutoOutputKind) {
    const kind = resolveOutputKind(content);
    if (kind === "json") {
      try {
        const sceneJsonString = prettyJson(parseSceneJsonString(extractJsonText(content)));
        return { outputMode: "json", sceneJsonString, rawContent: content };
      } catch (err) {
        return tryJsonFallback(String(err?.message || err));
      }
    }
    if (kind === "unknown") {
      return tryJsonFallback("AI response is neither commands nor valid scene JSON.");
    }
  }

  const commandScript = extractCommandScriptText(content);

  if (!isLikelyCommandScriptText(commandScript)) {
    return tryJsonFallback("AI response is not a valid command script.");
  }

  try {
    const parsed = parseCommandScript(commandScript);
    const parsedOps = parsed.map((cmd) => cmd.op);
    const commands = filterCoreUpdateCommands(parsed);
    if (commands.length === 0) {
      const detail =
        parsedOps.length > 0
          ? `Parsed ops [${parsedOps.join(", ")}] but none matched AI update command filter.`
          : "No scene.* or object.* commands found in AI output.";
      return tryJsonFallback(detail);
    }
    return {
      outputMode: "commands",
      commandScript,
      commands,
      ok: true,
      rawContent: content
    };
  } catch (err) {
    return tryJsonFallback(String(err?.message || err));
  }
}

export {
  generateSceneJsonString,
  generateSceneJsonFromImage,
  updateSceneJsonString,
  requestChatCompletion,
  requestUpdatedSceneJsonString,
  requestUpdatedSceneEditCommands,
  dryRunUpdateCommands,
  extractJsonText,
  parseSceneJsonString,
  resolveVisionImageUrl,
  buildGenerateUserMessage,
  maybeApplyCapabilityReview
};
