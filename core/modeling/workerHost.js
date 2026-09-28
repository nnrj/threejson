import { createModelingCompiler } from "./compiler.js";
import { registerBuiltinModelingOperators } from "./builtins.js";

/** A custom worker may register its own CPU/WASM operators before attaching this host. */
export function attachModelingWorkerHost(port, options = {}) {
  const registry = registerBuiltinModelingOperators(options.registry), compilers = new Map();
  let chain = Promise.resolve(), disposed = false;
  const onMessage = ({ data }) => {
    if (disposed || data?.type !== "compile") return;
    chain = chain.then(async () => {
      if (disposed) return;
      try {
        const id = data.options?.modelId || "default";
        let compiler = compilers.get(id);
        if (!compiler) { compiler = createModelingCompiler({ registry, context: options.context }); compilers.set(id, compiler); }
        const result = await compiler.compile(data.graph, { ...data.options, onProgress: (event) => port.postMessage({ type: "progress", id: data.id, event }) });
        const buffers = new Set();
        function visit(value) {
          if (ArrayBuffer.isView(value)) { buffers.add(value.buffer); return; }
          if (value && typeof value === "object") for (const item of Object.values(value)) visit(item);
        }
        visit(result);
        if (!disposed) port.postMessage({ type: "result", id: data.id, result }, [...buffers]);
      } catch (error) { if (!disposed) port.postMessage({ type: "error", id: data.id, error: { code: error.code, message: error.message || String(error), nodeId: error.nodeId } }); }
    });
  };
  port.addEventListener("message", onMessage);
  port.postMessage({ type: "ready" });
  return { dispose() { disposed = true; port.removeEventListener?.("message", onMessage); for (const compiler of compilers.values()) compiler.dispose(); compilers.clear(); } };
}
