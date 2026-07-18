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
  matchIntentSignals,
  shouldAllowParticleEffects,
  evaluateCapabilityFit,
  buildCapabilityFixPrompt
} from "./sceneCapability.js";
import { fetchReferenceMaterial } from "./sceneReferenceCatalog.js";
import { requestSceneOutline } from "./agentTools.js";
import {
  buildSanitizedJsonParseErrorMessage,
  isLikelyTruncatedJsonText,
  sanitizeAiJsonText
} from "./sceneJsonSanitize.js";
import {
  buildFriendlyScenePayloadFromCanonical,
  buildStandardScenePayloadFromCanonical,
  isLoadableScenePayload,
  normalizeScenePayload
} from "../handler/sceneFriendlyNormalizer.js";

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
  },
  // ThreeBox's built-in trial provider (tools/scene-host/threebox/js/threeBoxBuiltinProvider.js):
  // a Cloudflare Worker proxy the user configures a base URL for (default https://api.threebox.org,
  // see threebox-server's README), never a hardcoded upstream — behaves like "custom" except the
  // frontend fills baseUrl automatically instead of asking the user to type it. Unlike the other
  // entries, `endpoint` includes the "/v1" segment: threebox-server's chat-completions route lives
  // at "{base}/v1/chat/completions", matching the same base its non-chat endpoints
  // (threeBoxBuiltinProvider.js's "{base}/v1/auth/issue" and "{base}/v1/quota") are built from.
  "threebox-builtin": {
    apiBase: "",
    endpoint: "/v1/chat/completions",
    defaultModel: ""
  }
};

/** @param {*} value */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureProvider(provider) {
  const normalized = String(provider || "chatgpt").toLowerCase();
  if (!PROVIDERS[normalized]) {
    throw new Error(`Unsupported provider "${provider}". Use one of: ${Object.keys(PROVIDERS).join(", ")}.`);
  }
  return normalized;
}

/** Shared mutable state for every provider request spawned by one user-authored ThreeBox turn. */
function createThreeBoxTurnContext(turnId, originalPrompt) {
  return {
    turnId: String(turnId || "").trim(),
    originalPrompt: String(originalPrompt || ""),
    moderationStatus: "pending",
    moderationReceipt: "",
    originalPromptHash: ""
  };
}

function buildThreeBoxRequestContext(context) {
  if (!isObject(context) || !String(context.turnId || "").trim()) {
    return undefined;
  }
  const hasReceipt = Boolean(String(context.moderationReceipt || "").trim());
  return {
    protocol_version: 1,
    turn_id: String(context.turnId).trim(),
    original_prompt: hasReceipt
      ? { included: false }
      : { included: true, text: String(context.originalPrompt || "") },
    moderation: {
      status: hasReceipt ? String(context.moderationStatus || "allowed") : "pending",
      ...(hasReceipt ? { receipt: String(context.moderationReceipt) } : {}),
      ...(context.originalPromptHash ? { prompt_hash: String(context.originalPromptHash) } : {})
    }
  };
}

