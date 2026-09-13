import * as THREE from "three";
import * as TSL from "three/tsl";
import { createSceneResourcePolicy } from "../core/resource/sceneResourcePolicy.js";
import { requestTexture, whenTextureReady } from "../core/resource/textureRequest.js";
import { findPreparedResource, resolvePreparedResourceSource } from "./preparedResources.js";
import { createAssetResolver } from "../core/resource/assetResolver.js";
import { createAssetRegistryStore } from "../core/cache/assetRegistry.js";
const graphNodeCompilers = new Map();
const SAFE_OUTPUT_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const SAFE_TSL_EXPORT_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export class TslGraphError extends Error {
  constructor(message, code = "E_TSL_GRAPH_INVALID", details = {}) {
    super(message); this.name = "TslGraphError"; this.code = code; Object.assign(this, details);
  }
}

/** Register additional serializable graph nodes without changing the core graph compiler. */
export function registerTslGraphNode(type, compiler) {
  const id = String(type || "").trim().toLowerCase();
  if (!id || typeof compiler !== "function") {
    throw new Error("[tslGraph] type and compiler are required");
  }
  graphNodeCompilers.set(id, compiler);
}

export function unregisterTslGraphNode(type) {
  return graphNodeCompilers.delete(String(type || "").trim().toLowerCase());
}

function graphKey(descriptor) {
  return descriptor?.source?.url ? `url:${descriptor.source.url.trim()}` : `inline:${JSON.stringify(graphSource(descriptor))}`;
}

function graphSource(tslDescriptor) {
  if (tslDescriptor?.graphVersion) return tslDescriptor;
  const source = tslDescriptor?.source;
  if (source?.inline && typeof source.inline === "object") return source.inline;
  if (source?.graph && typeof source.graph === "object") return source.graph;
  if (tslDescriptor?.graph && typeof tslDescriptor.graph === "object") return tslDescriptor.graph;
  return null;
}

function nodesById(graph) {
  const list = Array.isArray(graph?.nodes)
    ? graph.nodes
    : Object.entries(graph?.nodes || {}).map(([id, node]) => ({ id, ...node }));
  if (!list.length) throw new TslGraphError("TSL graph must contain at least one node");
  const map = new Map();
  for (const node of list) {
    const id = typeof node?.id === "string" ? node.id.trim() : "";
    if (!id || map.has(id)) throw new TslGraphError(`Invalid or duplicate TSL node id: ${id}`);
    map.set(id, node);
  }
  return map;
}

function constant(value, valueType) {
  if (valueType === "color") return TSL.color(value ?? "#ffffff");
  if (valueType === "vec2") return TSL.vec2(...(Array.isArray(value) ? value : [value?.x, value?.y]));
  if (valueType === "vec3") return TSL.vec3(...(Array.isArray(value) ? value : [value?.x, value?.y, value?.z]));
  if (valueType === "vec4") return TSL.vec4(...(Array.isArray(value) ? value : [value?.x, value?.y, value?.z, value?.w]));
  return TSL.float(Number(value) || 0);
}

function resolveTextureNode(node, resolveInput, prepared, options) {
  let texture = node.texture?.isTexture
    ? node.texture
    : prepared?.textures.get(node.id);
  if (!texture) throw new TslGraphError(`Texture node "${node.id}" has no prepared texture`, "E_TSL_GRAPH_TEXTURE_UNAVAILABLE");
  if (options.ownTexture) texture = options.ownTexture(texture, node);
  return TSL.texture(texture, node.uv ? resolveInput(node.uv) : TSL.uv(Number(node.channel) || 0));
}

