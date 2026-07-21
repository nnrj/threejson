/** Generic static-resource URL resolution for image, video, audio, model and JSON assets. */

const URL_KEYS = new Set([
  "textureUrl",
  "videoUrl",
  "audioUrl",
  "modelPath",
  "fontJsonUrl",
  "environmentUrl",
  "hdrUrl",
  "url"
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isProxyableUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function inferAssetKind(key, parent) {
  const normalized = String(key || "").toLowerCase();
  if (normalized === "textureurl") return parent?.textureKind === "video" ? "video" : "image";
  if (normalized === "videourl") return "video";
  if (normalized === "audiourl") return "audio";
  if (normalized === "modelpath") return "model";
  if (normalized === "fontjsonurl" || normalized === "environmenturl" || normalized === "hdrurl") return "binary";
  if (parent?.assetKind) return String(parent.assetKind).toLowerCase();
  if (parent?.objType === "css3dPanel") return "json";
  return "json";
}

function buildProxyUrl(url, config, context) {
  const endpoint = String(config.endpoint || "/v1/assets/proxy").trim();
  const baseUrl = String(config.baseUrl || "").trim();
  if (!baseUrl) return url;
  const target = new URL(endpoint, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  target.searchParams.set("url", url);
  target.searchParams.set("kind", context.kind);
  return target.href;
}

/** Resolve one static asset URL without changing the persisted scene JSON. */
export function resolveAssetUrl(url, config, context = {}) {
  if (!isProxyableUrl(url) || !config || config.enabled === false) return url;
  if (typeof config.resolveUrl === "function") {
    try {
      return config.resolveUrl(url, context) || url;
    } catch {
      return url;
    }
  }
  return buildProxyUrl(url, config, context);
}

/** Apply an asset gateway to a normalized runtime payload in-place. */
export function applyAssetGatewayToPayload(payload, config) {
  if (!config || config.enabled === false || !payload || typeof payload !== "object") return payload;
  const visit = (value, parent = null, key = "") => {
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, parent, key));
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [childKey, childValue] of Object.entries(value)) {
      if (URL_KEYS.has(childKey) && isProxyableUrl(childValue)) {
        value[childKey] = resolveAssetUrl(childValue, config, {
          kind: inferAssetKind(childKey, value),
          key: childKey,
          parent,
          payload
        });
      } else {
        visit(childValue, value, childKey);
      }
    }
  };
  visit(payload);
  return payload;
}

