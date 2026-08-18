import { TextureAcquisitionProvider } from "threejson/texture";

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function readJsonResponse(response) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    const error = new Error(body?.message || body?.error || `Texture service returned HTTP ${response.status}.`);
    error.status = response.status;
    error.code = body?.error || body?.code || "TEXTURE_SERVICE_ERROR";
    throw error;
  }
  return body || {};
}

/** Creates a client for the neutral texture acquisition HTTP contract. */
export function createTextureServiceProvider(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const apiKey = String(options.apiKey || "").trim();
  if (!baseUrl || !apiKey) return null;

  const request = async (path, init = {}, context = {}) => {
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${apiKey}`);
    if (init.body != null) headers.set("Content-Type", "application/json");
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: context.signal });
    return readJsonResponse(response);
  };

  return new TextureAcquisitionProvider({
    capabilities: (context) => request("/v1/textures/capabilities", { method: "GET" }, context),
    search: (payload, context) => request("/v1/textures/search", { method: "POST", body: JSON.stringify(payload) }, context),
    generate: (payload, context) => request("/v1/textures/generate", { method: "POST", body: JSON.stringify(payload) }, context),
    persist: (payload, context) => request("/v1/textures/persist", { method: "POST", body: JSON.stringify(payload) }, context)
  });
}

export function createTextureProxyUrl(baseUrl, apiKey, sourceUrl) {
  const base = normalizeBaseUrl(baseUrl);
  const key = String(apiKey || "").trim();
  const source = String(sourceUrl || "").trim();
  if (!base || !key || !source || !/^https?:\/\//i.test(source)) return source;
  const url = new URL(`${base}/v1/textures/proxy`);
  url.searchParams.set("url", source);
  url.searchParams.set("key", key);
  return url.href;
}
