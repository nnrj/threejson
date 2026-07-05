/**
 * EventScript lexer — single dialect surface syntax (§3.3).
 */

const KEYWORDS = new Set([
  "var",
  "if",
  "else",
  "await",
  "wait",
  "run",
  "true",
  "false",
  "ref"
]);

/**
 * @typedef {object} Token
 * @property {string} type
 * @property {string|number|boolean|null} value
 * @property {number} line
 * @property {number} column
 * @property {number} start
 * @property {number} end
 */

/**
 * @param {string} source
 * @returns {Token[]}
 */
export function tokenizeEventScript(source) {
  const text = String(source ?? "");
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  let line = 1;
  let column = 1;

  function emit(type, value, start, end) {
    tokens.push({ type, value, line, column, start, end });
  }

  function advance(n = 1) {
    for (let k = 0; k < n; k++) {
      if (text[i] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      i += 1;
    }
  }

  function peek(offset = 0) {
    return text[i + offset] ?? "";
  }

  function isIdentStart(ch) {
    return typeof ch === "string" && ch.length > 0 && /[A-Za-z_$]/.test(ch);
  }

  function isIdentPart(ch) {
    return typeof ch === "string" && ch.length > 0 && /[A-Za-z0-9_$]/.test(ch);
  }

  while (i < text.length) {
    const ch = text[i];

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    if (ch === "/" && peek(1) === "/") {
      while (i < text.length && text[i] !== "\n") {
        advance();
      }
      continue;
    }

    if (ch === "#") {
      while (i < text.length && text[i] !== "\n") {
        advance();
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      const quote = ch;
      advance();
      let value = "";
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\" && i + 1 < text.length) {
          value += text[i + 1];
          advance(2);
          continue;
        }
        value += text[i];
        advance();
      }
      if (text[i] === quote) {
        advance();
      }
      emit("string", value, start, i);
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "-" && /[0-9]/.test(peek(1)))) {
      const start = i;
      let value = ch;
      advance();
      while (i < text.length && /[0-9.]/.test(text[i])) {
        value += text[i];
        advance();
      }
      emit("number", Number(value), start, i);
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      let value = ch;
      advance();
      while (i < text.length && isIdentPart(text[i])) {
        value += text[i];
        advance();
      }
      if (KEYWORDS.has(value)) {
        emit("keyword", value, start, i);
      } else {
        emit("ident", value, start, i);
      }
      continue;
    }

    const start = i;
    const two = ch + peek(1);
    const three = two + peek(2);
    if (three === "===" || three === "!==") {
      emit("op", three, start, i + 3);
      advance(3);
      continue;
    }
    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||") {
      emit("op", two, start, i + 2);
      advance(2);
      continue;
    }
    if (ch === "=" || ch === "!" || ch === "<" || ch === ">") {
      emit("op", ch, start, i + 1);
      advance();
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "{" || ch === "}" || ch === "," || ch === ";" || ch === ".") {
      emit("punct", ch, start, i + 1);
      advance();
      continue;
    }

    if (ch === "-" && !/[0-9]/.test(peek(1))) {
      emit("op", "-", start, i + 1);
      advance();
      continue;
    }

    throw new Error(`Unexpected character "${ch}" at ${line}:${column}`);
  }

  emit("eof", null, i, i);
  return tokens;
}
