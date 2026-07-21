/**
 * Sanitize LLM-produced "JSON" that embeds JavaScript numeric literals/expressions.
 * Used at ingest only; persisted/exported JSON remains strict numeric literals.
 */

const MATH_CONSTANT_REPLACEMENTS = [
  ["Math.SQRT1_2", String(Math.SQRT1_2)],
  ["Math.LOG10E", String(Math.LOG10E)],
  ["Math.LOG2E", String(Math.LOG2E)],
  ["Math.SQRT2", String(Math.SQRT2)],
  ["Math.LN10", String(Math.LN10)],
  ["Math.LN2", String(Math.LN2)],
  ["Math.PI", String(Math.PI)],
  ["Math.E", String(Math.E)]
];

const SIMPLE_NUMBER_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

const NUMERIC_EXPR_CHAR_RE = /[\d.eE+\-*/().\s]/;

/**
 * Remove an optional Markdown code fence around an LLM response. Models may emit
 * ```json, ``` json, or a bare ``` fence; the fence is transport decoration, not
 * part of the JSON document. Only anchored fences are removed so embedded text is
 * left untouched.
 * @param {string} rawText
 * @returns {string}
 */
function stripMarkdownCodeFence(rawText) {
  let text = String(rawText || "").trim();
  text = text.replace(/^```[ \t]*(?:json|threejson|javascript|js|command|commands)?[ \t]*(?:\r?\n|$)/i, "");
  text = text.replace(/(?:\r?\n|^)[ \t]*```[ \t]*$/i, "");
  return text.trim();
}

/**
 * @param {string} expr
 * @returns {number|null}
 */