function applyThreeBoxModerationHeaders(context, headers) {
  if (!isObject(context) || !headers?.get) {
    return;
  }
  const status = String(headers.get("X-ThreeBox-Moderation-Status") || "").trim();
  const receipt = String(headers.get("X-ThreeBox-Moderation-Receipt") || "").trim();
  const promptHash = String(headers.get("X-ThreeBox-Moderation-Prompt-Hash") || "").trim();
  if (status) context.moderationStatus = status;
  if (receipt) context.moderationReceipt = receipt;
  if (promptHash) context.originalPromptHash = promptHash;
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
  // Scene collection properties are optional. Models sometimes mirror the full schema with many
  // empty arrays; keeping those placeholders bloats segmented responses and the JSON viewer.
  // Limit pruning to deployable collection containers so semantic arrays such as lights: [] or
  // animation parameters are preserved.
  if (isObject(sceneObj.worldInfo)) {
    for (const [key, value] of Object.entries(sceneObj.worldInfo)) {
      if (Array.isArray(value) && value.length === 0) {
        delete sceneObj.worldInfo[key];
      }
    }
  }
  for (const key of ["objectList", "assetLibrary"]) {
    if (Array.isArray(sceneObj[key]) && sceneObj[key].length === 0) {
      delete sceneObj[key];
    }
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

function parseJsonObjectWithoutSceneValidation(sceneJsonString) {
  const parsed = JSON.parse(sanitizeAiJsonText(String(sceneJsonString || "").trim()));
  if (!isObject(parsed)) {
    throw new Error("Generated scene JSON must be an object.");
  }
  return parsed;
}

function prettyJson(sceneObj) {
  return JSON.stringify(sceneObj, null, 2);
}

function normalizeOutputFormat(value) {
  return value === "friendly" ? "friendly" : "standard";
}

function projectSceneOutputObject(sceneObj, outputFormat = "standard", options = {}) {
  const normalized = normalizeScenePayload(sceneObj);
  const standard = normalizeSceneJsonObject(
    buildStandardScenePayloadFromCanonical(sceneObj, normalized.payload)
  );
  if (normalizeOutputFormat(outputFormat) !== "friendly") {
    return standard;
  }
  return normalizeSceneJsonObject(
    buildFriendlyScenePayloadFromCanonical(standard, normalized.payload, {
      friendlyMap: options.friendlyMap
    })
  );
}

function projectSceneJsonString(sceneJsonString, outputFormat = "standard", options = {}) {
  const parsed = parseSceneJsonString(String(sceneJsonString || ""));
  return prettyJson(projectSceneOutputObject(parsed, outputFormat, options));
}

function projectSceneDraftJsonString(sceneJsonString, outputFormat, options = {}) {
  try {
    return projectSceneJsonString(sceneJsonString, outputFormat, options);
  } catch (error) {
    if (options.allowInvalidSceneDraft !== true) throw error;
    return prettyJson(parseJsonObjectWithoutSceneValidation(sceneJsonString));
  }
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
 * @param {(metadata:{finishReason:string|null})=>void} [onCompletionMetadata]
 * @returns {Promise<string>}
 */
async function readSseChatCompletionStream(body, onDelta, onCompletionMetadata) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let finishReason = null;
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
        const choice = json?.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
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
  if (typeof onCompletionMetadata === "function") {
    onCompletionMetadata({ finishReason });
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
  onDelta,
  onCompletionMetadata,
  extraHeaders,
  threeBoxTurnContext
}) {
  const normalizedProvider = ensureProvider(provider);
  const providerConfig = PROVIDERS[normalizedProvider];
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) {
    throw new Error("Missing apiKey.");
  }
  // Browser fetch converts header values to ByteString before sending. Characters outside
  // ISO-8859-1 (for example Chinese text or emoji copied alongside a key) make fetch throw a
  // cryptic TypeError before the provider receives anything. Do not otherwise prescribe a key
  // format here: custom providers remain free to use any header-compatible credential.
  if (Array.from(normalizedApiKey).some((char) => char.codePointAt(0) > 0xff)) {
    const error = new Error(
      "The API key contains characters that cannot be used in an HTTP Authorization header. " +
      "Check that you pasted only the API key supplied by the provider."
    );
    error.code = "INVALID_API_KEY_HEADER_VALUE";
    throw error;
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
  const threeBoxContext = normalizedProvider === "threebox-builtin"
    ? buildThreeBoxRequestContext(threeBoxTurnContext)
    : undefined;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${normalizedApiKey}`,
      ...extraHeaders
    },
    signal,
    body: JSON.stringify({
      model: model || providerConfig.defaultModel,
      temperature,
      max_tokens: maxTokens,
      messages,
      stream: stream === true,
      ...(threeBoxContext ? { threebox_context: threeBoxContext } : {})
    })
  });
  applyThreeBoxModerationHeaders(threeBoxTurnContext, response.headers);

  if (!response.ok) {
    const detail = await response.text();
    // threebox-server (the built-in provider's backend, tmpserver/threebox-server) reports trial
    // quota exhaustion as `{ "error": "QUOTA_EXCEEDED" }` — tag it so hosts can distinguish "buy
    // your own key" from a generic failure without string-matching the message text.
    let errorCode = null;
    try {
      const parsed = JSON.parse(detail);
      if (parsed && parsed.error === "QUOTA_EXCEEDED") {
        errorCode = "BUILTIN_QUOTA_EXCEEDED";
      } else if (parsed && ["DEVICE_BANNED", "DEVICE_MUTED", "SAFETY_POLICY_WARNING"].includes(parsed.error)) {
        errorCode = "BUILTIN_MODERATION_BLOCKED";
      }
    } catch {
      /* not JSON, ignore */
    }
    const error = new Error(`AI request failed (${response.status}): ${detail}`);
    if (errorCode) {
      error.code = errorCode;
    }
    throw error;
  }

  if (stream === true && response.body) {
    const content = await readSseChatCompletionStream(response.body, onDelta, onCompletionMetadata);
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
  if (typeof onCompletionMetadata === "function") {
    onCompletionMetadata({ finishReason: data?.choices?.[0]?.finish_reason || null });
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
  delete next.estimatedSegments;
  delete next.maxSceneSegments;
  delete next.onSegmentProgress;
  delete next.segmentedOutput;
  delete next.onGenerationPhase;
  delete next.onCompletionMetadata;
  delete next.outputFormat;
  delete next.friendlyMap;
  delete next.allowInvalidSceneDraft;
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
const DEFAULT_MAX_SCENE_SEGMENTS = 16;
const HARD_MAX_SCENE_SEGMENTS = 64;
const DEFAULT_AUTO_CONTINUE_MIN_CHARS = 8000;
const SCENE_SEGMENT_CONTINUE_MARKER = "<<<THREEJSON_CONTINUE>>>";
const SCENE_SEGMENT_COMPLETE_MARKER = "<<<THREEJSON_COMPLETE>>>";

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

function buildSegmentedSceneProtocolPrompt(estimatedSegments) {
  return [
    "SEGMENTED OUTPUT PROTOCOL (mandatory):",
    `The host estimates that this scene may need about ${estimatedSegments} response segment(s). This is advisory only; use fewer or more when necessary.`,
    "Write one contiguous JSON document across one or more assistant responses.",
    "In each response, output only the next exact JSON characters. Do not use Markdown fences, explanations, labels, ellipses, or repeat earlier characters.",
    "When you choose a segment boundary, stop only between complete array items or object properties (preferably just after a comma), never in the middle of a string, number, escape sequence, or literal.",
    `End every response with ${SCENE_SEGMENT_CONTINUE_MARKER} on its own line when more JSON remains.`,
    `End the response with ${SCENE_SEGMENT_COMPLETE_MARKER} on its own line only after the full JSON document is complete and valid.`,
    "The marker is transport control text and must never appear inside the JSON document."
  ].join("\n");
}

function buildContinueSceneSegmentMessage(segmentNumber) {
  return [
    `Continue with scene JSON segment ${segmentNumber}.`,
    "Start at the exact next character after your previous JSON fragment.",
    "Do not restart, repeat, summarize, repair, or wrap the JSON.",
    `Finish with ${SCENE_SEGMENT_CONTINUE_MARKER} if more remains, otherwise ${SCENE_SEGMENT_COMPLETE_MARKER}.`
  ].join("\n");
}

function splitSceneSegmentControl(rawContent) {
  const raw = String(rawContent || "");
  const match = raw.match(/(?:\r?\n)?<<<THREEJSON_(CONTINUE|COMPLETE)>>>\s*$/);
  if (!match || match.index === undefined) {
    return { fragment: raw, control: null };
  }
  return {
    fragment: raw.slice(0, match.index),
    control: match[1] === "CONTINUE" ? "continue" : "complete"
  };
}

/**
 * Keeps enough trailing streamed text buffered that transport markers are never shown as JSON.
 * @param {(delta:string)=>void} [onDelta]
 */
function createSceneSegmentDeltaForwarder(onDelta) {
  const markerTailLength = Math.max(
    SCENE_SEGMENT_CONTINUE_MARKER.length,
    SCENE_SEGMENT_COMPLETE_MARKER.length
  ) + 4;
  let raw = "";
  let emittedLength = 0;
  return {
    push(delta) {
      raw += String(delta || "");
      const safeLength = Math.max(0, raw.length - markerTailLength);
      if (safeLength > emittedLength && typeof onDelta === "function") {
        onDelta(raw.slice(emittedLength, safeLength));
      }
      emittedLength = Math.max(emittedLength, safeLength);
    },
    finish(cleanFragment) {
      const clean = String(cleanFragment || "");
      if (clean.length > emittedLength && typeof onDelta === "function") {
        onDelta(clean.slice(emittedLength));
      }
    }
  };
}

function emitSceneSegmentProgress(options, detail) {
  if (typeof options.onSegmentProgress === "function") {
    options.onSegmentProgress(detail);
  }
}

async function emitSceneGenerationPhase(options, detail) {
  if (typeof options.onGenerationPhase === "function") {
    await options.onGenerationPhase(detail);
  }
}

function shouldUseSegmentedSceneOutput(options, estimatedSegments) {
  if (options.segmentedOutput === true) {
    return true;
  }
  if (options.segmentedOutput === false) {
    return false;
  }
  return estimatedSegments > 1;
}

function isLengthFinishReason(value) {
  const reason = String(value || "").trim().toLowerCase();
  return reason === "length" || reason === "max_tokens" || reason === "max_output_tokens";
}

function shouldRetryCompactSceneOutput(content, completionMetadata, options) {
  if (options.compactRetryOnTruncation === false || !isLikelyTruncatedJsonText(content)) {
    return false;
  }
  if (isLengthFinishReason(completionMetadata?.finishReason)) {
    return true;
  }
  const minChars = clampInteger(
    options.compactRetryMinChars,
    DEFAULT_AUTO_CONTINUE_MIN_CHARS,
    1000,
    1000000
  );
  return String(content || "").length >= minChars;
}

function buildCompactSceneRetryMessage(prompt, referenceMaterial = "", options = {}) {
  return [
    buildGenerateUserMessage(prompt, "", options),
    referenceMaterial,
    "COMPACT FULL-REGENERATION REQUIREMENT:",
    "The previous one-response attempt exceeded the provider output limit. Generate the complete scene again from the beginning; do not continue, quote, or repair the previous fragment.",
    "Preserve the visual story, but reduce explicit JSON size aggressively: use instancedList/transforms for repeated objects, use a bounded varied sample for words such as many, reuse materials and simple assemblies, omit optional details, and close every array/object in this response.",
    "Return one complete valid standard scheme-B JSON document only."
  ].filter(Boolean).join("\n\n");
}

async function requestSegmentedSceneJsonContent(messages, options, maxTokens) {
  const estimatedSegments = clampInteger(options.estimatedSegments, 1, 1, DEFAULT_MAX_SCENE_SEGMENTS);
  const maxSegments = clampInteger(
    options.maxSceneSegments,
    DEFAULT_MAX_SCENE_SEGMENTS,
    1,
    HARD_MAX_SCENE_SEGMENTS
  );
  const conversation = messages.map((message) => ({ ...message }));
  let assembled = "";

  for (let segment = 1; segment <= maxSegments; segment += 1) {
    emitSceneSegmentProgress(options, {
      status: "request",
      segment,
      estimatedSegments,
      maxSegments
    });
    const deltaForwarder = createSceneSegmentDeltaForwarder(options.onDelta);
    const rawContent = await requestChatCompletion({
      ...options,
      maxTokens,
      messages: conversation,
      onDelta: (delta) => deltaForwarder.push(delta)
    });
    const { fragment, control } = splitSceneSegmentControl(rawContent);
    deltaForwarder.finish(fragment);
    assembled += fragment;

    const detectedTruncation = isLikelyTruncatedJsonText(assembled);
    if (!detectedTruncation) {
      emitSceneSegmentProgress(options, {
        status: "complete",
        segment,
        estimatedSegments,
        maxSegments,
        explicitMarker: control === "complete"
      });
      return assembled;
    }

    emitSceneSegmentProgress(options, {
      status: "continue",
      segment,
      estimatedSegments,
      maxSegments,
      implicitTruncation: detectedTruncation && control !== "continue"
    });
    if (segment === maxSegments) {
      break;
    }
    conversation.push(
      { role: "assistant", content: rawContent },
      { role: "user", content: buildContinueSceneSegmentMessage(segment + 1) }
    );
  }

  throw new Error(
    `Scene JSON was not completed after ${maxSegments} response segments. Try a provider/model with a larger context window or raise maxSceneSegments.`
  );
}

/**
 * @param {string} prompt
 * @param {string} [outline]
 * @returns {string}
 */
function buildGenerateUserMessage(prompt, outline = "", options = {}) {
  const trimmed = String(prompt || "").trim();
  const selectedIds = Array.isArray(options.selectedCapabilityIds) ? options.selectedCapabilityIds : null;
  const hints = selectedIds
    ? (selectedIds.length ? `Capabilities selected during model negotiation:\n${selectedIds.map((id) => `- ${id}`).join("\n")}` : "")
    : buildIntentHints(trimmed);
  const parts = [`User prompt:\n${trimmed}`];
  if (hints) {
    parts.push(hints);
  }
  if (outline && String(outline).trim()) {
    parts.push(`Scene plan:\n${String(outline).trim()}`);
  }
  return parts.join("\n\n");
}

async function resolveReferenceMaterialForPrompt(prompt, options = {}) {
  if (options.capabilityLookup === false || typeof options.resolveReferenceUrl !== "function") {
    return "";
  }
  try {
    const signals = Array.isArray(options.selectedCapabilityIds)
      ? options.selectedCapabilityIds.map((id) => ({ id }))
      : matchIntentSignals(prompt);
    return await fetchReferenceMaterial(signals, {
      resolveUrl: options.resolveReferenceUrl,
      locale: options.locale
    });
  } catch {
    return "";
  }
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
 * @param {"auto"|boolean} [options.segmentedOutput="auto"] Use multi-response output explicitly,
 *   disable it explicitly, or in auto mode use it only when estimatedSegments is greater than 1
 * @param {number} [options.maxSceneSegments=16] Maximum responses when segmented output is active (clamped to 1..64)
 * @param {boolean} [options.compactRetryOnTruncation=true] Retry once from scratch with compact-scene constraints after a genuine one-shot cutoff
 * @returns {Promise<string>}
 */
async function generateSceneJsonString(prompt, options = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error("prompt is required.");
  }

  const trimmedPrompt = String(prompt).trim();
  const particleEffects = Array.isArray(options.selectedCapabilityIds)
    ? options.selectedCapabilityIds.some((id) => ["particleEmitter", "weatherDomain"].includes(id))
    : shouldAllowParticleEffects(trimmedPrompt);
  const effectivePrompt = await resolveEffectiveGeneratePrompt(trimmedPrompt, options);
  const maxTokens = options.maxTokens ?? DEFAULT_GENERATE_MAX_TOKENS;
  const referenceMaterial = await resolveReferenceMaterialForPrompt(effectivePrompt, options);

  const estimatedSegments = clampInteger(options.estimatedSegments, 1, 1, DEFAULT_MAX_SCENE_SEGMENTS);
  const segmentedOutput = shouldUseSegmentedSceneOutput(options, estimatedSegments);
  const systemPrompt = buildSceneGenerationSystemPrompt({ ...options, particleEffects });
  const messages = [
    {
      role: "system",
      content: segmentedOutput
        ? [systemPrompt, buildSegmentedSceneProtocolPrompt(estimatedSegments)].join("\n\n")
        : systemPrompt
    },
    {
      role: "user",
      content: [buildGenerateUserMessage(effectivePrompt, "", options), referenceMaterial].filter(Boolean).join("\n\n")
    }
  ];
  let content;
  if (segmentedOutput) {
    content = await requestSegmentedSceneJsonContent(messages, options, maxTokens);
  } else {
    let completionMetadata = { finishReason: null };
    content = await requestChatCompletion({
      ...options,
      maxTokens,
      messages,
      onCompletionMetadata: (metadata) => {
        completionMetadata = { ...completionMetadata, ...metadata };
        if (typeof options.onCompletionMetadata === "function") {
          options.onCompletionMetadata(metadata);
        }
      }
    });
    if (shouldRetryCompactSceneOutput(content, completionMetadata, options)) {
      await emitSceneGenerationPhase(options, {
        phase: "compact-retry",
        reason: "provider-output-limit"
      });
      let retryMetadata = { finishReason: null };
      content = await requestChatCompletion({
        ...options,
        maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: buildCompactSceneRetryMessage(effectivePrompt, referenceMaterial, options) }
        ],
        onCompletionMetadata: (metadata) => {
          retryMetadata = { ...retryMetadata, ...metadata };
          if (typeof options.onCompletionMetadata === "function") {
            options.onCompletionMetadata(metadata);
          }
        }
      });
      if (shouldRetryCompactSceneOutput(content, retryMetadata, { ...options, compactRetryOnTruncation: true })) {
        throw new Error(
          "Scene JSON exceeded the provider output limit even after one compact full-regeneration attempt. " +
          "Use planned segmented output or simplify the requested scene."
        );
      }
    }
  }

  // Network/token generation has finished. Let browser hosts paint a parsing/rendering status
  // before the synchronous JSON normalization below; non-UI callers pay no extra delay.
  await emitSceneGenerationPhase(options, {
    phase: "processing",
    segmentedOutput,
    estimatedSegments
  });

  let jsonText = extractJsonText(content);
  let sceneJsonString = projectSceneDraftJsonString(jsonText, "standard", options);
  if (options.allowInvalidSceneDraft === true) {
    try {
      parseSceneJsonString(sceneJsonString);
    } catch (_error) {
      return sceneJsonString;
    }
  }
  sceneJsonString = await maybeApplyCapabilityReview(trimmedPrompt, sceneJsonString, {
    ...options,
    maxTokens
  });
  return projectSceneJsonString(sceneJsonString, options.outputFormat, options);
}

const DEFAULT_SCENE_IMAGE_PROMPT =
  "Recreate the spatial layout and main visible objects from the reference image as a standard ThreeJSON scene. Map visible shapes to objectList records with explicit objTypes (floor, wall, glass, sphere, line, infoPanel, group, points, native, externalModel, etc.). Use reasonable approximate sizes and positions.";

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
  const referenceMaterial = await resolveReferenceMaterialForPrompt(effectivePrompt, chatOptions);

  const content = await requestChatCompletion({
    ...options,
    maxTokens,
    messages: [
      {
        role: "system",
        content: buildSceneImageGenerationSystemPrompt(chatOptions)
      },
      {
        role: "user",
        content: [
          { type: "text", text: [buildGenerateUserMessage(effectivePrompt, "", chatOptions), referenceMaterial].filter(Boolean).join("\n\n") },
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
  let sceneJsonString = projectSceneJsonString(jsonText, "standard");
  sceneJsonString = await maybeApplyCapabilityReview(trimmedPrompt, sceneJsonString, {
    ...options,
    maxTokens
  });
  return projectSceneJsonString(sceneJsonString, options.outputFormat, options);
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
  let currentSceneObj;
  try {
    currentSceneObj = projectSceneOutputObject(
      parseSceneJsonString(String(currentSceneJsonString)),
      "standard"
    );
  } catch (error) {
    if (options.allowInvalidSceneDraft !== true) throw error;
    currentSceneObj = parseJsonObjectWithoutSceneValidation(currentSceneJsonString);
  }
  const referenceMaterial = await resolveReferenceMaterialForPrompt(prompt, options);

  if (updateMode === "incremental") {
    const currentScenePrettyJson = prettyJson(currentSceneObj);
    const content = await requestChatCompletion({
      ...options,
      ...chatOpts,
      messages: [
        {
          role: "system",
          content: buildSceneIncrementalUpdateSystemPrompt(options)
        },
        {
          role: "user",
          content: [
            `Modification request:\n${String(prompt).trim()}`,
            referenceMaterial,
            `Current scene JSON:\n${currentScenePrettyJson}`
          ].filter(Boolean).join("\n\n")
        }
      ]
    });
    const patch = extractPatchOperations(content);
    const applied = applySceneJsonPatch(currentSceneObj, patch);
    if (!applied.ok) {
      throw new Error(`incremental patch failed: ${applied.error}`);
    }
    const sceneJsonString = prettyJson(
      projectSceneOutputObject(applied.scene, options.outputFormat, options)
    );
    return includePatch ? { sceneJsonString, patch } : sceneJsonString;
  }

  const currentScenePrettyJson = prettyJson(currentSceneObj);
  const content = await requestChatCompletion({
    ...options,
    ...chatOpts,
    messages: [
      {
        role: "system",
        content: buildSceneUpdateSystemPrompt(options)
      },
      {
        role: "user",
        content: [
          `Modification request:\n${String(prompt).trim()}`,
          referenceMaterial,
          `Current scene JSON:\n${currentScenePrettyJson}`
        ].filter(Boolean).join("\n\n")
      }
    ]
  });

  const updatedJsonText = extractJsonText(content);
  const sceneJsonString = projectSceneDraftJsonString(
    updatedJsonText,
    options.outputFormat,
    options
  );
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

  const baseUserContent =
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
  const referenceMaterial = await resolveReferenceMaterialForPrompt(prompt, options);
  const userContent = [baseUserContent, referenceMaterial].filter(Boolean).join("\n\n");

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
    ? buildSceneCommandAutoUpdateSystemPrompt({
        agentRound: agentRound || iterativeApply,
        iterativeApply,
        onlineTextureHints: options.onlineTextureHints,
        animationCapabilities: options.animationCapabilities,
        selectedCapabilityIds: options.selectedCapabilityIds
      })
    : buildSceneCommandUpdateSystemPrompt({
        onlineTextureHints: options.onlineTextureHints,
        animationCapabilities: options.animationCapabilities,
        selectedCapabilityIds: options.selectedCapabilityIds
      });

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

function isSceneRefinementDoneText(rawContent) {
  const text = String(rawContent || "").trim();
  return /^(?:```(?:command)?\s*)?#\s*(?:done|complete|finished)\s*(?:```)?$/i.test(text);
}

function isRfc6902PatchList(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (operation) =>
        operation &&
        typeof operation === "object" &&
        ["add", "replace", "remove"].includes(operation.op) &&
        typeof operation.path === "string"
    )
  );
}

