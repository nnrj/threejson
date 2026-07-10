/**
 * Multi-turn chat-session orchestration helpers for scene-generation chat UIs.
 *
 * This module is purely additive: it does not modify any existing `core/ai` export or behavior.
 * It layers three new capabilities on top of the existing single-shot generate/update endpoints
 * in `sceneAiService.js`, using only already-public extension points (`requestChatCompletion`'s
 * free-form `messages` array, and the `context.userMessage` override accepted by
 * `requestUpdatedSceneEditCommands`):
 *
 * 1. `classifyTurnIntent` — a lightweight, separate chat call that asks the model to decide
 *    whether the user's next message is a brand-new generation request or an adjustment of a
 *    prior turn (and, if so, which one), given only a compact turn-summary history (no full JSON).
 * 2. `summarizeSceneTurn` — a lightweight, separate chat call that produces a short prose recap of
 *    a completed turn, for storage in a chat app's local session cache (again no full JSON, to
 *    keep token cost low).
 * 3. `buildStructuredTurnEnvelope` — a pure (no network) helper that assembles the classification
 *    result + resolved context (spatial summary or full JSON, caller's choice) + the user's raw
 *    prompt into one structured JSON-formatted string, meant to be handed to the existing
 *    generate/update entry points as `prompt` / `context.userMessage`.
 */
import { requestChatCompletion, extractJsonText } from "./sceneAiService.js";
import { sanitizeAiJsonText } from "./sceneJsonSanitize.js";

const DEFAULT_CLASSIFY_MAX_TOKENS = 300;
const DEFAULT_SUMMARIZE_MAX_TOKENS = 400;

/** Keep only chat-completion transport options (avoid leaking unrelated caller options into the HTTP body). */
function pickChatCompletionOptions(source, fallbackMaxTokens) {
  const keys = ["provider", "apiKey", "model", "baseUrl", "temperature", "signal"];
  const out = {};
  for (const k of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, k)) {
      out[k] = source[k];
    }
  }
  out.maxTokens = Number.isFinite(Number(source?.maxTokens)) ? Number(source.maxTokens) : fallbackMaxTokens;
  return out;
}

function normalizeHistoryEntries(history) {
  const list = Array.isArray(history) ? history : [];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i];
    const turnId = typeof entry?.turnId === "string" ? entry.turnId.trim() : "";
    if (!turnId) {
      continue;
    }
    out.push({ turnId, summary: typeof entry?.summary === "string" ? entry.summary : "" });
  }
  return out;
}

function buildClassifyIntentSystemPrompt() {
  return [
    "You are an intent router for a 3D-scene generation chat app.",
    "Given the user's newest message and a list of prior conversation turns (each with a short summary), decide:",
    "- \"generate\": the user wants a brand-new scene, unrelated to (or not clearly continuing) any prior turn.",
    "- \"adjust\": the user wants to modify the scene produced by a specific prior turn.",
    "",
    "Output shape (strict):",
    '{ "intent": "generate"|"adjust", "targetTurnId": string|null, "note": string }',
    "",
    "Rules:",
    '- "targetTurnId" MUST be one of the provided turn ids, or null. Never invent an id.',
    '- If intent is "generate", "targetTurnId" MUST be null.',
    '- If intent is "adjust" but you cannot tell which prior turn is meant, still pick the single most recent turn as targetTurnId (most conversations continue the latest result) and explain the ambiguity in "note".',
    '- "note" is one short sentence explaining your choice.',
    "",
    "Output requirement:",
    "Return ONLY one JSON object. No Markdown fences. No commentary before or after."
  ].join("\n");
}

function buildClassifyIntentUserMessage(userPrompt, historyEntries) {
  const historyBlock = historyEntries.length
    ? historyEntries
        .map((entry, index) => `${index + 1}. turnId=${entry.turnId} :: ${entry.summary || "(no summary)"}`)
        .join("\n")
    : "(no prior turns)";
  return [`User's newest message:\n${String(userPrompt || "").trim()}`, "", "Prior turns:", historyBlock].join("\n");
}

/**
 * Classify whether the user's next chat message is a new-scene request or an adjustment of a
 * specific prior turn. Safe-by-default: any network/parse/validation failure resolves to
 * `{ intent: "generate", targetTurnId: null }` rather than throwing, since guessing wrong toward
 * "generate" is the least destructive failure mode for a caller (it never silently overwrites the
 * wrong prior scene).
 *
 * @param {{ userPrompt: string, history?: Array<{turnId: string, summary: string}> }} input
 * @param {object} [options] requestChatCompletion transport options (provider/apiKey/model/baseUrl/...)
 * @returns {Promise<{ intent: "generate"|"adjust", targetTurnId: string|null, note: string }>}
 */
