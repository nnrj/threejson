import { createAssetUrlPolicy, resolvePublicAssetUrlCandidates } from "../util/assetsBase.js";
import { resolveAssetUrl } from "../util/assetGateway.js";
import { createEmbeddedResourceIndex, resolveEmbeddedResource, dataUrlToBytes } from "./embeddedResources.js";

/** Resource policy belongs to one runtime, never to a persisted descriptor. */
export function createSceneResourcePolicy(payload, options = {}) {
  const context = {};
  context.backdropFailurePolicy = options.backdropFailurePolicy || "preserve";
  const policy = createAssetUrlPolicy(payload, options);
  const gateway = options.assetGateway ?? options.resourceProxy;
  const embedded = createEmbeddedResourceIndex(payload);
  const buffers = new Map(options.preparedBufferReferences || []);
  context.registerPreparedBufferReferences = (entries) => { for (const [url, buffer] of entries || []) buffers.set(url, buffer); };
  context.resolveEmbeddedResource = (source) => resolveEmbeddedResource(embedded, source);
  context.registerEmbeddedResources = (nextPayload) => {
    const added = createEmbeddedResourceIndex(nextPayload);
    for (const [source, url] of added) if (embedded.has(source) && embedded.get(source) !== url) throw Object.assign(new Error(`Conflicting embedded resource: ${source}`), { code: "RESOURCE_ID_CONFLICT" });
    for (const [source, url] of added) embedded.set(source, url);
  };
  context.resolveBufferReference = (reference, geometry) => {
    const key = typeof reference === "string" ? reference : reference?.id || reference?.buffer;
    const declaration = geometry?.buffers?.[key] ?? reference;
    const url = typeof declaration === "string" ? declaration : declaration?.url;
    const provided = options.resolveBufferReference?.(reference, geometry) ?? buffers.get(url);
    if (provided !== undefined && provided !== null) return provided;
    const source = url?.startsWith("pack://") ? context.resolveEmbeddedResource(url) : url;
    if (source?.startsWith("data:")) {
      const bytes = dataUrlToBytes(source);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    return undefined;
  };
  context.loadSignal = options.signal;
  // Loader bases must remain authoritative. Resolve each GLTF/OBJ child resource
  // only at the request boundary, after the loader has resolved its relative path.
  context.resolveModelResourceUrl = (source) => {
    if (source.startsWith("pack://")) return context.resolveEmbeddedResource(source);
    const path = String(source).split(/[?#]/)[0];
    const kind = /\.(png|jpe?g|webp|gif|avif|bmp|tga|ktx2?)$/i.test(path) ? "image"
      : /\.(gltf|glb|obj|mtl|fbx|stl|ply|usd[zac]?)$/i.test(path) ? "model" : "binary";
    return resolveAssetUrl(source, gateway, { kind });
  };
  context.resolveAssetCandidates = (source) => resolvePublicAssetUrlCandidates(source, policy);
  context.resolveAssetUrl = (source, request = {}) => {
    if (source.startsWith("pack://")) return context.resolveEmbeddedResource(source);
    const kind = request.kind === "texture" ? "image" : request.kind;
    const runtimeUrl = resolveAssetUrl(source, gateway, { ...request, kind });
    return typeof options.resolveRuntimeUrl === "function" && kind === "image"
      ? options.resolveRuntimeUrl(source, { ...request, kind, runtimeUrl })
      : typeof options.resolveResourceUrl === "function"
      ? options.resolveResourceUrl(source, { ...request, kind, runtimeUrl })
      : runtimeUrl;
  };
  context.assetUrlPolicy = policy;
  return context;
}

export function configureSceneResourcePolicy(context, payload, options = {}) {
  return Object.assign(context, createSceneResourcePolicy(payload, options));
}
