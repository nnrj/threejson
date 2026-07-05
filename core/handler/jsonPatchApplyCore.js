/**
 * RFC 6902 JSON Patch subset (add / replace / remove) with path allowlist; pure JSON, no Three / binding side effects.
 */

/** @param {string} token */
function unescapeJsonPointer(token) {
  return String(token).replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * @param {string} path
 * @param {string[]} allowedPrefixes
 */
function isPathAllowed(path, allowedPrefixes) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    return false;
  }
  for (let i = 0; i < allowedPrefixes.length; i++) {
    const p = allowedPrefixes[i];
    if (path === p || path.startsWith(p + "/")) {
      return true;
    }
  }
  return false;
}

/**
 * Normalize LLM paths like /worldInfo.sphereModelList/- → /worldInfo/sphereModelList/-.
 * @param {string} path
 */
function normalizeJsonPointerPath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    return path;
  }
  const slashIdx = path.indexOf("/", 1);
  if (slashIdx >= 0) {
    const head = path.slice(0, slashIdx);
    if (head.includes(".")) {
      return `${head.split(".").join("/")}${path.slice(slashIdx)}`;
    }
    return path;
  }
  if (path.includes(".")) {
    return `/${path.slice(1).split(".").join("/")}`;
  }
  return path;
}

/**
 * @param {string} path
 * @returns {string[]}
 */
function parsePointer(path) {
  if (path === "" || path === "/") {
    return [];
  }
  return path
    .slice(1)
    .split("/")
    .filter((s) => s.length > 0)
    .map(unescapeJsonPointer);
}

/**
 * @param {object} root
 * @param {string[]} parts
 * @param {boolean} createMissing
 */
function navigateParent(root, parts, createMissing) {
  if (parts.length === 0) {
    return { parent: null, key: "", exists: false };
  }
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (key === "" && i === 0) {
      continue;
    }
    const next = cur[key];
    if (next == null || typeof next !== "object") {
      if (createMissing) {
        cur[key] = {};
      } else {
        throw new Error(`json-patch: path missing segment "${key}"`);
      }
    }
    cur = cur[key];
  }
  const lastKey = parts[parts.length - 1];
  return { parent: cur, key: lastKey, exists: Object.prototype.hasOwnProperty.call(cur, lastKey) };
}

const DEFAULT_ALLOWED_PREFIXES = [
  "/position",
  "/rotation",
  "/scale",
  "/name",
  "/material",
  "/animations",
  "/animationMode",
  "/threeJsonId",
  "/visible"
];

/**
 * @param {object} doc Descriptor JSON root (modified in place)
 * @param {object[]} patch
 * @param {{ allowedPathPrefixes?: string[] }} [options]
 * @returns {{ ok: boolean, error?: string }}
 */
function applyJsonPatchToJsonDocument(doc, patch, options = {}) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, error: "doc must be a plain object" };
  }
  if (!Array.isArray(patch)) {
    return { ok: false, error: "patch must be an array" };
  }
  const allowed = Array.isArray(options.allowedPathPrefixes)
    ? options.allowedPathPrefixes
    : DEFAULT_ALLOWED_PREFIXES;
  try {
    for (let i = 0; i < patch.length; i++) {
      const op = patch[i];
      if (!op || typeof op.op !== "string" || typeof op.path !== "string") {
        throw new Error(`invalid operation at index ${i}`);
      }
      const rawPath = op.path;
      const path = normalizeJsonPointerPath(rawPath);
      if (!isPathAllowed(path, allowed)) {
        throw new Error(`path not allowed: ${rawPath}`);
      }
      const parts = parsePointer(path);
      if (op.op === "replace" || op.op === "add") {
        if (parts.length === 0) {
          throw new Error("cannot add/replace root document via patch here");
        }
        const { parent, key } = navigateParent(doc, parts, op.op === "add");
        if (!parent || typeof parent !== "object") {
          throw new Error("invalid parent");
        }
        if (op.op === "add" && key === "-" && Array.isArray(parent)) {
          parent.push(op.value);
          continue;
        }
        parent[key] = op.value;
      } else if (op.op === "remove") {
        if (parts.length === 0) {
          throw new Error("cannot remove root");
        }
        const { parent, key } = navigateParent(doc, parts, false);
        if (!parent || typeof parent !== "object") {
          throw new Error("invalid parent");
        }
        delete parent[key];
      } else {
        throw new Error(`unsupported op: ${op.op}`);
      }
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return { ok: false, error: msg };
  }
  return { ok: true };
}

export {
  applyJsonPatchToJsonDocument,
  DEFAULT_ALLOWED_PREFIXES,
  isPathAllowed,
  normalizeJsonPointerPath
};
