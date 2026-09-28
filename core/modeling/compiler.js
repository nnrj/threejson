import { evaluateSceneDesign } from "../document/sceneDesign.js";
import { validateModelingGraph } from "./graph.js";
import { defaultModelingRegistry, modelingError, validateOperatorParameters } from "./registry.js";

export function canonicalModelingValue(value, ancestors = new Set()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw modelingError("MODEL_NONFINITE", "Modeling data must contain only finite numbers.");
    return String(value === 0 ? 0 : value);
  }
  if (value && ancestors.has(value)) throw modelingError("MODEL_DATA_CYCLE", "Modeling artifacts must not contain cyclic data references.");
  if (value && (Array.isArray(value) || ArrayBuffer.isView(value) || Object.getPrototypeOf(value) === Object.prototype)) {
    ancestors.add(value);
    try {
      const encode = (item) => canonicalModelingValue(item, ancestors);
      if (ArrayBuffer.isView(value) && !(value instanceof DataView)) return `{"$typed":${JSON.stringify(value.constructor.name)},"values":[${Array.from(value, encode).join(",")}]}`;
      if (Array.isArray(value)) return `[${Array.from(value, encode).join(",")}]`;
      if (Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${encode(value[key])}`).join(",")}}`;
    } finally { ancestors.delete(value); }
  }
  throw modelingError("MODEL_DATA", "Operator artifacts and parameters must be serializable data, not native handles or functions.");
}

async function fingerprint(value) {
  const text = canonicalModelingValue(value);
  if (!globalThis.crypto?.subtle) return text; // Exact keys, never a collision-prone substitute hash.
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("");
}

function resolveParameters(value, parameters) {
  if (Array.isArray(value)) return value.map((item) => resolveParameters(item, parameters));
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  if (Object.keys(value).length === 1 && typeof value.param === "string") {
    if (!Object.hasOwn(parameters, value.param)) throw modelingError("MODEL_PARAMETER_MISSING", `Unknown parameter ${value.param}.`);
    return structuredClone(parameters[value.param]);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveParameters(item, parameters)]));
}

function graphParameters(graph, overrides = {}) {
  const values = { ...graph.parameters, ...overrides }, numeric = {}, direct = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "number" || (value && typeof value === "object" && !Array.isArray(value) && ("value" in value || "expr" in value || "op" in value || "param" in value))) numeric[key] = value;
    else direct[key] = value;
  }
  if (Object.keys(numeric).length) {
    const resolved = evaluateSceneDesign({ objectList: [], design: { version: 1, units: graph.units || { length: "m" }, parameters: numeric } });
    for (const [key, quantity] of Object.entries(resolved.parameters)) direct[key] = quantity.value;
  }
  return direct;
}

/** Per-model compiler: a successful evaluation keeps only its reachable cache entries.
 * Cached artifacts are data, cloned at each ownership boundary; runtime disposal cannot poison reuse. */
