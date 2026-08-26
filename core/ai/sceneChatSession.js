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
import { buildAgentCapabilityIndex } from "./sceneCapabilityIndex.js";
import { mergeRequiredCapabilityIds } from "./sceneCapability.js";

// Negotiation, summaries and titles deliberately have no engine-owned completion ceiling. Their
// prompts constrain response shape; callers may opt into independent stage-specific limits.
const SCENE_TITLE_MAX_LENGTH = 80;
const MAX_ESTIMATED_SCENE_SEGMENTS = 16;
const SCENE_GENERATION_MODES = new Set(["auto", "direct", "draft_refine"]);
/** Characters unsafe in a file/folder name across common filesystems — a generated title is used
 * verbatim as a chat host's download/export file name (see generateSceneTitle below). */
const SCENE_TITLE_UNSAFE_CHARS = /[\\/:*?"<>|]/g;

/** Keep only chat-completion transport options. A stage-specific optional ceiling wins over the
 * legacy common maxTokens option; neither is invented here. */
function pickChatCompletionOptions(source, stageMaxTokensKey) {
  const keys = [
    "provider",
    "apiKey",
    "model",
    "baseUrl",
    "temperature",
    "signal",
    "providerAdapter",
    "requestContext",
    "userId",
    "thinkingPreference"
  ];
  const out = {};
  for (const k of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, k)) {
      out[k] = source[k];
    }
  }
  const requestedMaxTokens = source?.[stageMaxTokensKey] ?? source?.maxTokens;
  if (Number.isFinite(Number(requestedMaxTokens)) && Number(requestedMaxTokens) > 0) {
    out.maxTokens = Math.round(Number(requestedMaxTokens));
  }
  return out;
}

function normalizeEstimatedOutputTokens(value) {
  const rawMin = Number(value?.min);
  const rawMax = Number(value?.max);
  if (!Number.isFinite(rawMin) && !Number.isFinite(rawMax)) {
    return undefined;
  }
  const min = Math.max(1, Math.round(Number.isFinite(rawMin) ? rawMin : rawMax));
  const max = Math.max(min, Math.round(Number.isFinite(rawMax) ? rawMax : rawMin));
  return { min, max };
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
    out.push({
      turnId,
      summary: typeof entry?.summary === "string" ? entry.summary.slice(0, 1200) : "",
      userPrompt: typeof entry?.userPrompt === "string" ? entry.userPrompt.slice(0, 800) : "",
      mode: entry?.mode === "adjust" ? "adjust" : entry?.mode === "template" ? "template" : "generate",
      targetTurnId: typeof entry?.targetTurnId === "string" ? entry.targetTurnId.trim() : null,
      sceneTitle: typeof entry?.sceneTitle === "string" ? entry.sceneTitle.slice(0, 160) : ""
    });
  }
  return out;
}

function normalizeSceneGenerationMode(value) {
  return SCENE_GENERATION_MODES.has(value) ? value : "auto";
}

function buildExecutionModePolicyRules(sceneGenerationMode) {
  if (sceneGenerationMode === "direct") {
    return [
      '- The user explicitly selected complete generation. Set executionMode to "direct" and refinementGoals to []. Produce one complete, immediately usable scene; do not reinterpret visual ambition as a request for incremental construction.'
    ];
  }
  if (sceneGenerationMode === "draft_refine") {
    return [
      '- The user explicitly selected incremental construction. Set executionMode to "draft_refine" and provide 1-4 concrete, independently verifiable refinementGoals derived from the actual request.'
    ];
  }
  return [
    '- The user selected automatic generation mode. You MUST choose executionMode from the construction complexity of this specific request; do not default mechanically to either mode.',
    '- Choose "direct" unless incremental construction is genuinely necessary. Direct means the generation model returns one complete, immediately usable scene with semantically accurate materials, requested primary animation, lighting, and camera framing; trusted texture acquisition may continue independently after first render.',
    '- Judge authoring/output complexity, not how impressive the scene sounds. High quality, realistic, detailed, textured, animated, cinematic, or professional are not by themselves reasons for incremental construction.',
    '- Prefer "direct" when repetition can be represented compactly with groups, instancing, domain objects, bounded representative populations, or reusable materials. A furnished room, one building, a small campus, a robot or vehicle, a named planet with moons, and a conventional Solar System scene with a bounded number of bodies are direct.',
    '- Choose "draft_refine" only when at least one concrete condition holds: (a) several independently specified regions/subsystems each need substantial unique content; (b) the request requires a large population of non-repeating authored records that cannot be compacted; (c) later construction stages genuinely need spatial inspection of earlier stages; or (d) even after compact ThreeJSON abstractions, a complete usable scene is unlikely to fit one provider response.',
    '- If uncertain, choose "direct". The runtime can switch to incremental construction later if the provider explicitly reports a real output-length cutoff.',
    '- Never choose "draft_refine" merely for generic polish, validation, quality improvement, ceremonial review, or because a refinement loop is available.'
  ];
}

