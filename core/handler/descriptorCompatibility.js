import { NUMERIC_CONSTANTS, NUMERIC_FUNCTIONS, tokenizeNumericExpression } from "../util/numericExpression.js";

const error = (record, message, code) => Object.assign(new Error(`Object "${record.threeJsonId || record.objType}": ${message}`), { code, objectId: record.threeJsonId });

/** Input aliases only. Call on an owned clone, never on the author's document. */
export function normalizeDescriptorCompatibility(record) {
  const type = String(record.objType || "").trim().toLowerCase();
  if (type === "native" || record.parseMode === "native") return record;
  if (type === "group" && Array.isArray(record.children)) {
    if (record.children.length) {
      if (record.subScene != null && !Array.isArray(record.subScene)) throw error(record, "subScene must be an array.", "OBJECT_CHILDREN_INVALID");
      if (!record.children.every(child => child && typeof child.objType === "string")) {
        throw error(record, "group.children must contain ThreeJSON object descriptors; use subScene.", "OBJECT_CHILDREN_INVALID");
      }
      if (record.subScene?.length && JSON.stringify(record.subScene) !== JSON.stringify(record.children)) {
        throw error(record, "group.children conflicts with subScene; keep one canonical subScene list.", "OBJECT_CHILDREN_CONFLICT");
      }
      if (!record.subScene?.length) record.subScene = record.children;
    }
    delete record.children;
  }
  const geometry = record.geometry;
  if (type === "parametricsurface" && geometry?.func !== undefined && !geometry.expressions && !geometry.expression) {
    try {
      record.geometry = { ...geometry, expressions: arithmeticSurfaceExpressions(geometry.func) };
      delete record.geometry.func;
    } catch (cause) {
      throw error(record, `Unsupported geometry.func: ${cause.message} Use geometry.expressions {x,y,z}; JavaScript is never executed.`, "PARAMETRIC_FUNCTION_UNSUPPORTED");
    }
  }
  return record;
}

// A migration grammar, not a JavaScript interpreter: two parameters, optional
// sequential const arithmetic bindings, and one [x,y,z] result. Expansion limits
// protect the parser from exponentially repeated bindings in untrusted input.
export function arithmeticSurfaceExpressions(source) {
  if (typeof source !== "string" || source.length > 16384) throw new Error("Expected a short arithmetic arrow expression.");
  const match = /^\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)\s*=>\s*([\s\S]+?)\s*$/.exec(source);
  if (!match || match[1] === match[2]) throw new Error("Expected two distinct surface parameters.");
  const reserved = name => Object.hasOwn(NUMERIC_CONSTANTS, name.toUpperCase()) || Object.hasOwn(NUMERIC_FUNCTIONS, name.toLowerCase()) || name === "Math";
  if (reserved(match[1]) || reserved(match[2])) throw new Error("Reserved parameter name.");
  const bindings = new Map([[match[1], "u"], [match[2], "v"]]);
  const expand = expression => {
    if (/\^/.test(expression)) throw new Error("Use ** for powers, not JavaScript XOR.");
    const tokens = tokenizeNumericExpression(expression.replace(/\bMath\.([A-Za-z_]\w*)/g, (_, name) => {
      if (!Object.hasOwn(NUMERIC_FUNCTIONS, name) && !Object.hasOwn(NUMERIC_CONSTANTS, name)) throw new Error(`Unsupported Math member ${name}.`);
      return name;
    })).filter(token => token.type !== "eof");
    let size = 0;
    return tokens.map((token, index) => {
      let value = String(token.value);
      if (token.type === "ident") {
        if (tokens[index + 1]?.value === "(") {
          if (!Object.hasOwn(NUMERIC_FUNCTIONS, value)) throw new Error(`Unsupported function ${value}.`);
        } else if (bindings.has(value)) value = `(${bindings.get(value)})`;
        else if (!Object.hasOwn(NUMERIC_CONSTANTS, value)) throw new Error(`Unknown binding ${value}.`);
      }
      size += value.length + 1;
      if (size > 32768) throw new Error("Arithmetic expansion is too large.");
      return value;
    }).join(" ");
  };
  let body = match[3].trim();
  if (body.startsWith("{")) {
    if (!body.endsWith("}")) throw new Error("Unclosed arithmetic body.");
    body = body.slice(1, -1).trim();
    while (body.startsWith("const ")) {
      const statement = /^const\s+([A-Za-z_]\w*)\s*=\s*([^;]+);\s*/.exec(body);
      if (!statement || bindings.has(statement[1]) || reserved(statement[1])) throw new Error("Invalid or duplicate const binding.");
      bindings.set(statement[1], expand(statement[2]));
      body = body.slice(statement[0].length);
    }
    if (!/^return\s/.test(body)) throw new Error("Expected a returned coordinate array.");
    body = body.replace(/^return\s+/, "").replace(/;\s*$/, "").trim();
  }
  if (!body.startsWith("[") || !body.endsWith("]")) throw new Error("Expected [x,y,z].");
  const parts = []; let depth = 0, begin = 1;
  for (let index = 1; index < body.length - 1; index++) {
    const ch = body[index];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) throw new Error("Unbalanced parentheses.");
    if (ch === "," && depth === 0) { parts.push(body.slice(begin, index)); begin = index + 1; }
  }
  parts.push(body.slice(begin, -1));
  if (depth || parts.length !== 3 || parts.some(part => !part.trim())) throw new Error("Expected three arithmetic coordinates.");
  return Object.fromEntries(["x", "y", "z"].map((axis, index) => [axis, expand(parts[index])]));
}