export function createModelingCompiler({ registry = defaultModelingRegistry, backend = "auto", context = {} } = {}) {
  let cache = new Map(), disposed = false, generation = 0;
  return {
    async compile(source, options = {}) {
      if (disposed) throw modelingError("MODEL_COMPILER_DISPOSED", "Modeling compiler has been disposed.");
      const ticket = ++generation, graph = structuredClone(source), staged = new Map(), events = [], keys = new Map(), diagnostics = [];
      const externalInputs = structuredClone(options.inputs || {}), parameterOverrides = structuredClone(options.parameters || {});
      const check = () => { options.signal?.throwIfAborted(); if (disposed) throw modelingError("MODEL_COMPILER_DISPOSED", "Modeling compiler has been disposed."); };
      check();
      const progress = (event) => { events.push(event); try { options.onProgress?.(event); } catch { /* observers do not own computation */ } };
      async function evaluate(current, external = {}, parameterValues = {}, prefix = "", inputContracts = external) {
        const plan = validateModelingGraph(current, { registry, externalInputs: inputContracts });
        const parameters = graphParameters(current, parameterValues), results = new Map(), resultKeys = new Map();
        const ref = (reference) => reference.input !== undefined ? external[reference.input] : results.get(reference.node)[reference.output];
        const refKey = async (reference) => reference.input !== undefined ? fingerprint(external[reference.input]) : `${resultKeys.get(reference.node)}:${reference.output}`;
        for (const id of plan.order) {
          check();
          const node = plan.nodes.get(id), op = plan.contracts.get(id), path = `${prefix}${id}`;
          const params = resolveParameters(node.params || {}, parameters);
          for (const [name, definition] of Object.entries(op.metadata.parameters.properties || {})) if (params[name] === undefined && definition.default !== undefined) params[name] = structuredClone(definition.default);
          validateOperatorParameters(params, op.metadata.parameters, path);
          const inputs = {}, inputKeys = {};
          for (const [name, reference] of Object.entries(node.inputs || {})) {
            inputs[name] = Array.isArray(reference) ? reference.map(ref) : ref(reference);
            inputKeys[name] = Array.isArray(reference) ? await Promise.all(reference.map(refKey)) : await refKey(reference);
          }
          const requested = node.backend || options.backend || backend;
          let selected = requested;
          if (selected === "auto") selected = op.backends.gpu && (options.context?.gpu || context.gpu) ? "gpu" : "cpu";
          if (!op.graph && !op.backends[selected]) throw modelingError("MODEL_BACKEND_UNAVAILABLE", `${node.operator} has no ${selected} backend.`, { nodeId: path });
          // Quality affects calculation only if an operator consumes it; it is still part of the cache contract.
          const cacheContract = { nodeId: path, implementation: op.implementationId, inputs: inputKeys, params, quality: options.quality ?? "balanced", contextKey: options.contextKey ?? options.context?.cacheKey ?? context.cacheKey ?? null };
          let key = await fingerprint({ ...cacheContract, backend: selected });
          // Traverse composites even on a cache hit: their descendant implementations may have
          // changed and their live cache entries must survive subsequent parameter edits.
          let output = op.graph ? null : staged.get(key) || cache.get(key);
          if (output) progress({ nodeId: path, operator: node.operator, status: "cached", backend: selected });
          else {
            progress({ nodeId: path, operator: node.operator, status: "evaluating", backend: selected });
            try {
              const invoke = () => op.backends[selected]({
                inputs: structuredClone(inputs), params: structuredClone(params), signal: options.signal,
                quality: options.quality ?? "balanced", context: { ...context, ...options.context }, nodeId: path
              });
              if (op.graph) {
                const nested = await evaluate(op.graph, inputs, params, `${path}/`, op.metadata.inputs);
                output = nested.outputs;
                key = await fingerprint({ ...cacheContract, backend: selected, descendants: nested.outputKeys });
              } else {
                try { output = await invoke(); }
                catch (error) {
                  check();
                  if (requested !== "auto" || selected !== "gpu" || !op.backends.cpu || !["MODEL_GPU_LIMIT", "MODEL_GPU_COMPUTE", "MODEL_GPU_DISPOSED", "MODEL_GPU_DEVICE_LOST"].includes(error.code)) throw error;
                  diagnostics.push({ code: "MODEL_BACKEND_FALLBACK", nodeId: path, from: "gpu", to: "cpu", cause: error.code, message: error.message });
                  progress({ nodeId: path, operator: node.operator, status: "fallback", backend: "cpu", reason: error.code });
                  selected = "cpu";
                  key = await fingerprint({ ...cacheContract, backend: selected });
                  output = staged.get(key) || cache.get(key) || await invoke();
                }
              }
              check();
              for (const [name, port] of Object.entries(op.metadata.outputs)) if (output?.[name]?.type !== port.type) throw modelingError("MODEL_OUTPUT_TYPE", `${node.operator}.${name} must return a ${port.type} artifact.`);
              for (const name of Object.keys(output || {})) if (!op.metadata.outputs[name]) throw modelingError("MODEL_OUTPUT_TYPE", `Undeclared output ${node.operator}.${name}.`);
              canonicalModelingValue(output); // No Infinity, host objects or closures hidden in cached artifacts.
              output = structuredClone(output);
            } catch (error) {
              if (error.name === "AbortError") throw error;
              throw modelingError(error.code || "MODEL_EVALUATION_FAILED", `${path}: ${error.message || error}`, { nodeId: path, cause: error });
            }
            progress({ nodeId: path, operator: node.operator, status: "ready", backend: selected });
          }
          staged.set(key, output); results.set(id, output); resultKeys.set(id, key); keys.set(path, key);
        }
        return { outputs: Object.fromEntries(Object.entries(plan.outputs).map(([name, reference]) => [name, ref(reference)])),
          outputKeys: Object.fromEntries(await Promise.all(Object.entries(plan.outputs).map(async ([name, reference]) => [name, await refKey(reference)]))) };
      }
      const { outputs } = await evaluate(graph, externalInputs, parameterOverrides);
      check();
      if (ticket === generation) cache = staged; // An older asynchronous evaluation cannot replace a newer cache.
      return { outputs: structuredClone(outputs), result: structuredClone(outputs.result ?? Object.values(outputs)[0]),
        diagnostics, nodes: events, fingerprints: Object.fromEntries(keys), graphVersion: 1 };
    },
    clearCache() { cache.clear(); },
    dispose() { disposed = true; cache.clear(); },
    get cacheSize() { return cache.size; }
  };
}

export async function compileModelingGraph(graph, options = {}) {
  const compiler = createModelingCompiler(options);
  try { return await compiler.compile(graph, options); } finally { compiler.dispose(); }
}
