import { resolveRuntimeContext } from "../runtime/runtimeContext.js";
import { resolvePublicAssetUrl } from "../util/assetsBase.js";

/** Synchronous loader boundary for embedded files and ordinary asset URLs.
 * Call before an asynchronous loader starts, while the owning scene is explicit. */
export function resolveRuntimeResourceUrl(source, scope) {
  const context = resolveRuntimeContext(scope);
  const candidate = context.resolveAssetCandidates?.(source)?.[0] || resolvePublicAssetUrl(source);
  return context.resolveModelResourceUrl?.(candidate) ?? candidate;
}
