/**
 * Built-in trial provider key/quota management, ported from
 * tools/scene-host/threebox/js/threeBoxBuiltinProvider.js (structure follows threebox-cloud's port).
 * The trial API key + quota live in the settings provider entry (ai.providers[builtin]); this module
 * issues/re-issues the key ahead of expiry and refreshes the quota snapshot, driving the settings
 * store via a duck-typed controller. Graceful degradation: if the backend can't be reached (or the
 * privacy agreement isn't accepted), it simply leaves the entry without an apiKey, and the built-in
 * provider then behaves like an unconfigured provider.
 */
import {
  BUILTIN_PROVIDER_TYPE,
  KEY_REISSUE_MARGIN_MS,
  computeDeviceFingerprint,
  fetchBuiltinQuota as fetchBuiltinQuotaRaw,
  getDisplayDeviceId as getDisplayDeviceIdShared,
  issueBuiltinApiKey
} from "@threejson/host-kit/js/builtinAiProvider.js";
import { isBuiltinPrivacyAccepted as isBuiltinPrivacyAcceptedRaw } from "@threejson/host-kit/js/builtinProviderPrivacy.js";
import { THREEBOX_BUILTIN_PROVIDER_ID } from "./threeBoxSettingsSchema.js";

const PRIVACY_SCOPE = "threebox";

export const getDisplayDeviceId = getDisplayDeviceIdShared;
export { computeDeviceFingerprint };

export function isBuiltinPrivacyAccepted() {
  return isBuiltinPrivacyAcceptedRaw(PRIVACY_SCOPE);
}

function findBuiltinProvider(settings) {
  const providers = Array.isArray(settings?.ai?.providers) ? settings.ai.providers : [];
  return providers.find((p) => p.provider === BUILTIN_PROVIDER_TYPE) || null;
}

function backendUrl(settings) {
  return String(settings?.ai?.builtinBackendUrl || "").replace(/\/$/, "");
}

async function ensureBuiltinApiKeyInternal(settingsController, options = {}) {
  if (!isBuiltinPrivacyAccepted()) {
    return;
  }
  const settings = settingsController.getSettings();
  const provider = findBuiltinProvider(settings);
  if (!provider) {
    return;
  }
  const now = Date.now();
  const expiresAt = Number(provider.builtinKeyExpiresAt || 0);
  if (provider.apiKey && expiresAt - now > KEY_REISSUE_MARGIN_MS) {
    return;
  }
  try {
    const body = await issueBuiltinApiKey(backendUrl(settings));
    settingsController.updateSettings((draft) => {
      const draftProvider = findBuiltinProvider(draft);
      if (!draftProvider) {
        return;
      }
      draftProvider.apiKey = body.apiKey;
      draftProvider.builtinKeyExpiresAt = body.expiresAt;
      draftProvider.builtinShortId = body.shortId;
      draftProvider.builtinQuota = body.quota;
    });
  } catch (error) {
    console.warn("[threebox] built-in provider key issuance failed:", error);
    if (!provider.apiKey) {
      options.onUnavailable?.(error);
    }
  }
}

let inFlightEnsurePromise = null;

/** Public entry point — deduplicates concurrent callers into a single in-flight request. */
export function ensureBuiltinApiKey(settingsController, options = {}) {
  if (!inFlightEnsurePromise) {
    inFlightEnsurePromise = ensureBuiltinApiKeyInternal(settingsController, options).finally(() => {
      inFlightEnsurePromise = null;
    });
  }
  return inFlightEnsurePromise;
}

/**
 * Refreshes the cached quota snapshot from the backend (GET /v1/quota) so the settings panel isn't
 * stale. Fails silently (returns the last-known cached quota). Only persists when the fetched values
 * actually differ, to avoid a re-render loop while the panel stays open.
 */
export async function refreshBuiltinQuota(settingsController) {
  if (!isBuiltinPrivacyAccepted()) {
    return null;
  }
  const settings = settingsController.getSettings();
  const provider = findBuiltinProvider(settings);
  if (!provider?.apiKey) {
    return provider?.builtinQuota || null;
  }
  try {
    const body = await fetchBuiltinQuotaRaw(backendUrl(settings), provider.apiKey);
    const changed =
      JSON.stringify(body.quota) !== JSON.stringify(provider.builtinQuota) ||
      body.shortId !== provider.builtinShortId;
    if (changed) {
      settingsController.updateSettings((draft) => {
        const draftProvider = findBuiltinProvider(draft);
        if (!draftProvider) {
          return;
        }
        draftProvider.builtinQuota = body.quota;
        draftProvider.builtinShortId = body.shortId;
      });
    }
    return body.quota;
  } catch {
    return provider.builtinQuota || null;
  }
}

export function isBuiltinProviderId(id) {
  return id === THREEBOX_BUILTIN_PROVIDER_ID;
}
