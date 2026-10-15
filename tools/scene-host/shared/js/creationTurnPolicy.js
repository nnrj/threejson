import { BUILTIN_PROVIDER_TYPE } from "./builtinAiProvider.js";
import { createCreationBudget } from "./creationBudget.js";
import { resolveCreationQuality } from "./creationQualityPolicy.js";

const policyError = (message, code = "MODEL_POLICY_REJECTED") => Object.assign(new Error(message), { code });
const providerCapabilities = new Map(), capabilityRequests = new Map();
export function getDeclaredProviderCapabilities(baseUrl) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const cached = providerCapabilities.get(base);
  if (typeof globalThis.document !== "undefined" && base && (!cached || Date.now() - cached.at > 30000) && !capabilityRequests.has(base)) {
    const request = fetchCreationCapabilities(base).finally(() => capabilityRequests.delete(base));
    capabilityRequests.set(base, request);
  }
  return cached?.value || { inputModalities: ["text"], pending: Boolean(base) };
}
function visit(value, callback) {
  if (!value || typeof value !== "object") return;
  callback(value);
  for (const child of Object.values(value)) if (child && typeof child === "object") visit(child, callback);
}
export async function fetchCreationCapabilities(baseUrl, { signal, fetchImpl = globalThis.fetch } = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!base) return { models: { available: false, reason: "MODEL_SERVICE_UNCONFIGURED" }, provider: {} };
  const read = async path => {
    try {
      const response = await fetchImpl(`${base}${path}`, { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8000)]) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) { signal?.throwIfAborted(); return { available: false, reason: "CAPABILITIES_UNAVAILABLE", message: error.message }; }
  };
  const [models, provider] = await Promise.all([read("/v1/models/capabilities"), read("/v1/capabilities")]);
  providerCapabilities.set(base, { at: Date.now(), value: provider });
  return { models, provider };
}

/** Acquisition policy is per AI turn, not a restriction on ordinary document loading.
 * Only trusted adapter results may introduce new model URLs. Existing assets are grandfathered.
 * Texture/environment resources are intentionally not part of this gate. */
export function createAiModelAssetPolicy({ enabled = true, initialDocument, adapter, signal, onProgress } = {}) {
  const allowed = new Set(), acquired = new Map(), byUrl = new Map();
  const original = typeof initialDocument === "string" ? JSON.parse(initialDocument) : initialDocument;
  visit(original, record => { if (typeof record.modelPath === "string") allowed.add(record.modelPath); });
  async function resolve(path) {
    if (allowed.has(path)) return byUrl.get(path) || { url: path };
    if (!enabled || !adapter) throw policyError("AI 不允许新增外部模型；请保留已有资产或使用参数化建模。", "EXTERNAL_MODELS_DISABLED");
    if (!path.startsWith("asset-model://")) throw policyError("AI 新模型必须通过模型目录获取；不接受生成的任意 URL。使用 asset-model://search/<English keywords> 或 asset-model://id/<catalog ID>。");
    if (acquired.has(path)) return acquired.get(path);
    // Recheck on every acquisition, including a subsequent request after an admin disables it.
    const caps = await adapter.capabilities({ signal });
    if (!caps.available) throw policyError(caps.enabled === false ? "服务器已关闭此能力" : "模型服务当前不可用", caps.reason);
    let id;
    if (path.startsWith("asset-model://id/")) id = decodeURIComponent(path.slice(17));
    else if (path.startsWith("asset-model://search/")) {
      const query = decodeURIComponent(path.slice(21)).trim();
      if (!query || query.length > 160) throw policyError("Model search requires 1–160 characters.");
      const result = await adapter.search(query, { signal });
      id = result.candidates?.[0]?.id;
      if (!id) throw policyError(`No licensed model found for ${query}; use procedural modeling or a more specific catalog query.`, "MODEL_NOT_FOUND");
    } else throw policyError("Unknown model asset request.");
    onProgress?.({ kind: "model_acquisition", message: `正在获取引用模型：${id}` });
    const asset = await adapter.acquire(id, { signal });
    if (!asset?.url || !asset.license || asset.acquired !== true) throw policyError("Model adapter returned an unverified asset.");
    signal?.throwIfAborted();
    // A service switch changing while downloading must not silently import the new asset.
    if (!(await adapter.capabilities({ signal })).available) throw policyError("服务器已关闭此能力", "EXTERNAL_MODELS_DISABLED");
    allowed.add(asset.url); acquired.set(path, asset); byUrl.set(asset.url, asset); return asset;
  }
  async function prepare(value) {
    const next = structuredClone(value), requests = [];
    visit(next, record => {
      if (typeof record.modelPath === "string") requests.push(async () => {
        const asset = await resolve(record.modelPath); record.modelPath = asset.url;
        if (asset.acquired) {
          record.modelFileType = "gltf";
          record.userData = { ...record.userData, assetProvenance: { ...asset, referencedAsset: true } };
        }
      });
      // JSON Patch/descriptor field edits must not bypass the same rule.
      if (typeof record.path === "string" && /\/modelPath$/.test(record.path) && typeof record.value === "string") requests.push(async () => { record.value = (await resolve(record.value)).url; });
    });
    for (const request of requests) { signal?.throwIfAborted(); await request(); }
    return next;
  }
  return { prepare, assets: () => [...acquired.values()], enabled: Boolean(enabled && adapter) };
}