function buildClassifyIntentSystemPrompt(
  animationCapabilityMode = "auto",
  sceneGenerationMode = "auto",
  generationOnly = false,
  capabilityOptions = {}
) {
  const normalizedGenerationMode = normalizeSceneGenerationMode(sceneGenerationMode);
  return [
    "You are the pre-generation negotiation model for a ThreeJSON 3D-scene app.",
    generationOnly
      ? "This is the first scene-producing message in a new conversation. Its route is already fixed as a brand-new scene generation. Do NOT classify it as generate versus adjust; negotiate only how to generate it."
      : "Given the user's newest message and a list of prior conversation turns (each with a short summary), decide whether it generates a new scene or adjusts a prior scene.",
    ...(generationOnly
      ? []
      : [
          "- \"generate\": the user wants a brand-new scene, unrelated to (or not clearly continuing) any prior turn.",
          "- \"adjust\": the user wants to modify the scene produced by a specific prior turn."
        ]),
    "",
    "Output shape (strict):",
    generationOnly
      ? '{ "note": string, "generationStrategy": "single"|"segmented"|"compact", "estimatedSegments": integer, "estimatedOutputTokens": {"min": integer, "max": integer}, "executionMode": "direct"|"draft_refine", "refinementGoals": string[], "selectedCapabilityIds": string[], "requiresAnimation": boolean }'
      : '{ "intent": "generate"|"adjust", "targetTurnId": string|null, "note": string, "generationStrategy": "single"|"segmented"|"compact", "estimatedSegments": integer, "estimatedOutputTokens": {"min": integer, "max": integer}, "executionMode": "direct"|"draft_refine", "refinementGoals": string[], "selectedCapabilityIds": string[], "requiresAnimation": boolean }',
    "",
    "Rules:",
    ...(generationOnly
      ? ['- The operation is unconditionally a new scene generation. Do not output or infer intent or targetTurnId.']
      : [
          '- "targetTurnId" MUST be one of the provided turn ids, or null. Never invent an id.',
          '- If intent is "generate", "targetTurnId" MUST be null.',
          '- If intent is "adjust" but you cannot tell which prior turn is meant, still pick the single most recent turn as targetTurnId (most conversations continue the latest result) and explain the ambiguity in "note".'
        ]),
    ...(generationOnly
      ? []
      : [
          '- Conversation continuity is the default when prior scene turns exist. Requests to add, remove, replace, recolor, resize, move, rotate, animate, label, improve, simplify, or otherwise change something normally mean "adjust"—including short follow-ups such as "再加一棵树", "把它改成红色", or "让机器人挥手".',
          '- Choose "generate" with prior turns only when the user clearly asks for a new/separate scene, asks to start over, or the newest request is clearly unrelated to every prior scene. Do not classify a follow-up as "generate" merely because it contains enough detail to describe a complete scene.'
        ]),
    '- "note" is one short sentence explaining your choice.',
    '- Choose "generationStrategy" before generation starts. "single" means the complete JSON clearly fits one response. "segmented" means the request genuinely needs multiple responses AND you can follow the host segmented-output protocol from the first response. "compact" means a literal/full expansion is too large or segmented output is unsuitable; preserve the visual intent with instancing, bounded representative populations, and fewer explicit records so complete JSON fits one response.',
    '- Complexity features are optional safeguards, not a quality setting. Never choose "segmented" merely to improve quality, reasoning, correctness, or visual detail. Never begin a large one-shot response expecting the host to repair an arbitrary cutoff later.',
    '- For "single" or "compact", estimatedSegments MUST be 1. For "segmented", use 2-16 and only when the requested JSON is clearly too large for one provider response. If you are not confident that strict segmented output is supported, choose "compact" instead.',
    '- estimatedOutputTokens is a broad advisory range for the usable scene-authoring output after applying ThreeJSON compaction (not hidden reasoning and not input/context tokens). Estimate honestly; it is planning metadata, never a hard cutoff and never a reason to omit requested content.',
    '- executionMode is independent from generationStrategy: generationStrategy controls how one complete JSON response is transported; executionMode controls complete generation versus incremental construction.',
    ...buildExecutionModePolicyRules(normalizedGenerationMode),
    '- refinementGoals is empty for "direct". For "draft_refine", list 1-4 concrete remaining goals that can be completed and verified (for example "populate the four city districts"), not generic goals such as "improve quality" or "review the scene".',
    '- selectedCapabilityIds lists only the capability ids whose detailed syntax/examples the generation model needs. Do semantic reasoning; do not select capabilities merely because a keyword appears.',
    '- If the user asks to add, show, write, label, title, caption, or otherwise render visible words in the 3D scene, select "sceneText". Plain text defaults to SDF scene text. Select "infoPanel" instead only when the requested text needs a visible board/card/screen/panel backing; explicit extruded/beveled/solid lettering may use mesh text.',
    animationCapabilityMode === "on"
      ? '- Animation capability is explicitly enabled by the user: requiresAnimation MUST be true and selectedCapabilityIds MUST include events, lifecycle, or declarativeAnimation as appropriate.'
      : animationCapabilityMode === "off"
        ? '- Animation capability is explicitly disabled by the user: requiresAnimation MUST be false and do not select events/lifecycle/declarativeAnimation solely for animation.'
        : '- Animation mode is automatic: set requiresAnimation from the requested behavior and scene meaning, not from keyword matching.',
    '',
    // Build this at request time. Optional entries (notably threejson/webgpu) register after the
    // AI module itself has loaded, so a module-level snapshot permanently hid newly activated
    // capabilities from negotiation.
    buildAgentCapabilityIndex(capabilityOptions).trim(),
    "",
    "Output requirement:",
    "Return ONLY one JSON object. No Markdown fences. No commentary before or after."
  ].join("\n");
}

