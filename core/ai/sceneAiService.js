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
  commandScriptIndicatesDone,
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
  mergeRequiredCapabilityIds,
  analyzeSceneUsage,
  shouldAllowParticleEffects,
  evaluateCapabilityFit,
  buildCapabilityFixPrompt
} from "./sceneCapability.js";
import { isSceneCapabilityAvailable } from "../capabilities/sceneCapabilityManifest.js";
import { fetchReferenceMaterial } from "./sceneReferenceCatalog.js";
import { requestSceneOutline } from "./agentTools.js";
import {
  isLikelyTruncatedJsonText,
  stripMarkdownCodeFence
} from "./sceneJsonSanitize.js";
import {
  buildFriendlyScenePayloadFromCanonical,
  buildStandardScenePayloadFromCanonical,
  normalizeScenePayload
} from "../handler/sceneFriendlyNormalizer.js";
import {
  normalizeSceneJsonObject,
  parseJsonObjectWithoutSceneValidation,
  parseSceneJsonString
} from "../handler/sceneJsonParser.js";

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

function resolveProviderConfig(provider, providerAdapter) {
  const normalized = String(provider || "chatgpt").toLowerCase();
  const builtInConfig = PROVIDERS[normalized];
  const adapter = isObject(providerAdapter) ? providerAdapter : null;
  if (!builtInConfig && !adapter) {
    throw new Error(
      `Unsupported provider "${provider}". Use one of: ${Object.keys(PROVIDERS).join(", ")}, ` +
      "or inject a host-owned providerAdapter."
    );
  }
  const endpoint = String(adapter?.endpoint ?? builtInConfig?.endpoint ?? "").trim();
  if (!endpoint.startsWith("/")) {
    throw new Error("providerAdapter.endpoint must be an absolute URL path beginning with '/'.");
  }
  return {
    provider: normalized,
    adapter,
    config: {
      apiBase: String(adapter?.apiBase ?? builtInConfig?.apiBase ?? ""),
      endpoint,
      defaultModel: String(adapter?.defaultModel ?? builtInConfig?.defaultModel ?? "")
    }
  };
}

const THINKING_PREFERENCES = new Set(["inherit", "disabled", "high", "max"]);

function normalizeThinkingPreference(value) {
  return THINKING_PREFERENCES.has(String(value)) ? String(value) : "disabled";
}

function isOfficialDeepSeekEndpoint(provider, endpointBase) {
  if (provider === "deepseek") return true;
  try {
    const host = new URL(endpointBase).hostname.toLowerCase();
    return host === "deepseek.com" || host.endsWith(".deepseek.com");
  } catch {
    return false;
  }
}

function buildDeepSeekThinkingOptions(preference) {
  const normalized = normalizeThinkingPreference(preference);
  if (normalized === "inherit") return {};
  if (normalized === "disabled") return { thinking: { type: "disabled" } };
  return { thinking: { type: "enabled" }, reasoning_effort: normalized };
}

function extractJsonText(rawText) {
  if (typeof rawText !== "string") {
    throw new Error("AI response is not a string.");
  }
  const fenced = rawText.match(/```[ \t]*(?:json|threejson)?[ \t]*(?:\r?\n|$)([\s\S]*?)(?:\r?\n)?[ \t]*```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }

  const unfenced = stripMarkdownCodeFence(rawText);
  if (unfenced !== rawText.trim()) {
    return unfenced;
  }

  const firstBrace = rawText.indexOf("{");
  const lastBrace = rawText.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return rawText.slice(firstBrace, lastBrace + 1).trim();
  }
  return rawText.trim();
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

function completionContentToText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return "";
  }
  return value.map((part) => {
    if (typeof part === "string") {
      return part;
    }
    if (typeof part?.text === "string") {
      return part.text;
    }
    if (typeof part?.text?.value === "string") {
      return part.text.value;
    }
    return "";
  }).join("");
}

function extractChatCompletionChoiceContent(choice) {
  const candidates = [
    choice?.delta?.content,
    typeof choice?.delta === "string" ? choice.delta : undefined,
    choice?.message?.content,
    choice?.text
  ];
  for (const candidate of candidates) {
    const text = completionContentToText(candidate);
    if (text) {
      return text;
    }
  }
  return "";
}

function createChatCompletionPayloadError(payload, prefix = "AI stream failed") {
  const providerError = payload?.error;
  const detail = typeof providerError === "string"
    ? providerError
    : providerError?.message || providerError?.code || "provider returned an error event";
  const error = new Error(`${prefix}: ${detail}`);
  error.providerError = providerError && typeof providerError === "object" ? providerError : payload;
  if (typeof providerError?.code === "string" && providerError.code) {
    error.code = providerError.code;
  }
  return error;
}

