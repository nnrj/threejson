/**
 * ThreeBox settings schema — cloned from the editor's schema-driven pattern
 * (tools/scene-host/shared/js/editorSettingsSchema.js) but with an entirely independent
 * storage key/namespace (ThreeBox never reads or writes any editor storage key), and trimmed to
 * only the categories relevant to a chat app rather than a scene editor (no dock-pin layout,
 * session-recovery, scene-tree editing, render/camera, or capture settings — none of that exists
 * in ThreeBox). Unlike the editor (single AI provider config), ThreeBox supports an array of
 * saved provider configs (`ai.providers`) since the composer lets the user pick per-message.
 */

import { BUILTIN_PROVIDER_TYPE, DEFAULT_BUILTIN_BACKEND_URL } from "../../shared/js/builtinAiProvider.js";

export const THREEBOX_SETTINGS_STORAGE_KEY = "threejson.threebox.settings.v1";

export const THREEBOX_SETTINGS_DEFAULTS = {
  general: {
    locale: "auto",
    theme: "dark",
    templateThumbnailsEnabled: true,
    previewAuxiliaryLights: true,
    assetGatewayUrl: "",
    builtinNotificationsEnabled: false,
    builtinNotificationsDecisionMade: false
  },
  ai: {
    providers: [],
    defaultProviderId: "",
    rememberKeys: true,
    // Base URL for the built-in trial provider's backend (threebox-server, deployed as a
    // dedicated Cloudflare Worker subdomain rather than a path under the main site). Exposed as a
    // setting rather than hardcoded because ThreeBox is open source — anyone can run their own.
    builtinBackendUrl: DEFAULT_BUILTIN_BACKEND_URL,
    selfName: "ThreeBox",
    updateOutputMode: "commands",
    includeSpatialSummary: true,
    includeFullJson: false,
    defaultImageModel: "dall-e-3",
    globalPromptPrefix: "",
    includeTurnSummary: true,
    autoGenerateSceneTitle: true,
    sceneTitleLanguage: "auto",
    attachReferenceLinks: true,
    capabilityLookupEnabled: true,
    animationCapabilityMode: "auto",
    onlineTextureHints: true,
    maxSceneSegments: 16
  },
  agent: {
    enabled: false,
    depth: "medium",
    iterativeAdjust: true,
    progressiveGenerate: true
  },
  io: {
    exportJsonIndent: 2,
    sceneJsonFormat: "standard",
    tjzAssetPolicy: "preserve",
    showMeshExportWarnings: true,
    turnCacheMode: "full",
    jsonViewerLineNumbers: true,
    jsonViewerHighlight: true
  },
  sync: {
    enabled: false,
    endpoint: "",
    accessToken: "",
    rememberAccessToken: false
  }
};

export const THREEBOX_SETTINGS_SECTIONS = [
  { id: "general", title: "通用" },
  { id: "ai", title: "AI 配置" },
  { id: "agent", title: "Agent" },
  { id: "io", title: "导入导出" },
  { id: "about", title: "关于" }
];

/** Displayed in the "关于" settings section — bump alongside the root package.json version on
 * release (no build step wires this up automatically since threebox is a plain static app). */
// Keep optional self-hosted sync adjacent to, but before, the informational About section.
THREEBOX_SETTINGS_SECTIONS.splice(-1, 0, { id: "sync", title: "同步" });

export const THREEBOX_VERSION = "0.1.0-alpha.5";

