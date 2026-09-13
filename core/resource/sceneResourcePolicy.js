import { createAssetUrlPolicy, resolvePublicAssetUrlCandidates } from "../util/assetsBase.js";
import { resolveAssetUrl } from "../util/assetGateway.js";

/** Resource policy belongs to one runtime, never to a persisted descriptor. */
export function configureSceneResourcePolicy(context, payload, options = {}) {
  const policy = createAssetUrlPolicy(payload, options);
  const gateway = options.assetGateway ?? options.resourceProxy;
  context.resolveAssetCandidates = (source) => resolvePublicAssetUrlCandidates(source, policy);
  context.resolveAssetUrl = (source, request = {}) => {
    const kind = request.kind === "texture" ? "image" : request.kind;
    const runtimeUrl = resolveAssetUrl(source, gateway, { ...request, kind });
    return typeof options.resolveResourceUrl === "function"
      ? options.resolveResourceUrl(source, { ...request, kind, runtimeUrl })
      : runtimeUrl;
  };
  context.assetUrlPolicy = policy;
  return context;
}
