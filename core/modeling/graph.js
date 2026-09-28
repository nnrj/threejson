import { modelingError, defaultModelingRegistry } from "./registry.js";

/** Validate all nodes (including disconnected authoring nodes) before running any operator. */
export function validateModelingGraph(graph, { registry = defaultModelingRegistry, externalInputs = {}, stack = [] } = {}) {
  if (!graph || graph.version !== 1 || !Array.isArray(graph.nodes)) throw modelingError("MODEL_GRAPH_VERSION", "Expected a modeling graph with version: 1 and a nodes array.");
  const nodes = new Map(), contracts = new Map();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== "string" || !node.id || nodes.has(node.id)) throw modelingError("MODEL_NODE_ID", "Node IDs must be nonempty and unique.");
    const contract = registry.get(node.operator, node.version ?? 1);
    if (!contract) throw modelingError("MODEL_OPERATOR_MISSING", `Operator ${node.operator}@${node.version ?? 1} is not registered.`, { nodeId: node.id });
    if (node.backend && node.backend !== "auto" && !contract.graph && !contract.backends[node.backend]) {
      throw modelingError("MODEL_BACKEND_UNAVAILABLE", `${node.operator} does not implement ${node.backend}.`, { nodeId: node.id });
    }
    nodes.set(node.id, node); contracts.set(node.id, contract);
  }
  const dependencies = new Map([...nodes.keys()].map((id) => [id, new Set()]));
  function referenceType(reference, owner, multiple = false) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) throw modelingError("MODEL_PORT_REFERENCE", "A connection must be {node, output} or {input}.", { nodeId: owner });
    if (Object.hasOwn(reference, "input")) {
      const input = externalInputs[reference.input];
      if (!input || reference.node !== undefined) throw modelingError("MODEL_INPUT_MISSING", `Unknown graph input ${reference.input}.`, { nodeId: owner });
      if (Boolean(input.multiple) !== multiple) throw modelingError("MODEL_PORT_TYPE", `Graph input ${reference.input} has incompatible multiplicity.`, { nodeId: owner });
      return typeof input === "string" ? input : input.type;
    }
    const source = contracts.get(reference.node);
    const output = source?.metadata.outputs[reference.output];
    if (!output) throw modelingError("MODEL_PORT_REFERENCE", `Unknown output ${reference.node}.${reference.output}.`, { nodeId: owner });
    if (owner) dependencies.get(owner).add(reference.node);
    return output.type;
  }
  for (const [id, node] of nodes) {
    const contract = contracts.get(id);
    for (const name of Object.keys(node.inputs || {})) if (!contract.metadata.inputs[name]) throw modelingError("MODEL_INPUT_UNKNOWN", `Unknown input ${id}.${name}.`, { nodeId: id });
    for (const [name, port] of Object.entries(contract.metadata.inputs)) {
      const value = node.inputs?.[name];
      if (value === undefined && port.optional) continue;
      if (value === undefined) throw modelingError("MODEL_INPUT_MISSING", `Missing ${id}.${name}.`, { nodeId: id });
      if (port.multiple && !Array.isArray(value)) {
        if (!value?.input || referenceType(value, id, true) !== port.type) throw modelingError("MODEL_PORT_TYPE", `${id}.${name} expects a list of connections or a multiple graph input.`, { nodeId: id });
        continue;
      }
      for (const reference of port.multiple ? value : [value]) {
        if (referenceType(reference, id) !== port.type) throw modelingError("MODEL_PORT_TYPE", `${id}.${name} expects ${port.type}.`, { nodeId: id });
      }
    }
    if (contract.graph) {
      const key = `${node.operator}@${contract.metadata.version}`;
      if (stack.includes(key)) throw modelingError("MODEL_COMPOSITE_RECURSION", `Recursive composite operator: ${[...stack, key].join(" → ")}.`);
      const nested = validateModelingGraph(contract.graph, { registry, externalInputs: contract.metadata.inputs, stack: [...stack, key] });
      for (const [name, output] of Object.entries(contract.metadata.outputs)) {
        if (nested.outputTypes[name] !== output.type) throw modelingError("MODEL_PORT_TYPE", `Composite ${key} output ${name} must be ${output.type}.`);
      }
    }
  }
  const dependents = new Map([...nodes.keys()].map((id) => [id, []]));
  const incoming = new Map([...dependencies].map(([id, deps]) => [id, deps.size]));
  for (const [id, deps] of dependencies) for (const dep of deps) dependents.get(dep).push(id);
  const order = [...nodes.keys()].filter((id) => incoming.get(id) === 0);
  for (let i = 0; i < order.length; i++) for (const id of dependents.get(order[i])) {
    incoming.set(id, incoming.get(id) - 1); if (!incoming.get(id)) order.push(id);
  }
  if (order.length !== nodes.size) throw modelingError("MODEL_GRAPH_CYCLE", "Modeling graph contains a cycle.", { nodeIds: [...incoming].filter(([, count]) => count > 0).map(([id]) => id) });
  const outputs = graph.outputs || (graph.output ? { result: graph.output } : null);
  if (!outputs || !Object.keys(outputs).length) throw modelingError("MODEL_OUTPUT_MISSING", "The graph must declare output or outputs.");
  const outputTypes = Object.fromEntries(Object.entries(outputs).map(([name, reference]) => [name, referenceType(reference)]));
  const required = new Set();
  const pending = Object.values(outputs).filter((r) => r.node).map((r) => r.node);
  while (pending.length) { const id = pending.pop(); if (required.has(id)) continue; required.add(id); pending.push(...dependencies.get(id)); }
  return { nodes, contracts, dependencies, order: order.filter((id) => required.has(id)), outputs, outputTypes };
}
