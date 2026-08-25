/**
 * Shared low-level client for the built-in trial AI provider's backend (threebox-server, a
 * Cloudflare Worker — deployed at https://api.threebox.org by default). Used by both `threebox/`
 * and `editor/` so device fingerprinting, request signing, and the issue/quota HTTP calls exist
 * in exactly one place — the two apps' own `*BuiltinAiProvider.js` glue modules layer their
 * app-specific settings storage and UI feedback on top of the pure functions here.
 */

/** The host-owned `provider` value both apps persist for the built-in trial service. The engine
 * deliberately does not know this identifier; `BUILTIN_AI_PROVIDER_ADAPTER` below supplies its
 * OpenAI-compatible transport contract at the application boundary. */
export const BUILTIN_PROVIDER_TYPE = "threebox-builtin";

export const DEFAULT_BUILTIN_BACKEND_URL = "https://api.threebox.org";

const BUILTIN_THINKING_PREFERENCES = new Set(["inherit", "disabled", "high", "max"]);
const BUILTIN_ERROR_CODE_MAP = Object.freeze({
  QUOTA_EXCEEDED: "BUILTIN_QUOTA_EXCEEDED",
  SAFETY_POLICY_WARNING: "BUILTIN_SAFETY_WARNING",
  DEVICE_BANNED: "BUILTIN_DEVICE_BANNED",
  DEVICE_PERMANENTLY_BANNED: "BUILTIN_DEVICE_PERMANENTLY_BANNED",
  DEVICE_MUTED: "BUILTIN_DEVICE_MUTED"
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeBuiltinThinkingPreference(value) {
  const normalized = String(value || "disabled");
  return BUILTIN_THINKING_PREFERENCES.has(normalized) ? normalized : "disabled";
}

/** Mutable state shared by all built-in-provider requests spawned by one user action. */
export function createBuiltinAiTurnContext(turnId, originalPrompt) {
  return {
    turnId: String(turnId || "").trim(),
    originalPrompt: String(originalPrompt || ""),
    moderationStatus: "pending",
    moderationReceipt: "",
    originalPromptHash: ""
  };
}

export function buildBuiltinAiRequestContext(context, options = {}) {
  if (!isRecord(context) || !String(context.turnId || "").trim()) return undefined;
  const hasReceipt = Boolean(String(context.moderationReceipt || "").trim());
  const taskKind = /^[a-z][a-z0-9_-]{0,63}$/i.test(String(options.taskKind || "").trim())
    ? String(options.taskKind).trim()
    : "";
  const preference = Object.prototype.hasOwnProperty.call(options, "thinkingPreference")
    ? normalizeBuiltinThinkingPreference(options.thinkingPreference)
    : "inherit";
  const thinking = preference === "inherit"
    ? null
    : preference === "disabled"
      ? { mode: "disabled" }
      : { mode: "enabled", effort: preference };
  return {
    protocol_version: 1,
    turn_id: String(context.turnId).trim(),
    original_prompt: hasReceipt
      ? { included: false }
      : { included: true, text: String(context.originalPrompt || "") },
    moderation: {
      status: hasReceipt ? String(context.moderationStatus || "allowed") : "pending",
      ...(hasReceipt ? { receipt: String(context.moderationReceipt) } : {}),
      ...(context.originalPromptHash ? { prompt_hash: String(context.originalPromptHash) } : {})
    },
    ...((taskKind || thinking) ? {
      ai: {
        ...(taskKind ? { task_kind: taskKind } : {}),
        ...(thinking ? { thinking } : {})
      }
    } : {})
  };
}

export function applyBuiltinAiModerationHeaders(context, headers) {
  if (!isRecord(context) || !headers?.get) return;
  const status = String(headers.get("X-ThreeBox-Moderation-Status") || "").trim();
  const receipt = String(headers.get("X-ThreeBox-Moderation-Receipt") || "").trim();
  const promptHash = String(headers.get("X-ThreeBox-Moderation-Prompt-Hash") || "").trim();
  if (status) context.moderationStatus = status;
  if (receipt) context.moderationReceipt = receipt;
  if (promptHash) context.originalPromptHash = promptHash;
}

/** Host-owned protocol adapter injected into `threejson/ai`. Product request fields, moderation
 * response headers, quota codes and gateway errors therefore never enter ThreeJSON core. */
export const BUILTIN_AI_PROVIDER_ADAPTER = Object.freeze({
  endpoint: "/v1/chat/completions",
  defaultModel: "",
  transformRequestBody(body, options = {}) {
    const context = buildBuiltinAiRequestContext(options.requestContext, options);
    return context ? { ...body, threebox_context: context } : body;
  },
  handleResponse(response, options = {}) {
    applyBuiltinAiModerationHeaders(options.requestContext, response?.headers);
  },
  classifyError({ payload } = {}) {
    const rawCode = String(payload?.error || "").trim();
    const code = BUILTIN_ERROR_CODE_MAP[rawCode]
      || (rawCode.startsWith("UPSTREAM_") ? rawCode : "");
    return {
      ...(code ? { code } : {}),
      providerError: isRecord(payload) ? payload : null
    };
  }
});

/** Adds the built-in transport contract while keeping the stored provider identifier unchanged. */
export function withBuiltinAiProviderAdapter(options = {}, requestContext) {
  return {
    ...options,
    provider: BUILTIN_PROVIDER_TYPE,
    providerAdapter: BUILTIN_AI_PROVIDER_ADAPTER,
    ...(requestContext !== undefined ? { requestContext } : {})
  };
}

/** Re-issue a trial key this long before its actual expiry, so a boot-time check rarely races an
 * about-to-expire key. */
export const KEY_REISSUE_MARGIN_MS = 24 * 60 * 60 * 1000;

/**
 * Shared public HMAC key used to sign `/v1/auth/issue` requests to threebox-server (see its README
 * for the matching `PUBLIC_REQUEST_SIGNING_KEY`). This is a deterrent against scripted abuse (proves
 * the caller has this client key, not just a spoofable Origin header), not a hard guarantee:
 * both apps are open source, so the key is extractable. The real backstop is the
 * backend's per-device quota and ban policy. Self-hosting your own backend? Change this to match
 * your own deployed `PUBLIC_REQUEST_SIGNING_KEY`, or leave the official default and just override the
 * backend URL setting if you only want to swap the endpoint.
 */
const PUBLIC_REQUEST_SIGNING_KEY = "threebox-public-client-2024";

let cachedFingerprintPromise = null;

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(digest);
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(signature);
}

/** Best-effort, low-churn canvas signal — wrapped in try/catch because privacy-hardened browsers
 * (e.g. Brave) may block or randomize canvas reads; a blank fallback just means this device leans
 * more on its other signals. */
function canvasSignal() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.textBaseline = "top";
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = "#f60";
    ctx.fillRect(0, 0, 80, 20);
    ctx.fillStyle = "#069";
    ctx.fillText("built-in AI device signal", 2, 15);
    return canvas.toDataURL();
  } catch {
    return "";
  }
}