function createEmptyChatCompletionError({ finishReason = null, reasoningChars = 0, reasoningTokens = null } = {}) {
  const detail = [
    finishReason ? `finish_reason=${finishReason}` : "",
    reasoningChars > 0 ? `reasoning_chars=${reasoningChars}` : "",
    reasoningTokens !== null ? `reasoning_tokens=${reasoningTokens}` : ""
  ].filter(Boolean).join(", ");
  const suffix = detail ? ` (${detail})` : "";
  let code = "UPSTREAM_EMPTY_COMPLETION";
  let message = `AI provider returned no completion content${suffix}.`;
  if (finishReason === "length" && (reasoningChars > 0 || (reasoningTokens ?? 0) > 0)) {
    code = "UPSTREAM_REASONING_EXHAUSTED";
    message = `AI provider exhausted its output budget during reasoning before producing completion content${suffix}.`;
  } else if (finishReason === "length") {
    code = "UPSTREAM_OUTPUT_LIMIT";
    message = `AI provider reached its output limit before producing completion content${suffix}.`;
  } else if (finishReason === "content_filter") {
    code = "UPSTREAM_CONTENT_FILTERED";
    message = `AI provider filtered the response before producing completion content${suffix}.`;
  } else if (finishReason === "insufficient_system_resource") {
    code = "UPSTREAM_RESOURCE_UNAVAILABLE";
    message = `AI provider stopped because inference resources were unavailable${suffix}.`;
  }
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * Read an OpenAI-compatible streaming response. Besides standard SSE deltas, tolerate two common
 * compatibility behaviours: a final event without a trailing newline, and a provider that ignores
 * `stream: true` and returns one ordinary JSON chat completion instead.
 * @param {ReadableStream<Uint8Array>} body
 * @param {(chunk: string) => void} [onDelta]
 * @param {(metadata:{finishReason:string|null,reasoningChars?:number,reasoningTokens?:number|null})=>void} [onCompletionMetadata]
 * @returns {Promise<string>}
 */
async function readSseChatCompletionStream(body, onDelta, onCompletionMetadata) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawBody = "";
  let content = "";
  let finishReason = null;
  let reasoningChars = 0;
  let reasoningTokens = null;
  let sawSsePayload = false;

  const appendChoice = (json) => {
    if (json?.error) {
      throw createChatCompletionPayloadError(json);
    }
    const choice = json?.choices?.[0];
    if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
    reasoningChars += completionContentToText(
      choice?.delta?.reasoning_content ?? choice?.message?.reasoning_content
    ).length;
    const rawReasoningTokens = json?.usage?.completion_tokens_details?.reasoning_tokens;
    if (typeof rawReasoningTokens === "number" && Number.isFinite(rawReasoningTokens)) {
      reasoningTokens = Math.max(0, rawReasoningTokens);
    }
    const delta = extractChatCompletionChoiceContent(choice);
    if (delta) {
      content += delta;
      if (typeof onDelta === "function") {
        onDelta(delta);
      }
    }
  };

  const processLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }
    sawSsePayload = true;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      return;
    }
    try {
      appendChoice(JSON.parse(payload));
    } catch (error) {
      // Surface explicit provider error events; tolerate only genuinely malformed compatibility
      // chunks so a single bad event does not discard otherwise valid streamed content.
      if (error?.providerError) {
        throw error;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const decoded = decoder.decode(value, { stream: true });
    rawBody += decoded;
    buffer += decoded;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      processLine(line);
    }
  }

  const decoderTail = decoder.decode();
  rawBody += decoderTail;
  buffer += decoderTail;
  if (buffer.trim()) {
    processLine(buffer);
  }

  // A number of nominally OpenAI-compatible endpoints acknowledge `stream: true` but still send
  // `application/json`. Their body is a valid completion, not an empty SSE stream.
  if (!sawSsePayload && !content.trim() && rawBody.trim()) {
    let json;
    try {
      json = JSON.parse(rawBody);
    } catch {
      json = null;
    }
    if (json?.error) {
      throw createChatCompletionPayloadError(json);
    }
    if (json) {
      appendChoice(json);
    }
  }

  if (typeof onCompletionMetadata === "function") {
    onCompletionMetadata({ finishReason, reasoningChars, reasoningTokens });
  }
  if (!content.trim()) {
    throw createEmptyChatCompletionError({ finishReason, reasoningChars, reasoningTokens });
  }
  return content;
}

function createRequestAbortScope(parentSignal, timeoutMs, minimumTimeoutMs = 1000, timeoutCode = "") {
  const controller = new AbortController();
  const boundedTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.max(minimumTimeoutMs, Math.min(300000, Math.round(Number(timeoutMs))))
    : 120000;
  const forwardAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) {
    forwardAbort();
  } else {
    parentSignal?.addEventListener?.("abort", forwardAbort, { once: true });
  }
  const timer = setTimeout(() => {
    const error = new Error(`AI request timed out after ${boundedTimeout}ms.`);
    if (timeoutCode) error.code = timeoutCode;
    controller.abort(error);
  }, boundedTimeout);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.("abort", forwardAbort);
    }
  };
}

/**
 * Normalizes an explicitly configured completion ceiling without inventing one. `undefined`,
 * `null`, an empty string, zero and invalid values all mean "let the provider/gateway decide".
 * This is deliberately separate from prompt-level output estimates, which are advisory and must
 * never become an accidental terminal budget.
 */
function normalizeOptionalMaxTokens(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return Math.max(1, Math.round(numeric));
}

