import * as THREE from "three";
import * as TSL from "three/tsl";

const graphCache = new Map();
const textureCache = new Map();
const SUPPORTED_OUTPUTS = new Set(["color", "baseColor", "opacity", "emissive", "roughness", "metalness", "normal", "position"]);

export class TslGraphError extends Error {
  constructor(message, code = "E_TSL_GRAPH_INVALID", details = {}) {
    super(message); this.name = "TslGraphError"; this.code = code; Object.assign(this, details);
  }
}

function graphSource(tslDescriptor) {
  const source = tslDescriptor?.source;
  if (source?.inline && typeof source.inline === "object") return source.inline;
  if (source?.graph && typeof source.graph === "object") return source.graph;
  if (tslDescriptor?.graph && typeof tslDescriptor.graph === "object") return tslDescriptor.graph;
  if (typeof source?.url === "string") return graphCache.get(source.url.trim()) || null;
  return null;
}

function nodesById(graph) {
  const list = Array.isArray(graph?.nodes)
    ? graph.nodes
    : Object.entries(graph?.nodes || {}).map(([id, node]) => ({ id, ...node }));
  if (!list.length || list.length > 256) throw new TslGraphError("TSL graph must contain 1..256 nodes");
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

function resolveTextureNode(node, resolveInput) {
  const texture = node.texture?.isTexture
    ? node.texture
    : textureCache.get(String(node.url || "").trim());
  if (!texture) throw new TslGraphError(`Texture node "${node.id}" has no prepared texture`, "E_TSL_GRAPH_TEXTURE_UNAVAILABLE");
  return TSL.texture(texture, node.uv ? resolveInput(node.uv) : TSL.uv(Number(node.channel) || 0));
}

export function compileTslGraph(graphOrDescriptor, options = {}) {
  const graph = graphOrDescriptor?.graphVersion ? graphOrDescriptor : graphSource(graphOrDescriptor);
  if (!graph || Number(graph.graphVersion) !== 1) throw new TslGraphError("TSL graphVersion:1 is required");
  const definitions = nodesById(graph); const resolved = new Map(); const resolving = new Set();
  const resolveInput = (value) => {
    if (typeof value === "string") {
      if (definitions.has(value)) return resolveNode(value);
      throw new TslGraphError(`Unknown TSL node reference: ${value}`, "E_TSL_GRAPH_UNKNOWN_REFERENCE", { nodeId: value });
    }
    if (typeof value === "number") return TSL.float(value);
    if (Array.isArray(value)) return constant(value, `vec${Math.min(4, Math.max(2, value.length))}`);
    if (value && typeof value === "object" && value.node) return resolveNode(value.node);
    return constant(value?.value ?? value, value?.valueType || value?.type);
  };
  const resolveNode = (id) => {
    if (resolved.has(id)) return resolved.get(id);
    if (resolving.has(id)) throw new TslGraphError(`TSL graph contains a cycle at node: ${id}`, "E_TSL_GRAPH_CYCLE", { nodeId: id });
    const node = definitions.get(id); if (!node) throw new TslGraphError(`Unknown TSL node reference: ${id}`);
    resolving.add(id);
    const type = String(node.type || "constant").trim().toLowerCase();
    const args = Array.isArray(node.inputs) ? node.inputs.map(resolveInput) : [];
    const unaryInput = () => resolveInput(node.input ?? node.a ?? node.value);
    let value;
    if (type === "constant" || type === "color") value = constant(node.value, type === "color" ? "color" : node.valueType);
    else if (type === "uniform") value = TSL.uniform(node.value ?? 0, node.valueType);
    else if (type === "time") value = TSL.time;
    else if (type === "uv") value = TSL.uv(Number(node.channel) || 0);
    else if (type === "position") value = ({ local: TSL.positionLocal, world: TSL.positionWorld, view: TSL.positionView })[node.space] || TSL.positionLocal;
    else if (type === "normal") value = ({ world: TSL.normalWorld, view: TSL.normalView })[node.space] || TSL.normalLocal;
    else if (type === "texture") value = resolveTextureNode(node, resolveInput);
    else if (["add","sub","mul","div","pow","min","max","dot","cross"].includes(type)) value = TSL[type](...(args.length ? args : [resolveInput(node.a), resolveInput(node.b)]));
    else if (["sin","cos","abs","fract","normalize","length"].includes(type)) value = TSL[type](unaryInput());
    else if (type === "mix") value = TSL.mix(resolveInput(node.a), resolveInput(node.b), resolveInput(node.factor ?? node.t));
    else if (type === "smoothstep") value = TSL.smoothstep(resolveInput(node.edge0), resolveInput(node.edge1), resolveInput(node.input));
    else if (type === "clamp") value = TSL.clamp(resolveInput(node.input), resolveInput(node.min ?? 0), resolveInput(node.max ?? 1));
    else if (type === "noise") value = TSL.mx_noise_float(unaryInput(), Number(node.amplitude ?? 1), Number(node.pivot ?? 0));
    else if (type === "swizzle") {
      const components = String(node.components || "x");
      if (!/^[xyzwrgba]{1,4}$/.test(components)) {
        throw new TslGraphError(`Invalid TSL swizzle components: ${components}`, "E_TSL_GRAPH_SWIZZLE_INVALID", { nodeId: id });
      }
      value = unaryInput()[components];
    }
    else throw new TslGraphError(`Unsupported TSL graph node type: ${type}`, "E_TSL_GRAPH_NODE_UNAVAILABLE", { nodeId: id, nodeType: type });
    resolving.delete(id); resolved.set(id, value); return value;
  };
  const outputs = graph.outputs && typeof graph.outputs === "object" ? graph.outputs : {};
  const compiled = {};
  for (const [name, reference] of Object.entries(outputs)) {
    if (!SUPPORTED_OUTPUTS.has(name)) {
      throw new TslGraphError(`Unsupported TSL graph output: ${name}`, "E_TSL_GRAPH_OUTPUT_UNAVAILABLE", { output: name });
    }
    compiled[name] = resolveInput(reference);
  }
  if (!Object.keys(compiled).length) throw new TslGraphError("TSL graph outputs are required");
  return compiled;
}

function visit(value, visitor, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return; seen.add(value);
  if (String(value.type || "").trim().toLowerCase() === "tsl") visitor(value.tsl, value);
  if (Array.isArray(value)) value.forEach((entry) => visit(entry, visitor, seen));
  else Object.values(value).forEach((entry) => visit(entry, visitor, seen));
}

async function loadTexture(url) {
  if (textureCache.has(url)) return textureCache.get(url);
  const texture = await new THREE.TextureLoader().loadAsync(url); textureCache.set(url, texture); return texture;
}

export async function prepareTslGraphsForPayload(payload) {
  const tasks = [];
  visit(payload, (tsl) => {
    if (!tsl || String(tsl.kind || "").toLowerCase() !== "graph") return;
    const url = typeof tsl.source?.url === "string" ? tsl.source.url.trim() : "";
    if (url && !graphCache.has(url)) tasks.push(fetch(url, { mode: "cors", credentials: "omit" }).then((response) => {
      if (!response.ok) throw new TslGraphError(`TSL graph request failed: HTTP ${response.status}`, "E_TSL_GRAPH_FETCH_FAILED");
      return response.json();
    }).then((graph) => { nodesById(graph); graphCache.set(url, graph); }));
    const graph = graphSource(tsl);
    if (graph) {
      const defs = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodes || {});
      for (const node of defs) if (String(node?.type || "").toLowerCase() === "texture" && typeof node.url === "string") tasks.push(loadTexture(node.url.trim()));
    }
  });
  await Promise.all(tasks);
  // URL-fetched graphs may themselves contain textures, so run one bounded second pass.
  const textureTasks = [];
  visit(payload, (tsl) => {
    const graph = graphSource(tsl); const defs = Array.isArray(graph?.nodes) ? graph.nodes : Object.values(graph?.nodes || {});
    for (const node of defs) if (String(node?.type || "").toLowerCase() === "texture" && typeof node.url === "string") textureTasks.push(loadTexture(node.url.trim()));
  });
  await Promise.all(textureTasks);
  // Compile once during preparation so cycles, missing references, invalid outputs, and unsafe
  // swizzles fail before the runtime starts deploying scene objects.
  visit(payload, (tsl) => {
    if (tsl && String(tsl.kind || "").toLowerCase() === "graph") compileTslGraph(tsl);
  });
}

export function _clearTslGraphCachesForTests() { for (const texture of textureCache.values()) texture.dispose?.(); textureCache.clear(); graphCache.clear(); }
