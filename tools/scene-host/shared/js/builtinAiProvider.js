/**
 * Shared low-level client for the built-in trial AI provider's backend (threebox-server, a
 * Cloudflare Worker — deployed at https://api.threebox.org by default). Used by both `threebox/`
 * and `editor/` so device fingerprinting, request signing, and the issue/quota HTTP calls exist
 * in exactly one place — the two apps' own `*BuiltinAiProvider.js` glue modules layer their
 * app-specific settings storage and UI feedback on top of the pure functions here.
 */

/** The `provider` value both apps write into their AI settings when the built-in trial provider
 * is selected, and the `PROVIDERS` key `core/ai/sceneAiService.js` resolves it against. Do not
 * rename: real users already have this literal string persisted in their browsers' localStorage
 * (ThreeBox shipped before this module existed) — changing it would silently orphan their saved
 * provider config. */
export const BUILTIN_PROVIDER_TYPE = "threebox-builtin";

export const DEFAULT_BUILTIN_BACKEND_URL = "https://api.threebox.org";

/** Re-issue a trial key this long before its actual expiry, so a boot-time check rarely races an
 * about-to-expire key. */
export const KEY_REISSUE_MARGIN_MS = 24 * 60 * 60 * 1000;

/**
 * Shared HMAC secret used to sign `/v1/auth/issue` requests to threebox-server (see its README
 * for the matching `REQUEST_SIGNING_SECRET`). This is a deterrent against scripted abuse (proves
 * the caller has this client secret, not just a spoofable Origin header), not a hard guarantee:
 * both apps are open source, so the secret is technically extractable. The real backstop is the
 * backend's per-device quota and ban policy. Self-hosting your own backend? Change this to match
 * your own deployed `REQUEST_SIGNING_SECRET`, or leave the official default and just override the
 * backend URL setting if you only want to swap the endpoint.
 */
const REQUEST_SIGNING_SECRET = "threebox-public-client-2024";

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
  const sig = await hmacSha256Hex(REQUEST_SIGNING_SECRET, `${deviceId}.${ts}.${nonce}`);
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
    const error = new Error(`Built-in provider key issuance failed (${res.status}).`);
    error.status = res.status;
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
