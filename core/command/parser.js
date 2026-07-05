import { parseAiJsonFragment } from "../ai/sceneJsonSanitize.js";
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
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
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
  return lines.map((line) => parseCommandLineText(line));
}
