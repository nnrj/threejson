import { resolveRuntimeContext } from "../runtime/runtimeContext.js";
import { resolveBufferMeshReferences } from "../capabilities/optionalCapabilityLoader.js";
import { createSceneResourcePolicy } from "../resource/sceneResourcePolicy.js";
import { createModelingCompiler, canonicalModelingValue } from "./compiler.js";
import { BUILTIN_MODELING_OPERATOR_IDS } from "./builtins.js";
import { createWorkerModelingCompiler } from "./workerCompiler.js";

export const modelingRecordKey = (record) => canonicalModelingValue({ graph: record.modeling, quality: record.modelQuality ?? null });

async function resourceCacheKey(references) {
  async function identity(value) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;
    if (bytes) {
      const digest = globalThis.crypto?.subtle ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (v) => v.toString(16).padStart(2, "0")).join("") : canonicalModelingValue(bytes);
      return { binaryType: value.constructor.name, digest };
    }
    if (Array.isArray(value)) return Promise.all(value.map(identity));
    if (value && typeof value === "object") return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await identity(item)])));
    return value;
  }
  return Promise.all([...references].sort(([a], [b]) => a.localeCompare(b)).map(async ([url, value]) => [url, await identity(value)]));
}

/** Command validation and runtime preparation share this cache; neither owns the source document. */
export async function evaluateModeledMesh(record, options = {}) {
  const scope = resolveRuntimeContext(options.runtimeScope, { fallback: false });
  const resolveBufferReference = options.resolveBufferReference || scope?.resolveBufferReference;
  const bufferReferences = await resolveBufferMeshReferences(record, { ...options, resolveBufferReference });
  const resourcePolicy = createSceneResourcePolicy(options.resourcePayload || record, { ...options, resolveBufferReference, preparedBufferReferences: bufferReferences });
  const modelingContext = { ...options.modelingContext, resolveBufferReference: resourcePolicy.resolveBufferReference };
  // A URL is an identity, not a content version. Host-provided binary data may change in place.
  const contextKey = { host: options.modelingContext?.cacheKey ?? null, resources: await resourceCacheKey(bufferReferences) };
  let compiler = options.modelingCompiler, owned = false;
  if (!compiler && scope?.capabilityResources) {
    let cache = scope.capabilityResources.find("modeling-compilers");
    if (!cache) {
      cache = { compilers: new Map(), worker: null, dispose() { for (const c of this.compilers.values()) c.dispose(); this.compilers.clear(); this.worker?.dispose(); } };
      scope.capabilityResources.add("modeling-compilers", cache);
    }
    const id = record.threeJsonId || record.name || modelingRecordKey(record);
    const stockWorker = (options.geometryCompiler || scope.geometryCompiler) && typeof globalThis.Worker === "function" && !options.modelingRegistry && !options.modelingContext
      && !bufferReferences.size && record.modeling?.nodes?.every((n) => BUILTIN_MODELING_OPERATOR_IDS.includes(n.operator) && (!n.backend || ["cpu", "auto"].includes(n.backend)));
    if (stockWorker) compiler = cache.worker ||= createWorkerModelingCompiler();
    else {
      compiler = cache.compilers.get(id);
      if (!compiler) { compiler = createModelingCompiler({ registry: options.modelingRegistry, context: options.modelingContext }); cache.compilers.set(id, compiler); }
    }
  }
  if (!compiler) { compiler = createModelingCompiler({ registry: options.modelingRegistry, context: options.modelingContext }); owned = true; }
  try {
    return await compiler.compile(record.modeling, { signal: options.signal, onProgress: options.onModelingProgress,
      context: modelingContext, contextKey, modelId: record.threeJsonId || record.name || modelingRecordKey(record), quality: record.modelQuality ?? options.modelQuality });
  } finally { if (owned) compiler.dispose(); }
}
