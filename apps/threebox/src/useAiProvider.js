/**
 * Built-in trial provider state for ThreeBox.
 *
 * Since the schema-driven settings modal landed, the source of truth for *which* providers exist
 * (the `ai.providers` array the composer picks from) is the settings store (useThreeBoxSettings).
 * This hook is now scoped to the one provider that needs device-bound, non-persisted machinery the
 * settings store can't hold: the built-in quota-limited trial backend. It owns the privacy gate
 * (every prompt is content-moderated server-side, so the user must accept the agreement first) and
 * the per-device trial key issued by host-kit's builtinAiProvider. The user's own providers
 * (chatgpt / deepseek / custom) are resolved directly from their settings entry in App.jsx.
 */
import { useCallback, useEffect, useState } from "react";
import {
  BUILTIN_PROVIDER_TYPE,
  issueBuiltinApiKey,
  getDisplayDeviceId,
  withBuiltinAiProviderAdapter
} from "@threejson/host-kit/js/builtinAiProvider.js";
import {
  BUILTIN_PRIVACY_ACCEPTED,
  getBuiltinPrivacyDecision,
  setBuiltinPrivacyDecision
} from "@threejson/host-kit/js/builtinProviderPrivacy.js";

const PRIVACY_SCOPE = "threebox";

export function useAiProvider() {
  const [privacyDecision, setPrivacyDecision] = useState(() => getBuiltinPrivacyDecision(PRIVACY_SCOPE));
  const [builtinKey, setBuiltinKey] = useState(null);
  const [deviceId, setDeviceId] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState(null);

  useEffect(() => {
    void getDisplayDeviceId().then(setDeviceId);
  }, []);

  const acceptPrivacy = useCallback(() => {
    setBuiltinPrivacyDecision(PRIVACY_SCOPE, BUILTIN_PRIVACY_ACCEPTED);
    setPrivacyDecision(BUILTIN_PRIVACY_ACCEPTED);
  }, []);

  const declinePrivacy = useCallback(() => {
    setBuiltinPrivacyDecision(PRIVACY_SCOPE, "declined");
    setPrivacyDecision("declined");
  }, []);

  const privacyAccepted = privacyDecision === BUILTIN_PRIVACY_ACCEPTED;

  /** Issues (once) the per-device trial key for the built-in backend. */
  const ensureBuiltinKey = useCallback(
    async (backendUrl) => {
      if (builtinKey) {
        return builtinKey;
      }
      setIssuing(true);
      setIssueError(null);
      try {
        const body = await issueBuiltinApiKey(backendUrl);
        setBuiltinKey(body.apiKey);
        return body.apiKey;
      } catch (error) {
        setIssueError(error);
        return null;
      } finally {
        setIssuing(false);
      }
    },
    [builtinKey]
  );

  /**
   * Resolves providerOptions for the built-in trial provider, or { ready:false, reason } explaining
   * what the user still has to do (accept privacy / retry issuance).
   * @param {string} backendUrl settings.ai.builtinBackendUrl
   */
  const resolveBuiltinProviderOptions = useCallback(
    async (backendUrl) => {
      if (!privacyAccepted) {
        return { ready: false, reason: "privacy" };
      }
      const key = await ensureBuiltinKey(backendUrl);
      if (!key) {
        return { ready: false, reason: "issue-failed" };
      }
      return {
        ready: true,
        options: withBuiltinAiProviderAdapter({ apiKey: key, baseUrl: backendUrl })
      };
    },
    [privacyAccepted, ensureBuiltinKey]
  );

  return {
    deviceId,
    privacyAccepted,
    privacyDecided: privacyDecision !== null,
    acceptPrivacy,
    declinePrivacy,
    builtinKeyIssued: Boolean(builtinKey),
    issuing,
    issueError,
    resolveBuiltinProviderOptions
  };
}
