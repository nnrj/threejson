/**
 * EventScript parser — produces AST for the runtime interpreter.
 */

import { tokenizeEventScript } from "./lexer.js";

function stripRunCommandSuffix(value) {
  return String(value ?? "")
    .trim()
    .replace(/;\s*$/, "");
}

/**
 * @param {string} source
 */
function parseEventScriptFromTokens(source) {
  const tokens = tokenizeEventScript(source);
  let index = 0;

  function current() {
    return tokens[index];
  }

  function peek(offset = 0) {
    return tokens[index + offset];
  }

  function eat(type, value) {
    const token = current();
    if (!token || token.type !== type) {
      throw new Error(`Expected ${type} but got ${token?.type ?? "eof"} at ${token?.line}:${token?.column}`);
    }
    if (value != null && token.value !== value) {
      throw new Error(`Expected ${value} but got ${token.value} at ${token.line}:${token.column}`);
    }
    index += 1;
    return token;
  }

  function match(type, value) {
    const token = current();
    if (!token || token.type !== type) {
      return false;
    }
    if (value != null && token.value !== value) {
      return false;
    }
    index += 1;
    return true;
  }

  function skipSemis() {
    while (match("punct", ";")) {
      // optional statement terminators
    }
  }

  function parseProgram() {
    /** @type {object[]} */
    const body = [];
    skipSemis();
    while (current().type !== "eof") {
      body.push(parseStatement());
      skipSemis();
    }
    return { type: "Program", body };
  }

  function parseStatement() {
    if (match("keyword", "await")) {
      eat("keyword", "wait");
      eat("punct", "(");
      const ms = parseExpression();
      eat("punct", ")");
      return { type: "AwaitWait", ms };
    }
    if (match("keyword", "if")) {
      eat("punct", "(");
      const test = parseExpression();
      eat("punct", ")");
      const consequent = parseBlock();
      let alternate = null;
      if (match("keyword", "else")) {
        alternate = parseBlock();
      }
      return { type: "IfStatement", test, consequent, alternate };
    }
    if (current().type === "keyword" && current().value === "var") {
      return parseVarDecl(false);
    }
    if (current().type === "ident" && peek(1)?.type === "ident" && peek(2)?.type === "op" && peek(2)?.value === "=") {
      return parseVarDecl(true);
    }
    const expr = parseExpression();
    return { type: "ExpressionStatement", expression: expr };
  }

  function parseVarDecl(typed) {
    let objType = null;
    if (typed) {
      objType = eat("ident").value;
    } else {
      eat("keyword", "var");
    }
    const name = eat("ident").value;
    eat("op", "=");
    const init = parseExpression();
    return { type: "VarDeclaration", name, init, objType };
  }

  function parseBlock() {
    eat("punct", "{");
    /** @type {object[]} */
    const body = [];
    skipSemis();
    while (!match("punct", "}")) {
      body.push(parseStatement());
      skipSemis();
    }
    return { type: "BlockStatement", body };
  }

  function parseExpression() {
    return parseAssignment();
  }

  function parseAssignment() {
    const expr = parseLogicalOr();
    if (match("op", "=")) {
      if (expr.type !== "MemberExpression" && expr.type !== "Identifier") {
        throw new Error(`Invalid assignment target at ${current().line}:${current().column}`);
      }
      return { type: "AssignmentExpression", left: expr, right: parseAssignment() };
    }
    return expr;
  }

  function parseLogicalOr() {
    let node = parseLogicalAnd();
    while (match("op", "||")) {
      node = { type: "BinaryExpression", operator: "||", left: node, right: parseLogicalAnd() };
    }
    return node;
  }

  function parseLogicalAnd() {
    let node = parseEquality();
    while (match("op", "&&")) {
      node = { type: "BinaryExpression", operator: "&&", left: node, right: parseEquality() };
    }
    return node;
  }

  function parseEquality() {
    let node = parseComparison();
    while (current().type === "op" && (current().value === "==" || current().value === "!=")) {
      const op = eat("op").value;
      node = { type: "BinaryExpression", operator: op, left: node, right: parseComparison() };
    }
    return node;
  }

  function parseComparison() {
    let node = parseUnary();
    while (current().type === "op" && [">", "<", ">=", "<="].includes(String(current().value))) {
      const op = eat("op").value;
      node = { type: "BinaryExpression", operator: op, left: node, right: parseUnary() };
    }
    return node;
  }

  function parseUnary() {
    if (match("op", "!")) {
      return { type: "UnaryExpression", operator: "!", argument: parseUnary() };
    }
    if (match("op", "-")) {
      return { type: "UnaryExpression", operator: "-", argument: parseUnary() };
    }
    return parseCallChain();
  }

  function parseCallChain() {
    let node = parsePrimary();
    while (true) {
      if (match("punct", ".")) {
        const property = eat("ident").value;
        node = { type: "MemberExpression", object: node, property };
        continue;
      }
      if (match("punct", "(")) {
        /** @type {object[]} */
        const args = [];
        if (!match("punct", ")")) {
          do {
            args.push(parseExpression());
          } while (match("punct", ","));
          eat("punct", ")");
        }
        node = { type: "CallExpression", callee: node, args };
        continue;
      }
      break;
    }
    return node;
  }

  function parsePrimary() {
    const token = current();
    if (match("number")) {
      return { type: "Literal", value: token.value };
    }
    if (match("string")) {
      return { type: "Literal", value: token.value };
    }
    if (match("keyword", "true")) {
      return { type: "Literal", value: true };
    }
    if (match("keyword", "false")) {
      return { type: "Literal", value: false };
    }
    if (match("ident", "$") || match("keyword", "ref")) {
      eat("punct", "(");
      const arg = parseExpression();
      eat("punct", ")");
      return { type: "ResolveExpression", token: arg };
    }
    if (match("ident")) {
      return { type: "Identifier", name: token.value };
    }
    if (match("punct", "(")) {
      const expr = parseExpression();
      eat("punct", ")");
      return expr;
    }
    throw new Error(`Unexpected token ${token?.type}:${token?.value} at ${token?.line}:${token?.column}`);
  }

  return parseProgram();
}

/**
 * Full-line `run` / `await run` use micro DSL text and are extracted before tokenizing.
 *
 * @param {string} source
 */
export function parseEventScript(source) {
  const lines = String(source ?? "").split(/\r?\n/);
  /** @type {object[]} */
  const body = [];
  /** @type {string[]} */
  const chunk = [];

  function flushChunk() {
    const part = chunk.join("\n").trim();
    chunk.length = 0;
    if (!part) {
      return;
    }
    body.push(...parseEventScriptFromTokens(part).body);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) {
      chunk.push(line);
      continue;
    }
    const awaitRun = trimmed.match(/^await\s+run\s+(.+)$/i);
    if (awaitRun) {
      flushChunk();
      body.push({ type: "AwaitRun", commandText: stripRunCommandSuffix(awaitRun[1]) });
      continue;
    }
    const runLine = trimmed.match(/^run\s+(.+)$/i);
    if (runLine) {
      flushChunk();
      body.push({ type: "Run", commandText: stripRunCommandSuffix(runLine[1]) });
      continue;
    }
    chunk.push(line);
  }
  flushChunk();
  return { type: "Program", body };
}
