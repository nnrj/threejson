/** Immutable authoring data and copy-on-write operations. No renderer or host imports. */
export const SCENE_DOCUMENT_VERSION = 2;

export function documentError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

export function cloneDocumentData(value, ancestors = new Set(), path = "") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw documentError("INVALID_DOCUMENT_VALUE", `Non-finite number at ${path || "/"}.`);
    return value;
  }
  if (typeof value !== "object") throw documentError("INVALID_DOCUMENT_VALUE", `Non-JSON value at ${path || "/"}.`);
  if (ancestors.has(value)) throw documentError("CYCLIC_DOCUMENT", `Cyclic value at ${path || "/"}.`);
  ancestors.add(value);
  try {
    if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return Array.from(value, (item, i) => cloneDocumentData(item, ancestors, `${path}/${i}`));
    if (Array.isArray(value)) return value.map((item, i) => cloneDocumentData(item, ancestors, `${path}/${i}`));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw documentError("INVALID_DOCUMENT_VALUE", `Expected plain data at ${path || "/"}.`);
    }
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, cloneDocumentData(item, ancestors, `${path}/${escapePointer(key)}`)]));
  } finally { ancestors.delete(value); }
}

export function freezeDocumentData(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freezeDocumentData(item);
    Object.freeze(value);
  }
  return value;
}

export function createSceneDocument(root, options = {}) {
  if (!root || typeof root !== "object" || Array.isArray(root)) throw documentError("INVALID_SCENE_DOCUMENT", "Scene root must be an object.");
  if (root.schemaVersion !== undefined && (!Number.isInteger(root.schemaVersion) || root.schemaVersion < 1 || root.schemaVersion > SCENE_DOCUMENT_VERSION)) {
    throw documentError("UNSUPPORTED_SCHEMA_VERSION", `Unsupported scene schemaVersion: ${root.schemaVersion}.`);
  }
  const revision = options.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw documentError("INVALID_REVISION", "Document revision must be a non-negative safe integer.");
  return freezeDocumentData({ kind: "SceneDocument", schemaVersion: SCENE_DOCUMENT_VERSION, revision,
    sourceFormat: options.sourceFormat || "standard", root: cloneDocumentData(root) });
}

export const isSceneDocument = (value) => value?.kind === "SceneDocument" && value.schemaVersion === SCENE_DOCUMENT_VERSION && Boolean(value.root);
export const escapePointer = (value) => String(value).replace(/~/g, "~0").replace(/\//g, "~1");

function equalData(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equalData(a[key], b[key]));
}

function pointerParts(path) {
  if (path === "") return [];
  if (typeof path !== "string" || !path.startsWith("/") || /~(?![01])/u.test(path)) throw documentError("INVALID_POINTER", `Invalid JSON pointer: ${path}.`);
  const parts = path.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts.some((part) => ["__proto__", "constructor", "prototype"].includes(part))) throw documentError("INVALID_POINTER", "Prototype paths are not document properties.");
  return parts;
}

function arrayIndex(container, key, allowEnd = false) {
  if (key === "-" && allowEnd) return container.length;
  if (!/^(0|[1-9]\d*)$/u.test(key)) throw documentError("INVALID_POINTER", `Invalid array index: ${key}.`);
  const index = Number(key);
  if (!Number.isSafeInteger(index) || index >= container.length + (allowEnd ? 1 : 0)) throw documentError("MISSING_PATH", `Array index out of range: ${key}.`);
  return index;
}

export function readDocumentPointer(root, path) {
  let value = root;
  for (const key of pointerParts(path)) {
    if (!value || typeof value !== "object") throw documentError("MISSING_PATH", `Missing path: ${path}.`);
    const resolved = Array.isArray(value) ? arrayIndex(value, key) : key;
    if (!Object.hasOwn(value, resolved)) throw documentError("MISSING_PATH", `Missing path: ${path}.`);
    value = value[resolved];
  }
  return value;
}

