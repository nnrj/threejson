import { resolveRuntimeContext } from "../core/runtime/runtimeContext.js";

export function findPreparedResource(options, id, select) {
  if (options.preparedCapabilities) return options.preparedCapabilities.find(id, select);
  return resolveRuntimeContext(options.runtimeScope || options.runtimeContext || options.scene, { fallback: false })?.capabilityResources?.find(id, select);
}

/** Resolve the source before applying a delivery proxy, retaining relative file semantics. */
export function resolvePreparedResourceSource(source, policy, options = {}, parentUrl) {
  const raw = String(source).trim();
  const page = options.resourceBaseUrl || (typeof document !== "undefined" ? document.baseURI : undefined);
  const base = parentUrl ? (page ? new URL(parentUrl, page).href : parentUrl) : page;
  if (parentUrl && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    try { return new URL(raw, base).href; } catch {
      // Headless loaders may deliberately accept paths without any network origin.
      const relative = new URL(raw, new URL(parentUrl, "https://relative.invalid/"));
      return `${parentUrl.startsWith("/") ? relative.pathname : relative.pathname.slice(1)}${relative.search}${relative.hash}`;
    }
  }
  const candidate = raw.startsWith("pack://") ? raw : policy.resolveAssetCandidates(raw)[0] || raw;
  if (base) return new URL(candidate, base).href;
  return candidate;
}
