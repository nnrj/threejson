const fs = require("fs");
const htmlPath = "e:/WORKSPACE/WebStrormSpace/ThreeJSON/scene-editor.html";
const snippetPath = "e:/WORKSPACE/WebStrormSpace/ThreeJSON/lab/_editor-settings-snippet.js";
let html = fs.readFileSync(htmlPath, "utf8");
let snippet = fs.readFileSync(snippetPath, "utf8").replace(/^\/\/[^\n]*\n\n/, "");

if (html.includes("EDITOR_SETTINGS_STORAGE_KEY")) {
  console.log("Settings already inserted");
  process.exit(0);
}

const marker = '  const EDITOR_BASE_TITLE = "场景编辑器";\n';
if (!html.includes(marker)) {
  console.error("EDITOR_BASE_TITLE marker not found");
  process.exit(1);
}
html = html.replace(marker, snippet);

const removals = [
  '  const LOADING_MASK_DEFAULT_TEXT = "3D 场景加载中...";\n',
  '  const sceneJsonUrl = "/assets/json/portShow.json";\n',
  "  const FLYOUT_PEEK_HIDE_DELAY_MS = 280;\n",
  '  const VIEW_CHROME_STORAGE_KEY = "sceneEditor_viewChrome_v1";\n\n',
  "  const AUTO_SNAPSHOT_INTERVAL_MS = 120_000;\n\n",
  "  const SIDE_JSON_AUTO_RENDER_DELAY_MS = 1000;\n\n"
];
for (const line of removals) {
  html = html.replace(line, "");
}

html = html.replace(
  /  const AI_EDITOR_LS_PREFIX[\s\S]*?  const SIDEBAR_DEFAULT_IMAGE_MODEL = "dall-e-3";\n/,
  ""
);

html = html.replace(
  /  const EDITOR_HIGHLIGHT_CHANNEL_OPTIONS = \{[\s\S]*?  \};\n\n  \/\*\* 清除全部后处理高亮/,
  "  /** 清除全部后处理高亮"
);

fs.writeFileSync(htmlPath, html);
console.log("Done");