export function compileTslGraph(graphOrDescriptor, options = {}) {
  const key = graphKey(graphOrDescriptor);
  const prepared = options.graphResources ? options.graphResources.get(key) : findPreparedResource(options, "webgpu-tsl-graphs", (resources) => resources.get(key));
  const graph = prepared?.graph || graphSource(graphOrDescriptor);
  if (!graph || Number(graph.graphVersion) !== 1) throw new TslGraphError("TSL graphVersion:1 is required");
  const definitions = nodesById(graph); const resolved = new Map(); const resolving = new Set();
  const resolveInput = (value) => {
    if (typeof value === "string") {
      if (definitions.has(value)) return resolveNode(value);
      throw new TslGraphError(`Unknown TSL node reference: ${value}`, "E_TSL_GRAPH_UNKNOWN_REFERENCE", { nodeId: value });
    }
    if (typeof value === "number") return TSL.float(value);
    if (typeof value === "boolean") return value;
    if (Array.isArray(value)) return constant(value, `vec${Math.min(4, Math.max(2, value.length))}`);
    if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "literal")) {
      return value.literal;
    }
    if (value && typeof value === "object" && value.node) return resolveNode(value.node);
    return constant(value?.value ?? value, value?.valueType || value?.type);
  };
  const resolveNode = (id) => {
    if (resolved.has(id)) return resolved.get(id);
    if (resolving.has(id)) throw new TslGraphError(`TSL graph contains a cycle at node: ${id}`, "E_TSL_GRAPH_CYCLE", { nodeId: id });
    const node = definitions.get(id); if (!node) throw new TslGraphError(`Unknown TSL node reference: ${id}`);
    resolving.add(id);
    const type = String(node.type || "constant").trim().toLowerCase();
    const inputList = Array.isArray(node.inputs) ? node.inputs : Array.isArray(node.args) ? node.args : [];
    const args = inputList.map(resolveInput);
    const unaryInput = () => resolveInput(node.input ?? node.a ?? node.value);
    let value;
    if (type === "constant" || type === "color") value = constant(node.value, type === "color" ? "color" : node.valueType);
    else if (type === "uniform") value = TSL.uniform(node.value ?? 0, node.valueType);
    else if (type === "time") value = TSL.time;
    else if (type === "uv") value = TSL.uv(Number(node.channel) || 0);
    else if (type === "position") value = ({ local: TSL.positionLocal, world: TSL.positionWorld, view: TSL.positionView })[node.space] || TSL.positionLocal;
    else if (type === "normal") value = ({ world: TSL.normalWorld, view: TSL.normalView })[node.space] || TSL.normalLocal;
    else if (type === "texture") value = resolveTextureNode(node, resolveInput, prepared, options);
    else if (["add","sub","mul","div","pow","min","max","dot","cross"].includes(type)) value = TSL[type](...(args.length ? args : [resolveInput(node.a), resolveInput(node.b)]));
    else if (["sin","cos","abs","fract","normalize","length"].includes(type)) value = TSL[type](unaryInput());
    else if (type === "mix") value = TSL.mix(resolveInput(node.a), resolveInput(node.b), resolveInput(node.factor ?? node.t));
    else if (type === "smoothstep") value = TSL.smoothstep(resolveInput(node.edge0), resolveInput(node.edge1), resolveInput(node.input));
    else if (type === "clamp") value = TSL.clamp(resolveInput(node.input), resolveInput(node.min ?? 0), resolveInput(node.max ?? 1));
    else if (type === "noise") value = TSL.mx_noise_float(unaryInput(), Number(node.amplitude ?? 1), Number(node.pivot ?? 0));
    else if (["fractalnoise", "fractal_noise", "fbm"].includes(type)) {
      value = TSL.mx_fractal_noise_float(unaryInput());
    }
    else if (type === "call") {
      const functionName = String(node.function ?? node.fn ?? "").trim();
      if (!SAFE_TSL_EXPORT_NAME.test(functionName) || typeof TSL[functionName] !== "function") {
        throw new TslGraphError(
          `Unknown callable three/tsl export: ${functionName}`,
          "E_TSL_GRAPH_CALL_UNAVAILABLE",
          { nodeId: id, functionName }
        );
      }
      try {
        value = TSL[functionName](...args);
      } catch (cause) {
        throw new TslGraphError(
          `three/tsl call failed: ${functionName}`,
          "E_TSL_GRAPH_CALL_FAILED",
          { nodeId: id, functionName, cause }
        );
      }
    }
    else if (type === "swizzle") {
      const components = String(node.components || "x");
      if (!/^[xyzwrgba]{1,4}$/.test(components)) {
        throw new TslGraphError(`Invalid TSL swizzle components: ${components}`, "E_TSL_GRAPH_SWIZZLE_INVALID", { nodeId: id });
      }
      value = unaryInput()[components];
    }
    else if (graphNodeCompilers.has(type)) {
      value = graphNodeCompilers.get(type)({
        node,
        nodeId: id,
        args,
        resolveInput,
        TSL,
        THREE,
        options
      });
    }
    else throw new TslGraphError(`Unsupported TSL graph node type: ${type}`, "E_TSL_GRAPH_NODE_UNAVAILABLE", { nodeId: id, nodeType: type });
    resolving.delete(id); resolved.set(id, value); return value;
  };
  const outputs = graph.outputs && typeof graph.outputs === "object" ? graph.outputs : {};
  const compiled = {};
  for (const [name, reference] of Object.entries(outputs)) {
    if (!SAFE_OUTPUT_NAME.test(name) || ["constructor", "prototype", "__proto__"].includes(name)) {
      throw new TslGraphError(`Invalid TSL graph output name: ${name}`, "E_TSL_GRAPH_OUTPUT_INVALID", { output: name });
    }
    compiled[name] = resolveInput(reference);
  }
  if (!Object.keys(compiled).length) throw new TslGraphError("TSL graph outputs are required");
  return compiled;
}