function changeAt(root, parts, operation) {
  if (!parts.length) {
    if (operation.op === "remove") throw documentError("INVALID_OPERATION", "Cannot remove the scene root.");
    return operation.value;
  }
  if (!root || typeof root !== "object") throw documentError("MISSING_PATH", `Missing path: ${operation.path}.`);
  const [key, ...rest] = parts;
  const copy = Array.isArray(root) ? root.slice() : { ...root };
  const index = Array.isArray(root) ? arrayIndex(root, key, !rest.length && operation.op === "add") : key;
  const exists = Object.hasOwn(root, index);
  if (rest.length) {
    if (!exists) throw documentError("MISSING_PATH", `Missing path: ${operation.path}.`);
    copy[index] = changeAt(root[index], rest, operation);
  } else if (operation.op === "remove") {
    if (!exists) throw documentError("MISSING_PATH", `Missing path: ${operation.path}.`);
    if (Array.isArray(copy)) copy.splice(index, 1);
    else delete copy[index];
  } else {
    if (operation.op === "replace" && !exists) throw documentError("MISSING_PATH", `Missing path: ${operation.path}.`);
    if (Array.isArray(copy) && operation.op === "add") copy.splice(index, 0, operation.value);
    else copy[index] = operation.value;
  }
  return copy;
}

/** Author-owned objects only; geometry inputs, Domain-generated parts and native internals are not entities. */
export function indexSceneDocument(document) {
  const root = isSceneDocument(document) ? document.root : document;
  const entries = new Map();
  const visit = (record, path, parentId = null) => {
    if (!record || typeof record !== "object") return;
    const id = record.threeJsonId;
    if (typeof id === "string" && id) {
      if (entries.has(id)) throw documentError("DUPLICATE_OBJECT_ID", `Duplicate authoring object ID: ${id}.`, { id, paths: [entries.get(id).path, path] });
      entries.set(id, { id, path, parentId, record });
    }
    if (Array.isArray(record.subScene)) record.subScene.forEach((child, i) => visit(child, `${path}/subScene/${i}`, id || parentId));
    if (Array.isArray(record.levels)) record.levels.forEach((level, i) => visit(level.object, `${path}/levels/${i}/object`, id || parentId));
  };
  (root.objectList || []).forEach((record, i) => visit(record, `/objectList/${i}`));
  (root.sceneConfig?.lights || []).forEach((record, i) => visit(record, `/sceneConfig/lights/${i}`));
  return entries;
}

function flattenPatch(root, path, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw documentError("INVALID_OPERATION", "object.patch requires an object patch.");
  const operations = [];
  for (const [key, value] of Object.entries(patch)) {
    const childPath = `${path}/${escapePointer(key)}`;
    const current = root[key];
    if (value && current && typeof value === "object" && typeof current === "object" && !Array.isArray(value) && !Array.isArray(current)) {
      operations.push(...flattenPatch(current, childPath, value));
    } else operations.push({ op: Object.hasOwn(root, key) ? "replace" : "add", path: childPath, value });
  }
  return operations;
}

