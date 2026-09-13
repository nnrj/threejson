/** Generic static-resource URL resolution for image, video, audio, model and JSON assets. */
import { MATERIAL_TEXTURE_SLOTS } from "../texture/textureSlots.js";

const TEXTURE_KEYS = new Set(["map", ...Object.values(MATERIAL_TEXTURE_SLOTS).map((slot) => slot.descriptorField)]);

const URL_KEYS = new Set([
  "textureUrl",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "emissiveMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
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
  if (["textureurl", "normalmap", "roughnessmap", "metalnessmap", "aomap", "emissivemap", "alphamap", "bumpmap", "displacementmap"].includes(normalized)) {
    return normalized === "textureurl" && parent?.textureKind === "video" ? "video" : "image";
  }
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
  // Proxied asset URLs are embedded directly as <img>/texture/media `src` values — the browser
  // fetches them as plain GETs with no way to attach an `Authorization` header. If the gateway
  // requires an API key, it must therefore travel as a query param instead of a header, or every
  // deployment with "require API key" turned on would silently 401 on every texture/media load.
  const apiKey = String(config.apiKey || "").trim();
  if (apiKey) target.searchParams.set("key", apiKey);
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
export function applyAssetGatewayToPayload(payload, config, options = {}) {
  if (!config || config.enabled === false || !payload || typeof payload !== "object") return payload;
  const visit = (value, parent = null, key = "") => {
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, parent, key));
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [childKey, childValue] of Object.entries(value)) {
      if (childKey === "textureResources" || (options.deferTextures && TEXTURE_KEYS.has(childKey))) continue;
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

