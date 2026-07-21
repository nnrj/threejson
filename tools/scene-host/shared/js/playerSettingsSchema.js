export const PLAYER_SETTINGS_SECTIONS = [
  { id: "general", title: "General" },
  { id: "layout", title: "Layout" },
  { id: "audio", title: "Audio" },
  { id: "playback", title: "Playback" },
  { id: "render", title: "Rendering" },
  { id: "immersive", title: "Immersive Fullscreen" },
  { id: "highlight", title: "Highlight" }
];

export const PLAYER_SETTINGS_FIELDS = [
  { section: "general", path: "general.assetGatewayUrl", type: "text", label: "Static asset gateway URL", placeholder: "https://your-server.example.com" },
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
  { section: "general", path: "general.defaultSceneUrl", type: "text", label: "Default scene URL" },
  { section: "general", path: "general.loadingMaskText", type: "text", label: "Loading overlay text" },
  {
    section: "general",
    path: "general.messageToastDurationMs",
    type: "number",
    label: "Message toast duration (ms)",
    min: 500,
    max: 15000
  },
  {
    section: "general",
    path: "general.progressOverlayEnabled",
    type: "checkbox",
    label: "Show loading progress overlay"
  },
  {
    section: "general",
    path: "general.sceneLoadDoneDelayMs",
    type: "number",
    label: "Post-load overlay dismiss delay (ms)",
    min: 0,
    max: 3000,
    hint: "How long the overlay stays visible after scene load completes. Set to 0 to dismiss immediately."
  },
  {
    section: "layout",
    path: "layout.rightPanelOpenByDefault",
    type: "checkbox",
    label: "Expand playlist panel by default"
  },
  {
    section: "layout",
    path: "layout.playlistListMinHeightPx",
    type: "number",
    label: "Playlist minimum height (px)",
    min: 80,
    max: 400
  },
  {
    section: "audio",
    path: "audio.defaultVolumePercent",
    type: "number",
    label: "Default master volume (%)",
    min: 0,
    max: 100
  },
  { section: "audio", path: "audio.defaultMuted", type: "checkbox", label: "Muted by default" },
  {
    section: "audio",
    path: "audio.rememberVolume",
    type: "checkbox",
    label: "Remember volume and mute state"
  },
  {
    section: "playback",
    path: "playback.restorePlaylistOnStartup",
    type: "checkbox",
    label: "Restore playlist on startup"
  },
  {
    section: "playback",
    path: "playback.preferUrlQueryScene",
    type: "checkbox",
    label: "URL ?scene= / ?url= overrides default scene",
    hint: "Used when no playlist restore and no URL query is present."
  },
  {
    section: "playback",
    path: "playback.sceneAutoRotate",
    type: "checkbox",
    label: "Scene auto-rotate (overridable by scene JSON)"
  },
  { section: "render", path: "render.antialias", type: "checkbox", label: "Antialiasing" },
  {
    section: "render",
    path: "render.targetFps",
    type: "number",
    label: "Target frame rate",
    min: 15,
    max: 120,
    hint: "Applies only when low-FPS mode is enabled."
  },
  { section: "render", path: "render.lowFpsMode", type: "checkbox", label: "Low-FPS mode" },
  {
    section: "render",
    path: "render.overrideSceneRenderLoop",
    type: "checkbox",
    label: "Override scene render loop (fps / lowFps)",
    hint: "When enabled, player settings override fps / lowFps from scene JSON."
  },
  {
    section: "render",
    path: "render.earlyRenderWhileLoading",
    type: "checkbox",
    label: "Render while loading",
    hint: "Start the render loop during scene load so the canvas is visible under the overlay."
  },
  {
    section: "immersive",
    path: "immersive.chromeHideDelayMs",
    type: "number",
    label: "Fullscreen chrome hide delay (ms)",
    min: 100,
    max: 3000
  },
  {
    section: "immersive",
    path: "immersive.rightEdgeStripWidthPx",
    type: "number",
    label: "Fullscreen right-edge strip width (px)",
    min: 12,
    max: 48
  },
  { section: "highlight", path: "highlight.channels.info", type: "color", label: "info channel color" },
  { section: "highlight", path: "highlight.channels.locate", type: "color", label: "locate channel color" },
  { section: "highlight", path: "highlight.channels.alarm", type: "color", label: "alarm channel color" }
];
