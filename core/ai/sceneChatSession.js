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
 * 4. `generateSceneTitle` — a lightweight, separate chat call that produces a short scene title
 *    for a completed turn, for use as a chat host's scene-card label and (via that label) its
 *    download/export file name.
 */
import { requestChatCompletion, extractJsonText } from "./sceneAiService.js";
import { sanitizeAiJsonText } from "./sceneJsonSanitize.js";
import { THREE_JSON_AGENT_CAPABILITY_INDEX } from "./sceneCapabilityIndex.js";

const DEFAULT_CLASSIFY_MAX_TOKENS = 300;
const DEFAULT_SUMMARIZE_MAX_TOKENS = 400;
const DEFAULT_TITLE_MAX_TOKENS = 60;
const SCENE_TITLE_MAX_LENGTH = 80;
const MAX_ESTIMATED_SCENE_SEGMENTS = 16;
/** Characters unsafe in a file/folder name across common filesystems — a generated title is used
 * verbatim as a chat host's download/export file name (see generateSceneTitle below). */
const SCENE_TITLE_UNSAFE_CHARS = /[\\/:*?"<>|]/g;

/** Keep only chat-completion transport options (avoid leaking unrelated caller options into the HTTP body). */
function pickChatCompletionOptions(source, fallbackMaxTokens) {
  const keys = ["provider", "apiKey", "model", "baseUrl", "temperature", "signal", "threeBoxTurnContext"];
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

function buildClassifyIntentSystemPrompt(animationCapabilityMode = "auto") {
  return [
    "You are the pre-generation negotiation model for a ThreeJSON 3D-scene app.",
    "Given the user's newest message and a list of prior conversation turns (each with a short summary), decide:",
    "- \"generate\": the user wants a brand-new scene, unrelated to (or not clearly continuing) any prior turn.",
    "- \"adjust\": the user wants to modify the scene produced by a specific prior turn.",
    "",
    "Output shape (strict):",
    '{ "intent": "generate"|"adjust", "targetTurnId": string|null, "note": string, "generationStrategy": "single"|"segmented"|"compact", "estimatedSegments": integer, "selectedCapabilityIds": string[], "requiresAnimation": boolean }',
    "",
    "Rules:",
    '- "targetTurnId" MUST be one of the provided turn ids, or null. Never invent an id.',
    '- If intent is "generate", "targetTurnId" MUST be null.',
    '- If intent is "adjust" but you cannot tell which prior turn is meant, still pick the single most recent turn as targetTurnId (most conversations continue the latest result) and explain the ambiguity in "note".',
    '- "note" is one short sentence explaining your choice.',
    '- Choose "generationStrategy" before generation starts. "single" means the complete JSON clearly fits one response. "segmented" means the request genuinely needs multiple responses AND you can follow the host segmented-output protocol from the first response. "compact" means a literal/full expansion is too large or segmented output is unsuitable; preserve the visual intent with instancing, bounded representative populations, and fewer explicit records so complete JSON fits one response.',
    '- Complexity features are optional safeguards, not a quality setting. Never choose "segmented" merely to improve quality, reasoning, correctness, or visual detail. Never begin a large one-shot response expecting the host to repair an arbitrary cutoff later.',
    '- For "single" or "compact", estimatedSegments MUST be 1. For "segmented", use 2-16 and only when the requested JSON is clearly too large for one provider response. If you are not confident that strict segmented output is supported, choose "compact" instead.',
    '- selectedCapabilityIds lists only the capability ids whose detailed syntax/examples the generation model needs. Do semantic reasoning; do not select capabilities merely because a keyword appears.',
    '- If the user asks to add, show, write, label, title, caption, or otherwise render visible words in the 3D scene, select "sceneText". Plain text defaults to SDF scene text. Select "infoPanel" instead only when the requested text needs a visible board/card/screen/panel backing; explicit extruded/beveled/solid lettering may use mesh text.',
    animationCapabilityMode === "on"
      ? '- Animation capability is explicitly enabled by the user: requiresAnimation MUST be true and selectedCapabilityIds MUST include events, lifecycle, or declarativeAnimation as appropriate.'
      : animationCapabilityMode === "off"
        ? '- Animation capability is explicitly disabled by the user: requiresAnimation MUST be false and do not select events/lifecycle/declarativeAnimation solely for animation.'
        : '- Animation mode is automatic: set requiresAnimation from the requested behavior and scene meaning, not from keyword matching.',
    '',
    THREE_JSON_AGENT_CAPABILITY_INDEX.trim(),
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
 * `{ intent: "generate", targetTurnId: null, generationStrategy: "single", estimatedSegments: 1 }` rather than throwing, since guessing wrong toward
 * "generate" is the least destructive failure mode for a caller (it never silently overwrites the
 * wrong prior scene).
 *
 * @param {{ userPrompt: string, history?: Array<{turnId: string, summary: string}> }} input
 * @param {object} [options] requestChatCompletion transport options (provider/apiKey/model/baseUrl/...)
 * @returns {Promise<{ intent: "generate"|"adjust", targetTurnId: string|null, note: string, generationStrategy: "single"|"segmented"|"compact", estimatedSegments: number }>}
 */
async function classifyTurnIntent(input = {}, options = {}) {
  const userPrompt = String(input?.userPrompt || "").trim();
  const historyEntries = normalizeHistoryEntries(input?.history);
  const fallback = {
    intent: "generate",
    targetTurnId: null,
    note: "",
    generationStrategy: "single",
    estimatedSegments: 1,
    selectedCapabilityIds: [],
    requiresAnimation: options.animationCapabilityMode === "on"
  };

  try {
    const content = await requestChatCompletion({
      ...pickChatCompletionOptions(options, DEFAULT_CLASSIFY_MAX_TOKENS),
      messages: [
        { role: "system", content: buildClassifyIntentSystemPrompt(options.animationCapabilityMode) },
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
    const rawEstimatedSegments = Number(parsed?.estimatedSegments);
    const boundedSegments = Number.isFinite(rawEstimatedSegments)
      ? Math.min(MAX_ESTIMATED_SCENE_SEGMENTS, Math.max(1, Math.round(rawEstimatedSegments)))
      : 1;
    const parsedStrategy = ["single", "segmented", "compact"].includes(parsed?.generationStrategy)
      ? parsed.generationStrategy
      : boundedSegments > 1
        ? "segmented"
        : "single";
    const generationStrategy = parsedStrategy;
    const estimatedSegments = generationStrategy === "segmented" ? Math.max(2, boundedSegments) : 1;
    const selectedCapabilityIds = Array.isArray(parsed?.selectedCapabilityIds)
      ? [...new Set(parsed.selectedCapabilityIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 12)
      : [];
    const requiresAnimation = options.animationCapabilityMode === "on"
      ? true
      : options.animationCapabilityMode === "off"
        ? false
        : parsed?.requiresAnimation === true;
    if (intent === "adjust" && !targetTurnId) {
      return { ...fallback, note: "fallback: model chose adjust but named an unknown targetTurnId" };
    }
    return { intent, targetTurnId, note, generationStrategy, estimatedSegments, selectedCapabilityIds, requiresAnimation };
  } catch (error) {
    if (error?.code === "BUILTIN_MODERATION_BLOCKED") {
      throw error;
    }
    return { ...fallback, note: `fallback: classification failed (${error?.message || error})` };
  }
}

const DEFAULT_SELF_NAME = "ThreeBox";

function buildSummarizeTurnSystemPrompt(selfName) {
  const name = String(selfName || "").trim() || DEFAULT_SELF_NAME;
  return [
    "You write short, factual recaps of a single turn in a 3D-scene generation chat, for storage in the app's local session history.",
    `When referring to the system that produced the scene, call it "${name}" — never "the assistant", "the AI", "the model", "ChatGPT", or any other generic/provider name. "${name}" is the chat host's own product name and this recap is shown to end users as its reply, so it must speak in its own voice.`,
    "Write 2-4 sentences in plain prose (no Markdown, no JSON), covering:",
    "- What the user asked for in this turn.",
    `- What ${name} produced (in general terms — object types/counts/layout, not raw JSON).`,
    "- If this turn adjusted a prior turn, name which prior turn id it adjusted and what changed.",
    "Do not restate the full scene JSON. Do not add commentary outside the recap."
  ].join("\n");
}

function buildSummarizeTurnUserMessage({ userPrompt, mode, targetTurnId, turnId, resultDigest, responseLanguage }) {
  const lines = [
    `Turn id: ${turnId || "(unknown)"}`,
    `Mode: ${mode === "adjust" ? "adjustment" : "new generation"}`
  ];
  if (mode === "adjust" && targetTurnId) {
    lines.push(`Adjusted prior turn id: ${targetTurnId}`);
  }
  lines.push(`User request:\n${String(userPrompt || "").trim()}`);
  lines.push(`Result digest (for your reference, not to be echoed verbatim):\n${String(resultDigest || "").trim() || "(none)"}`);
  if (responseLanguage) {
    lines.push(`Write the recap in ${responseLanguage}, regardless of what language the user request above is in.`);
  }
  return lines.join("\n\n");
}

/**
 * Produce a short prose recap of a completed generate/adjust turn, for a chat app's session cache.
 * Deliberately never sends/receives full scene JSON (token cost) — callers should pass a compact
 * `resultDigest` string (e.g. object-type/count summary) instead of the raw scene payload.
 *
 * @param {{ userPrompt: string, mode: "generate"|"adjust", targetTurnId?: string|null, turnId: string, resultDigest?: string, responseLanguage?: string, selfName?: string }} input
 *   `responseLanguage` is an optional human-readable language name (e.g. "Simplified Chinese",
 *   "English") — when provided, the recap is written in that language regardless of the user
 *   request's own language, so a chat host can keep summaries consistent with its current UI
 *   locale setting rather than whatever language the user happened to type in.
 *   `selfName` is the chat host's own product name (e.g. "ThreeBox") for the recap to refer to
 *   itself by, rather than defaulting to generic "the assistant" wording — defaults to "ThreeBox"
 *   when omitted.
 * @param {object} [options] requestChatCompletion transport options
 * @returns {Promise<string>} plain-text summary; empty string on failure (caller may still cache the turn without a summary)
 */
async function summarizeSceneTurn(input = {}, options = {}) {
  try {
    const content = await requestChatCompletion({
      ...pickChatCompletionOptions(options, DEFAULT_SUMMARIZE_MAX_TOKENS),
      messages: [
        { role: "system", content: buildSummarizeTurnSystemPrompt(input.selfName) },
        { role: "user", content: buildSummarizeTurnUserMessage(input) }
      ]
    });
    return String(content || "").trim();
  } catch (_error) {
    return "";
  }
}

function buildGenerateTitleSystemPrompt() {
  return [
    "You write a short, descriptive title for a single turn's resulting 3D scene, for use as a chat host's scene-card label and as a downloaded/exported file name.",
    "Output ONLY the title text itself — no quotes, no Markdown, no commentary, no trailing period.",
    "Keep it concise: roughly 2-8 words (or the equivalent length in the requested language).",
    "The title must describe the resulting SCENE (what it depicts), not the chat turn itself — never write things like \"Scene generated\" or \"Adjustment applied\".",
    "Since the title is used verbatim as a file name, do not include characters such as / \\ : * ? \" < > |.",
    "If a previous title is given, this turn is an ADJUSTMENT of that same scene, not a new one: keep the previous title's base name and append a revision marker plus a short description of what changed this round — e.g. \"<BaseName>_Rev2_<what changed>\" (match the previous title's own language/wording for \"revision\"; if it already ends in a revision marker, increment the number instead of adding another one). Only give it a brand-new, unrelated title if the result no longer resembles the previous scene at all — e.g. the user pivoted to a completely different subject."
  ].join("\n");
}

function buildGenerateTitleUserMessage({ userPrompt, resultDigest, responseLanguage, previousTitle }) {
  const lines = [
    `User request:\n${String(userPrompt || "").trim()}`,
    `Result digest (for your reference, not to be echoed verbatim):\n${String(resultDigest || "").trim() || "(none)"}`
  ];
  const prevTitle = String(previousTitle || "").trim();
  if (prevTitle) {
    lines.push(`Previous title of the scene being adjusted: ${prevTitle}`);
  }
  if (responseLanguage) {
    lines.push(`Write the title in ${responseLanguage}, regardless of what language the user request above is in.`);
  }
  return lines.join("\n\n");
}

/** Strips wrapping quotes/Markdown, collapses whitespace/newlines, drops characters unsafe in a
 * file name, and caps length — the model is instructed to already produce clean output (see
 * buildGenerateTitleSystemPrompt), but the result is used verbatim as a download file name, so it
 * must be defensively sanitized rather than trusted outright. */
function sanitizeSceneTitleText(raw) {
  let text = String(raw || "").trim();
  text = text.replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, "").trim();
  text = text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  text = text.replace(SCENE_TITLE_UNSAFE_CHARS, "").trim();
  if (text.length > SCENE_TITLE_MAX_LENGTH) {
    text = text.slice(0, SCENE_TITLE_MAX_LENGTH).trim();
  }
  return text;
}

/**
 * Produce a short scene title for a completed generate/adjust turn — for use as a chat host's
 * scene-card display label and, via that label, its downloaded JSON / exported .tjz file name.
 * Deliberately never sends/receives full scene JSON (token cost) — same `resultDigest` convention
 * as `summarizeSceneTurn`.
 *
 * @param {{ userPrompt: string, resultDigest?: string, responseLanguage?: string, previousTitle?: string }} input
 *   `responseLanguage` is an optional human-readable language name (e.g. "Simplified Chinese",
 *   "English") — when provided, the title is written in that language regardless of the user
 *   request's own language, so a chat host can keep titles consistent with a configured language
 *   setting rather than whatever language the user happened to type in.
 *   `previousTitle`, when this is an adjustment of an existing scene, should be that scene's
 *   current title — the new title then builds on it (e.g. "SolarSystem" -> "SolarSystem_Rev1_
 *   ImprovedTextures") instead of generating an unrelated name for what's still the same scene.
 * @param {object} [options] requestChatCompletion transport options
 * @returns {Promise<string>} plain-text title; empty string on failure (caller should fall back to the raw user prompt)
 */
async function generateSceneTitle(input = {}, options = {}) {
  try {
    const content = await requestChatCompletion({
      ...pickChatCompletionOptions(options, DEFAULT_TITLE_MAX_TOKENS),
      messages: [
        { role: "system", content: buildGenerateTitleSystemPrompt() },
        { role: "user", content: buildGenerateTitleUserMessage(input) }
      ]
    });
    return sanitizeSceneTitleText(content);
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
 *   adjustOutputMode?: "commands"|"json-incremental"|"json-full"|null,
 *   globalPromptPrefix?: string|null,
 *   includeReferenceLinks?: boolean,
 *   generationStrategy?: "single"|"segmented"|"compact"
 *   selectedCapabilityIds?: string[],
 *   requiresAnimation?: boolean
 * }} input
 *   `includeReferenceLinks`: when true, adds a `referenceLinks` block pointing at the ThreeJSON
 *   docs site and its example-JSON repo folder — a citation only (this function does no network
 *   I/O), for models whose training data already covers these public URLs to draw on usage not
 *   spelled out elsewhere in the prompt. Applies to both single-round and Agent-mode turns, since
 *   both paths ultimately send this envelope string as the user message.
 * @returns {string}
 */
const THREE_JSON_REFERENCE_LINKS = Object.freeze({
  docs: "https://threejson.org/website/#/docs-index",
  examples: "https://github.com/nnrj/threejson/tree/master/assets/json"
});

function buildStructuredTurnEnvelope(input = {}) {
  const envelope = {
    intent: input?.intent === "adjust" ? "adjust" : "generate",
    userRequest: String(input?.userPrompt || "").trim()
  };
  const globalInstructions = typeof input?.globalPromptPrefix === "string" ? input.globalPromptPrefix.trim() : "";
  if (globalInstructions) {
    envelope.globalInstructions = globalInstructions;
  }
  if (input?.includeReferenceLinks === true) {
    envelope.referenceLinks = {
      note: "If your training data covers these public resources, use them for ThreeJSON usage not otherwise spelled out in this prompt.",
      docsIndex: THREE_JSON_REFERENCE_LINKS.docs,
      jsonExamples: THREE_JSON_REFERENCE_LINKS.examples
    };
  }
  if (Array.isArray(input?.selectedCapabilityIds) && input.selectedCapabilityIds.length > 0) {
    envelope.selectedCapabilityIds = [...new Set(input.selectedCapabilityIds.map((id) => String(id || "").trim()).filter(Boolean))];
  }
  if (typeof input?.requiresAnimation === "boolean") {
    envelope.requiresAnimation = input.requiresAnimation;
  }
  if (envelope.intent === "generate") {
    const strategy = ["single", "segmented", "compact"].includes(input?.generationStrategy)
      ? input.generationStrategy
      : "single";
    envelope.generationStrategy = strategy;
    if (strategy === "compact") {
      envelope.generationConstraints = {
        completeJsonInOneResponse: true,
        instruction: "Preserve the requested visual story while keeping the JSON compact. Use instancedList/transforms for repeated props, represent words such as many with a bounded varied sample, reuse materials and simple assemblies, omit optional detail, and close a valid complete JSON document. Do not expand every implied object into a separate record."
      };
    }
  }
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

export { classifyTurnIntent, summarizeSceneTurn, generateSceneTitle, buildStructuredTurnEnvelope };