export function createModelAssetClient({ baseUrl, apiKey, fetchImpl = globalThis.fetch }) {
  const base = String(baseUrl).replace(/\/+$/, "");
  const call = async (path, body, { signal } = {}) => {
    const response = await fetchImpl(`${base}/v1/models/${path}`, { method: body ? "POST" : "GET", signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(body ? 115000 : 8000)]), headers: body ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` } : {}, ...(body ? { body: JSON.stringify({ ...body, userEnabled: true }) } : {}) });
    const result = await response.json();
    if (!response.ok) throw policyError(result.message || result.error || `HTTP ${response.status}`, result.error);
    return result;
  };
  return { capabilities: options => call("capabilities", null, options), search: (query, options) => call("search", { query }, options), acquire: (id, options) => call("acquire", { id }, options) };
}

export async function prepareCreationTurn(input) {
  if (input.creationPolicy) return input;
  const options = input.agentOptions || {}, provider = input.providerOptions || {};
  const qualityBudget = createCreationBudget(input);
  const observe = options => ({ ...options,
    beforeRequest: async limits => { const prior = await options.beforeRequest?.(limits); return qualityBudget.begin({ ...limits, ...prior }); },
    onCompletionMetadata: metadata => { qualityBudget.observe(metadata, options); options.onCompletionMetadata?.(metadata); } });
  const baseUrl = options.modelServiceUrl || (provider.provider === BUILTIN_PROVIDER_TYPE ? provider.baseUrl : "");
  const capabilities = await fetchCreationCapabilities(baseUrl, { signal: input.signal });
  const apiKey = options.modelServiceApiKey || (provider.provider === BUILTIN_PROVIDER_TYPE ? provider.apiKey : "");
  const adapter = input.modelAssetAdapter || (baseUrl && apiKey && capabilities.models.available ? createModelAssetClient({ baseUrl, apiKey }) : null);
  const policy = createAiModelAssetPolicy({ enabled: options.externalModelsEnabled !== false, initialDocument: input.targetSceneJsonString || input.project, adapter, signal: input.signal, onProgress: input.onAgentProgress });
  const guidance = policy.enabled
    ? 'Licensed external models are optional. Keep unique/editable hero shapes procedural. For standard furniture/plants use objType:"externalModel", modelFileType:"gltf", modelPath:"asset-model://search/<specific English keywords>" (or asset-model://id/<catalog ID>). The host resolves a licensed catalog match, records provenance and stores it durably; do not invent URLs. Clearly describe referenced assets as referenced, not original modeling. No match is an explicit error, not a license to fabricate a URL.'
    : 'AI new external-model acquisition is unavailable or disabled. Preserve existing model references. Author new geometry parametrically; do not introduce modelPath URLs. Textures and environment maps are separately managed.';
  let queue = Promise.resolve();
  const prepareString = async text => JSON.stringify(await policy.prepare(JSON.parse(text)), null, 2);
  const onAgentProgress = progress => {
    // Core progress is a notification, not an awaited transaction. Serialize safe previews;
    // never let an unapproved model URL reach a renderer through an early stage preview.
    queue = queue.then(async () => {
      const next = { ...progress };
      if (progress.sceneJsonString) next.sceneJsonString = await prepareString(progress.sceneJsonString);
      if (progress.commands) next.commands = await policy.prepare(progress.commands);
      await input.onAgentProgress?.(next);
    }).catch(error => { input.onAgentProgress?.({ kind: "draft_policy_rejected", message: error.message }); });
    return queue;
  };
  let envelope = input.envelope;
  if (typeof envelope === "string") {
    try { const parsed = JSON.parse(envelope); parsed.globalInstructions = [parsed.globalInstructions, guidance].filter(Boolean).join("\n\n"); envelope = JSON.stringify(parsed); }
    catch { envelope = JSON.stringify({ userRequest: envelope, globalInstructions: guidance }); }
  }
  return { ...input, envelope, creationPolicy: policy, qualityBudget, drainCreationPreviews: async () => { await queue; },
    providerOptions: observe({ ...provider, ...(provider.provider === BUILTIN_PROVIDER_TYPE ? { capabilities: capabilities.provider } : {}) }),
    ...(input.qualityReviewerOptions ? { qualityReviewerOptions: observe(input.qualityReviewerOptions) } : {}),
    globalPromptPrefix: [input.globalPromptPrefix, guidance].filter(Boolean).join("\n\n"),
    agentOptions: { ...options, qualityProfile: resolveCreationQuality(input.creationQuality ?? options.creationQuality, input.qualityProfile ?? options.qualityProfile), prepareModelAssets: policy.prepare },
    onAgentProgress,
    onSceneDraft: input.onSceneDraft ? async (text, meta) => input.onSceneDraft(await prepareString(text), meta) : undefined,
    applyCommands: input.applyCommands ? async (commands, context) => input.applyCommands(await policy.prepare(commands), context) : undefined
  };
}
