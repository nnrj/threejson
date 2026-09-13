import { cloneDocumentData, documentError } from "./sceneDocument.js";

function numbers(values) {
  if (!Array.isArray(values) && !ArrayBuffer.isView(values)) throw documentError("INVALID_BUFFER_VALUES", "Buffer values must be an array.");
  const result = [];
  const append = (list) => {
    for (const value of list) {
      if (Array.isArray(value) || ArrayBuffer.isView(value)) append(value);
      else {
        const number = Number(value);
        if (!Number.isFinite(number)) throw documentError("INVALID_BUFFER_VALUES", "Buffer values must be finite.");
        result.push(number);
      }
    }
  };
  append(values);
  return result;
}

function checkedOffset(value) {
  const offset = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0) throw documentError("INVALID_BUFFER_OFFSET", "Buffer offset must be a non-negative integer.");
  return offset;
}

/** Copy-on-write buffer transactions, shared by document planning and runtime commands. */
export function prepareBufferMeshDraft(record, previous, operation, args = {}) {
  if (String(record.objType).toLowerCase() !== "buffermesh") throw documentError("INVALID_BUFFER_TARGET", "mesh.buffer.* requires objType bufferMesh.");
  const current = Number(record.meshRevision || 0);
  if ((args.baseRevision != null && Number(args.baseRevision) !== current) || (previous && previous.baseRevision !== current)) {
    throw documentError("E_MESH_REVISION_CONFLICT", `Buffer draft does not match current mesh revision ${current}.`);
  }
  const id = record.threeJsonId;
  if (operation === "cancel") return { draft: null, data: { threeJsonId: id, cancelled: Boolean(previous) } };
  if (operation === "commit") {
    if (!previous) throw documentError("MISSING_BUFFER_DRAFT", "No pending mesh.buffer transaction exists for this mesh.");
    const descriptor = cloneDocumentData(previous.descriptor);
    descriptor.meshRevision = current + 1;
    return { draft: null, descriptor, data: { threeJsonId: id, revision: descriptor.meshRevision, changed: [...previous.changed] } };
  }
  const draft = previous ? { baseRevision: previous.baseRevision, descriptor: cloneDocumentData(previous.descriptor), changed: [...previous.changed] }
    : { baseRevision: current, descriptor: cloneDocumentData(record), changed: [] };
  const geometry = draft.descriptor.geometry ||= {};
  const isIndex = operation === "appendIndices" || operation === "setIndexRange";
  const append = operation === "appendAttribute" || operation === "appendIndices";
  if (!["appendAttribute", "setAttributeRange", "appendIndices", "setIndexRange"].includes(operation)) throw documentError("INVALID_BUFFER_OPERATION", `Unknown buffer edit: ${operation}.`);
  let target, name;
  if (isIndex) {
    const input = geometry.index ?? geometry.indices ?? [];
    target = Array.isArray(input) || ArrayBuffer.isView(input) ? { array: numbers(input), type: "Uint32Array" }
      : { ...input, array: numbers(input.array || input.data || []) };
    geometry.index = target; delete geometry.indices;
    name = "index";
  } else {
    name = String(args.name || "").trim();
    if (!name || ["__proto__", "prototype", "constructor"].includes(name)) throw documentError("INVALID_ATTRIBUTE_NAME", "A valid attribute name is required.");
    const shorthand = { position: "positions", normal: "normals", tangent: "tangents", color: "colors", uv: "uvs" }[name];
    const attributes = geometry.attributes ||= {};
    const input = attributes[name] || (shorthand ? geometry[shorthand] : null) || [];
    target = Array.isArray(input) || ArrayBuffer.isView(input)
      ? { array: numbers(input), type: args.type || "Float32Array", itemSize: args.itemSize ?? (name === "uv" ? 2 : name === "tangent" ? 4 : 3) }
      : { ...input, array: numbers(input.array || []), ...(args.itemSize !== undefined ? { itemSize: args.itemSize } : {}) };
    if (!Number.isSafeInteger(target.itemSize) || target.itemSize < 1) throw documentError("INVALID_ITEM_SIZE", "Attribute itemSize must be a positive integer.");
    attributes[name] = target;
    if (shorthand) delete geometry[shorthand];
  }
  const values = numbers(args.values ?? args.array ?? args.indices);
  if (isIndex && values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw documentError("INVALID_BUFFER_INDEX", "Indices must be non-negative integers.");
  const offset = append ? target.array.length : checkedOffset(args.offset);
  if (!append && offset + values.length > target.array.length && args.expand !== true) throw documentError("BUFFER_RANGE_EXCEEDED", "Range exceeds the array; use expand:true to grow it.");
  while (target.array.length < offset) target.array.push(0);
  // Never spread large arrays into arguments: that introduces a hidden call-stack limit.
  for (let i = 0; i < values.length; i++) target.array[offset + i] = values[i];
  if (!draft.changed.includes(name)) draft.changed.push(name);
  return { draft, data: { threeJsonId: id, baseRevision: current, pending: true, ...(isIndex ? { indexCount: target.array.length } : { attribute: name, valueCount: target.array.length }), offset, count: values.length } };
}
