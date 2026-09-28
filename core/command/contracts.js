/** JSON-only contracts shared by tools, AI discovery and both execution paths. */
const string = { type: "string", minLength: 1 };
const object = { type: "object" };
const integer = { type: "integer", minimum: 0 };
const list = { type: "array" };
const nonempty = { type: "array", minItems: 1 };
const number = { type: "number" };
const boolean = { type: "boolean" };
const common = {
  id: string, nodeId: string, name: string, category: string, parent: string, json: object,
  descriptor: object, partial: object, material: object, options: object, path: string,
  baseRevision: integer, offset: integer, limit: { type: "integer", minimum: 1 },
  materialIndex: integer, page: { type: "integer", minimum: 1 }, pageSize: { type: "integer", minimum: 1 },
  itemSize: { type: "integer", minimum: 1 }, patch: nonempty, operations: nonempty,
  values: { type: "array", items: number }, vertexIds: list, faceIds: list, part: string,
  bounds: object, views: { type: "array", items: string }, size: { type: "integer", minimum: 1 },
  mesh: string, sync: boolean, expand: boolean, clamp: boolean,
  includeDescriptor: boolean, includeParameters: boolean, includeArtifact: boolean,
  checkSelfIntersectionRisk: boolean,
  format: { enum: ["standard", "friendly"] }
};
const required = {
  "object.add": ["descriptor"], "object.remove": ["id"], "object.get": ["id"],
  "object.patch": ["id"], "material.patch": ["id"], "scene.applyPatch": ["patch"],
  "morph.list": ["id"], "morph.set": ["id", "target", "value"],
  "mesh.inspect": ["id"], "mesh.getTopology": ["id"], "mesh.validate": ["id"],
  "mesh.edit": ["id", "operations"], "mesh.bake": ["id"], "mesh.renderViews": ["id"],
  "mesh.buffer.appendAttribute": ["id", "name", "values"],
  "mesh.buffer.setAttributeRange": ["id", "name", "offset", "values"],
  "mesh.buffer.appendIndices": ["id", "values"], "mesh.buffer.setIndexRange": ["id", "offset", "values"],
  "mesh.buffer.commit": ["id"], "mesh.buffer.cancel": ["id"],
  "model.inspect": ["id"], "model.evaluate": ["id"], "model.patch": ["id", "baseRevision", "patch"],
  "model.bake": ["id"]
};
const read = new Set(["scene.list", "scene.export", "scene.validate", "object.get", "model.operators", "model.inspect", "model.evaluate", "mesh.inspect", "mesh.getTopology", "mesh.validate", "mesh.renderViews", "morph.list"]);

export function withCommandContract(spec) {
  const properties = Object.fromEntries(Object.entries(spec.args || {}).map(([key, description]) =>
    [key, { ...(common[key] || {}), description }]));
  if (spec.op === "morph.set") properties.value = number;
  // Input synonyms remain explicit until their consumers are migrated together.
  if (spec.op === "material.patch") { properties.material = object; properties.materialIndex = integer; }
  if (spec.op === "scene.list") { properties.offset = integer; properties.limit = { type: "integer", minimum: 1 }; }
  const alternatives = spec.op === "object.patch" ? [{ required: ["partial"] }, { required: ["path", "value"] }]
    : spec.op === "material.patch" ? [{ required: ["partial"] }, { required: ["material"] }] : null;
  const category = spec.category || (read.has(spec.op) ? "read" : spec.op === "camera.fit" ? "runtime" : spec.op.startsWith("mesh.buffer.") && spec.op !== "mesh.buffer.commit" ? "draft" : "authoring");
  return { ...spec, category,
    inputSchema: spec.inputSchema || { type: "object", properties, required: required[spec.op] || [], additionalProperties: false, ...(alternatives ? { anyOf: alternatives } : {}) },
    outputSchema: spec.outputSchema || { type: "object" },
    targets: spec.targets || (spec.op.startsWith("model.") && spec.op !== "model.operators" ? ["modeledMesh"]
      : ["mesh.edit", "mesh.getTopology", "mesh.bake"].includes(spec.op) ? ["editableMesh"]
        : spec.op.startsWith("mesh.buffer.") ? ["bufferMesh"] : []),
    requirements: spec.requirements || (spec.op === "mesh.renderViews" ? ["capture-adapter"] : spec.op === "camera.fit" ? ["viewport"] : []),
    transactional: category === "authoring", undoable: category === "authoring",
    preflight: category !== "runtime", cancellation: "before-commit"
  };
}

/** Supported schema vocabulary is intentionally small and deterministic, never eval. */
export function validateCommandSchema(value, schema, path = "args") {
  const fail = (message) => { throw Object.assign(new TypeError(`${path}: ${message}`), { code: "INVALID_COMMAND_ARGUMENTS", path }); };
  if (!schema) return;
  if (Array.isArray(schema.type)) {
    if (!schema.type.some((type) => { try { validateCommandSchema(value, { ...schema, type }, path); return true; } catch { return false; } })) fail("no permitted type matched");
    return;
  }
  if (schema.type === "null" && value !== null) fail("expected null");
  if (schema.anyOf && !schema.anyOf.some((branch) => { try { validateCommandSchema(value, branch, path); return true; } catch { return false; } })) fail("no permitted argument combination matched");
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) fail("unexpected value");
  if (schema.type === "object" && (!value || typeof value !== "object" || Array.isArray(value))) fail("expected an object");
  if (schema.type === "array" && !Array.isArray(value)) fail("expected an array");
  if (["number", "integer"].includes(schema.type) && (typeof value !== "number" || !Number.isFinite(value) || schema.type === "integer" && !Number.isSafeInteger(value))) fail(`expected a finite ${schema.type}`);
  if (["boolean", "string"].includes(schema.type) && typeof value !== schema.type) fail(`expected ${schema.type}`);
  if (schema.minimum != null && value < schema.minimum) fail(`minimum is ${schema.minimum}`);
  if (schema.maximum != null && value > schema.maximum) fail(`maximum is ${schema.maximum}`);
  if (schema.minLength != null && value.length < schema.minLength) fail("empty string is not allowed");
  if (schema.required) for (const key of schema.required) if (!value || !Object.hasOwn(value, key)) fail(`missing ${key}`);
  if (schema.type === "object") for (const [key, item] of Object.entries(value)) {
    if (!Object.hasOwn(schema.properties || {}, key) && schema.additionalProperties === false) fail(`unknown argument ${key}`);
    if (Object.hasOwn(schema.properties || {}, key)) validateCommandSchema(item, schema.properties[key], `${path}.${key}`);
  }
  if (schema.type === "array") {
    if (schema.minItems != null && value.length < schema.minItems) fail(`at least ${schema.minItems} items required`);
    if (schema.maxItems != null && value.length > schema.maxItems) fail(`at most ${schema.maxItems} items allowed`);
    value.forEach((item, i) => validateCommandSchema(item, schema.items, `${path}[${i}]`));
  }
}

export function assertCommandContract(command, spec) {
  if (!spec) throw Object.assign(new Error(`Unknown command: ${command.op}.`), { code: "UNKNOWN_COMMAND" });
  validateCommandSchema(command.args || {}, spec.inputSchema);
}
