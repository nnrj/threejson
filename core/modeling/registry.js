/** Operator contracts are data; implementations belong to an explicitly supplied registry. */
export const MODELING_TYPES = Object.freeze(["mesh", "curve", "surface", "solid", "field", "points", "instances"]);

export function modelingError(code, message, details = {}) {
  return Object.assign(new Error(message), { name: "ModelingError", code, ...details });
}

const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const portType = (port) => typeof port === "string" ? port : port?.type;
let nextImplementation = 0;
function freezeContract(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value) || ArrayBuffer.isView(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeContract(child, seen);
  return Object.freeze(value);
}

export function createModelingOperatorRegistry() {
  const operators = new Map();
  return {
    register(definition) {
      if (!definition || !identifier.test(definition.id || "") || !Number.isSafeInteger(definition.version) || definition.version < 1) {
        throw modelingError("OPERATOR_CONTRACT", "An operator needs an identifier and a positive integer version.");
      }
      const key = `${definition.id}@${definition.version}`;
      if (operators.has(key)) throw modelingError("OPERATOR_DUPLICATE", `Operator ${key} is already registered; register a new version or unregister it explicitly.`);
      const ports = (values, output = false) => Object.fromEntries(Object.entries(values || {}).map(([name, value]) => {
        if (!identifier.test(name) || !MODELING_TYPES.includes(portType(value))) throw modelingError("OPERATOR_CONTRACT", `Invalid ${key} port ${name}.`);
        const port = typeof value === "string" ? { type: value } : structuredClone(value);
        if (output && (port.multiple || port.optional)) throw modelingError("OPERATOR_CONTRACT", "Output ports are single, required values; use an instances/points artifact for collections.");
        return [name, Object.freeze(port)];
      }));
      const inputs = ports(definition.inputs), outputs = ports(definition.outputs, true);
      if (!Object.keys(outputs).length) throw modelingError("OPERATOR_CONTRACT", `${key} has no outputs.`);
      const implementations = { ...definition.backends };
      if (!definition.graph && !Object.values(implementations).some((value) => typeof value === "function")) {
        throw modelingError("OPERATOR_CONTRACT", `${key} needs a graph or at least one backend implementation.`);
      }
      if (definition.graph && Object.keys(implementations).length) throw modelingError("OPERATOR_CONTRACT", "A composite operator declares a graph, not backend implementations.");
      if (Object.values(implementations).some((value) => typeof value !== "function")) throw modelingError("OPERATOR_CONTRACT", "Backend implementations must be functions.");
      const metadata = freezeContract({
        id: definition.id, version: definition.version, label: definition.label || definition.id,
        description: definition.description || "", category: definition.category || "custom",
        inputs, outputs, parameters: structuredClone(definition.parameters || { type: "object", properties: {}, additionalProperties: false }),
        backends: Object.keys(implementations), composite: Boolean(definition.graph),
        ...(definition.attributes ? { attributes: structuredClone(definition.attributes) } : {}),
        ...(definition.diagnostics ? { diagnostics: structuredClone(definition.diagnostics) } : {})
      });
      const registered = Object.freeze({ metadata, backends: Object.freeze(implementations),
        graph: definition.graph ? freezeContract(structuredClone(definition.graph)) : null, implementationId: ++nextImplementation });
      operators.set(key, registered);
      return () => { if (operators.get(key) === registered) operators.delete(key); };
    },
    get(id, version = 1) { return operators.get(`${id}@${version}`); },
    list() { return [...operators.values()].map(({ metadata }) => structuredClone(metadata)); }
  };
}

export const defaultModelingRegistry = createModelingOperatorRegistry();
export function registerModelingOperator(definition, registry = defaultModelingRegistry) { return registry.register(definition); }
export function getModelingOperatorManifest(registry = defaultModelingRegistry) {
  return { version: 1, types: [...MODELING_TYPES], operators: registry.list() };
}

/** Deliberately small JSON Schema vocabulary, shared by built-ins, custom operators and UI. */
export function validateOperatorParameters(value, schema, path = "params") {
  if (!schema || typeof schema !== "object") return;
  const fail = (reason) => { throw modelingError("OPERATOR_PARAMETERS", `${path}: ${reason}`, { path }); };
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) fail("value is not in the allowed enum");
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value) || ArrayBuffer.isView(value)) fail("expected an object");
    for (const name of schema.required || []) if (value[name] === undefined) fail(`missing ${name}`);
    for (const [name, item] of Object.entries(value)) {
      const property = schema.properties?.[name];
      if (!property && schema.additionalProperties === false) fail(`unknown parameter ${name}`);
      if (property) validateOperatorParameters(item, property, `${path}.${name}`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) fail("expected an array");
    if (schema.minItems !== undefined && value.length < schema.minItems) fail(`at least ${schema.minItems} items required`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`at most ${schema.maxItems} items allowed`);
    if (schema.items) for (let i = 0; i < value.length; i++) validateOperatorParameters(value[i], schema.items, `${path}[${i}]`);
  } else if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isSafeInteger(value))) fail(`expected a finite ${schema.type}`);
    if (schema.minimum !== undefined && value < schema.minimum) fail(`minimum is ${schema.minimum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) fail(`must exceed ${schema.exclusiveMinimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`maximum is ${schema.maximum}`);
  } else if (schema.type && typeof value !== schema.type) fail(`expected ${schema.type}`);
}