function buildClassifyIntentUserMessage(userPrompt, historyEntries) {
  return JSON.stringify(
    {
      newestUserMessage: String(userPrompt || "").trim(),
      priorSceneTurns: historyEntries.map((entry, index) => ({
        turnId: entry.turnId,
        chronologicalIndex: index + 1,
        isLatestScene: index === historyEntries.length - 1,
        mode: entry.mode,
        targetTurnId: entry.targetTurnId,
        sceneTitle: entry.sceneTitle,
        originalRequest: entry.userPrompt,
        resultSummary: entry.summary
      }))
    },
    null,
    2
  );
}

/**
 * Negotiate generation policy and, when prior scene turns exist, classify whether the user's next
 * message is a new-scene request or an adjustment of a specific prior turn. A first message is
 * always routed locally as generation. Safe-by-default: any network/parse/validation failure resolves to
 * a marked fallback result rather than throwing. Chat hosts with prior scene context must inspect
 * `classificationFailed` and avoid silently treating that fallback as a new-scene request.
 *
 * @param {{ userPrompt: string, history?: Array<{turnId: string, summary: string}> }} input
 * @param {object} [options] requestChatCompletion transport options plus
 *   sceneGenerationMode: "auto"|"direct"|"draft_refine"
 * @returns {Promise<{ intent: "generate"|"adjust", targetTurnId: string|null, note: string, classificationFailed: boolean, generationStrategy: "single"|"segmented"|"compact", estimatedSegments: number, estimatedOutputTokens?: {min:number,max:number}, executionMode: "direct"|"draft_refine", refinementGoals: string[] }>}
 */
