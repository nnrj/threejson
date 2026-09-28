/** Classify strict JSON without guessing repairs. A valid prefix can be continued verbatim;
 * an invalid prefix cannot be fixed by appending text. Iterative to support deeply nested data. */
export function classifyJsonPrefix(source) {
  const text = String(source || "");
  const stack = [{ kind: "root", state: "value" }];
  let i = 0;
  const invalid = () => ({ status: "invalid", position: i });
  const incomplete = () => ({ status: "incomplete", position: text.length });
  const valueDone = () => { stack.at(-1).state = "after"; };
  while (true) {
    while (i < text.length && /[\x20\t\r\n]/.test(text[i])) i++;
    const frame = stack.at(-1);
    if (i === text.length) {
      return stack.length === 1 && frame.state === "after" ? { status: "complete" } : incomplete();
    }
    const ch = text[i];
    if (frame.state === "after") {
      if (frame.kind === "root") return invalid();
      if (ch === (frame.kind === "object" ? "}" : "]")) {
        stack.pop(); i++; valueDone(); continue;
      }
      if (ch !== ",") return invalid();
      frame.state = frame.kind === "object" ? "key" : "value";
      i++; continue;
    }
    if (frame.state === "colon") {
      if (ch !== ":") return invalid();
      frame.state = "value"; i++; continue;
    }
    if ((frame.state === "firstKey" && ch === "}") || (frame.state === "firstValue" && ch === "]")) {
      stack.pop(); i++; valueDone(); continue;
    }
    const isKey = frame.state === "firstKey" || frame.state === "key";
    if (isKey && ch !== '"') return invalid();
    if (ch === '"') {
      i++;
      let closed = false;
      while (i < text.length) {
        if (text.charCodeAt(i) < 32) return invalid();
        if (text[i] === '"') { i++; closed = true; break; }
        if (text[i] === "\\") {
          i++;
          if (i === text.length) return incomplete();
          if (text[i] === "u") {
            for (let n = 0; n < 4; n++) {
              i++;
              if (i === text.length) return incomplete();
              if (!/[0-9a-f]/i.test(text[i])) return invalid();
            }
          } else if (!'"\\/bfnrt'.includes(text[i])) return invalid();
        }
        i++;
      }
      if (!closed) return incomplete();
      frame.state = isKey ? "colon" : "after";
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push({ kind: ch === "{" ? "object" : "array", state: ch === "{" ? "firstKey" : "firstValue" });
      i++; continue;
    }
    const literal = { t: "true", f: "false", n: "null" }[ch];
    if (literal) {
      for (const expected of literal) {
        if (i === text.length) return incomplete();
        if (text[i] !== expected) return invalid();
        i++;
      }
      valueDone(); continue;
    }
    if (ch === "-" || /[0-9]/.test(ch)) {
      const start = i;
      while (i < text.length && /[0-9eE+.-]/.test(text[i])) i++;
      const token = text.slice(start, i);
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) {
        if (i === text.length && /^(?:-|\-?(?:0|[1-9]\d*)(?:\.|(?:\.\d+)?[eE][+-]?))$/.test(token)) return incomplete();
        return { status: "invalid", position: start };
      }
      valueDone(); continue;
    }
    return invalid();
  }
}
