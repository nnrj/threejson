import { resolveRuntimeContext } from "../runtime/runtimeContext.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { collectGeometryRecords, geometryInputKey } from "./geometryInput.js";

export function takePreparedGeometry(record, runtimeScope) {
  return resolveRuntimeContext(runtimeScope, { fallback: false })?.capabilityResources
    .find("compiled-geometry", (resources) => resources.take(geometryInputKey(record)));
}

/** Compiler is host-injected. Without it, no scan, worker, compute module or network work occurs. */
export async function prepareSceneGeometry(payload, options = {}) {
  if (!options.geometryCompiler) return null;
  const compiler = options.geometryCompiler;
  const prepared = new Map();
  const resources = {
    take(key) {
      const queue = prepared.get(key), item = queue?.shift();
      if (!queue?.length) prepared.delete(key);
      return item;
    },
    dispose() { for (const queue of prepared.values()) for (const item of queue) item.geometry.dispose(); prepared.clear(); }
  };
  try {
    for (const record of collectGeometryRecords(payload)) {
      if (!compiler.supports(record)) continue;
      options.signal?.throwIfAborted();
      const built = await compiler.compile(record, { signal: options.signal, meshBudget: options.meshBudget });
      if (!built?.geometry) throw Object.assign(new Error(built?.error || "Geometry compilation failed."), { code: built?.code || "GEOMETRY_BUILD_FAILED" });
      if (options.signal?.aborted) { built.geometry.dispose(); options.signal.throwIfAborted(); }
      trackDisposableResource(built.geometry);
      const key = geometryInputKey(record);
      if (!prepared.has(key)) prepared.set(key, []);
      prepared.get(key).push(built);
    }
    return resources;
  } catch (error) { resources.dispose(); throw error; }
}
