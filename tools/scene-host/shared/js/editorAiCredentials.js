import { BUILTIN_PROVIDER_TYPE, ensureEditorBuiltinApiKey, getDisplayDeviceId } from "./editorBuiltinAiProvider.js";
import { withBuiltinAiProviderAdapter } from "./builtinAiProvider.js";
import { BUILTIN_PRIVACY_ACCEPTED, isBuiltinPrivacyAccepted } from "./builtinProviderPrivacy.js";

export function getSelectedProvider(host) {
  const ai = host.getEditorSettings()?.ai || {};
  const providers = (Array.isArray(ai.providers) ? ai.providers : []).filter(provider => provider.provider !== BUILTIN_PROVIDER_TYPE || isBuiltinPrivacyAccepted("editor"));
  return providers.find(provider => provider.id === ai.defaultProviderId) || providers[0] || null;
}
export function getCredentials(host) {
  const provider = getSelectedProvider(host);
  if (!provider) return { provider: "", apiKey: "", model: undefined, baseUrl: undefined };
  const creds = { provider: provider.provider || "chatgpt", apiKey: String(provider.apiKey || "").trim(), model: String(provider.model || "").trim() || undefined, baseUrl: undefined };
  if (provider.provider === "custom") creds.baseUrl = String(provider.baseUrl || "").trim() || undefined;
  else if (provider.provider === BUILTIN_PROVIDER_TYPE) {
    creds.baseUrl = String(host.getEditorSettings()?.ai?.builtinBackendUrl || "").trim() || undefined;
    return withBuiltinAiProviderAdapter(creds);
  }
  return creds;
}
export async function ensureUsableCredentials(host) {
  const decision = await host.promptBuiltinPrivacyAgreement?.();
  if (decision && decision !== BUILTIN_PRIVACY_ACCEPTED) {
    const creds = getCredentials(host);
    if (creds.provider === "deepseek") creds.userId = await getDisplayDeviceId();
    return creds;
  }
  let creds = getCredentials(host);
  if (!creds.apiKey && creds.provider === BUILTIN_PROVIDER_TYPE) {
    await ensureEditorBuiltinApiKey({ getEditorSettings: () => host.getEditorSettings(), persistSettings: () => host.persistSettingsRememberingAiKey?.(), onIssued() {} });
    creds = getCredentials(host);
  }
  if (creds.provider === "deepseek") creds.userId = await getDisplayDeviceId();
  return creds;
}
