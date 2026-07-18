import {
  BUILTIN_PROVIDER_TYPE,
  KEY_REISSUE_MARGIN_MS,
  fetchBuiltinQuota as fetchBuiltinQuotaRaw,
  getDisplayDeviceId as getDisplayDeviceIdShared,
  issueBuiltinApiKey
} from "../../shared/js/builtinAiProvider.js";

export { BUILTIN_PROVIDER_TYPE };

/** Re-exported for the AI-edit tab / settings display — same fingerprint derivation as ThreeBox
 * (see tools/scene-host/shared/js/builtinAiProvider.js), so the same physical device shows the
 * same ID in either app. */
export const getDisplayDeviceId = getDisplayDeviceIdShared;

/** Finds the (at most one) auto-seeded built-in provider entry in ai.providers[] — mirrors
 * threeBoxBuiltinProvider.js's findBuiltinProvider. */
export function findEditorBuiltinProvider(settings) {
  const providers = Array.isArray(settings?.ai?.providers) ? settings.ai.providers : [];
  return providers.find((p) => p.provider === BUILTIN_PROVIDER_TYPE) || null;
}

function backendUrl(settings) {
  return String(settings?.ai?.builtinBackendUrl || "").replace(/\/$/, "");
}

/**
 * Issues (or silently re-issues, ahead of expiry) the built-in provider's trial API key into the
 * ai.providers[] entry whose provider type is the built-in one. Mirrors ThreeBox's
 * ensureBuiltinApiKey (threeBoxBuiltinProvider.js), adapted to Editor's array-of-providers shape
 * (Editor moved off its old scalar ai.provider/ai.apiKey fields onto the same shape as ThreeBox).
 * A no-op whenever no built-in provider entry exists, or an unexpired key is already cached.
 *
 * Graceful degradation: on any failure (backend unreachable/misconfigured, non-2xx response) this
 * just returns without touching the entry's apiKey — Editor falls back to needing a manually
 * configured provider, same as it always did before this feature existed.
 * @param {{getEditorSettings: () => object, persistSettings: () => void, onIssued?: () => void, onUnavailable?: () => void}} deps
 */
async function ensureEditorBuiltinApiKeyInternal({ getEditorSettings, persistSettings, onIssued, onUnavailable }) {
  const settings = getEditorSettings();
  const provider = findEditorBuiltinProvider(settings);
  if (!provider) {
    return;
  }
  const now = Date.now();
  const expiresAt = Number(provider.builtinKeyExpiresAt || 0);
  if (provider.apiKey && expiresAt - now > KEY_REISSUE_MARGIN_MS) {
    return;
  }

  const hadKeyBefore = Boolean(provider.apiKey);
  try {
    const body = await issueBuiltinApiKey(backendUrl(settings));
    provider.apiKey = body.apiKey;
    provider.builtinKeyExpiresAt = body.expiresAt;
    provider.builtinShortId = body.shortId;
    provider.builtinQuota = body.quota;
    persistSettings?.();
    onIssued?.();
  } catch (error) {
    console.warn("[editor] built-in provider key issuance failed:", error);
    if (!hadKeyBefore) {
      onUnavailable?.();
    }
  }
}

let inFlightEnsurePromise = null;

/**
 * Public entry point — deduplicates concurrent callers into a single in-flight request/promise.
 * Boot fires this once without awaiting it (so first paint isn't blocked on a network round
 * trip), and the AI-edit panel separately awaits it if a key is still missing at the moment the
 * user triggers an AI action — without dedup that second call would fire a redundant
 * `/v1/auth/issue` request instead of just waiting for the boot-time one to land.
 */
export function ensureEditorBuiltinApiKey(deps) {
  if (!inFlightEnsurePromise) {
    inFlightEnsurePromise = ensureEditorBuiltinApiKeyInternal(deps).finally(() => {
      inFlightEnsurePromise = null;
    });
  }
  return inFlightEnsurePromise;
}

/**
 * Refreshes the cached quota snapshot from the backend (GET /v1/quota) — used by the settings
 * panel's built-in provider card so the displayed "剩余额度" isn't stale from whenever the key
 * happened to be issued. Fails silently (returns the last-known cached quota). Mirrors ThreeBox's
 * refreshBuiltinQuota; see its docblock for why this only persists on an actual value change.
 * @param {{getEditorSettings: () => object, persistSettings: () => void}} deps
 */
export async function refreshEditorBuiltinQuota({ getEditorSettings, persistSettings }) {
  const settings = getEditorSettings();
  const provider = findEditorBuiltinProvider(settings);
  if (!provider?.apiKey) {
    return provider?.builtinQuota || null;
  }
  try {
    const body = await fetchBuiltinQuotaRaw(backendUrl(settings), provider.apiKey);
    const changed =
      JSON.stringify(body.quota) !== JSON.stringify(provider.builtinQuota) ||
      body.shortId !== provider.builtinShortId;
    if (changed) {
      provider.builtinQuota = body.quota;
      provider.builtinShortId = body.shortId;
      persistSettings?.();
    }
    return body.quota;
  } catch {
    return provider.builtinQuota || null;
  }
}

/** Whether the built-in provider currently has a usable (non-empty) API key — used to decide
 * whether to show the "builtin unavailable" toast when the AI-edit tab is shown with the built-in
 * provider selected. */
export function isEditorBuiltinProviderUsable(settings) {
  const provider = findEditorBuiltinProvider(settings);
  return Boolean(provider?.apiKey);
}
