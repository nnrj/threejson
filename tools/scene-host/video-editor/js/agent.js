import { element, field, modal } from "./ui.js";
const key = "threejson.videoEditor.ai";
let config;
export function getVideoAiConfig() { if (!config) { try { config = JSON.parse(localStorage.getItem(key)) || {}; } catch { config = {}; } } return { mode: "shared", maxRequests: 0, maxMinutes: 0, ...config }; }
export async function editVideoAiSettings() {
  const value = getVideoAiConfig(), body = element("div");
  const mode = field("供应商配置", value.mode, { options: [["shared", "使用场景编辑器中的默认供应商"], ["custom", "独立 OpenAI 兼容接口"]] });
  const url = field("API Base URL", value.baseUrl || "", {}), model = field("模型名称", value.model || ""), apiKey = field("API Key", value.apiKey || "", { type: "password" });
  const requests = field("本轮最多请求次数（0 = 不限制）", value.maxRequests, { min: 0, step: 1 }), minutes = field("本轮最长分钟数（0 = 不限制）", value.maxMinutes, { min: 0 });
  const remember = field("", "", { type: "checkbox" }); remember.input.checked = value.remember === true; remember.wrapper.className = "check"; remember.wrapper.append(document.createTextNode("在此浏览器记住 API Key（明文存于本地）"));
  const vision = field("", "", { type: "checkbox" }); vision.input.checked = value.vision === true; vision.wrapper.className = "check"; vision.wrapper.append(document.createTextNode("此模型支持图片输入（允许查看实际帧）"));
  body.append(element("p", { class: "hint" }, "配置不进入工程 JSON 或工程包。共享模式沿用场景编辑器的供应商、隐私许可和密钥；可以到场景编辑器的 AI 配置中修改。"), ...[mode, url, model, apiKey, requests, minutes, remember, vision].map(f => f.wrapper));
  body.append(element("a", { href: "../editor/index.html", target: "_blank", rel: "noopener" }, "打开场景编辑器配置共享供应商"));
  const update = () => { for (const f of [url, model, apiKey, remember]) f.wrapper.hidden = mode.input.value === "shared"; }; mode.input.onchange = update; update();
  const action = await modal("视频 AI 设置", body, [{ label: "内置供应商条款", value: "privacy" }, { label: "取消", value: "cancel" }, { label: "保存", value: "ok", accent: true }]);
  if (action === "privacy") { const privacy = await import("../../shared/js/builtinProviderPrivacy.js"); await privacy.createBuiltinProviderPrivacyController({ scope: "editor" }).open(); return; }
  if (action !== "ok") return;
  config = { mode: mode.input.value, baseUrl: url.input.value.trim(), model: model.input.value.trim(), apiKey: apiKey.input.value.trim(), maxRequests: Math.max(0, Math.round(Number(requests.input.value))), maxMinutes: Math.max(0, Number(minutes.input.value)), remember: remember.input.checked, vision: vision.input.checked };
  localStorage.setItem(key, JSON.stringify({ ...config, apiKey: config.remember ? config.apiKey : "" }));
}

async function credentials() {
  const config = getVideoAiConfig();
  if (config.mode === "custom") {
    if (!config.baseUrl || !config.model) throw new Error("请在 AI 设置中填写 API 地址和模型。");
    const url = new URL(config.baseUrl); if (!["https:", "http:"].includes(url.protocol)) throw new Error("API 地址必须是 HTTP(S)。");
    return { provider: "custom", baseUrl: url.href.replace(/\/$/, ""), model: config.model, apiKey: config.apiKey };
  }
  const settingsStore = await import("../../shared/js/editorSettingsStore.js");
  const { settings } = await settingsStore.loadEditorSettingsBundle();
  const shared = await import("../../shared/js/editorAiCredentials.js");
  const privacy = await import("../../shared/js/builtinProviderPrivacy.js");
  const provider = settings.ai?.providers?.find(p => p.id === settings.ai.defaultProviderId) || settings.ai?.providers?.[0];
  if (provider?.provider === "threebox-builtin") {
    const decision = await privacy.createBuiltinProviderPrivacyController({ scope: "editor" }).promptIfNeeded();
    if (decision !== privacy.BUILTIN_PRIVACY_ACCEPTED) throw new Error("尚未同意内置供应商隐私条款。可改用自己配置的供应商。");
  }
  const resolved = await shared.ensureUsableCredentials({ getEditorSettings: () => settings, persistSettingsRememberingAiKey: () => settingsStore.persistEditorSettings(settings, { rememberAiKey: true }) });
  if (!resolved.apiKey) throw new Error("场景编辑器尚未配置可用的供应商。请配置后重试，或在此选择独立接口。");
  return resolved;
}

