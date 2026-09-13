import { createAssetUrlPolicy, resolvePublicAssetUrlCandidates } from "../util/assetsBase.js";
import { resolveAssetUrl } from "../util/assetGateway.js";

/** Resource policy belongs to one runtime, never to a persisted descriptor. */
export function configureSceneResourcePolicy(context, payload, options = {}) {
  const policy = createAssetUrlPolicy(payload, options);
  const gateway = options.assetGateway ?? options.resourceProxy;
  context.loadSignal = options.signal;
  // Loader bases must remain authoritative. Resolve each GLTF/OBJ child resource
  // only at the request boundary, after the loader has resolved its relative path.
  context.resolveModelResourceUrl = (source) => {
    const path = String(source).split(/[?#]/)[0];
    const kind = /\.(png|jpe?g|webp|gif|avif|bmp|tga|ktx2?)$/i.test(path) ? "image"
      : /\.(gltf|glb|obj|mtl|fbx|stl|ply|usd[zac]?)$/i.test(path) ? "model" : "binary";
    return resolveAssetUrl(source, gateway, { kind });
  };
  context.resolveAssetCandidates = (source) => resolvePublicAssetUrlCandidates(source, policy);
  context.resolveAssetUrl = (source, request = {}) => {
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
