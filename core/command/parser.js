import { parseAiJsonFragment } from "../util/sceneJsonSanitize.js";
import { COMMAND_API_VERSION } from "./types.js";
import { looksLikeMicroDslLine, parseMicroDslLine } from "./microDsl.js";

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * @param {unknown} value
 * @returns {import("./types.js").ParsedCommand}
 */
export function normalizeCommand(value) {
  if (!isObjectRecord(value)) {
    throw new Error("command must be a JSON object.");
  }
  const op = typeof value.op === "string" ? value.op.trim() : "";
  if (!op) {
    throw new Error('command requires non-empty "op".');
  }
  const args = isObjectRecord(value.args) ? value.args : {};
  const v = Number.isFinite(value.v) ? value.v : COMMAND_API_VERSION;
  return { v, op, args };
}

/**
 * @param {string} line
 * @returns {import("./types.js").ParsedCommand}
 */
function parseCommandLineText(line) {
  const text = String(line ?? "").trim();
  if (!text || text.startsWith("#")) {
    throw new Error("empty command line.");
  }
  if (looksLikeMicroDslLine(text)) {
    return normalizeCommand(parseMicroDslLine(text));
  }
  let parsed;
  try {
    parsed = parseAiJsonFragment(text);
  } catch (err) {
    throw new Error(
      `invalid command line (expected JSON object or micro DSL like "object.add descriptor={...}"): ${String(err?.message || err)}`
    );
  }
  return normalizeCommand(parsed);
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function splitCommandScript(text) {
  const source = String(text ?? "");
  const statements = [], containers = [];
  let start = 0, inString = false, escaped = false;
  // Newlines delimit commands, not the nested JSON arguments inside them. Parse the
  // entire batch before execution so an incomplete final command cannot partially apply.
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === "#" && !containers.length && !source.slice(start, i).trim()) {
      while (i < source.length && source[i] !== "\n") i++;
      start = i + 1;
      continue;
    }
    // JSON arguments retain the sanitizer's existing comment support. Quotes/braces
    // inside a comment are not delimiters; keep the text for the sanitizer to remove.
    if (containers.length && ch === "/" && source[i + 1] === "/") {
      while (i + 1 < source.length && source[i + 1] !== "\n") i++;
      continue;
    }
    if (containers.length && ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end < 0) throw new Error("incomplete comment in command script.");
      i = end + 1;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") containers.push(ch);
    else if (ch === "}" || ch === "]") {
      if (containers.pop() !== (ch === "}" ? "{" : "[")) throw new Error("unbalanced JSON value in command script.");
    } else if (ch === "\n" && !containers.length) {
      const statement = source.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }
  if (inString || containers.length) throw new Error("incomplete JSON value in command script.");
  const tail = source.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

/**
 * @param {string | import("./types.js").ParsedCommand | object} input
 * @returns {import("./types.js").ParsedCommand}
 */
export function parseCommandLine(input) {
  if (isObjectRecord(input) && typeof input.op === "string") {
    return normalizeCommand(input);
  }
  const text = String(input ?? "").trim();
  if (!text) {
    throw new Error("command input is empty.");
  }
  if (text.includes("\n")) {
    const lines = splitCommandScript(text);
    if (lines.length !== 1) {
      throw new Error("parseCommandLine expects a single command; use parseCommandScript for multiple lines.");
    }
    return parseCommandLineText(lines[0]);
  }
  return parseCommandLineText(text);
}

/**
 * @param {string | import("./types.js").ParsedCommand[] | object[]} input
 * @returns {import("./types.js").ParsedCommand[]}
 */
export function parseCommandScript(input) {
  if (Array.isArray(input)) {
    return input.map((item) => normalizeCommand(item));
  }
  const lines = splitCommandScript(String(input ?? ""));
  if (lines.length === 0) {
    throw new Error("command script is empty.");
  }
  return lines.flatMap((line) => line.startsWith("[")
    ? parseAiJsonFragment(line).map(normalizeCommand)
    : [parseCommandLineText(line)]);
}