/** Scope enforcement is a service boundary, not only a sentence in a prompt. */
export function scopedVideoService(service, shotId) {
  const allowed = command => {
    if (command.op === "media.document.replace") return false;
    if (!shotId) return true;
    if (["media.inspect", "media.validate", "media.captureFrames"].includes(command.op)) return true;
    if (command.op === "media.shot.narrate" && command.args?.extend) return false;
    if (command.op === "media.clip.update" && Object.keys(command.args?.changes || {}).some(key => ["start", "duration", "sourceStart", "rate"].includes(key))) return false;
    if (["media.shot.put", "media.shot.edit", "media.shot.inspect", "media.shot.query", "media.shot.narrate", "media.clip.update"].includes(command.op)) return command.args?.id === shotId && !(command.op === "media.shot.put" && command.args?.clip);
    return ["timeline.edit", "timeline.inspect"].includes(command.op) && command.args?.shotId === shotId;
  };
  return {
    get revision() { return service.revision; },
    discover() { const value = service.discover(); return { ...value, commands: value.commands.filter(c => c.op !== "media.document.replace" && (!shotId || ["media.inspect", "media.validate", "media.captureFrames", "media.shot.put", "media.shot.edit", "media.shot.inspect", "media.shot.query", "media.shot.narrate", "media.clip.update", "timeline.edit", "timeline.inspect"].includes(c.op))) }; },
    async execute(input, options) {
      const commands = Array.isArray(input) ? input : [input];
      if (!commands.every(allowed)) return { ok: false, code: "MEDIA_EDIT_SCOPE", error: "Operation is outside the approved editing scope. Edit only the selected shot; do not replace the project or retime other clips.", revision: service.revision, results: [], diagnostics: [] };
      const result = await service.execute(input, options);
      if (shotId && result.ok) for (const item of result.results || []) if (item.op === "media.validate") {
        item.data.diagnostics = item.data.diagnostics.filter(d => d.shotId === shotId);
        item.data.satisfied = !item.data.diagnostics.some(d => d.severity === "error");
      }
      return result;
    }
  };
}

export async function runEditorVideoAgent({ service, prompt, shotId, signal, confirmStoryboard, onProgress, request, providerOptions }) {
  const { runVideoAgent } = await import("threejson/ai"), config = getVideoAiConfig();
  const provider = providerOptions || await credentials(); signal?.throwIfAborted();
  const { createBuiltinAiTurnContext } = await import("../../shared/js/builtinAiProvider.js");
  return runVideoAgent({ ...provider, service: scopedVideoService(service, shotId), prompt: `${shotId ? `Approved scope: only shot ${JSON.stringify(shotId)}. Other shots are read-only. Preserve composition timing.\n` : "Edit the existing project incrementally; never replace it wholesale.\n"}${prompt}`, signal, request, requestContext: createBuiltinAiTurnContext(`video-editor-${crypto.randomUUID()}`, prompt), confirmStoryboard, visionAvailable: config.vision,
    modelBudget: { ...(config.maxRequests > 0 ? { maxRequests: config.maxRequests } : {}), ...(config.maxMinutes > 0 ? { maxTimeMs: config.maxMinutes * 60000 } : {}) }, onProgress });
}
