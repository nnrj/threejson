import { resolveParentThreeJsonId } from "../../../../../core/runtime/sceneObjectCommands.js";

/**
 * Compact spatial context for AI scene update (position, geometry summary, scale profile).
 */

const MAX_SPATIAL_OBJECTS = 40;
const MAX_REFERENCE_OBJECTS = 5;
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

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {string}
 */
export function buildGeometrySummary(descriptor) {
  const objType = String(descriptor.objType || "").toLowerCase();
  const geometry = isObjectRecord(descriptor.geometry) ? descriptor.geometry : null;
  if (!geometry) {
    return objType ? `${objType} unknown` : "unknown";
  }
  if (objType === "cylinder" || geometry.radiusTop != null || geometry.radiusBottom != null) {
    const r = toNumber(geometry.radiusTop ?? geometry.radiusBottom ?? geometry.radius);
    const h = toNumber(geometry.height);
    return `cylinder r=${r}/h=${h}`;
  }
  if (
    objType === "sphere" ||
    (geometry.radius != null && geometry.width == null && geometry.radiusTop == null)
  ) {
    return `sphere r=${toNumber(geometry.radius)}`;
  }
  if (objType === "box" || geometry.width != null || geometry.depth != null) {
    const w = toNumber(geometry.width);
    const h = toNumber(geometry.height);
    const d = toNumber(geometry.depth);
    return `box ${w}×${h}×${d}`;
  }
  if (geometry.radius != null) {
    return `${objType || "shape"} r=${toNumber(geometry.radius)}`;
  }
  return objType ? `${objType} unknown` : "unknown";
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {{ minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number }|null}
 */
export function buildFootprint(descriptor) {
  const position = isObjectRecord(descriptor.position) ? descriptor.position : {};
  const px = toNumber(position.x);
  const py = toNumber(position.y);
  const pz = toNumber(position.z);
  const objType = String(descriptor.objType || "").toLowerCase();
  const geometry = isObjectRecord(descriptor.geometry) ? descriptor.geometry : null;
  if (!geometry) {
    return {
      minX: px,
      maxX: px,
      minY: py,
      maxY: py,
      minZ: pz,
      maxZ: pz
    };
  }
  if (objType === "cylinder" || geometry.radiusTop != null || geometry.radiusBottom != null) {
    const r = toNumber(geometry.radiusTop ?? geometry.radiusBottom ?? geometry.radius);
    const hh = toNumber(geometry.height) / 2;
    return {
      minX: px - r,
      maxX: px + r,
      minY: py - hh,
      maxY: py + hh,
      minZ: pz - r,
      maxZ: pz + r
    };
  }
  if (objType === "sphere" || (geometry.radius != null && geometry.width == null)) {
    const r = toNumber(geometry.radius);
    return {
      minX: px - r,
      maxX: px + r,
      minY: py - r,
      maxY: py + r,
      minZ: pz - r,
      maxZ: pz + r
    };
  }
  if (objType === "box" || geometry.width != null || geometry.depth != null) {
    const hw = toNumber(geometry.width) / 2;
    const hh = toNumber(geometry.height) / 2;
    const hd = toNumber(geometry.depth) / 2;
    return {
      minX: px - hw,
      maxX: px + hw,
      minY: py - hh,
      maxY: py + hh,
      minZ: pz - hd,
      maxZ: pz + hd
    };
  }
  return {
    minX: px,
    maxX: px,
    minY: py,
    maxY: py,
    minZ: pz,
    maxZ: pz
  };
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {object}
 */
export function buildObjectSpatialCard(descriptor, options = {}) {
  const id = typeof descriptor.threeJsonId === "string" ? descriptor.threeJsonId.trim() : "";
  const position = isObjectRecord(descriptor.position) ? descriptor.position : {};
  const parentThreeJsonId =
    typeof options.parentThreeJsonId === "string" ? options.parentThreeJsonId.trim() : "";
  return {
    threeJsonId: id,
    name: typeof descriptor.name === "string" ? descriptor.name : "",
    objType: typeof descriptor.objType === "string" ? descriptor.objType : "",
    ...(parentThreeJsonId ? { parentThreeJsonId } : {}),
    position: {
      x: toNumber(position.x),
      y: toNumber(position.y),
      z: toNumber(position.z)
    },
    geometrySummary: buildGeometrySummary(descriptor),
    maxExtent: characteristicSizeFromDescriptor(descriptor),
    footprint: buildFootprint(descriptor)
  };
}

/**
 * @param {Record<string, unknown>} descriptor
 * @returns {number}
 */
export function characteristicSizeFromDescriptor(descriptor) {
  const geometry = isObjectRecord(descriptor.geometry) ? descriptor.geometry : null;
  if (!geometry) {
    return 0;
  }
  const objType = String(descriptor.objType || "").toLowerCase();
  if (objType === "box" || geometry.width != null) {
    return Math.max(toNumber(geometry.width), toNumber(geometry.height), toNumber(geometry.depth));
  }
  if (geometry.radius != null) {
    const r = toNumber(geometry.radius);
    const h = toNumber(geometry.height);
    return h > 0 ? Math.max(r * 2, h) : r * 2;
  }
  return 0;
}

/**
 * @param {Array<object>} cards
 * @param {{ truncated?: boolean, totalCount?: number }} [meta]
 * @returns {object}
 */
export function buildSceneScaleProfile(cards, meta = {}) {
  const list = Array.isArray(cards) ? cards : [];
  const sizes = [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < list.length; i += 1) {
    const card = list[i];
    if (typeof card.maxExtent === "number" && card.maxExtent > 0) {
      sizes.push(card.maxExtent);
    } else {
      const summary = String(card.geometrySummary || "");
      const boxMatch = summary.match(/box\s+([\d.]+)[×x]([\d.]+)[×x]([\d.]+)/i);
      if (boxMatch) {
        sizes.push(Math.max(Number(boxMatch[1]), Number(boxMatch[2]), Number(boxMatch[3])));
      } else {
        const sphereMatch = summary.match(/r=([\d.]+)/);
        if (sphereMatch) {
          sizes.push(Number(sphereMatch[1]) * 2);
        }
      }
    }
    const fp = card.footprint;
    if (fp && typeof fp === "object") {
      minX = Math.min(minX, toNumber(fp.minX));
      minY = Math.min(minY, toNumber(fp.minY));
      minZ = Math.min(minZ, toNumber(fp.minZ));
      maxX = Math.max(maxX, toNumber(fp.maxX));
      maxY = Math.max(maxY, toNumber(fp.maxY));
      maxZ = Math.max(maxZ, toNumber(fp.maxZ));
    }
  }

  sizes.sort((a, b) => a - b);
  const characteristicSize =
    sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : 0;
  const minSize = sizes.length > 0 ? sizes[0] : 0;
  const maxSize = sizes.length > 0 ? sizes[sizes.length - 1] : 0;
  const typicalPartRange =
    sizes.length > 0 ? `${Math.round(minSize)}–${Math.round(maxSize)}` : "unknown";

  const profile = {
    objectCount: meta.totalCount ?? list.length,
    sceneBounds:
      Number.isFinite(minX) && Number.isFinite(maxX)
        ? {
            min: { x: minX, y: minY, z: minZ },
            max: { x: maxX, y: maxY, z: maxZ }
          }
        : null,
    characteristicSize: Math.round(characteristicSize * 10) / 10,
    typicalPartRange,
    note:
      "Default inference only — follow the modification request when it explicitly specifies size, position, or no changes."
  };
  if (meta.truncated) {
    profile.truncated = true;
    profile.includedObjectCount = list.length;
  }
  return profile;
}

/**
 * @param {import("../../../core/command/types.js").CommandContext} ctx
 * @returns {{ cards: object[], descriptorById: Map<string, object> }}
 */
export function buildObjectSpatialCardsFromScene(ctx) {
  const cards = [];
  const descriptorById = new Map();
  const seen = new Set();
  const scene = ctx?.scene;
  if (!scene?.isScene) {
    return { cards, descriptorById };
  }
  scene.traverse((node) => {
    const descriptor = node?.userData?.objJson;
    if (!isObjectRecord(descriptor)) {
      return;
    }
    const id = typeof descriptor.threeJsonId === "string" ? descriptor.threeJsonId.trim() : "";
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    descriptorById.set(id, descriptor);
    const parentThreeJsonId = resolveParentThreeJsonId(node);
    cards.push(buildObjectSpatialCard(descriptor, { parentThreeJsonId }));
  });
  cards.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const totalCount = cards.length;
  if (cards.length > MAX_SPATIAL_OBJECTS) {
    return {
      cards: cards.slice(0, MAX_SPATIAL_OBJECTS),
      descriptorById,
      truncated: true,
      totalCount
    };
  }
  return { cards, descriptorById, totalCount };
}

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
  const cjk = text.match(/[\u4e00-\u9fff]+/g) || [];
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
 * @param {Record<string, unknown>} descriptor
 * @returns {object}
 */
export function buildCompactReferenceDescriptor(descriptor) {
  const compact = {
    threeJsonId: descriptor.threeJsonId,
    name: descriptor.name,
    objType: descriptor.objType,
    position: descriptor.position,
    geometry: descriptor.geometry
  };
  if (isObjectRecord(descriptor.material)) {
    const material = descriptor.material;
    compact.material = {
      type: material.type,
      color: material.color,
      opacity: material.opacity
    };
  }
  return compact;
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
    matched.push(full ? buildCompactReferenceDescriptor(full) : card);
    if (matched.length >= MAX_REFERENCE_OBJECTS) {
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
