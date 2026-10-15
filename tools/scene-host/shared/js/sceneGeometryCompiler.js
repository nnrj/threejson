/** Application-level scheduling policy, not a default engine dependency. */
let compilerPromise = null;
const supports = (record) => /^(editablemesh|parametricsurface|bezierpatch|nurbssurface|lathemesh|lathe|loftmesh|loft|sweepmesh|sweep|implicitsurface|sdfmesh)$/i.test(String(record?.objType || ""));

// A browser-host safeguard, not an engine limit. Embedders may override it or
// pass an empty budget to opt out; it is never written into authoring JSON.
export function createSceneHostGeometryCompiler({ meshBudget = { maxVertices: 2000000, maxSamples: 2097152 } } = {}) {
  return {
    supports,
    async compile(record, options = {}) {
      options = { ...options, meshBudget: options.meshBudget ?? meshBudget };
      options.signal?.throwIfAborted();
      compilerPromise ||= import("threejson/geometry-worker").then((module) => ({
        module, compiler: module.createWorkerGeometryCompiler(), direct: false
      }));
      const state = await compilerPromise;
      try { return await state.compiler.compile(record, options); }
      catch (error) {
        if (["GEOMETRY_WORKER_UNAVAILABLE", "GEOMETRY_WORKER_STARTUP"].includes(error?.code)) {
          if (!state.direct) {
            state.compiler.dispose(); state.compiler = state.module.createDirectGeometryCompiler(); state.direct = true;
            options.onDiagnostic?.({ code: "GEOMETRY_MAIN_THREAD_FALLBACK", message: error.message });
          }
          return state.compiler.compile(record, options);
        }
        throw error;
      }
    }
  };
}
export const sceneHostGeometryCompiler = createSceneHostGeometryCompiler();