/** Apply a whole batch privately; the input and unmodified subtrees retain identity. */
export function applyDocumentOperations(document, operations, options = {}) {
  if (!isSceneDocument(document)) throw documentError("INVALID_SCENE_DOCUMENT", "Expected a SceneDocument.");
  if (!Array.isArray(operations)) throw documentError("INVALID_OPERATION", "operations must be an array.");
  if (options.baseRevision !== undefined && options.baseRevision !== document.revision) throw documentError("STALE_SCENE_REVISION", "The scene changed after this operation was planned.", { expected: document.revision, actual: options.baseRevision });
  let root = document.root;
  const inverse = [], applied = [];
  const apply = (raw) => {
    if (!raw || typeof raw !== "object") throw documentError("INVALID_OPERATION", "Invalid document operation.");
    if (raw.op === "copy" || raw.op === "move") {
      const from = pointerParts(raw.from), to = pointerParts(raw.path);
      if (raw.op === "move" && to.length > from.length && from.every((part, i) => to[i] === part)) throw documentError("INVALID_OPERATION", "Cannot move a value into its own descendant.");
      const value = readDocumentPointer(root, raw.from);
      if (raw.op === "move" && raw.from === raw.path) return;
      if (raw.op === "move") apply({ op: "remove", path: raw.from });
      apply({ op: "add", path: raw.path, value });
      return;
    }
    if (raw.op === "array.splice") {
      const parts = pointerParts(raw.path);
      const source = readDocumentPointer(root, raw.path);
      if (!Array.isArray(source) || !Number.isSafeInteger(raw.index) || raw.index < 0 || raw.index > source.length ||
        !Number.isSafeInteger(raw.deleteCount) || raw.deleteCount < 0 || raw.index + raw.deleteCount > source.length || !Array.isArray(raw.values)) {
        throw documentError("INVALID_OPERATION", "array.splice requires a valid array, index, deleteCount and values.");
      }
      const values = freezeDocumentData(cloneDocumentData(raw.values));
      const removed = source.slice(raw.index, raw.index + raw.deleteCount);
      if (equalData(removed, values)) return;
      const next = source.slice(0, raw.index).concat(values, source.slice(raw.index + raw.deleteCount));
      root = changeAt(root, parts, { op: "replace", path: raw.path, value: next });
      applied.push({ op: "array.splice", path: raw.path, index: raw.index, deleteCount: raw.deleteCount, values });
      inverse.unshift({ op: "array.splice", path: raw.path, index: raw.index, deleteCount: values.length, values: removed });
      return;
    }
    if (raw.op === "object.patch" || raw.op === "object.remove") {
      const entry = indexSceneDocument(root).get(raw.id);
      if (!entry) throw documentError("OBJECT_NOT_FOUND", `Object not found: ${raw.id}.`);
      const edits = raw.op === "object.remove" ? [{ op: "remove", path: entry.path }] : flattenPatch(entry.record, entry.path, raw.patch);
      edits.forEach(apply); return;
    }
    if (!["add", "replace", "remove", "test"].includes(raw.op)) throw documentError("INVALID_OPERATION", `Unsupported document operation: ${raw.op}.`);
    const parts = pointerParts(raw.path);
    if (raw.op === "test") {
      if (!equalData(readDocumentPointer(root, raw.path), raw.value)) throw documentError("DOCUMENT_TEST_FAILED", `Document test failed at ${raw.path}.`);
      return;
    }
    const parent = parts.length ? readDocumentPointer(root, parts.length === 1 ? "" : `/${parts.slice(0, -1).map(escapePointer).join("/")}`) : null;
    const key = parts[parts.length - 1];
    const actualPath = Array.isArray(parent) && key === "-" ? `${raw.path.slice(0, -1)}${parent.length}` : raw.path;
    const exists = !parts.length || (parent && Object.hasOwn(parent, key));
    const before = exists ? readDocumentPointer(root, raw.path) : undefined;
    const operation = { op: raw.op, path: raw.path, ...(raw.op !== "remove" ? { value: freezeDocumentData(cloneDocumentData(raw.value)) } : {}) };
    if (exists && raw.op !== "remove" && (raw.op === "replace" || !Array.isArray(parent)) && equalData(before, operation.value)) return;
    root = changeAt(root, parts, operation);
    if (!root || typeof root !== "object" || Array.isArray(root)) throw documentError("INVALID_SCENE_DOCUMENT", "Scene root must remain an object.");
    const undo = raw.op === "add" && (Array.isArray(parent) || !exists) ? { op: "remove", path: actualPath }
      : { op: raw.op === "remove" ? "add" : "replace", path: raw.path, value: before };
    inverse.unshift(undo);
    applied.push(operation);
  };
  operations.forEach(apply);
  indexSceneDocument(root);
  const changed = applied.length > 0;
  if (changed && !Number.isSafeInteger(document.revision + 1)) throw documentError("REVISION_EXHAUSTED", "Revision exceeds the exact integer range; start a new document lineage.");
  if (root.schemaVersion !== undefined && (!Number.isInteger(root.schemaVersion) || root.schemaVersion < 1 || root.schemaVersion > SCENE_DOCUMENT_VERSION)) throw documentError("UNSUPPORTED_SCHEMA_VERSION", "A transaction cannot set an unsupported schema version.");
  return { document: changed ? freezeDocumentData({ ...document, revision: document.revision + 1, root }) : document,
    operations: freezeDocumentData(applied), inverse: freezeDocumentData(inverse), changed };
}