/**
 * Ask an agent for one optional refinement of an already-valid scene draft. The model may stop,
 * replace the full JSON, return RFC 6902 JSON Patch, or return executable core commands.
 * @param {string} userPrompt Original user intent
 * @param {string} currentSceneJsonString Current valid full scene JSON
 * @param {object} [options]
 */
async function requestSceneRefinementStep(userPrompt, currentSceneJsonString, options = {}) {
  if (!String(userPrompt || "").trim()) {
    throw new Error("userPrompt is required.");
  }
  const currentSceneObj = parseSceneJsonString(String(currentSceneJsonString || ""));
  const currentScenePrettyJson = prettyJson(currentSceneObj);
  const feedback = String(options.feedback || "").trim();
  const allowCommands = options.allowCommands !== false;
  const particleEffects = shouldAllowParticleEffects(userPrompt);
  const systemPrompt = [
    buildSceneCommandAutoUpdateSystemPrompt({
      agentRound: true,
      iterativeApply: true,
      onlineTextureHints: options.onlineTextureHints,
      animationCapabilities: options.animationCapabilities
    }),
    "",
    "Optional draft-refinement protocol:",
    "- Inspect the current rendered draft against the original user intent.",
    "- If it is already satisfactory, output exactly: # done",
    "- Otherwise output exactly ONE useful refinement using full scene JSON, RFC 6902 JSON Patch, or executable commands.",
    "- Make a meaningful but bounded improvement per round. Do not output explanations or combine formats.",
    particleEffects
      ? "- Particle effects may be used only where they directly implement the original user intent."
      : "- Particle effects are forbidden for this request. Do not add particleEmitter, particleList, points-as-particles, precipitation, smoke, dust, sparks, or decorative weather effects during refinement.",
    allowCommands
      ? "- Command output is supported and will be applied before the next round."
      : "- Command output is unavailable in this host; use full JSON or JSON Patch instead."
  ].join("\n");
  const content = await requestChatCompletion({
    ...options,
    ...stripChatTransportOptions(options),
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          `Original user intent:\n${String(userPrompt).trim()}`,
          feedback ? `Previous refinement feedback:\n${feedback}` : "",
          `Current scene JSON:\n${currentScenePrettyJson}`
        ]
          .filter(Boolean)
          .join("\n\n")
      }
    ]
  });

  if (isSceneRefinementDoneText(content)) {
    return { outputMode: "done", rawContent: content };
  }

  if (resolveOutputKind(content) === "json") {
    const sceneJsonString = projectSceneJsonString(
      extractJsonText(content),
      options.outputFormat,
      options
    );
    return { outputMode: "json", sceneJsonString, rawContent: content };
  }

  try {
    const patch = extractPatchOperations(content);
    if (isRfc6902PatchList(patch)) {
      const applied = applySceneJsonPatch(currentSceneObj, patch);
      if (!applied.ok) {
        throw new Error(applied.error || "JSON Patch application failed.");
      }
      const sceneJsonString = prettyJson(
        projectSceneOutputObject(applied.scene, options.outputFormat, options)
      );
      return { outputMode: "patch", patch, sceneJsonString, rawContent: content };
    }
  } catch (_patchError) {
    /* Try command parsing below. */
  }

  if (allowCommands) {
    const commandScript = extractCommandScriptText(content);
    if (isLikelyCommandScriptText(commandScript)) {
      const commands = filterCoreUpdateCommands(parseCommandScript(commandScript));
      if (commands.length > 0) {
        return { outputMode: "commands", commandScript, commands, rawContent: content };
      }
    }
  }

  throw new Error("AI refinement response is not # done, full scene JSON, JSON Patch, or supported commands.");
}

export {
  generateSceneJsonString,
  generateSceneJsonFromImage,
  updateSceneJsonString,
  requestChatCompletion,
  requestUpdatedSceneJsonString,
  requestUpdatedSceneEditCommands,
  requestSceneRefinementStep,
  dryRunUpdateCommands,
  extractJsonText,
  parseSceneJsonString,
  resolveVisionImageUrl,
  buildGenerateUserMessage,
  projectSceneJsonString,
  maybeApplyCapabilityReview,
  createThreeBoxTurnContext,
  buildThreeBoxRequestContext,
  applyThreeBoxModerationHeaders
};