/**
 * Low-level HTTP: call an OpenAI-compatible chat/completions endpoint and parse its assistant content.
 * @param {object} params
 * @param {string} [params.provider='chatgpt']
 * @param {string} params.apiKey
 * @param {Array<{role:string,content:string|Array}>} params.messages
 * @param {string} [params.model]
 * @param {number} [params.temperature=0.2]
 * @param {number} [params.maxTokens] Optional caller/provider output ceiling. When omitted,
 * `max_tokens` is not sent and the provider (or an upstream gateway) owns the limit.
 * @param {string} [params.baseUrl] Override default apiBase
 * @param {RequestCredentials} [params.credentials] Optional browser credential policy. Hosts that
 * use cookie-authenticated gateways may opt into `include`; direct provider calls keep the fetch
 * default when this is omitted.
 * @param {string} [params.userId] Anonymous application user identifier. Sent only to providers
 * whose documented API supports an isolation field (currently DeepSeek's `user_id`).
 * @param {object} [params.providerAdapter] Optional host-owned OpenAI-compatible transport
 * adapter. It may define `apiBase`, `endpoint`, `defaultModel`, `transformRequestBody`,
 * `handleResponse`, and `classifyError`. This is the extension boundary for gateways and product
 * protocols that must not become engine dependencies.
 * @param {*} [params.requestContext] Opaque context forwarded only to `providerAdapter` hooks.
 * @param {"inherit"|"disabled"|"high"|"max"} [params.thinkingPreference="disabled"]
 * DeepSeek thinking policy. Other providers do not receive these vendor-specific fields.
 */
