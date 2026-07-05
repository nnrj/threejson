/**
 * Extract Chinese player settings labels into zh-CN locale catalog.
 * Usage: node tools/dev/gen-player-settings-zh-cn.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "../scene-host/shared/js/playerSettingsSchema.js");
const outPath = path.join(__dirname, "../scene-host/shared/i18n/locales/player-settings.zh-CN.json");

const zhSections = {
  general: "常规",
  layout: "界面布局",
  audio: "音频",
  playback: "播放",
  render: "渲染",
  immersive: "沉浸全屏",
  highlight: "高亮"
};

const zhFields = {
  "general.locale": "界面语言",
  "general.baseTitle": "窗口标题前缀",
  "general.defaultSceneUrl": "默认场景 URL",
  "general.loadingMaskText": "加载遮罩文案",
  "general.messageToastDurationMs": "消息提示时长 (ms)",
  "general.progressOverlayEnabled": "显示加载进度遮罩",
  "general.sceneLoadDoneDelayMs": "加载完成收起延迟 (ms)",
  "layout.rightPanelOpenByDefault": "默认展开右侧播放列表",
  "layout.playlistListMinHeightPx": "播放列表最小高度 (px)",
  "audio.defaultVolumePercent": "默认主音量 (%)",
  "audio.defaultMuted": "默认静音",
  "audio.rememberVolume": "记住音量与静音状态",
  "playback.restorePlaylistOnStartup": "启动时恢复播放列表",
  "playback.preferUrlQueryScene": "URL 参数 ?scene= / ?url= 优先于默认场景",
  "playback.sceneAutoRotate": "场景自动旋转（可被场景 JSON 覆盖）",
  "render.antialias": "抗锯齿",
  "render.targetFps": "目标帧率",
  "render.lowFpsMode": "低帧率模式",
  "render.overrideSceneRenderLoop": "覆盖场景配置（fps / lowFps）",
  "render.earlyRenderWhileLoading": "加载中提前渲染",
  "immersive.chromeHideDelayMs": "全屏时顶/底栏与侧栏隐藏延迟 (ms)",
  "immersive.rightEdgeStripWidthPx": "全屏右侧感应条宽度 (px)",
  "highlight.channels.info": "info 通道颜色",
  "highlight.channels.locate": "locate 通道颜色",
  "highlight.channels.alarm": "alarm 通道颜色"
};

const zhHints = {
  "general.sceneLoadDoneDelayMs": "场景加载完成后，遮罩再停留的时长。设为 0 则立即收起。",
  "playback.preferUrlQueryScene": "无播放列表恢复且未指定 URL 参数时使用默认场景 URL。",
  "render.targetFps": "仅当开启低帧率模式时生效。",
  "render.overrideSceneRenderLoop": "启用后使用当前播放器设置覆盖场景 JSON 中的 fps / lowFps。",
  "render.earlyRenderWhileLoading": "启用后在场景加载阶段提前启动渲染循环，遮罩期间也可看到画面。"
};

const zhOptions = {
  "general.locale.": "自动（跟随浏览器）",
  "general.locale.en-US": "English",
  "general.locale.zh-CN": "中文"
};

const source = fs.readFileSync(schemaPath, "utf8");
const transformed = source.replace(/^export /gm, "");
const sandbox = {};
vm.runInNewContext(
  transformed + "\nthis.PLAYER_SETTINGS_SECTIONS = PLAYER_SETTINGS_SECTIONS;\nthis.PLAYER_SETTINGS_FIELDS = PLAYER_SETTINGS_FIELDS;",
  sandbox
);

const catalog = {
  "player.settings.modal.title": "播放器设置",
  "player.settings.modal.save": "保存并应用",
  "player.settings.modal.cancel": "取消",
  "player.settings.modal.reset": "恢复默认"
};

for (const section of sandbox.PLAYER_SETTINGS_SECTIONS) {
  catalog[`player.settings.sections.${section.id}`] = zhSections[section.id] || section.title;
}
for (const field of sandbox.PLAYER_SETTINGS_FIELDS) {
  catalog[`player.settings.fields.${field.path}`] = zhFields[field.path] || field.label;
  if (field.hint) {
    catalog[`player.settings.hints.${field.path}`] = zhHints[field.path] || field.hint;
  }
  if (Array.isArray(field.options)) {
    for (const opt of field.options) {
      const optKey = `player.settings.options.${field.path}.${opt.value}`;
      catalog[optKey] = zhOptions[`${field.path}.${opt.value}`] || opt.label;
    }
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n");
console.log("Wrote", Object.keys(catalog).length, "keys to", outPath);
