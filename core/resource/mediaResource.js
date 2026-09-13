import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

/** Capture a runtime's resolver before crossing an await; retain optional blob URL leases. */
export function createMediaResource(source, kind, options = {}) {
  const scope = resolveRuntimeContext(options.runtimeScope);
  const resolve = options.resolveRuntimeUrl || scope.resolveAssetUrl;
  const url = scope.resolveAssetCandidates?.(source)?.[0] || source;
  const controller = new AbortController();
  const signals = [...new Set([scope.signal, scope.loadSignal, options.signal].filter(Boolean))];
  let resource;
  const abort = (event) => controller.abort(event?.target?.reason || new DOMException("Media disposed.", "AbortError"));
  for (const signal of signals) {
    if (signal.aborted) abort({ target: signal });
    else signal.addEventListener("abort", abort, { once: true });
  }
  const ready = Promise.resolve().then(async () => {
    controller.signal.throwIfAborted();
    resource = resolve ? await resolve(url, { kind, source, signal: controller.signal }) : url;
    if (controller.signal.aborted) { resource?.release?.(); controller.signal.throwIfAborted(); }
    const resolved = typeof resource === "string" ? resource : resource?.url;
    if (!resolved) throw new TypeError("Media resolver returned no URL.");
    return resolved;
  });
  ready.catch(() => {});
  return { ready, signal: controller.signal, dispose() {
    abort();
    for (const signal of signals) signal.removeEventListener("abort", abort);
    resource?.release?.(); resource = null;
  } };
}