function safeEvalNumericExpression(expr) {
  const cleaned = String(expr || "").trim();
  if (!cleaned || !/^[-+]?[\d.eE+\-*/().\s]+$/.test(cleaned)) {
    return null;
  }
  if (SIMPLE_NUMBER_RE.test(cleaned)) {
    return Number(cleaned);
  }
  try {
    const result = Function(`"use strict"; return (${cleaned});`)();
    if (typeof result === "number" && Number.isFinite(result)) {
      return result;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * @param {string} ch
 * @returns {boolean}
 */
function canStartNumericExpression(ch) {
  return ch === "(" || ch === "-" || ch === "+" || ch === "." || (ch >= "0" && ch <= "9");
}

/**
 * @param {string} text
 * @param {number} start
 * @returns {{ end: number, expr: string, value: number } | null}
 */
function readNumericExpressionSpan(text, start) {
  if (start >= text.length || !canStartNumericExpression(text[start])) {
    return null;
  }
  let i = start;
  let depth = 0;
  while (i < text.length) {
    const ch = text[i];
    if (!NUMERIC_EXPR_CHAR_RE.test(ch)) {
      break;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;
      if (depth < 0) {
        break;
      }
    }
    i += 1;
  }
  while (i > start && /\s/.test(text[i - 1])) {
    i -= 1;
  }
  const expr = text.slice(start, i).trim();
  if (!expr || !/[-+*/()]/.test(expr)) {
    return null;
  }
  const value = safeEvalNumericExpression(expr);
  if (value === null) {
    return null;
  }
  return { end: i, expr, value };
}

/**
 * @param {string} text
 * @returns {string}
 */
function replaceMathConstantsOutsideStrings(text) {
  let result = "";
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      result += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      i += 1;
      continue;
    }
    let replaced = false;
    for (let j = 0; j < MATH_CONSTANT_REPLACEMENTS.length; j += 1) {
      const [pattern, value] = MATH_CONSTANT_REPLACEMENTS[j];
      if (text.startsWith(pattern, i)) {
        result += value;
        i += pattern.length;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      result += ch;
      i += 1;
    }
  }
  return result;
}

/**
 * Fold `: 1/2`, `, 1/2`, `[ 1/2` style numeric expressions outside JSON strings.
 * @param {string} text
 * @returns {string}
 */
function foldNumericExpressionsOutsideStrings(text) {
  let result = "";
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      result += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      i += 1;
      continue;
    }
    if (ch === ":" || ch === "[" || ch === ",") {
      result += ch;
      i += 1;
      const wsStart = i;
      while (i < text.length && /\s/.test(text[i])) {
        i += 1;
      }
      const exprStart = i;
      const span = readNumericExpressionSpan(text, exprStart);
      if (span) {
        result += text.slice(wsStart, exprStart) + String(span.value);
        i = span.end;
        continue;
      }
      result += text.slice(wsStart, i);
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}

/**
 * @param {string} text
 * @returns {{ openBraces: number, closeBraces: number, openBrackets: number, closeBrackets: number }}
 */
function countJsonBracketsOutsideStrings(text) {
  let inString = false;
  let escape = false;
  let openBraces = 0;
  let closeBraces = 0;
  let openBrackets = 0;
  let closeBrackets = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      openBraces += 1;
    } else if (ch === "}") {
      closeBraces += 1;
    } else if (ch === "[") {
      openBrackets += 1;
    } else if (ch === "]") {
      closeBrackets += 1;
    }
  }
  return { openBraces, closeBraces, openBrackets, closeBrackets };
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isLikelyTruncatedJsonText(text) {
  const sanitized = String(text || "");
  const { openBraces, closeBraces, openBrackets, closeBrackets } =
    countJsonBracketsOutsideStrings(sanitized);
  const needBraces = openBraces - closeBraces;
  const needBrackets = openBrackets - closeBrackets;
  return needBraces > 0 || needBrackets > 0;
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripCommentsOutsideStrings(text) {
  let result = "";
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      result += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") {
        i += 1;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      i += 2;
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}

/**
 * @param {string} sanitized
 * @param {Error} err
 * @returns {string}
 */
function buildSanitizedJsonParseErrorMessage(sanitized, err) {
  const base = String(err?.message || err);
  const parts = [`Invalid scene JSON after sanitization: ${base}`];
  const posMatch = base.match(/position (\d+)/i);
  let pos = -1;
  if (posMatch) {
    pos = Number(posMatch[1]);
    if (Number.isFinite(pos) && pos >= 0) {
      const from = Math.max(0, pos - 48);
      const to = Math.min(sanitized.length, pos + 48);
      parts.push(`Context: ...${sanitized.slice(from, to)}...`);
    }
  }
  if (isLikelyTruncatedJsonText(sanitized) && (pos < 0 || pos >= sanitized.length - 2)) {
    const balance = countJsonBracketsOutsideStrings(sanitized);
    parts.push(
      `JSON appears truncated (missing ${balance.openBrackets - balance.closeBrackets} ']' and ${balance.openBraces - balance.closeBraces} '}'). Use command mode, a stronger model, or higher max output tokens.`
    );
  } else if (/\bMath\./.test(sanitized)) {
    parts.push("Unresolved Math.* identifiers may remain in the text.");
  } else if (/[\d.)]\s*[-+*/]\s*[\d.(]/.test(sanitized)) {
    parts.push("An arithmetic expression may not have been folded to a number.");
  } else {
    parts.push(
      "This is often invalid JSON structure. Prefer numeric literals (e.g. 1.5708) in LLM output."
    );
  }
  return parts.join(" ");
}

/**
 * Replace Math.* constants and fold numeric expressions; strip comments and trailing commas.
 * @param {string} rawText
 * @returns {string}
 */
function sanitizeAiJsonText(rawText) {
  let text = stripMarkdownCodeFence(rawText);
  text = stripCommentsOutsideStrings(text);

  text = replaceMathConstantsOutsideStrings(text);

  let changed = true;
  let guard = 0;
  while (changed && guard < 48) {
    guard += 1;
    const next = foldNumericExpressionsOutsideStrings(text);
    changed = next !== text;
    text = next;
  }

  text = text.replace(/,\s*([}\]])/g, "$1");
  return text;
}

/**
 * Sanitize and parse a JSON fragment from LLM output (command DSL args, etc.).
 * @param {string} rawText
 * @returns {unknown}
 */
function parseAiJsonFragment(rawText) {
  const sanitized = sanitizeAiJsonText(String(rawText || "").trim());
  try {
    return JSON.parse(sanitized);
  } catch (err) {
    throw new Error(buildSanitizedJsonParseErrorMessage(sanitized, err));
  }
}

export {
  stripMarkdownCodeFence,
  sanitizeAiJsonText,
  parseAiJsonFragment,
  safeEvalNumericExpression,
  buildSanitizedJsonParseErrorMessage,
  isLikelyTruncatedJsonText
};
