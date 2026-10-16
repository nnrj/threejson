/**
 * Safe numeric-expression evaluator for JSON numeric fields and EventScript.
 * It deliberately does not use eval/new Function. Supported syntax:
 * numbers, PI/E/TAU, parentheses, arithmetic operators (including powers), and selected Math functions.
 */

const CONSTANTS = Object.freeze({
  PI: Math.PI,
  E: Math.E,
  TAU: Math.PI * 2
});

const FUNCTIONS = Object.freeze({
  abs: Math.abs,
  acos: Math.acos,
  asin: Math.asin,
  atan: Math.atan,
  atan2: Math.atan2,
  ceil: Math.ceil,
  cos: Math.cos,
  floor: Math.floor,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan
});

export function tokenizeNumericExpression(source) {
  const text = String(source ?? "");
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = text.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!match) throw new Error(`Invalid number at ${i}`);
      tokens.push({ type: "number", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      tokens.push({ type: "ident", value: match[0] });
      i += match[0].length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (two === "**") {
      tokens.push({ type: "op", value: "**" });
      i += 2;
      continue;
    }
    if ("+-*/%^(),".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected character "${ch}" at ${i}`);
  }
  tokens.push({ type: "eof", value: null });
  return tokens;
}

export function evaluateNumericExpression(source, variables = {}) {
  if (typeof source === "number") {
    if (!Number.isFinite(source)) throw new Error("Numeric value must be finite");
    return source;
  }
  const tokens = tokenizeNumericExpression(source);
  let index = 0;
  const current = () => tokens[index];
  const match = (value) => current()?.value === value && Boolean(++index);
  const eat = (value) => {
    if (!match(value)) throw new Error(`Expected "${value}"`);
  };

  function primary() {
    const token = current();
    if (token.type === "number") {
      index += 1;
      return token.value;
    }
    if (token.type === "ident") {
      index += 1;
      const name = token.value;
      if (match("(")) {
        const fn = FUNCTIONS[name.toLowerCase()];
        if (!fn) throw new Error(`Unknown numeric function "${name}"`);
        const args = [];
        if (!match(")")) {
          do args.push(expression()); while (match(","));
          eat(")");
        }
        const result = fn(...args);
        if (!Number.isFinite(result)) throw new Error(`Function "${name}" returned a non-finite value`);
        return result;
      }
      const constant = CONSTANTS[name.toUpperCase()];
      if (Number.isFinite(constant)) return constant;
      const variable = variables?.[name];
      if (Number.isFinite(Number(variable))) return Number(variable);
      throw new Error(`Unknown numeric constant or variable "${name}"`);
    }
    if (match("(")) {
      const value = expression();
      eat(")");
      return value;
    }
    throw new Error("Expected a number, constant, function, or parenthesized expression");
  }

  function unary() {
    if (match("+")) return unary();
    if (match("-")) return -unary();
    return primary();
  }

  function power() {
    const left = unary();
    if (match("**") || match("^")) return Math.pow(left, power());
    return left;
  }

  function product() {
    let value = power();
    while (["*", "/", "%"].includes(current()?.value)) {
      const op = current().value;
      index += 1;
      const right = power();
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  }

  function expression() {
    let value = product();
    while (["+", "-"].includes(current()?.value)) {
      const op = current().value;
      index += 1;
      const right = product();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  const result = expression();
  if (current().type !== "eof") throw new Error(`Unexpected token "${current().value}"`);
  if (!Number.isFinite(result)) throw new Error("Numeric expression result must be finite");
  return result;
}

export function resolveNumericValue(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      return evaluateNumericExpression(value);
    } catch (_error) {
      return fallback;
    }
  }
  return fallback;
}

export { CONSTANTS as NUMERIC_CONSTANTS, FUNCTIONS as NUMERIC_FUNCTIONS };