function visit(value, visitor, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return; seen.add(value);
  if (ArrayBuffer.isView(value) || (Array.isArray(value) && typeof value[0] === "number")) return;
  if (String(value.type || "").trim().toLowerCase() === "tsl") visitor(value.tsl, value);
  if (Array.isArray(value)) value.forEach((entry) => visit(entry, visitor, seen));
  else Object.values(value).forEach((entry) => visit(entry, visitor, seen));
}

export async function prepareTslGraphsForPayload(payload, options = {}) {
  const descriptors = new Map();
  visit(payload, (tsl) => { if (String(tsl?.kind || "").toLowerCase() === "graph") descriptors.set(graphKey(tsl), tsl); });
  if (!descriptors.size) return undefined;
  const policy = createSceneResourcePolicy(options.sceneJsonRoot || payload, options), registry = createAssetRegistryStore();
  registry.registerAssetLibrary((options.sceneJsonRoot || payload).assetLibrary);
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const resolver = createAssetResolver(), textures = new Map(), graphs = new Map();
  let disposed = false;
  const resources = {
    get: (key) => disposed ? undefined : graphs.get(key),
    dispose() { if (disposed) return; disposed = true; controller.abort(); for (const texture of textures.values()) texture.dispose(); resolver.dispose(); graphs.clear(); textures.clear(); }
  };
  const sourceUrl = (raw, base) => {
    let url = String(raw).trim();
    if (url.startsWith("lib://")) {
      url = registry.resolveLibTokenToUrl(url.slice(6));
      if (!url) throw new TslGraphError(`Unknown texture library token: ${raw}`, "E_TSL_GRAPH_TEXTURE_UNAVAILABLE");
    }
    return resolvePreparedResourceSource(url, policy, options, base);
  };
  const tasks = [...descriptors].map(async ([key, tsl]) => {
    let graph = graphSource(tsl), base;
    if (tsl.source?.url) {
      base = sourceUrl(tsl.source.url);
      const response = await (options.fetch || fetch)(await policy.resolveAssetUrl(base, { kind: "json" }), { mode: "cors", credentials: "omit", signal });
      if (!response.ok) throw new TslGraphError(`TSL graph request failed: HTTP ${response.status}`, "E_TSL_GRAPH_FETCH_FAILED");
      graph = await response.json();
    }
    signal.throwIfAborted();
    if (Number(graph?.graphVersion) !== 1) throw new TslGraphError("TSL graphVersion:1 is required");
    const entry = { graph, textures: new Map() }; graphs.set(key, entry);
    const waits = [];
    for (const node of nodesById(graph).values()) {
      if (String(node?.type || "").toLowerCase() !== "texture" || node.texture?.isTexture || typeof node.url !== "string") continue;
      const url = sourceUrl(node.url, base);
      if (!textures.has(url)) textures.set(url, requestTexture(url, {
        runtimeScope: options.runtimeScope, assetResolver: resolver, candidates: [url],
        loader: options.textureLoader || options.loader, signal, resolveRuntimeUrl: policy.resolveAssetUrl
      }));
      const texture = textures.get(url); entry.textures.set(node.id, texture); waits.push(whenTextureReady(texture));
    }
    await Promise.all(waits); signal.throwIfAborted();
    compileTslGraph(tsl, { ...options, graphResources: resources });
  });
  try { await Promise.all(tasks); return resources; }
  catch (error) { resources.dispose(); await Promise.allSettled(tasks); throw error; }
}
