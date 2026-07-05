import { parseAiJsonFragment } from "../ai/sceneJsonSanitize.js";
import { COMMAND_API_VERSION } from "./types.js";

/**
 * @param {string} line
 * @returns {boolean}
 */
export function looksLikeMicroDslLine(line) {
  const text = String(line ?? "").trim();
  if (!text || text.startsWith("#") || text.startsWith("{") || text.startsWith("[")) {
    return false;
  }
  return /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+(?:\s|$)/i.test(text);
}

/**
 * @param {string} text
 * @param {number} start
 * @param {string} open
 * @param {string} close
 * @returns {number}
 */
function findJsonContainerEnd(text, start, open, close) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  throw new Error("unbalanced JSON value in micro DSL.");
}

/**
 * @param {string} text
 * @param {number} start
 * @returns {{ value: unknown, end: number }}
 */
function parseArgValue(text, start) {
  let i = start;
  while (i < text.length && text[i] === " ") {
    i += 1;
  }
  if (i >= text.length) {
    throw new Error("missing argument value in micro DSL.");
  }
  const ch = text[i];
  if (ch === "{") {
    const end = findJsonContainerEnd(text, i, "{", "}");
    const raw = text.slice(i, end + 1);
    return { value: parseAiJsonFragment(raw), end: end + 1 };
  }
  if (ch === "[") {
    const end = findJsonContainerEnd(text, i, "[", "]");
    const raw = text.slice(i, end + 1);
    return { value: parseAiJsonFragment(raw), end: end + 1 };
  }
  if (ch === '"') {
    let j = i + 1;
    let escape = false;
    while (j < text.length) {
      if (escape) {
        escape = false;
        j += 1;
        continue;
      }
      if (text[j] === "\\") {
        escape = true;
        j += 1;
        continue;
      }
      if (text[j] === '"') {
        const raw = text.slice(i, j + 1);
        return { value: JSON.parse(raw), end: j + 1 };
      }
      j += 1;
    }
    throw new Error("unterminated string in micro DSL.");
  }
  const rest = text.slice(i);
  if (rest.startsWith("true")) {
    return { value: true, end: i + 4 };
  }
  if (rest.startsWith("false")) {
    return { value: false, end: i + 5 };
  }
  if (rest.startsWith("null")) {
    return { value: null, end: i + 4 };
  }
  const numMatch = rest.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (numMatch) {
    const next = rest[numMatch[0].length];
    if (next == null || /\s/.test(next)) {
      return { value: Number(numMatch[0]), end: i + numMatch[0].length };
    }
  }
  const wordMatch = rest.match(/^[^\s]+/);
  if (!wordMatch) {
    throw new Error("missing argument value in micro DSL.");
  }
  return { value: wordMatch[0], end: i + wordMatch[0].length };
}

/**
 * @param {string} rest
 * @returns {Record<string, unknown>}
 */
function parseKeyValueArgs(rest) {
  const args = {};
  let i = 0;
  const text = String(rest ?? "");
  while (i < text.length) {
    while (i < text.length && text[i] === " ") {
      i += 1;
    }
    if (i >= text.length) {
      break;
    }
    const keyStart = i;
    while (i < text.length && text[i] !== "=" && text[i] !== " ") {
      i += 1;
    }
    const key = text.slice(keyStart, i).trim();
    if (!key) {
      throw new Error("invalid micro DSL argument key.");
    }
    while (i < text.length && text[i] === " ") {
      i += 1;
    }
    if (text[i] !== "=") {
      throw new Error(`micro DSL argument "${key}" requires '=' value.`);
    }
    i += 1;
    const parsed = parseArgValue(text, i);
    args[key] = parsed.value;
    i = parsed.end;
  }
  return args;
}

/**
 * Human-readable line: `object.patch id=obj-1 partial={"position":{"x":1}}`
 * @param {string} line
 * @returns {{ v: number, op: string, args: Record<string, unknown> }}
 */
export function parseMicroDslLine(line) {
  const text = String(line ?? "").trim();
  if (!text) {
    throw new Error("empty micro DSL line.");
  }
  const spaceIdx = text.indexOf(" ");
  const op = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).trim();
  if (!op || !op.includes(".")) {
    throw new Error(`micro DSL requires dotted op (e.g. object.add), got "${op}".`);
  }
  const rest = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1).trim();
  const args = rest ? parseKeyValueArgs(rest) : {};
  return { v: COMMAND_API_VERSION, op, args };
}

/**
 * @param {{ op: string, args?: Record<string, unknown> }} command
 * @returns {string}
 */
export function formatCommandAsMicroDsl(command) {
  const op = String(command?.op ?? "").trim();
  const args = command?.args && typeof command.args === "object" ? command.args : {};
  const parts = [op];
  for (const key of Object.keys(args)) {
    const value = args[key];
    if (value === undefined) {
      continue;
    }
    if (value !== null && typeof value === "object") {
      parts.push(`${key}=${JSON.stringify(value)}`);
    } else if (typeof value === "string") {
      if (/^[\w.-]+$/.test(value)) {
        parts.push(`${key}=${value}`);
      } else {
        parts.push(`${key}=${JSON.stringify(value)}`);
      }
    } else {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join(" ");
}
