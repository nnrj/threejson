import { buildGeometrySummary, buildFootprint, buildObjectSpatialCard, characteristicSizeFromDescriptor, buildSceneScaleProfile, buildObjectSpatialCardsFromScene, buildObjectSpatialCardsFromSceneJson, buildCompactReferenceDescriptor } from "../query/spatialDescriptors.js";
export { buildGeometrySummary, buildFootprint, buildObjectSpatialCard, characteristicSizeFromDescriptor, buildSceneScaleProfile, buildObjectSpatialCardsFromScene, buildObjectSpatialCardsFromSceneJson, buildCompactReferenceDescriptor } from "../query/spatialDescriptors.js";

const MIN_PROMPT_TOKEN_LENGTH = 2;

const RELATIVE_POSITION_WORDS = [
  "旁边",
  "邻近",
  "附近",
  "左侧",
  "右侧",
  "左边",
  "右边",
  "对面",
  "next to",
  "near",
  "beside",
  "left of",
  "right of",
  "adjacent"
];

const isObjectRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const toNumber = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

/**
 * Tokens from the user prompt for generic name overlap (no domain keyword list).
 * ASCII: alphanumeric/underscore runs; CJK: contiguous Han sequences.
 * @param {string} prompt
 * @returns {string[]}
 */
export function extractPromptTokens(prompt) {
  const text = String(prompt || "");
  const tokens = new Set();
  const ascii = text.match(/[a-zA-Z0-9_]+/g) || [];
  for (let i = 0; i < ascii.length; i += 1) {
    const token = ascii[i].toLowerCase();
    if (token.length >= MIN_PROMPT_TOKEN_LENGTH) {
      tokens.add(token);
    }
  }
  const cjk = text.match(/[一-鿿]+/g) || [];
  for (let i = 0; i < cjk.length; i += 1) {
    const token = cjk[i];
    if (token.length >= MIN_PROMPT_TOKEN_LENGTH) {
      tokens.add(token);
    }
  }
  return [...tokens];
}

/**
 * @param {string} name
 * @param {string[]} tokens
 * @returns {boolean}
 */
function objectNameOverlapsPromptTokens(name, tokens) {
  const n = String(name || "").toLowerCase();
  if (!n || !Array.isArray(tokens) || tokens.length === 0) {
    return false;
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) {
      continue;
    }
    if (token.charCodeAt(0) > 127) {
      if (n.includes(token) || String(name || "").includes(token)) {
        return true;
      }
    } else if (n.includes(token)) {
      return true;
    }
  }
  return false;
}

/**
 * Reference objects for richer geometry/material context.
 * - Relative-placement prompts: prefer current selection when set.
 * - Otherwise: objects whose name shares a token with the prompt (no domain keyword list).
 * Cross-language (e.g. 中文提示 + English object names) is left to the LLM via Object spatial summary.
 * @param {string} prompt
 * @param {Array<object>} cards
 * @param {Map<string, object>} descriptorById
 * @param {{ selectionId?: string|null, selectionDescriptor?: object|null }} [options]
 * @returns {object[]}
 */
export function pickReferenceObjects(prompt, cards, descriptorById, options = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const selectionId = typeof options.selectionId === "string" ? options.selectionId.trim() : "";
  const selectionDescriptor = isObjectRecord(options.selectionDescriptor)
    ? options.selectionDescriptor
    : null;

  if (selectionId && selectionDescriptor && promptHasRelativePlacement(prompt)) {
    return [buildCompactReferenceDescriptor(selectionDescriptor)];
  }

  const tokens = extractPromptTokens(prompt);
  if (tokens.length === 0 || list.length === 0) {
    return [];
  }

  const matched = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i += 1) {
    const card = list[i];
    const name = String(card.name || "");
    if (!objectNameOverlapsPromptTokens(name, tokens) || !card.threeJsonId || seen.has(card.threeJsonId)) {
      continue;
    }
    seen.add(card.threeJsonId);
    const full = descriptorById?.get(card.threeJsonId);
    matched.push(full ? {
      ...buildCompactReferenceDescriptor(full),
      ...(card.parentThreeJsonId ? { parentThreeJsonId: card.parentThreeJsonId } : {}),
      ...(card.worldPosition ? { worldPosition: card.worldPosition } : {}),
      position: card.position,
      rotation: card.rotation,
      scale: card.scale,
      maxExtent: card.maxExtent,
      footprint: card.footprint,
      ...(card.boundsSource ? { boundsSource: card.boundsSource } : {})
    } : card);
    if (options.maxReferences != null && matched.length >= options.maxReferences) {
      break;
    }
  }
  return matched;
}

/**
 * @param {string} prompt
 * @returns {boolean}
 */
export function promptHasRelativePlacement(prompt) {
  const text = String(prompt || "").toLowerCase();
  return RELATIVE_POSITION_WORDS.some((word) => text.includes(word.toLowerCase()));
}

/**
 * @param {object[]} referenceObjects
 * @param {object} [scaleProfile]
 * @returns {string}
 */
export function buildPlacementHints(prompt, referenceObjects, scaleProfile = null) {
  if (!promptHasRelativePlacement(prompt)) {
    return "";
  }
  const range =
    scaleProfile?.typicalPartRange && scaleProfile.typicalPartRange !== "unknown"
      ? scaleProfile.typicalPartRange
      : null;
  const rangeSuffix = range
    ? ` with part sizes similar to scene (~${range})`
    : "";
  const overrideNote =
    " unless the modification request specifies otherwise.";

  const refs = Array.isArray(referenceObjects) ? referenceObjects : [];
  if (refs.length > 0) {
    const parts = [];
    let unionMinX = Infinity;
    let unionMaxX = -Infinity;
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      const fp = ref.footprint || buildFootprint(ref);
      if (!fp) {
        continue;
      }
      unionMinX = Math.min(unionMinX, toNumber(fp.minX));
      unionMaxX = Math.max(unionMaxX, toNumber(fp.maxX));
      const label = ref.name || ref.threeJsonId || "reference";
      parts.push(`${label} spans x≈[${toNumber(fp.minX).toFixed(1)},${toNumber(fp.maxX).toFixed(1)}]`);
    }
    if (Number.isFinite(unionMaxX)) {
      const offsetX = unionMaxX + Math.max(10, (unionMaxX - unionMinX) * 0.5);
      return `${parts.join("; ")}. Suggested: place new content near x≈${offsetX.toFixed(0)}${rangeSuffix}${overrideNote}`;
    }
  }

  const bounds = scaleProfile?.sceneBounds;
  if (bounds?.min && bounds?.max) {
    const minX = toNumber(bounds.min.x);
    const maxX = toNumber(bounds.max.x);
    const offsetX = maxX + Math.max(10, (maxX - minX) * 0.1);
    return `Scene spans x≈[${minX.toFixed(1)},${maxX.toFixed(1)}]. Suggested: offset new content beyond existing bounds near x≈${offsetX.toFixed(0)}${rangeSuffix}${overrideNote}`;
  }

  return "";
}