async function requestChatCompletion({
  provider = "chatgpt",
  apiKey,
  messages,
  model,
  temperature = 0.2,
  maxTokens,
  baseUrl,
  stream = false,
  signal,
  requestTimeoutMs,
  turnDeadlineAt,
  onDelta,
  onCompletionMetadata,
  extraHeaders,
  credentials,
  providerAdapter,
  requestContext,
  userId,
  thinkingPreference = "disabled",
  taskKind = ""
}) {
  const resolvedProvider = resolveProviderConfig(provider, providerAdapter);
  const normalizedProvider = resolvedProvider.provider;
  const providerConfig = resolvedProvider.config;
  const adapter = resolvedProvider.adapter;
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
    error.isAiTransportError = true;
    throw error;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be a non-empty array.");
  }
  const normalizedMaxTokens = normalizeOptionalMaxTokens(maxTokens);

  const endpointBase = (baseUrl || providerConfig.apiBase || "").replace(/\/$/, "");
  if (!endpointBase) {
    throw new Error(
      `Provider "${normalizedProvider}" requires options.baseUrl or providerAdapter.apiBase ` +
      "(OpenAI-compatible API root URL, e.g. https://api.openai.com/v1)."
    );
  }
  const url = `${endpointBase}${providerConfig.endpoint}`;
  const normalizedUserId = String(userId || "").trim();
  if (normalizedUserId && !/^[a-zA-Z0-9_-]{1,512}$/.test(normalizedUserId)) {
    throw new Error("userId must contain only letters, digits, hyphens, or underscores (maximum 512 characters).");
  }
  const thinkingOptions = isOfficialDeepSeekEndpoint(normalizedProvider, endpointBase)
    ? buildDeepSeekThinkingOptions(thinkingPreference)
    : {};
  const numericDeadline = Number(turnDeadlineAt);
  let effectiveRequestTimeoutMs = requestTimeoutMs;
  let minimumRequestTimeoutMs = 1000;
  let requestTimeoutCode = "";
  if (Number.isFinite(numericDeadline) && numericDeadline > 0) {
    const remainingTurnMs = Math.floor(numericDeadline - Date.now());
    if (remainingTurnMs <= 0) {
      const error = new Error("AI scene turn exceeded its total time limit.");
      error.code = "AI_TURN_TIMEOUT";
      throw error;
    }
    const ordinaryRequestTimeout = Number.isFinite(Number(requestTimeoutMs)) && Number(requestTimeoutMs) > 0
      ? Number(requestTimeoutMs)
      : 120000;
    effectiveRequestTimeoutMs = Math.min(ordinaryRequestTimeout, remainingTurnMs);
    minimumRequestTimeoutMs = 1;
    if (remainingTurnMs <= ordinaryRequestTimeout) {
      requestTimeoutCode = "AI_TURN_TIMEOUT";
    }
  }
  const abortScope = createRequestAbortScope(
    signal,
    effectiveRequestTimeoutMs,
    minimumRequestTimeoutMs,
    requestTimeoutCode
  );
  try {
    const baseRequestBody = {
      model: model || providerConfig.defaultModel,
      temperature,
      ...(normalizedMaxTokens !== undefined
        ? { max_tokens: normalizedMaxTokens }
        : {}),
      messages,
      stream: stream === true,
      ...thinkingOptions,
      ...(normalizedProvider === "deepseek" && normalizedUserId ? { user_id: normalizedUserId } : {})
    };
    const transformedRequestBody = typeof adapter?.transformRequestBody === "function"
      ? await adapter.transformRequestBody(baseRequestBody, {
          requestContext,
          provider: normalizedProvider,
          endpointBase,
          thinkingPreference,
          taskKind
        })
      : baseRequestBody;
    if (!isObject(transformedRequestBody)) {
      throw new Error("providerAdapter.transformRequestBody must return a request body object.");
    }
    const response = await fetch(url, {
      method: "POST",
      ...(credentials ? { credentials } : {}),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${normalizedApiKey}`,
        ...extraHeaders
      },
      signal: abortScope.signal,
      body: JSON.stringify(transformedRequestBody)
    });
    if (typeof adapter?.handleResponse === "function") {
      await adapter.handleResponse(response, {
        requestContext,
        provider: normalizedProvider,
        endpointBase,
        thinkingPreference,
        taskKind
      });
    }

    if (!response.ok) {
      const detail = await response.text();
      let parsedPayload = null;
      try {
        const parsed = JSON.parse(detail);
        parsedPayload = parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        /* not JSON, ignore */
      }
      const classification = typeof adapter?.classifyError === "function"
        ? await adapter.classifyError({
            response,
            detail,
            payload: parsedPayload,
            requestContext,
            provider: normalizedProvider
          })
        : null;
      const error = new Error(
        String(classification?.message || `AI request failed (${response.status}): ${detail}`)
      );
      error.httpStatus = response.status;
      error.isAiTransportError = true;
      error.providerError = classification?.providerError ?? parsedPayload;
      if (classification?.code) {
        error.code = String(classification.code);
      }
      throw error;
    }

    if (stream === true && response.body) {
      const content = await readSseChatCompletionStream(response.body, onDelta, onCompletionMetadata);
      return content;
    }

    const data = await response.json();
    if (data?.error) {
      throw createChatCompletionPayloadError(data, "AI request failed");
    }
    const content = extractChatCompletionChoiceContent(data?.choices?.[0]);
    if (!content.trim()) {
      const choice = data?.choices?.[0];
      const reasoningChars = completionContentToText(choice?.message?.reasoning_content).length;
      const rawReasoningTokens = data?.usage?.completion_tokens_details?.reasoning_tokens;
      throw createEmptyChatCompletionError({
        finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
        reasoningChars,
        reasoningTokens: typeof rawReasoningTokens === "number" && Number.isFinite(rawReasoningTokens)
          ? Math.max(0, rawReasoningTokens)
          : null
      });
    }
    if (typeof onCompletionMetadata === "function") {
      onCompletionMetadata({ finishReason: data?.choices?.[0]?.finish_reason || null });
    }
    return content;
  } finally {
    abortScope.cleanup();
  }
}

/**
 * Strip streaming / UI-only fields before passing options to nested LLM calls. Keep the caller's
 * AbortSignal and shared turn deadline: outline/review/refinement requests are part of the same
 * user turn and must stop immediately when that turn is cancelled.
 * @param {object} options
 */
function stripChatTransportOptions(options = {}) {
  const next = { ...options };
  delete next.stream;
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
  delete next.onSceneDraft;
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

function isSceneOutputCutoff(content, completionMetadata, options) {
  if (!isLikelyTruncatedJsonText(content)) {
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

function shouldRetryCompactSceneOutput(content, completionMetadata, options) {
  return options.compactRetryOnTruncation !== false &&
    isSceneOutputCutoff(content, completionMetadata, options);
}

function createSceneOutputLimitError(message) {
  const error = new Error(message);
  error.code = "SCENE_OUTPUT_LIMIT";
  return error;
}

function buildCompactSceneRetryMessage(prompt, referenceMaterial = "", options = {}) {
  const incrementalDraft = options.incrementalDraft === true;
  return [
    buildGenerateUserMessage(prompt, "", options),
    referenceMaterial,
    incrementalDraft
      ? "COMPACT STRUCTURAL-DRAFT REGENERATION REQUIREMENT:"
      : "COMPACT FULL-REGENERATION REQUIREMENT:",
    incrementalDraft
      ? "The previous structural-draft attempt exceeded the provider output limit. Generate a fresh, complete, valid structural draft from the beginning; do not continue, quote, or repair the previous fragment. This is still an incremental draft, not the final detailed scene."
      : "The previous one-response attempt exceeded the provider output limit. Generate the complete scene again from the beginning; do not continue, quote, or repair the previous fragment.",
    incrementalDraft
      ? "Keep only the primary visual anchors; defer every secondary prop and decoration to later incremental command rounds. Prefer compact JSON formatting and close every array/object before adding optional content. Do not invent an arbitrary token or object-count quota."
      : "Preserve the visual story, but reduce explicit JSON size aggressively: use instancedList/transforms for repeated objects, use a bounded varied sample for words such as many, reuse materials and simple assemblies, omit optional details, and close every array/object in this response.",
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
      taskKind: options.taskKind || "scene_generate",
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

  throw createSceneOutputLimitError(
    `Scene JSON was not completed after ${maxSegments} response segments. Try a provider/model with a larger context window or raise maxSceneSegments.`
  );
}

function addSegmentedProtocolToMessages(messages, estimatedSegments) {
  let foundSystem = false;
  const withProtocol = messages.map((message) => {
    if (!foundSystem && message?.role === "system") {
      foundSystem = true;
      return {
        ...message,
        content: [message.content, buildSegmentedSceneProtocolPrompt(estimatedSegments)].join("\n\n")
      };
    }
    return { ...message };
  });
  if (!foundSystem) {
    withProtocol.unshift({ role: "system", content: buildSegmentedSceneProtocolPrompt(estimatedSegments) });
  }
  return withProtocol;
}

/** Runs a JSON-producing completion without an engine-owned ceiling. If an explicit provider or
 * gateway ceiling still cuts the JSON, restart under the exact-fragment continuation protocol.
 * Used by image generation and full/Patch adjustment paths; command output has its own adaptive
 * commands -> Patch -> full fallback chain. */
async function requestJsonCompletionWithSegmentedRecovery(messages, options = {}, taskKind = "scene_json") {
  const maxTokens = normalizeOptionalMaxTokens(options.maxTokens);
  let completionMetadata = { finishReason: null };
  const content = await requestChatCompletion({
    ...options,
    maxTokens,
    taskKind,
    messages,
    onCompletionMetadata: (metadata) => {
      completionMetadata = { ...completionMetadata, ...metadata };
      if (typeof options.onCompletionMetadata === "function") {
        options.onCompletionMetadata(metadata);
      }
    }
  });
  if (!isSceneOutputCutoff(content, completionMetadata, options)) {
    return content;
  }
  if (options.compactRetryOnTruncation === false) {
    throw createSceneOutputLimitError(
      "JSON output reached the provider limit before the document was complete."
    );
  }
  await emitSceneGenerationPhase(options, {
    phase: "segmented-recovery",
    reason: "provider-output-limit"
  });
  const estimatedSegments = Math.max(
    2,
    clampInteger(options.estimatedSegments, 2, 1, DEFAULT_MAX_SCENE_SEGMENTS)
  );
  return requestSegmentedSceneJsonContent(
    addSegmentedProtocolToMessages(messages, estimatedSegments),
    { ...options, taskKind, estimatedSegments },
    maxTokens
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

const WEBGPU_AI_CAPABILITY_IDS = new Set(["webgpuTsl", "tslCode", "webgpuParticles"]);
const PARTICLE_AI_CAPABILITY_IDS = new Set([
  "particles",
  "particleEmitter",
  "particleRaster",
  "webgpuParticles",
  "weather",
  "weatherDomain"
]);

function readSceneRendererBackend(scene) {
  const runtimeRendererRecord = Array.isArray(scene?.objectList)
    ? [...scene.objectList].reverse().find(
      (record) => String(record?.objType || "").trim().toLowerCase() === "renderer"
    )
    : null;
  const backend = String(
    scene?.sceneConfig?.renderer?.backend
      || runtimeRendererRecord?.backend
      || scene?.renderer?.backend
      || ""
  ).trim().toLowerCase();
  return backend === "webgpu" || backend === "webgl" ? backend : "";
}

/** Resolve a concrete prompt/runtime snapshot from explicit negotiation plus hard requirements
 * named in the user request. WebGPU is chosen automatically only when its optional entry is
 * actually registered; otherwise the prompt remains honest about the WebGL-only host. */
function resolveAiCapabilityOptions(prompt, options = {}, currentScene = null) {
  const promptSelectedCapabilityIds = mergeRequiredCapabilityIds(prompt, options.selectedCapabilityIds);
  const selected = new Set(promptSelectedCapabilityIds || []);
  if (currentScene && typeof currentScene === "object") {
    const usage = analyzeSceneUsage(currentScene).objTypes;
    if (usage.has("particleEmitter")) selected.add("particles");
    if (usage.has("particleSource:raster")) selected.add("particleRaster");
    if (usage.has("particleBackend:webgpu-compute")) selected.add("webgpuParticles");
    if (usage.has("material:tsl")) selected.add("webgpuTsl");
    if (usage.has("tslKind:code")) selected.add("tslCode");
  }
  const selectedCapabilityIds = selected.size > 0
    ? [...selected]
    : promptSelectedCapabilityIds;
  const explicitBackend = String(options.rendererBackend || "").trim().toLowerCase();
  const currentBackend = readSceneRendererBackend(currentScene);
  const wantsWebgpu = Array.isArray(selectedCapabilityIds)
    && selectedCapabilityIds.some((id) => WEBGPU_AI_CAPABILITY_IDS.has(id));
  const webgpuAvailable = isSceneCapabilityAvailable("rendererBackends", "webgpu");
  const rendererBackend = explicitBackend === "webgpu" || explicitBackend === "webgl"
    ? explicitBackend
    : currentBackend || (wantsWebgpu && webgpuAvailable ? "webgpu" : "webgl");
  return {
    ...options,
    rendererBackend,
    includePreviewCapabilities:
      options.includePreviewCapabilities === true || rendererBackend === "webgpu",
    selectedCapabilityIds
  };
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
      ...(normalizeOptionalMaxTokens(options.outlineMaxTokens) !== undefined
        ? { maxTokens: normalizeOptionalMaxTokens(options.outlineMaxTokens) }
        : {}),
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
    // This is a second, un-streamed LLM round trip after the draft already shown via
    // `onSceneDraft` above — it can take as long as (or longer than) the original generation, so
    // hosts need a phase event here or the UI just sits on a stale "generating…" status with no
    // visible activity for minutes (see the `capability-review` phase handling in host apps).
    await emitSceneGenerationPhase(options, { phase: "capability-review", attempt, gaps: fit.gaps });
    const fixPrompt = buildCapabilityFixPrompt(prompt, fit);
    try {
      current = await requestUpdatedSceneJsonString(fixPrompt, current, {
        ...stripChatTransportOptions(options),
        ...(normalizeOptionalMaxTokens(options.capabilityReviewMaxTokens ?? options.maxTokens) !== undefined
          ? { maxTokens: normalizeOptionalMaxTokens(options.capabilityReviewMaxTokens ?? options.maxTokens) }
          : {})
      });
    } catch (error) {
      // This review pass only ever *improves* capability usage on top of an already-valid,
      // already-rendered draft — it must never be able to turn a good draft into a reported
      // generation failure. Respect an explicit user-initiated stop; swallow anything else
      // (timeout, transient network/provider error, malformed fix response) and keep the last
      // known-good scene instead of discarding it.
      if (options.signal?.aborted) {
        throw error;
      }
      break;
    }
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
 * @param {boolean} [options.compactRetryOnTruncation=true] Recover a genuine one-shot cutoff by
 *   restarting under the compact segmented-continuation protocol
 * @returns {Promise<string>}
 */
async function generateSceneJsonString(prompt, options = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error("prompt is required.");
  }

  const trimmedPrompt = String(prompt).trim();
  const capabilityOptions = resolveAiCapabilityOptions(trimmedPrompt, options);
  const particleEffects = Array.isArray(capabilityOptions.selectedCapabilityIds)
    ? capabilityOptions.selectedCapabilityIds.some((id) => PARTICLE_AI_CAPABILITY_IDS.has(id))
    : shouldAllowParticleEffects(trimmedPrompt);
  const effectivePrompt = await resolveEffectiveGeneratePrompt(trimmedPrompt, capabilityOptions);
  const maxTokens = normalizeOptionalMaxTokens(capabilityOptions.maxTokens);
  const referenceMaterial = await resolveReferenceMaterialForPrompt(effectivePrompt, capabilityOptions);

  const estimatedSegments = clampInteger(capabilityOptions.estimatedSegments, 1, 1, DEFAULT_MAX_SCENE_SEGMENTS);
  const segmentedOutput = shouldUseSegmentedSceneOutput(capabilityOptions, estimatedSegments);
  const systemPrompt = buildSceneGenerationSystemPrompt({ ...capabilityOptions, particleEffects });
  const messages = [
    {
      role: "system",
      content: segmentedOutput
        ? [systemPrompt, buildSegmentedSceneProtocolPrompt(estimatedSegments)].join("\n\n")
        : systemPrompt
    },
    {
      role: "user",
      content: [buildGenerateUserMessage(effectivePrompt, "", capabilityOptions), referenceMaterial].filter(Boolean).join("\n\n")
    }
  ];
  let content;
  if (segmentedOutput) {
    content = await requestSegmentedSceneJsonContent(messages, capabilityOptions, maxTokens);
  } else {
    let completionMetadata = { finishReason: null };
    content = await requestChatCompletion({
      ...capabilityOptions,
      maxTokens,
      taskKind: capabilityOptions.taskKind || "scene_generate",
      messages,
      onCompletionMetadata: (metadata) => {
        completionMetadata = { ...completionMetadata, ...metadata };
        if (typeof capabilityOptions.onCompletionMetadata === "function") {
          capabilityOptions.onCompletionMetadata(metadata);
        }
      }
    });
    if (
      capabilityOptions.compactRetryOnTruncation === false &&
      isSceneOutputCutoff(content, completionMetadata, capabilityOptions)
    ) {
      throw createSceneOutputLimitError(
        "Scene JSON exceeded the provider output limit. Switch to planned incremental construction."
      );
    }
    if (shouldRetryCompactSceneOutput(content, completionMetadata, capabilityOptions)) {
      await emitSceneGenerationPhase(capabilityOptions, {
        phase: "segmented-recovery",
        reason: "provider-output-limit"
      });
      // A genuine finish_reason=length is a transport boundary, not proof that the requested
      // scene is impossible. Restart once under the explicit continuation protocol, then keep
      // requesting exact subsequent JSON fragments until the document closes. This also covers
      // gateways that enforce their own per-request ceiling while core/ai leaves maxTokens unset.
      const recoveryEstimatedSegments = Math.max(2, estimatedSegments);
      content = await requestSegmentedSceneJsonContent(
        [
          {
            role: "system",
            content: [systemPrompt, buildSegmentedSceneProtocolPrompt(recoveryEstimatedSegments)].join("\n\n")
          },
          {
            role: "user",
            content: buildCompactSceneRetryMessage(effectivePrompt, referenceMaterial, capabilityOptions)
          }
        ],
        { ...capabilityOptions, estimatedSegments: recoveryEstimatedSegments },
        maxTokens
      );
    }
  }

  // Network/token generation has finished. Let browser hosts paint a parsing/rendering status
  // before the synchronous JSON normalization below; non-UI callers pay no extra delay.
  await emitSceneGenerationPhase(capabilityOptions, {
    phase: "processing",
    segmentedOutput,
    estimatedSegments
  });

  let jsonText = extractJsonText(content);
  let sceneJsonString = projectSceneDraftJsonString(jsonText, "standard", capabilityOptions);
  if (capabilityOptions.allowInvalidSceneDraft === true) {
    try {
      parseSceneJsonString(sceneJsonString);
    } catch (_error) {
      return sceneJsonString;
    }
  }
  if (typeof capabilityOptions.onSceneDraft === "function") {
    try {
      // Start host-side preview work without delaying the final post-processing path. Hosts may
      // render this validated draft immediately and replace it with the reviewed final JSON later.
      void Promise.resolve(capabilityOptions.onSceneDraft(sceneJsonString)).catch(() => {});
    } catch {
      /* A preview must never make generation fail. */
    }
  }
  sceneJsonString = await maybeApplyCapabilityReview(trimmedPrompt, sceneJsonString, {
    ...capabilityOptions,
    maxTokens
  });
  return projectSceneJsonString(sceneJsonString, capabilityOptions.outputFormat, capabilityOptions);
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
  const capabilityOptions = resolveAiCapabilityOptions(trimmedPrompt, chatOptions);

  const effectivePrompt = await resolveEffectiveGeneratePrompt(trimmedPrompt, capabilityOptions);
  const maxTokens = normalizeOptionalMaxTokens(capabilityOptions.maxTokens);
  const referenceMaterial = await resolveReferenceMaterialForPrompt(effectivePrompt, capabilityOptions);

  const content = await requestJsonCompletionWithSegmentedRecovery(
    [
      {
        role: "system",
        content: buildSceneImageGenerationSystemPrompt(capabilityOptions)
      },
      {
        role: "user",
        content: [
          { type: "text", text: [buildGenerateUserMessage(effectivePrompt, "", capabilityOptions), referenceMaterial].filter(Boolean).join("\n\n") },
          {
            type: "image_url",
            image_url: {
              url: imageUrlForApi,
              detail
            }
          }
        ]
      }
    ],
    { ...capabilityOptions, imageDetail: detail, maxTokens },
    capabilityOptions.taskKind || "scene_generate_image"
  );

  let jsonText = extractJsonText(content);
  let sceneJsonString = projectSceneJsonString(jsonText, "standard");
  sceneJsonString = await maybeApplyCapabilityReview(trimmedPrompt, sceneJsonString, {
    ...capabilityOptions,
    maxTokens
  });
  return projectSceneJsonString(sceneJsonString, capabilityOptions.outputFormat, capabilityOptions);
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
  const capabilityOptions = resolveAiCapabilityOptions(prompt, options, currentSceneObj);
  const chatOpts = stripChatTransportOptions(capabilityOptions);
  const referenceMaterial = await resolveReferenceMaterialForPrompt(prompt, capabilityOptions);

  if (updateMode === "incremental") {
    const currentScenePrettyJson = prettyJson(currentSceneObj);
    const content = await requestJsonCompletionWithSegmentedRecovery(
      [
        {
          role: "system",
          content: buildSceneIncrementalUpdateSystemPrompt(capabilityOptions)
        },
        {
          role: "user",
          content: [
            `Modification request:\n${String(prompt).trim()}`,
            referenceMaterial,
            `Current scene JSON:\n${currentScenePrettyJson}`
          ].filter(Boolean).join("\n\n")
        }
      ],
      { ...capabilityOptions, ...chatOpts },
      capabilityOptions.taskKind || "scene_adjust_patch"
    );
    const patch = extractPatchOperations(content);
    const applied = applySceneJsonPatch(currentSceneObj, patch);
    if (!applied.ok) {
      throw new Error(`incremental patch failed: ${applied.error}`);
    }
    const sceneJsonString = prettyJson(
      projectSceneOutputObject(applied.scene, capabilityOptions.outputFormat, capabilityOptions)
    );
    return includePatch ? { sceneJsonString, patch } : sceneJsonString;
  }

  const currentScenePrettyJson = prettyJson(currentSceneObj);
  const content = await requestJsonCompletionWithSegmentedRecovery(
    [
      {
        role: "system",
        content: buildSceneUpdateSystemPrompt(capabilityOptions)
      },
      {
        role: "user",
        content: [
          `Modification request:\n${String(prompt).trim()}`,
          referenceMaterial,
          `Current scene JSON:\n${currentScenePrettyJson}`
        ].filter(Boolean).join("\n\n")
      }
    ],
    { ...capabilityOptions, ...chatOpts },
    capabilityOptions.taskKind || "scene_adjust_json"
  );

  const updatedJsonText = extractJsonText(content);
  const sceneJsonString = projectSceneDraftJsonString(
    updatedJsonText,
    capabilityOptions.outputFormat,
    capabilityOptions
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
 * Best-effort: interpret `rawContent` as an RFC 6902 JSON Patch against `currentSceneJsonString`
 * and apply it locally (no extra LLM round trip). Returns `null` (not a throw) whenever the
 * content isn't a patch or doesn't apply cleanly, so callers can fall through to their next
 * fallback (e.g. a full-JSON regeneration call) without special-casing "not a patch" as an error.
 * This is the second-cheapest output the commands-preferring update pipeline accepts — after
 * commands, before a full scene JSON rewrite — see requestUpdatedSceneEditCommands's call sites.
 * @param {string} rawContent
 * @param {string} currentSceneJsonString
 * @param {object} options
 * @returns {{outputMode:"patch", patch: object[], sceneJsonString: string, rawContent: string}|null}
 */
function tryApplyContentAsPatch(rawContent, currentSceneJsonString, options) {
  if (!currentSceneJsonString) {
    return null;
  }
  let patch;
  try {
    patch = extractPatchOperations(rawContent);
  } catch (_error) {
    return null;
  }
  if (!isRfc6902PatchList(patch)) {
    return null;
  }
  let currentSceneObj;
  try {
    currentSceneObj = parseSceneJsonString(currentSceneJsonString);
  } catch (_error) {
    return null;
  }
  const applied = applySceneJsonPatch(currentSceneObj, patch);
  if (!applied.ok) {
    return null;
  }
  const sceneJsonString = prettyJson(
    projectSceneOutputObject(applied.scene, options?.outputFormat, options)
  );
  return { outputMode: "patch", patch, sceneJsonString, rawContent: String(rawContent || "") };
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
  let currentSceneForCapabilities = null;
  if (currentSceneJsonString) {
    try {
      currentSceneForCapabilities = parseSceneJsonString(currentSceneJsonString);
    } catch {
      // Command mode can operate from a spatial summary without a parseable full document. In
      // that case use the negotiated/prompt capability selection alone.
    }
  }
  options = resolveAiCapabilityOptions(prompt, options, currentSceneForCapabilities);

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
  // iterative rounds always get that prompt regardless of the caller's `outputMode` (a host's
  // command-preferred setting need not become literal outputMode:"auto"), so gating JSON detection
  // branch on `outputMode === "auto"` alone let the model follow its own prompt's advice and
  // return valid scene JSON, only to have it rejected as "not a valid command script" with no
  // fallback (agent calls always pass fallbackToJson:false) — the whole agent turn then failed
  // after burning through every repair round on responses that were never actually invalid.
  const allowAutoOutputKind = outputMode === "auto" || agentRound || iterativeApply;
  const systemPrompt = allowAutoOutputKind
      ? buildSceneCommandAutoUpdateSystemPrompt({
        agentRound: agentRound || iterativeApply,
        iterativeApply,
        animationCapabilities: options.animationCapabilities,
        selectedCapabilityIds: options.selectedCapabilityIds,
        rendererBackend: options.rendererBackend,
        includePreviewCapabilities: options.includePreviewCapabilities
      })
    : buildSceneCommandUpdateSystemPrompt({
        animationCapabilities: options.animationCapabilities,
        selectedCapabilityIds: options.selectedCapabilityIds,
        rendererBackend: options.rendererBackend,
        includePreviewCapabilities: options.includePreviewCapabilities
      });

  let finishReason = null;
  const externalCompletionMetadata = options.onCompletionMetadata;
  const content = await requestChatCompletion({
    ...options,
    ...stripChatTransportOptions(options),
    taskKind: options.taskKind || "scene_adjust_commands",
    onCompletionMetadata: (metadata) => {
      finishReason = metadata?.finishReason || null;
      externalCompletionMetadata?.(metadata);
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent }
    ]
  });

  // Iterative callers need to observe the model's explicit completion signal. Previously this
  // comment-only response fell into command parsing, was rejected as "no commands", and the outer
  // loop retried until its entire budget was exhausted even though the model had already finished.
  if ((agentRound || iterativeApply) && commandScriptIndicatesDone(content)) {
    const doneScript = extractCommandScriptText(content);
    const doneCommands = isLikelyCommandScriptText(doneScript)
      ? filterCoreUpdateCommands(parseCommandScript(doneScript))
      : [];
    if (doneCommands.length === 0) {
      return {
        outputMode: "commands",
        commandScript: doneScript,
        commands: [],
        rawContent: String(content || ""),
        finishReason
      };
    }
  }

  const fallbackToJson = options.fallbackToJson !== false;
  const tryJsonFallback = async (reason) => {
    // Before paying for an entirely fresh full-JSON regeneration call, check whether the model's
    // existing response is actually a small RFC 6902 JSON Patch against the current scene — a
    // second, cheaper-than-full-JSON incremental output the model is allowed to use (see
    // buildSceneCommandAutoUpdateSystemPrompt's "auto" prompt). Applying it locally (no extra LLM
    // round trip) keeps the whole point of the commands-first pipeline intact: never ask the model
    // to re-emit the entire scene when a small patch would do.
    const patchAttempt = tryApplyContentAsPatch(content, currentSceneJsonString, options);
    if (patchAttempt) {
      return patchAttempt;
    }
    if (!fallbackToJson || !currentSceneJsonString) {
      if (isLengthFinishReason(finishReason)) {
        throw createSceneOutputLimitError(
          "AI command response exceeded the provider output limit."
        );
      }
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
      rawContent: content,
      finishReason
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
  options = resolveAiCapabilityOptions(userPrompt, options, currentSceneObj);
  const currentScenePrettyJson = prettyJson(currentSceneObj);
  const feedback = String(options.feedback || "").trim();
  const allowCommands = options.allowCommands !== false;
  const particleEffects = shouldAllowParticleEffects(userPrompt);
  const systemPrompt = [
    buildSceneCommandAutoUpdateSystemPrompt({
      agentRound: true,
      iterativeApply: true,
      animationCapabilities: options.animationCapabilities,
      selectedCapabilityIds: options.selectedCapabilityIds,
      rendererBackend: options.rendererBackend,
      includePreviewCapabilities: options.includePreviewCapabilities
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
    taskKind: options.taskKind || "scene_refine",
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
  maybeApplyCapabilityReview
};
