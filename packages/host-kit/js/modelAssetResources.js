/** Public, immutable model copies are not textures and must not go through the
 * texture proxy. No API key or cookies are sent; acquisition policy is irrelevant
 * to reopening/exporting already-saved works. Called only for an explicit export. */
export const isPersistedModelUrl = url => /^https?:\/\/[^/]+\/v1\/models\/objects\/[a-f0-9]{64}$/.test(String(url));
export const isRequiredModelAsset = ({ key, ref }) => key === "modelPath" && isPersistedModelUrl(ref);

export async function fetchPersistedModelBlob(url, { signal, fetchImpl = globalThis.fetch } = {}) {
  if (!isPersistedModelUrl(url)) return null;
  const response = await fetchImpl(url, { credentials: "omit", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(60000)]) });
  if (!response.ok) throw new Error(`模型打包失败（HTTP ${response.status}）：${url}`);
  return response.blob();
}
