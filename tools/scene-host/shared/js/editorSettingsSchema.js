/**
 * Editor settings schema — copied from scene-editor.html (frozen baseline).
 * scene-host must not import baseline HTML; keep keys/paths aligned manually.
 * Regenerate: node tools/scene-host/scripts/extract-settings-schema.mjs
 */
import { BOX_EDGE_HELPER_DEFAULT_COLOR } from "../../../../core/theme/runtimeVisualDefaults.js";
import {
  HIGHLIGHT_ALARM_RED,
  HIGHLIGHT_LOCATE_AMBER
} from "../../../../domains/sceneHighlight/channels.js";

export const EDITOR_SETTINGS_STORAGE_KEY = "sceneEditor_settings_v1";
export const OBJECT_IMPORT_SESSION_FILL_LIGHTS = "sceneEditor_objectImportFillLights";
export const OBJECT_IMPORT_SESSION_FILL_CAMERA = "sceneEditor_objectImportFillCamera";
export const EDITOR_SETTINGS_JSON_URL = "/assets/json/other/scene-editor/setting.json";
export const LOADING_MASK_ACTIVITY_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const EDITOR_SETTINGS_DEFAULTS = {
    version: 1,
    app: "scene-editor",
    general: {
      locale: "",
      baseTitle: "Scene Editor",
      defaultSceneUrl: "/assets/json/portShow.json",
      openLastSceneOnStartup: false,
      exitNavigateUrl: "/demo.html",
      loadingMaskText: "Loading 3D scene…",
      loadingActivityIntervalMs: 120,
      messageToastDurationMs: 2600,
      progressOverlayEnabled: true,
      sceneLoadDoneDelayMs: 300,
      debugLogging: false
    },
    layout: {
      topBarPinned: true,
      bottomBarPinned: true,
      leftDockPinned: true,
      rightDockPinned: true,
      flyoutPeekHideDelayMs: 280,
      leftDockWidthPx: 300,
      rightDockWidthPx: 238,
      peekStripWidthPx: 14,
      defaultLeftPanelTab: "builtin"
    },
    session: {
      autoSnapshotIntervalMs: 120000,
      promptOnBootRestore: true,
      beforeUnloadWarn: true,
      indexedDbEnabled: true,
      clearCacheOnExit: false,
      clearCacheOnExitScopes: {
        session: true,
        recent: true,
        baseline: true,
        settings: false
      }
    },
    sceneJson: {
      cameraLockDefault: true,
      autoRenderDefault: false,
      autoRenderDelayMs: 1000,
      syncCodeAndSidebarPrefs: true,
      codeViewFormat: "auto",
      subSceneLayout: "subSceneList",
      subSceneNormalizePolicy: "warn"
    },
    editing: {
      defaultTransformMode: "translate",
      dragControlsEnabled: false,
      impactCheckOnEdit: true,
      clickHighlightNonEditable: false,
      blurRedeployOnPropertyChange: true,
      blurRedeployDebounceMs: 400,
      historyMaxDepth: 80,
      sceneTreeClickDelayMs: 250,
      boxHelperColor: BOX_EDGE_HELPER_DEFAULT_COLOR,
      showGridHelper: false,
      highlightChannels: {
        info: "#FFFFFF",
        locate: HIGHLIGHT_LOCATE_AMBER,
        alarm: HIGHLIGHT_ALARM_RED
      },
      statusBarHint:
        "Controls: left-drag orbit, right-drag pan, wheel zoom. Scene tree: single-click highlight, double-click highlight + outline + edit."
    },
    domainEdit: {
      promptOnChildChange: true,
      silentDefaultAction: "degrade",
      enableChildMutationOverlay: false
    },
    render: {
      antialias: true,
      targetFps: 60,
      lowFpsMode: false,
      overrideSceneRenderLoop: false,
      earlyRenderWhileLoading: true,
      sceneAutoRotate: false,
      defaultFov: 50,
      orbitDampingFactor: 0.35,
      orbitMaxPolarAngle: 1.658,
      cameraFallbackPosition: { x: 21, y: 63.8, z: 100.8 },
      fullSceneFillLightsMode: "auto",
      objectRecordFillLightsMode: "prompt",
      fullSceneFillCameraMode: "auto",
      objectRecordFillCameraMode: "auto",
      deployAutoFitCamera: true,
      deployAutoFitOverrideExplicitCamera: false
    },
    threeView: { warnAfterFailCount: 24, fallbackAfterFailCount: 120 },
    io: {
      optimizeJsonOnSave: true,
      objectImportFitViewDefault: true,
      promptExportFilename: true,
      exportJsonIndent: 2,
      tjzExport: {
        format: "standard",
        assetPolicy: "preserve",
        includeRuntime: true,
        fetchExternalUrls: false
      }
    },
    capture: {
      recordFps: 30,
      recordMimeType: "",
      recordBitrateBps: null,
      screenshotFilenamePrefix: "sceneEditor-snapshot-",
      recordFilenamePrefix: "sceneEditor-record-"
    },
    interaction: {
      previewEventBinding: "followJson",
      editorEventBinding: "alwaysOff",
      previewPlayerUrl: "",
      previewHotReload: true
    },
    ai: {
      rememberConfig: false,
      provider: "chatgpt",
      model: "",
      apiKey: "",
      customApiBase: "",
      agentEnabled: false,
      agentDepth: "medium",
      agentIterativeApply: false,
      agentFitViewEachRound: false,
      incrementalUpdate: false,
      updateOutputMode: "commands",
      includeFullJson: false,
      includeSpatialSummary: false,
      streamPreview: true,
      stageAutoLoad: false,
      defaultImageModel: "dall-e-3",
      textureBrowserMode: "directory"
    }
  };