async function classifyTurnIntent(input = {}, options = {}) {
  const userPrompt = String(input?.userPrompt || "").trim();
  const historyEntries = normalizeHistoryEntries(input?.history);
  // With no prior scene there is nothing to adjust. The model call remains useful for automatic
  // complete-vs-incremental construction and capability negotiation, but never controls routing.
  const generationOnly = historyEntries.length === 0;
  const sceneGenerationMode = normalizeSceneGenerationMode(options.sceneGenerationMode);
  const fallbackExecutionMode = sceneGenerationMode === "draft_refine" ? "draft_refine" : "direct";
  const fallback = {
    intent: "generate",
    targetTurnId: null,
    note: "",
    classificationFailed: true,
    generationStrategy: "single",
    estimatedSegments: 1,
    estimatedOutputTokens: undefined,
    executionMode: fallbackExecutionMode,
    refinementGoals: [],
    // Undefined preserves core/ai's local intent hints when negotiation could not be parsed.
    selectedCapabilityIds: undefined,
    requiresAnimation: options.animationCapabilityMode === "on"
      ? true
      : options.animationCapabilityMode === "off"
        ? false
        : undefined
  };

  try {
    const content = await requestChatCompletion({
      ...pickChatCompletionOptions(options, "negotiationMaxTokens"),
      taskKind: "scene_negotiate",
      messages: [
        {
          role: "system",
          content: buildClassifyIntentSystemPrompt(
            options.animationCapabilityMode,
            sceneGenerationMode,
            generationOnly,
            options
          )
        },
        { role: "user", content: buildClassifyIntentUserMessage(userPrompt, historyEntries) }
      ]
    });
    const jsonText = extractJsonText(content);
    const parsed = JSON.parse(sanitizeAiJsonText(jsonText));
    const intent = generationOnly
      ? "generate"
      : parsed?.intent === "adjust"
        ? "adjust"
        : parsed?.intent === "generate"
          ? "generate"
          : null;
    if (!intent) {
      return { ...fallback, note: "fallback: model returned an unrecognized intent" };
    }
    const validIds = new Set(historyEntries.map((entry) => entry.turnId));
    const rawTargetId = typeof parsed?.targetTurnId === "string" ? parsed.targetTurnId.trim() : "";
    const latestTurnId = historyEntries.length ? historyEntries[historyEntries.length - 1].turnId : null;
    // Once the model has semantically chosen "adjust", a missing or slightly malformed target id
    // must not reverse that decision into "generate". The negotiation prompt explicitly defines
    // the latest scene as the ambiguity fallback, so enforce that contract here.
    const targetTurnId = intent === "adjust"
      ? validIds.has(rawTargetId)
        ? rawTargetId
        : latestTurnId
      : null;
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
    const estimatedOutputTokens = normalizeEstimatedOutputTokens(parsed?.estimatedOutputTokens);
    const modelExecutionMode = parsed?.executionMode === "draft_refine" ? "draft_refine" : "direct";
    const executionMode = sceneGenerationMode === "auto"
      ? modelExecutionMode
      : sceneGenerationMode;
    const refinementGoals = executionMode === "draft_refine" && Array.isArray(parsed?.refinementGoals)
      ? [...new Set(parsed.refinementGoals.map((goal) => String(goal || "").trim()).filter(Boolean))].slice(0, 4)
      : [];
    const selectedCapabilityIds = Array.isArray(parsed?.selectedCapabilityIds)
      ? [...new Set(parsed.selectedCapabilityIds.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 12)
      : undefined;
    const effectiveSelectedCapabilityIds = mergeRequiredCapabilityIds(userPrompt, selectedCapabilityIds);
    const requiresAnimation = options.animationCapabilityMode === "on"
      ? true
      : options.animationCapabilityMode === "off"
        ? false
        : typeof parsed?.requiresAnimation === "boolean"
          ? parsed.requiresAnimation
          : undefined;
    if (intent === "adjust" && !targetTurnId) {
      return { ...fallback, note: "fallback: model chose adjust without any prior scene turn" };
    }
    return {
      intent,
      targetTurnId,
      note,
      classificationFailed: false,
      generationStrategy,
      estimatedSegments,
      estimatedOutputTokens,
      executionMode,
      refinementGoals,
      selectedCapabilityIds: effectiveSelectedCapabilityIds,
      requiresAnimation
    };
  } catch (error) {
    // Transport/API failures already carry structured metadata for the host UI. Do not turn them
    // into an intent fallback; provider-specific error codes belong to the injected adapter.
    if (Number.isFinite(Number(error?.httpStatus)) || error?.isAiTransportError === true) {
      throw error;
    }
    return {
      ...fallback,
      note: `fallback: ${generationOnly ? "generation policy negotiation" : "classification"} failed (${error?.message || error})`
    };
  }
}

const DEFAULT_SELF_NAME = "ThreeJSON";

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
 *   `selfName` is the chat host's own product name for the recap to refer to itself by, rather
 *   than defaulting to generic "the assistant" wording — defaults to "ThreeJSON"
 *   when omitted.
 * @param {object} [options] requestChatCompletion transport options
 * @returns {Promise<string>} plain-text summary; empty string on failure (caller may still cache the turn without a summary)
 */
async function summarizeSceneTurn(input = {}, options = {}) {
  try {
    const content = await requestChatCompletion({
      ...pickChatCompletionOptions(options, "summaryMaxTokens"),
      taskKind: "scene_summary",
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
      ...pickChatCompletionOptions(options, "titleMaxTokens"),
      taskKind: "scene_title",
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
 *   generationStrategy?: "single"|"segmented"|"compact",
 *   estimatedOutputTokens?: {min:number,max:number},
 *   executionMode?: "direct"|"draft_refine",
 *   refinementGoals?: string[],
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
    const estimatedOutputTokens = normalizeEstimatedOutputTokens(input?.estimatedOutputTokens);
    if (estimatedOutputTokens) {
      envelope.estimatedOutputTokens = {
        ...estimatedOutputTokens,
        advisoryOnly: true
      };
    }
    envelope.executionMode = input?.executionMode === "draft_refine" ? "draft_refine" : "direct";
    if (envelope.executionMode === "draft_refine" && Array.isArray(input?.refinementGoals)) {
      const goals = [...new Set(input.refinementGoals.map((goal) => String(goal || "").trim()).filter(Boolean))].slice(0, 4);
      if (goals.length) {
        envelope.refinementGoals = goals;
      }
    }
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
