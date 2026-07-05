function unescapeJsonPointerToken(token) {
  return String(token).replace(/~1/g, "/").replace(/~0/g, "~");
}

function escapeJsonPointerToken(token) {
  return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * @param {string} pointer RFC 6901
 * @returns {string[]}
 */
function splitJsonPointer(pointer) {
  const p = String(pointer ?? "").trim();
  const trimmed = p.startsWith("/") ? p.slice(1) : p;
  if (!trimmed) return [];
  return trimmed.split("/").map(unescapeJsonPointerToken);
}

/**
 * @param {string} path dot path, e.g. material.textureUrl
 */
function pathToPointer(path) {
  const raw = String(path ?? "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("/")) {
    return raw;
  }
  const parts = raw.split(".").filter(Boolean).map(escapeJsonPointerToken);
  return `/${parts.join("/")}`;
}

/**
 * @param {object} root
 * @param {string} pointer RFC 6901
 */
function getByPointer(root, pointer) {
  const parts = splitJsonPointer(pointer);
  let cur = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * @param {object} root
 * @param {string} pointer
 * @param {*} value
 * @param {{ createMissing?: boolean }} [options]
 */
function setByPointer(root, pointer, value, options = {}) {
  const parts = splitJsonPointer(pointer);
  if (parts.length === 0) {
    throw new Error("Invalid JSON Pointer for set (empty).");
  }
  let cur = root;
  const createMissing = options.createMissing === true;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (cur[part] === undefined || cur[part] === null) {
      if (!createMissing) {
        throw new Error(`JSON Pointer segment "${part}" missing on path "${pointer}".`);
      }
      cur[part] = {};
    }
    if (typeof cur[part] !== "object") {
      throw new Error(`Cannot set JSON Pointer "${pointer}": "${part}" is not an object.`);
    }
    cur = cur[part];
  }
  const leaf = parts[parts.length - 1];
  if (cur == null || typeof cur !== "object") {
    throw new Error(`Cannot set JSON Pointer "${pointer}": parent is not an object.`);
  }
  cur[leaf] = value;
}

/**
 * @param {object} root
 * @param {string} path dot path or pointer
 */
function getByPath(root, path) {
  return getByPointer(root, pathToPointer(path));
}

/**
 * @param {object} root
 * @param {string} path dot path or pointer
 * @param {*} value
 * @param {{ createMissing?: boolean }} [options]
 */
function setByPath(root, path, value, options = {}) {
  return setByPointer(root, pathToPointer(path), value, options);
}

export {
  splitJsonPointer,
  pathToPointer,
  getByPointer,
  setByPointer,
  getByPath,
  setByPath
};
