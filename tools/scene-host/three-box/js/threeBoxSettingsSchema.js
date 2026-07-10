/**
 * ThreeBox settings schema — cloned from the editor's schema-driven pattern
 * (tools/scene-host/shared/js/editorSettingsSchema.js) but with an entirely independent
 * storage key/namespace (ThreeBox never reads or writes any editor storage key), and trimmed to
 * only the categories relevant to a chat app rather than a scene editor (no dock-pin layout,
 * session-recovery, scene-tree editing, render/camera, or capture settings — none of that exists
 * in ThreeBox). Unlike the editor (single AI provider config), ThreeBox supports an array of
 * saved provider configs (`ai.providers`) since the composer lets the user pick per-message.
 */

export const THREEBOX_SETTINGS_STORAGE_KEY = "threejson.threebox.settings.v1";

export const THREEBOX_SETTINGS_DEFAULTS = {
  general: {
    locale: "auto",
    theme: "dark"
  },
  ai: {
    providers: [],
    defaultProviderId: "",
    rememberKeys: false,
    agentDepth: "medium",
    updateOutputMode: "commands",
    includeSpatialSummary: true,
    includeFullJson: false,
    defaultImageModel: "dall-e-3"
  },
  io: {
    exportJsonIndent: 2,
    copyFriendlyJson: false,
    tjzAssetPolicy: "preserve"
  }
};

export const THREEBOX_SETTINGS_SECTIONS = [
  { id: "general", title: "通用" },
  { id: "ai", title: "AI 配置" },
  { id: "io", title: "导入导出" }
];

/** Generic (non-"ai.providers") fields — rendered by the same simple field-loop the editor uses. */
export const THREEBOX_SETTINGS_FIELDS = [
  { section: "general", path: "general.locale", type: "select", label: "界面语言", options: [["auto", "跟随浏览器"], ["zh-CN", "简体中文"], ["en-US", "English"]] },
  { section: "general", path: "general.theme", type: "select", label: "主题", options: [["dark", "深色"], ["light", "浅色"]] },

  { section: "ai", path: "ai.rememberKeys", type: "checkbox", label: "记住 API Key 到本地" },
  { section: "ai", path: "ai.agentDepth", type: "select", label: "生成深度", options: [["simple", "简单"], ["medium", "中等"], ["deep", "深入"], ["auto", "自动"]] },
  { section: "ai", path: "ai.updateOutputMode", type: "select", label: "调整优先方式", options: [["commands", "操作命令"], ["json-incremental", "JSON Patch"], ["json-full", "完整 JSON"]] },
  { section: "ai", path: "ai.includeSpatialSummary", type: "checkbox", label: "调整时附带空间摘要" },
  { section: "ai", path: "ai.includeFullJson", type: "checkbox", label: "调整时附带完整 JSON（更耗费 Token）" },
  { section: "ai", path: "ai.defaultImageModel", type: "text", label: "默认图像模型" },

  { section: "io", path: "io.exportJsonIndent", type: "number", label: "导出 JSON 缩进", min: 0, max: 4 },
  { section: "io", path: "io.copyFriendlyJson", type: "checkbox", label: "复制 JSON 时使用友好格式" },
  { section: "io", path: "io.tjzAssetPolicy", type: "select", label: ".tjz 资源策略", options: [["preserve", "保留原始 URL"], ["tryPack", "尝试打包资源"]] }
];

export const THREEBOX_PROVIDER_TYPES = [
  ["chatgpt", "ChatGPT (OpenAI)"],
  ["deepseek", "DeepSeek"],
  ["custom", "自定义 (OpenAI 兼容)"]
];