/** Generic (non-"ai.providers") fields — rendered by the same simple field-loop the editor uses. */
export const THREEBOX_SETTINGS_FIELDS = [
  { section: "general", path: "general.locale", type: "select", label: "界面语言", options: [["auto", "跟随浏览器"], ["zh-CN", "简体中文"], ["en-US", "English"]] },
  { section: "general", path: "general.theme", type: "select", label: "主题", options: [["dark", "深色"], ["light", "浅色"]] },
  { section: "general", path: "general.templateThumbnailsEnabled", type: "checkbox", label: "自动生成并缓存模板库缩略图" },
  { section: "general", path: "general.previewAuxiliaryLights", type: "checkbox", label: "ThreeBox 画布启用辅助光源" },

  { section: "ai", path: "ai.rememberKeys", type: "checkbox", label: "记住 API Key 到本地" },
  {
    section: "ai",
    path: "ai.builtinBackendUrl",
    type: "text",
    label: "内置供应商后端地址",
    placeholder: "https://api.threebox.org",
    testEndpoint: "builtinBackend"
  },
  { section: "ai", path: "ai.selfName", type: "text", label: "AI 自称" },
  { section: "ai", path: "ai.updateOutputMode", type: "select", label: "调整优先方式", options: [["commands", "操作命令"], ["json-incremental", "JSON Patch"], ["json-full", "完整 JSON"]] },
  { section: "ai", path: "ai.includeSpatialSummary", type: "checkbox", label: "调整时附带空间摘要" },
  { section: "ai", path: "ai.includeFullJson", type: "checkbox", label: "调整时附带完整 JSON（更耗费 Token）" },
  { section: "ai", path: "ai.defaultImageModel", type: "text", label: "默认图像模型" },
  {
    section: "ai",
    path: "ai.globalPromptPrefix",
    type: "textarea",
    label: "全局提示词",
    placeholder: "会自动附加到每次发送给 AI 的结构化提示词中，例如统一的风格、单位、命名约定等要求。",
    rows: 4
  },
  { section: "ai", path: "ai.includeTurnSummary", type: "checkbox", label: "场景生成后输出简短总结" },
  { section: "ai", path: "ai.autoGenerateSceneTitle", type: "checkbox", label: "自动为场景生成标题" },
  {
    section: "ai",
    path: "ai.sceneTitleLanguage",
    type: "select",
    label: "场景标题语言",
    options: [["auto", "默认"], ["en-US", "English"], ["zh-CN", "中文"]]
  },
  {
    section: "ai",
    path: "ai.attachReferenceLinks",
    type: "checkbox",
    label: "提示词中附带 ThreeJSON 文档与示例仓库链接"
  },
  { section: "ai", path: "ai.capabilityLookupEnabled", type: "checkbox", label: "按意图查阅 ThreeJSON 能力示例" },
  {
    section: "ai",
    path: "ai.animationCapabilityMode",
    type: "select",
    label: "动画/事件脚本能力",
    options: [["auto", "自动（由协商模型判断）"], ["on", "始终启用"], ["off", "关闭"]]
  },
  { section: "ai", path: "ai.onlineTextureHints", type: "checkbox", label: "为适合的物体自动添加在线纹理" },
  {
    section: "ai",
    path: "ai.maxSceneSegments",
    type: "number",
    label: "场景 JSON 最大续写轮数",
    min: 1,
    max: 64
  },

  { section: "agent", path: "agent.enabled", type: "checkbox", label: "开启多轮 Agent" },
  { section: "agent", path: "agent.depth", type: "select", label: "Agent 深度", options: [["simple", "简单"], ["medium", "中等"], ["deep", "深入"], ["auto", "自动"]] },
  { section: "agent", path: "agent.iterativeAdjust", type: "checkbox", label: "调整时逐轮应用到离屏场景" },
  { section: "agent", path: "agent.progressiveGenerate", type: "checkbox", label: "允许生成草稿后自主多轮细化" },

  { section: "io", path: "io.exportJsonIndent", type: "number", label: "导出 JSON 缩进", min: 0, max: 4 },
  { section: "io", path: "io.sceneJsonFormat", type: "select", label: "JSON 输出格式", options: [["standard", "标准格式"], ["friendly", "友好格式"]] },
  { section: "io", path: "io.tjzAssetPolicy", type: "select", label: ".tjz 资源策略", options: [["preserve", "保留原始 URL"], ["tryPack", "尝试打包资源"]] },
  { section: "io", path: "io.showMeshExportWarnings", type: "checkbox", label: "导出三方模型后显示警告弹窗" },
  { section: "io", path: "io.jsonViewerLineNumbers", type: "checkbox", label: "JSON 查看显示行号" },
  { section: "io", path: "io.jsonViewerHighlight", type: "checkbox", label: "JSON 查看代码高亮" },
  {
    section: "io",
    path: "io.turnCacheMode",
    type: "select",
    label: "聊天记录缓存方式",
    options: [
      ["full", "完整 JSON（每轮都存完整场景，占用更多空间）"],
      ["diff", "仅保存差异（命令调整只存调整命令，重新打开时按需重放）"]
    ]
  },
  { section: "sync", path: "sync.enabled", type: "checkbox", label: "启用自建会话同步" },
  { section: "sync", path: "sync.endpoint", type: "text", label: "同步服务器地址", placeholder: "https://your-server.example/api", testEndpoint: "selfHostedSync" },
  { section: "sync", path: "sync.accessToken", type: "password", label: "同步访问令牌" },
  { section: "sync", path: "sync.rememberAccessToken", type: "checkbox", label: "在此设备保存同步访问令牌" },
  { section: "general", path: "general.builtinNotificationsEnabled", type: "checkbox", label: "接收内置供应商通知" },
  { section: "general", path: "general.assetGatewayUrl", type: "text", label: "Static asset gateway URL", placeholder: "https://api.threebox.org", testEndpoint: "assetGateway" }
];

export const THREEBOX_PROVIDER_TYPES = [
  [BUILTIN_PROVIDER_TYPE, "内置供应商（限额体验）"],
  ["chatgpt", "ChatGPT (OpenAI)"],
  ["deepseek", "DeepSeek"],
  ["custom", "自定义 (OpenAI 兼容)"]
];

/** The provider id/type reserved for the auto-seeded built-in trial provider — used by
 * threeBoxSettingsStore.js (first-run seeding), threeBoxSettingsModal.js (special-cased card
 * rendering) and threeBoxOrchestrator.js (baseUrl/key resolution). `THREEBOX_BUILTIN_PROVIDER_TYPE`
 * re-exports the shared constant (see tools/scene-host/shared/js/builtinAiProvider.js) under its
 * original name so existing ThreeBox imports don't need to change. */
export const THREEBOX_BUILTIN_PROVIDER_TYPE = BUILTIN_PROVIDER_TYPE;
export const THREEBOX_BUILTIN_PROVIDER_ID = "builtin-default";