function webglSignal() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return "";
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    if (!info) return "";
    return `${gl.getParameter(info.UNMASKED_VENDOR_WEBGL)}::${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)}`;
  } catch {
    return "";
  }
}

/**
 * Computes a stable per-device fingerprint by hashing low-churn browser/hardware signals — never
 * read from storage, so the same browser reproduces the same value even after clearing all site
 * data, and the same physical device visiting either app gets the same fingerprint (same signals,
 * same algorithm). Deliberately excludes `navigator.userAgent` (its version segment changes on
 * every browser auto-update, which would silently rotate the "identity" and defeat the point).
 * Not cryptographically unique across all devices — it doesn't need to be; see threebox-server's
 * README for how the backend treats this as a soft identity signal, not a hard guarantee.
 */
export function computeDeviceFingerprint() {
  if (!cachedFingerprintPromise) {
    cachedFingerprintPromise = (async () => {
      let timeZone = "";
      try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      } catch {
        /* ignore */
      }
      const parts = [
        String(screen.width || ""),
        String(screen.height || ""),
        String(screen.colorDepth || ""),
        String(navigator.hardwareConcurrency || ""),
        navigator.language || "",
        navigator.platform || "",
        timeZone,
        canvasSignal(),
        webglSignal()
      ];
      return sha256Hex(parts.join("|"));
    })();
  }
  return cachedFingerprintPromise;
}

/** Short, shareable form for support requests — must match threebox-server's `shortDeviceId()`
 * (src/lib/deviceId.ts) exactly so what a user sees in either app's settings matches what you
 * search for in the admin dashboard. */
export async function getDisplayDeviceId() {
  const deviceId = await computeDeviceFingerprint();
  return `TB-${deviceId.slice(0, 10).toUpperCase()}`;
}

function randomNonce() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

async function signIssueRequest(deviceId) {
  const ts = Date.now();
  const nonce = randomNonce();
  const sig = await hmacSha256Hex(PUBLIC_REQUEST_SIGNING_KEY, `${deviceId}.${ts}.${nonce}`);
  return { deviceId, ts, nonce, sig };
}

function normalizeBackendUrl(backendUrl) {
  return String(backendUrl || "").replace(/\/$/, "");
}

/**
 * Issues a fresh trial API key from threebox-server. Throws on any failure (missing/empty
 * `backendUrl`, network error, or a non-2xx response — the thrown Error's `status` property holds
 * the HTTP status when available) so callers decide how to surface it; this function itself has
 * no knowledge of settings storage or UI feedback.
 * @param {string} backendUrl
 * @returns {Promise<{apiKey: string, expiresAt: number, deviceId: string, shortId: string, quota: {roundsUsed:number, roundsLimit:number, costUsedUsdCents:number, costLimitUsdCents:number}}>}
 */
export async function issueBuiltinApiKey(backendUrl) {
  const base = normalizeBackendUrl(backendUrl);
  if (!base) {
    throw new Error("Built-in provider backend URL is not configured.");
  }
  const deviceId = await computeDeviceFingerprint();
  const signed = await signIssueRequest(deviceId);
  const res = await fetch(`${base}/v1/auth/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signed)
  });
  if (!res.ok) {
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* The status remains useful when a proxy returns a non-JSON error page. */
    }
    const serverCode = String(payload?.error || "").trim();
    const serverMessage = String(payload?.message || "").trim();
    const detail = serverCode || serverMessage
      ? `: ${[serverCode, serverMessage && serverMessage !== serverCode ? serverMessage : ""].filter(Boolean).join(" - ")}`
      : "";
    const error = new Error(`Built-in provider key issuance failed (${res.status})${detail}.`);
    error.status = res.status;
    error.code = serverCode;
    throw error;
  }
  return res.json();
}

/**
 * Fetches the current quota/ban status for an already-issued trial key. Throws on failure, same
 * conventions as `issueBuiltinApiKey`.
 * @param {string} backendUrl
 * @param {string} apiKey
 * @returns {Promise<{deviceId: string, shortId: string, banned: boolean, banReason: string|null, quota: object, keyExpiresAt: number}>}
 */
export async function fetchBuiltinQuota(backendUrl, apiKey) {
  const base = normalizeBackendUrl(backendUrl);
  if (!base || !apiKey) {
    throw new Error("Built-in provider backend URL or API key is missing.");
  }
  const res = await fetch(`${base}/v1/quota`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!res.ok) {
    const error = new Error(`Built-in provider quota fetch failed (${res.status}).`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}
