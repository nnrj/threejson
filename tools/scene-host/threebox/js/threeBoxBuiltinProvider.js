import { THREEBOX_BUILTIN_PROVIDER_ID, THREEBOX_BUILTIN_PROVIDER_TYPE } from "./threeBoxSettingsSchema.js";
import {
  KEY_REISSUE_MARGIN_MS,
  computeDeviceFingerprint,
  fetchBuiltinQuota as fetchBuiltinQuotaRaw,
  getDisplayDeviceId as getDisplayDeviceIdShared,
  issueBuiltinApiKey
} from "../../shared/js/builtinAiProvider.js";
import { showToast } from "./threeBoxUiFeedback.js";
import { t } from "../../shared/i18n/index.js";

// Re-exported so existing ThreeBox imports of `getDisplayDeviceId` from this module keep working
// unchanged — the actual fingerprinting/hashing now lives in the shared module (see
// tools/scene-host/shared/js/builtinAiProvider.js), used identically by editor/.
export const getDisplayDeviceId = getDisplayDeviceIdShared;

function findBuiltinProvider(settings) {
  const providers = Array.isArray(settings?.ai?.providers) ? settings.ai.providers : [];
  return providers.find((p) => p.provider === THREEBOX_BUILTIN_PROVIDER_TYPE) || null;
}

function backendUrl(settings) {
  return String(settings?.ai?.builtinBackendUrl || "").replace(/\/$/, "");
}

/** Shown once per failed boot attempt — only when there's no already-working cached key to fall
 * back on (see below), so a transient failure to *renew* a still-valid key doesn't nag the user.
 * Deliberately the default "info" toast style, not "warning"/"error": ThreeBox worked perfectly
 * well before it had a built-in provider at all, purely from a manually configured one, so this
 * isn't a failure state for the app — it's just letting the user know why the zero-config path
 * isn't available right now. */
function notifyBuiltinProviderUnavailable() {
  showToast(
    t("threebox.builtin.unavailableToast", "内置供应商无法访问，请配置供应商。"),
    "info"
  );
}

/**
 * Issues (or silently re-issues, ahead of expiry) the built-in provider's trial API key and
 * writes it back into `ai.providers[]` via `settingsModal.updateSettings`. Safe to call on every
 * ThreeBox boot — it's a no-op once a non-expiring-soon key is already present. The issued key is
 * written regardless of `ai.rememberKeys`: it's a low-value, backend-revocable trial credential,
 * not a user-owned secret, so the "don't remember my key" privacy setting shouldn't force
 * re-issuing a new device registration on every reload.
 *
 * Graceful degradation: if the backend can't be reached (or isn't configured), this simply
 * returns without an apiKey — the built-in provider entry then behaves exactly like an
 * unconfigured "custom" provider (see resolveProviderOptions in threeBoxOrchestrator.js), so
 * ThreeBox falls back to needing the user to add/select a working provider, same as it always did
 * before this feature existed. Nothing here blocks boot or throws past this function.
 * @param {{getSettings: () => object, updateSettings: (updater: (draft: object) => void, options?: object) => object}} settingsModal
 */
async function ensureBuiltinApiKeyInternal(settingsModal) {
  const settings = settingsModal.getSettings();
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
    settingsModal.updateSettings(
      (draft) => {
        const draftProvider = findBuiltinProvider(draft);
        if (!draftProvider) return;
        draftProvider.apiKey = body.apiKey;
        draftProvider.builtinKeyExpiresAt = body.expiresAt;
        draftProvider.builtinShortId = body.shortId;
        draftProvider.builtinQuota = body.quota;
      },
      { notify: true, toast: false, closeModal: false }
    );
  } catch (error) {
    console.warn("[threebox] built-in provider key issuance failed:", error);
    if (!provider.apiKey) {
      notifyBuiltinProviderUnavailable();
    }
  }
}

let inFlightEnsurePromise = null;

/**
 * Public entry point for `ensureBuiltinApiKeyInternal` above — deduplicates concurrent callers
 * into a single in-flight request/promise. This matters because `threeBoxApp.js`'s `main()` fires
 * this once on boot (`void ensureBuiltinApiKey(...)`, not awaited so it never blocks first paint),
 * and separately awaits it again from the send-message path if a key is still missing at send
 * time (closing the race where a user types and hits Send before the boot-time issuance request
 * has come back) — without dedup, that second call would fire a redundant `/v1/auth/issue`
 * request (a second device registration attempt) instead of just waiting for the first one.
 */
export function ensureBuiltinApiKey(settingsModal) {
  if (!inFlightEnsurePromise) {
    inFlightEnsurePromise = ensureBuiltinApiKeyInternal(settingsModal).finally(() => {
      inFlightEnsurePromise = null;
    });
  }
  return inFlightEnsurePromise;
}

/**
 * Refreshes the cached quota snapshot from the backend (GET /v1/quota) — used by the settings
 * panel so the displayed "剩余额度" isn't stale from whenever the key happened to be issued.
 * Fails silently (returns the last-known cached quota) since this is a best-effort UI refresh.
 * Only persists when the fetched values actually differ from the cached ones — `updateSettings`
 * re-renders the (currently open) settings panel, which would rebuild this same provider card and
 * call back into this function; committing unconditionally would loop for as long as the panel
 * stays open, so this only writes through on a real change (and a same-value refetch on the
 * resulting re-render then no-ops, ending the chain after at most one extra render).
 */
export async function refreshBuiltinQuota(settingsModal) {
  const settings = settingsModal.getSettings();
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
      settingsModal.updateSettings(
        (draft) => {
          const draftProvider = findBuiltinProvider(draft);
          if (!draftProvider) return;
          draftProvider.builtinQuota = body.quota;
          draftProvider.builtinShortId = body.shortId;
        },
        { notify: false, toast: false, closeModal: false }
      );
    }
    return body.quota;
  } catch {
    return provider.builtinQuota || null;
  }
}

// computeDeviceFingerprint is re-exported for parity with the pre-refactor module surface, even
// though no current ThreeBox call site imports it directly (getDisplayDeviceId is what's used).
export { computeDeviceFingerprint };

export function isBuiltinProviderId(id) {
  return id === THREEBOX_BUILTIN_PROVIDER_ID;
}