async function classifyTurnIntent(input = {}, options = {}) {
  const userPrompt = String(input?.userPrompt || "").trim();
  const historyEntries = normalizeHistoryEntries(input?.history);
  const fallback = { intent: "generate", targetTurnId: null, note: "" };

  if (!historyEntries.length) {
    return { ...fallback, note: "no prior turns; nothing to adjust" };
  }

  try {
    const content = await requestChatCompletion({
      ...pickChatCompletionOptions(options, DEFAULT_CLASSIFY_MAX_TOKENS),
      messages: [
        { role: "system", content: buildClassifyIntentSystemPrompt() },
        { role: "user", content: buildClassifyIntentUserMessage(userPrompt, historyEntries) }
      ]
    });
    const jsonText = extractJsonText(content);
    const parsed = JSON.parse(sanitizeAiJsonText(jsonText));
    const intent = parsed?.intent === "adjust" ? "adjust" : parsed?.intent === "generate" ? "generate" : null;
    if (!intent) {
      return { ...fallback, note: "fallback: model returned an unrecognized intent" };
    }
    const validIds = new Set(historyEntries.map((entry) => entry.turnId));
    const rawTargetId = typeof parsed?.targetTurnId === "string" ? parsed.targetTurnId.trim() : "";
    const targetTurnId = intent === "adjust" && validIds.has(rawTargetId) ? rawTargetId : null;
    const note = typeof parsed?.note === "string" ? parsed.note.slice(0, 300) : "";
    if (intent === "adjust" && !targetTurnId) {
      return { ...fallback, note: "fallback: model chose adjust but named an unknown targetTurnId" };
    }
    return { intent, targetTurnId, note };
  } catch (error) {
    return { ...fallback, note: `fallback: classification failed (${error?.message || error})` };
  }
}

function buildSummarizeTurnSystemPrompt() {
  return [
    "You write short, factual recaps of a single turn in a 3D-scene generation chat, for storage in the app's local session history.",
    "Write 2-4 sentences in plain prose (no Markdown, no JSON), covering:",
    "- What the user asked for in this turn.",
    "- What the assistant produced (in general terms — object types/counts/layout, not raw JSON).",
    "- If this turn adjusted a prior turn, name which prior turn id it adjusted and what changed.",
    "Do not restate the full scene JSON. Do not add commentary outside the recap."
  ].join("\n");
}

function buildSummarizeTurnUserMessage({ userPrompt, mode, targetTurnId, turnId, resultDigest }) {
  const lines = [
    `Turn id: ${turnId || "(unknown)"}`,
    `Mode: ${mode === "adjust" ? "adjustment" : "new generation"}`
  ];
  if (mode === "adjust" && targetTurnId) {
    lines.push(`Adjusted prior turn id: ${targetTurnId}`);
  }
  lines.push(`User request:\n${String(userPrompt || "").trim()}`);
  lines.push(`Result digest (for your reference, not to be echoed verbatim):\n${String(resultDigest || "").trim() || "(none)"}`);
  return lines.join("\n\n");
}

/**
 * Produce a short prose recap of a completed generate/adjust turn, for a chat app's session cache.
 * Deliberately never sends/receives full scene JSON (token cost) — callers should pass a compact
 * `resultDigest` string (e.g. object-type/count summary) instead of the raw scene payload.
 *
 * @param {{ userPrompt: string, mode: "generate"|"adjust", targetTurnId?: string|null, turnId: string, resultDigest?: string }} input
 * @param {object} [options] requestChatCompletion transport options
 * @returns {Promise<string>} plain-text summary; empty string on failure (caller may still cache the turn without a summary)
 */
async function summarizeSceneTurn(input = {}, options = {}) {
  try {
    const content = await requestChatCompletion({
      ...pickChatCompletionOptions(options, DEFAULT_SUMMARIZE_MAX_TOKENS),
      messages: [
        { role: "system", content: buildSummarizeTurnSystemPrompt() },
        { role: "user", content: buildSummarizeTurnUserMessage(input) }
      ]
    });
    return String(content || "").trim();
  } catch (_error) {
    return "";
  }
}

/**
 * Pure (no network) assembly of a "structured turn envelope" a chat-style host can send as the
 * actual generate/adjust prompt: the pre-resolved intent, the resolved context (spatial summary
 * or full JSON — caller decides which per its own settings), the desired adjustment output mode
 * (when adjusting), and the user's raw request. Serialized as one JSON string, for hosts that want
 * the outbound "prompt" itself to be structured/JSON rather than raw prose.
 *
 * The returned string is meant to be passed as `prompt` (generate path) or `context.userMessage`
 * (adjust path via `requestUpdatedSceneEditCommands`/`requestUpdatedSceneJsonString`) — both are
 * pre-existing, unmodified extension points.
 *
 * @param {{
 *   userPrompt: string,
 *   intent: "generate"|"adjust",
 *   targetTurnId?: string|null,
 *   contextPayload?: object|null,
 *   adjustOutputMode?: "commands"|"json-incremental"|"json-full"|null
 * }} input
 * @returns {string}
 */
function buildStructuredTurnEnvelope(input = {}) {
  const envelope = {
    intent: input?.intent === "adjust" ? "adjust" : "generate",
    userRequest: String(input?.userPrompt || "").trim()
  };
  if (envelope.intent === "adjust") {
    envelope.targetTurnId = typeof input?.targetTurnId === "string" ? input.targetTurnId : null;
    if (input?.adjustOutputMode) {
      envelope.adjustOutputMode = input.adjustOutputMode;
    }
    if (input?.contextPayload && typeof input.contextPayload === "object") {
      envelope.context = input.contextPayload;
    }
  }
  return JSON.stringify(envelope, null, 2);
}

export { classifyTurnIntent, summarizeSceneTurn, buildStructuredTurnEnvelope };