export const EDITOR_SETTINGS_SECTIONS = [
    { id: "general", title: "General" },
    { id: "layout", title: "Layout" },
    { id: "session", title: "Session & recovery" },
    { id: "sceneJson", title: "Scene JSON" },
    { id: "editing", title: "Editing & interaction" },
    { id: "domainEdit", title: "Domain editing" },
    { id: "render", title: "Rendering & camera" },
    { id: "interaction", title: "Events & preview" },
    { id: "threeView", title: "Three views" },
    { id: "io", title: "Import & export" },
    { id: "capture", title: "Capture & recording" },
    { id: "ai", title: "AI assistant" }
  ];

export const EDITOR_SETTINGS_FIELDS = [
    {
      section: "general",
      path: "general.locale",
      type: "select",
      label: "Language",
      options: [
        { value: "", label: "Auto (browser)" },
        { value: "en-US", label: "English" },
        { value: "zh-CN", label: "中文" }
      ]
    },
    { section: "general", path: "general.baseTitle", type: "text", label: "Window title prefix" },
    { section: "general", path: "general.defaultSceneUrl", type: "text", label: "默认启动场景 URL" },
    {
      section: "general",
      path: "general.openLastSceneOnStartup",
      type: "checkbox",
      label: "启动时打开上次打开的场景"
    },
    { section: "general", path: "general.exitNavigateUrl", type: "text", label: "退出编辑器跳转 URL" },
    { section: "general", path: "general.loadingMaskText", type: "text", label: "加载遮罩文案" },
    {
      section: "general",
      path: "general.loadingActivityIntervalMs",
      type: "number",
      label: "加载动画间隔 (ms)",
      min: 60,
      max: 2000
    },
    {
      section: "general",
      path: "general.messageToastDurationMs",
      type: "number",
      label: "消息提示时长 (ms)",
      min: 500,
      max: 15000
    },
    {
      section: "general",
      path: "general.progressOverlayEnabled",
      type: "checkbox",
      label: "显示加载进度遮罩"
    },
    {
      section: "general",
      path: "general.sceneLoadDoneDelayMs",
      type: "number",
      label: "加载完成收起延迟 (ms)",
      min: 0,
      max: 3000,
      hint: "场景加载完成后，遮罩再停留的时长。设为 0 则立即收起。"
    },
    {
      section: "general",
      path: "general.debugLogging",
      type: "checkbox",
      label: "启用 Debug 日志",
      hint: "开启后输出 ThreeJSON 内部 debug 级日志（实例化/合并/碰撞等）；也可用 URL ?threejson_debug=1 或 localStorage threejson.debug=1。"
    },
    { section: "layout", path: "layout.topBarPinned", type: "checkbox", label: "默认钉住标题栏" },
    { section: "layout", path: "layout.bottomBarPinned", type: "checkbox", label: "默认钉住状态栏" },
    { section: "layout", path: "layout.leftDockPinned", type: "checkbox", label: "默认钉住左侧工具面板" },
    { section: "layout", path: "layout.rightDockPinned", type: "checkbox", label: "默认钉住右侧属性面板" },
    {
      section: "layout",
      path: "layout.flyoutPeekHideDelayMs",
      type: "number",
      label: "边缘唤出隐藏延迟 (ms)",
      min: 0,
      max: 3000
    },
    {
      section: "layout",
      path: "layout.leftDockWidthPx",
      type: "number",
      label: "左侧面板宽度 (px)",
      min: 200,
      max: 600
    },
    {
      section: "layout",
      path: "layout.rightDockWidthPx",
      type: "number",
      label: "右侧面板宽度 (px)",
      min: 180,
      max: 480
    },
    {
      section: "layout",
      path: "layout.peekStripWidthPx",
      type: "number",
      label: "边缘感应条宽度 (px)",
      min: 8,
      max: 32
    },
    {
      section: "layout",
      path: "layout.defaultLeftPanelTab",
      type: "select",
      label: "左栏默认子 Tab",
      options: [
        { value: "builtin", label: "组件" },
        { value: "aiConfig", label: "AI 配置" },
        { value: "aiGenerate", label: "AI 生成" },
        { value: "aiAdjust", label: "AI 调整" },
        { value: "aiImage", label: "AI 看图" }
      ]
    },
    {
      section: "session",
      path: "session.autoSnapshotIntervalMs",
      type: "number",
      label: "自动快照间隔 (ms)",
      min: 30000,
      max: 900000
    },
    {
      section: "session",
      path: "session.promptOnBootRestore",
      type: "checkbox",
      label: "启动时提示恢复未保存编辑"
    },
    {
      section: "session",
      path: "session.beforeUnloadWarn",
      type: "checkbox",
      label: "离开页面前提示未保存"
    },
    {
      section: "session",
      path: "session.indexedDbEnabled",
      type: "checkbox",
      label: "启用 IndexedDB 会话存储"
    },
    {
      section: "session",
      path: "session.clearCacheOnExit",
      type: "checkbox",
      label: "退出时自动清除缓存"
    },
    {
      section: "session",
      path: "session.clearCacheOnExitScopes.session",
      type: "checkbox",
      label: "退出时清除：会话缓存"
    },
    {
      section: "session",
      path: "session.clearCacheOnExitScopes.recent",
      type: "checkbox",
      label: "退出时清除：最近打开列表"
    },
    {
      section: "session",
      path: "session.clearCacheOnExitScopes.baseline",
      type: "checkbox",
      label: "退出时清除：场景基线与快照"
    },
    {
      section: "session",
      path: "session.clearCacheOnExitScopes.settings",
      type: "checkbox",
      label: "退出时清除：设置缓存"
    },
    {
      section: "sceneJson",
      path: "sceneJson.cameraLockDefault",
      type: "checkbox",
      label: "默认勾选「视角保持」"
    },
    {
      section: "sceneJson",
      path: "sceneJson.autoRenderDefault",
      type: "checkbox",
      label: "默认开启侧栏自动渲染"
    },
    {
      section: "sceneJson",
      path: "sceneJson.autoRenderDelayMs",
      type: "number",
      label: "自动渲染防抖 (ms)",
      min: 200,
      max: 5000
    },
    {
      section: "sceneJson",
      path: "sceneJson.syncCodeAndSidebarPrefs",
      type: "checkbox",
      label: "代码模式与侧栏 JSON 偏好联动"
    },
    {
      section: "sceneJson",
      path: "sceneJson.codeViewFormat",
      type: "select",
      label: "Code 模式 JSON 形式",
      hint: "自动 = 跟随载入的完整场景源格式；仅影响 Code 与侧栏 JSON 展示，不影响导出菜单与内部历史快照。",
      options: [
        { value: "auto", label: "自动" },
        { value: "standard", label: "标准" },
        { value: "friendly", label: "友好" }
      ]
    },
    {
      section: "sceneJson",
      path: "sceneJson.subSceneLayout",
      type: "select",
      label: "Code 模式 subScene 层级展示",
      hint: "与 friendly/standard 正交；仅影响 Code 与侧栏 JSON 展示。",
      options: [
        { value: "subSceneList", label: "subSceneList（默认）" },
        { value: "nested", label: "nested（嵌套 subScene）" },
        { value: "flat", label: "flat（parentThreeJsonId）" }
      ]
    },
    {
      section: "sceneJson",
      path: "sceneJson.subSceneNormalizePolicy",
      type: "select",
      label: "subScene 归一化策略",
      options: [
        { value: "warn", label: "warn（默认）" },
        { value: "strict", label: "strict" }
      ]
    },
    {
      section: "editing",
      path: "editing.defaultTransformMode",
      type: "select",
      label: "进入编辑默认变换模式",
      options: [
        { value: "translate", label: "移动" },
        { value: "rotate", label: "旋转" },
        { value: "scale", label: "缩放" }
      ]
    },
    {
      section: "editing",
      path: "editing.dragControlsEnabled",
      type: "checkbox",
      label: "启用 DragControls（可能与轨道冲突）"
    },
    {
      section: "editing",
      path: "editing.impactCheckOnEdit",
      type: "checkbox",
      label: "编辑时启用碰撞检测"
    },
    {
      section: "editing",
      path: "editing.clickHighlightNonEditable",
      type: "checkbox",
      label: "双击不可编辑物体时高亮"
    },
    {
      section: "editing",
      path: "editing.sceneTreeClickDelayMs",
      type: "number",
      label: "场景树单击延迟 (ms)",
      min: 0,
      max: 800
    },
    {
      section: "editing",
      path: "editing.historyMaxDepth",
      type: "number",
      label: "撤销/重做深度",
      min: 20,
      max: 300
    },
    {
      section: "editing",
      path: "editing.blurRedeployOnPropertyChange",
      type: "checkbox",
      label: "属性 blur 后自动 redeploy"
    },
    {
      section: "editing",
      path: "editing.blurRedeployDebounceMs",
      type: "number",
      label: "属性 redeploy 防抖 (ms)",
      min: 0,
      max: 5000
    },
    { section: "editing", path: "editing.boxHelperColor", type: "color", label: "选中描边颜色" },
    {
      section: "editing",
      path: "editing.showGridHelper",
      type: "checkbox",
      label: "显示地面网格辅助线",
      hint: "仅编辑器视口显示，不会写入场景 JSON。"
    },
    {
      section: "editing",
      path: "editing.highlightChannels.info",
      type: "color",
      label: "高亮通道 info 颜色"
    },
    {
      section: "editing",
      path: "editing.highlightChannels.locate",
      type: "color",
      label: "高亮通道 locate 颜色"
    },
    {
      section: "editing",
      path: "editing.highlightChannels.alarm",
      type: "color",
      label: "高亮通道 alarm 颜色"
    },
    { section: "editing", path: "editing.statusBarHint", type: "textarea", label: "状态栏默认提示文案" },
    {
      section: "domainEdit",
      path: "domainEdit.promptOnChildChange",
      type: "checkbox",
      label: "子编辑结束且子结构有改动时显示确认弹窗"
    },
    {
      section: "domainEdit",
      path: "domainEdit.silentDefaultAction",
      type: "select",
      label: "关闭弹窗时的默认行为",
      options: [
        { value: "degrade", label: "退化为 group" },
        { value: "bind", label: "绑定解析器（未填全则退化）" },
        { value: "undo", label: "撤销子对象编辑" }
      ]
    },
    {
      section: "domainEdit",
      path: "domainEdit.enableChildMutationOverlay",
      type: "checkbox",
      label: "启用子对象变换 overlay 记录（实验性）"
    },
    { section: "render", path: "render.antialias", type: "checkbox", label: "抗锯齿" },
    {
      section: "render",
      path: "render.targetFps",
      type: "number",
      label: "目标帧率",
      min: 15,
      max: 120,
      hint: "仅当开启低帧率模式时生效。"
    },
    { section: "render", path: "render.lowFpsMode", type: "checkbox", label: "低帧率模式" },
    {
      section: "render",
      path: "render.overrideSceneRenderLoop",
      type: "checkbox",
      label: "覆盖场景配置（fps / lowFps）",
      hint: "启用后使用当前编辑器设置覆盖场景 JSON 中的 fps / lowFps。"
    },
    {
      section: "render",
      path: "render.earlyRenderWhileLoading",
      type: "checkbox",
      label: "加载中提前渲染",
      hint: "启用后在场景加载阶段提前启动渲染循环，遮罩期间也可看到画面。"
    },
    {
      section: "render",
      path: "render.sceneAutoRotate",
      type: "checkbox",
      label: "场景自动旋转（可被场景 JSON 覆盖）",
      hint: "场景 JSON 中的 sceneAutoRotate 优先。"
    },
    {
      section: "render",
      path: "render.defaultFov",
      type: "number",
      label: "默认 FOV",
      min: 20,
      max: 120
    },
    {
      section: "render",
      path: "render.orbitDampingFactor",
      type: "number",
      label: "轨道阻尼系数",
      min: 0,
      max: 1,
      step: 0.01
    },
    {
      section: "render",
      path: "render.orbitMaxPolarAngle",
      type: "number",
      label: "轨道最大极角 (rad)",
      min: 0.5,
      max: 3.14,
      step: 0.01
    },
    {
      section: "render",
      path: "render.fullSceneFillLightsMode",
      type: "select",
      label: "全场景载入 · 补光",
      options: [
        { value: "auto", label: "自动补光" },
        { value: "off", label: "不补光" },
        { value: "prompt", label: "提示确认" }
      ]
    },
    {
      section: "render",
      path: "render.objectRecordFillLightsMode",
      type: "select",
      label: "单对象导入 · 补光",
      options: [
        { value: "auto", label: "自动补光" },
        { value: "off", label: "不补光" },
        { value: "prompt", label: "提示确认" }
      ]
    },
    {
      section: "render",
      path: "render.fullSceneFillCameraMode",
      type: "select",
      label: "全场景载入 · 补相机",
      options: [
        { value: "auto", label: "自动补相机" },
        { value: "off", label: "不补相机" },
        { value: "prompt", label: "提示确认" }
      ]
    },
    {
      section: "render",
      path: "render.objectRecordFillCameraMode",
      type: "select",
      label: "单对象导入 · 补相机",
      options: [
        { value: "auto", label: "自动补相机" },
        { value: "off", label: "不补相机" },
        { value: "prompt", label: "提示确认" }
      ]
    },
    {
      section: "render",
      path: "render.deployAutoFitCamera",
      type: "checkbox",
      label: "部署后自适应取景"
    },
    {
      section: "render",
      path: "render.deployAutoFitOverrideExplicitCamera",
      type: "checkbox",
      label: "覆盖用户相机",
      hint: "勾选后，JSON 中已定义的相机视角也会被部署阶段的自适应取景覆盖（需同时开启「部署后自适应取景」）。"
    },
    {
      section: "interaction",
      path: "interaction.previewEventBinding",
      type: "select",
      label: "预览事件绑定",
      hint: "仅对场景预览（运行场景打开的播放器）生效。",
      options: [
        { value: "followJson", label: "默认 — 跟随 JSON" },
        { value: "alwaysOn", label: "总是启用" },
        { value: "alwaysOff", label: "总是禁用" }
      ]
    },
    {
      section: "interaction",
      path: "interaction.editorEventBinding",
      type: "select",
      label: "编辑器事件绑定",
      options: [
        { value: "alwaysOff", label: "总是禁用（默认）" },
        { value: "alwaysOn", label: "总是启用" },
        { value: "followJson", label: "跟随 JSON" }
      ]
    },
    {
      section: "interaction",
      path: "interaction.previewPlayerUrl",
      type: "text",
      label: "预览播放器地址",
      hint: "留空使用默认 player 路径。"
    },
    {
      section: "interaction",
      path: "interaction.previewHotReload",
      type: "checkbox",
      label: "预览热更新"
    },
    {
      section: "threeView",
      path: "threeView.warnAfterFailCount",
      type: "number",
      label: "辅视口异常警告阈值",
      min: 1,
      max: 200
    },
    {
      section: "threeView",
      path: "threeView.fallbackAfterFailCount",
      type: "number",
      label: "自动切回普通视图阈值",
      min: 10,
      max: 500
    },
    { section: "io", path: "io.optimizeJsonOnSave", type: "checkbox", label: "保存时优化 JSON" },
    {
      section: "io",
      path: "io.objectImportFitViewDefault",
      type: "checkbox",
      label: "对象导入默认自适应相机"
    },
    {
      section: "io",
      path: "io.exportJsonIndent",
      type: "number",
      label: "导出 JSON 缩进空格",
      min: 0,
      max: 8
    },
    {
      section: "io",
      path: "io.promptExportFilename",
      type: "checkbox",
      label: "导出时提示重命名文件名",
      hint: "关闭后按自动生成的文件名直接下载，不再弹出文件名对话框。"
    },
    {
      section: "io",
      path: "io.tjzExport.format",
      type: "select",
      label: ".tjz 默认导出格式",
      options: [
        { value: "standard", label: "standard" },
        { value: "friendly", label: "friendly" },
        { value: "three-native", label: "three-native" }
      ]
    },
    {
      section: "io",
      path: "io.tjzExport.assetPolicy",
      type: "select",
      label: ".tjz 默认资源策略",
      options: [
        { value: "preserve", label: "preserve" },
        { value: "tryPack", label: "tryPack" }
      ]
    },
    {
      section: "io",
      path: "io.tjzExport.includeRuntime",
      type: "checkbox",
      label: ".tjz 默认导出 runtime"
    },
    {
      section: "io",
      path: "io.tjzExport.fetchExternalUrls",
      type: "checkbox",
      label: ".tjz tryPack 时抓取外链"
    },
    {
      section: "capture",
      path: "capture.recordFps",
      type: "number",
      label: "录制默认帧率",
      min: 1,
      max: 120
    },
    {
      section: "capture",
      path: "capture.recordMimeType",
      type: "select",
      label: "录制默认 MIME",
      options: [
        { value: "", label: "自动" },
        { value: "video/webm;codecs=vp9", label: "webm vp9" },
        { value: "video/webm;codecs=vp8", label: "webm vp8" },
        { value: "video/webm", label: "webm" }
      ]
    },
    {
      section: "capture",
      path: "capture.recordBitrateBps",
      type: "number",
      label: "录制码率 (bps，0=自动)",
      min: 0,
      max: 50000000,
      step: 1000000
    },
    {
      section: "capture",
      path: "capture.screenshotFilenamePrefix",
      type: "text",
      label: "截图文件名前缀"
    },
    {
      section: "capture",
      path: "capture.recordFilenamePrefix",
      type: "text",
      label: "录制文件名前缀"
    },
    {
      section: "ai",
      path: "ai.rememberConfig",
      type: "checkbox",
      label: "记住 AI 配置到本地"
    },
    {
      section: "ai",
      path: "ai.provider",
      type: "select",
      label: "默认 Provider",
      options: [
        { value: "chatgpt", label: "ChatGPT" },
        { value: "deepseek", label: "DeepSeek" },
        { value: "custom", label: "自定义" }
      ]
    },
    { section: "ai", path: "ai.model", type: "text", label: "默认文本模型" },
    { section: "ai", path: "ai.apiKey", type: "password", label: "API Key" },
    { section: "ai", path: "ai.customApiBase", type: "text", label: "自定义 API Base" },
    { section: "ai", path: "ai.agentEnabled", type: "checkbox", label: "启用 Agent" },
    { section: "ai", path: "ai.agentIterativeApply", type: "checkbox", label: "迭代应用到画布" },
    { section: "ai", path: "ai.agentFitViewEachRound", type: "checkbox", label: "每轮变更后自适应取景" },
    {
      section: "ai",
      path: "ai.agentDepth",
      type: "select",
      label: "Agent 深度",
      options: [
        { value: "simple", label: "simple" },
        { value: "medium", label: "medium" },
        { value: "deep", label: "deep" },
        { value: "auto", label: "auto" }
      ]
    },
    {
      section: "ai",
      path: "ai.updateOutputMode",
      type: "select",
      label: "默认调整输出模式",
      options: [
        { value: "commands", label: "命令脚本" },
        { value: "json-full", label: "JSON 全量" },
        { value: "json-incremental", label: "JSON 增量" },
        { value: "auto", label: "自动" }
      ]
    },
    { section: "ai", path: "ai.streamPreview", type: "checkbox", label: "默认流式预览" },
    { section: "ai", path: "ai.stageAutoLoad", type: "checkbox", label: "生成后自动载入场景" },
    { section: "ai", path: "ai.defaultImageModel", type: "text", label: "默认图像模型" },
    {
      section: "ai",
      path: "ai.textureBrowserMode",
      type: "select",
      label: "纹理浏览器模式",
      options: [
        { value: "directory", label: "目录" },
        { value: "upload", label: "上传" },
        { value: "zip", label: "ZIP 下载" }
      ]
    }
  ];

