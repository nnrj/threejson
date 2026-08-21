import { DEFAULT_CDN_ASSETS_BASE } from "threejson/assets";

// Single source of truth for the pinned @threejson/assets CDN version is core/util/assetsBase.js
// (DEFAULT_CDN_ASSETS_BASE / ASSETS_PACKAGE_VERSION, guarded by tests/assetsBase.test.mjs against
// the installed devDependency — so a stale pin fails `npm test`). We only append the trailing slash:
// @threejson/assets publishes the assets/ folder's *contents* at its package root, so there is no
// "assets/" path segment.
const ASSETS_CDN = `${DEFAULT_CDN_ASSETS_BASE}/`;

// Keep this in sync with the root package version. The release version command updates it in both
// the scene-host source and the published @threejson/host-kit copy. Pinning avoids a downloaded
// template changing behavior later merely because npm's `latest` dist-tag moved.
export const TEMPLATE_THREEJSON_VERSION = "0.1.0-alpha.10";
const THREEJSON_CDN = `https://cdn.jsdelivr.net/npm/threejson@${TEMPLATE_THREEJSON_VERSION}`;

const OPTIONAL_TEMPLATE_DEPENDENCIES = Object.freeze({
  archive: ["fflate", "https://esm.sh/fflate@0.8.3", "^0.8.3"],
  animatedGif: ["gifuct-js", "https://esm.sh/gifuct-js@2.1.2", "^2.1.2"],
  htmlInfoPanel: ["html2canvas-pro", "https://esm.sh/html2canvas-pro@2.0.4", "^2.0.4"],
  sdfText: [
    "troika-three-text",
    "https://esm.sh/troika-three-text@0.52.4?deps=three@0.184.0",
    "^0.52.4"
  ]
});

function inspectSceneCapabilities(value, capabilities, seen) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);

  const objType = String(value.objType || "").trim().toLowerCase();
  const mode = String(value.mode || "").trim().toLowerCase();
  if (objType === "text" && mode !== "texture" && mode !== "mesh") {
    capabilities.sdfText = true;
  }
  if (objType === "infopanel" && String(value.type || "").toLowerCase() === "html") {
    capabilities.htmlInfoPanel = true;
  }
  if (String(value.textureKind || "").toLowerCase() === "gif") {
    capabilities.animatedGif = true;
  }
  if (["joins", "inters", "holes"].some((key) => Array.isArray(value[key]) && value[key].length)) {
    capabilities.csg = true;
  }
  if (value.infoPanel && String(value.infoPanel.type || "").toLowerCase() === "html") {
    capabilities.htmlInfoPanel = true;
  }
  for (const child of Object.values(value)) {
    inspectSceneCapabilities(child, capabilities, seen);
  }
}

export function detectTemplateCapabilities(sceneJsonSource) {
  const capabilities = {
    archive: false,
    animatedGif: false,
    csg: false,
    htmlInfoPanel: false,
    sdfText: false
  };
  let payload = sceneJsonSource;
  if (typeof sceneJsonSource === "string") {
    try {
      payload = JSON.parse(sceneJsonSource);
    } catch {
      const source = sceneJsonSource.toLowerCase();
      capabilities.animatedGif = /["']texturekind["']\s*:\s*["']gif["']/.test(source);
      capabilities.csg = /["'](?:joins|inters|holes)["']\s*:\s*\[\s*\{/.test(source);
      capabilities.htmlInfoPanel = /["']type["']\s*:\s*["']html["']/.test(source);
      capabilities.sdfText = /["']objtype["']\s*:\s*["']text["']/.test(source)
        && !/["']mode["']\s*:\s*["'](?:texture|mesh)["']/.test(source);
      return capabilities;
    }
  }
  inspectSceneCapabilities(payload, capabilities, new WeakSet());
  if (payload?.sceneConfig?.textFont?.preloadCharacters) capabilities.sdfText = true;
  return capabilities;
}

function resolveTemplateCapabilities(options = {}) {
  return {
    ...detectTemplateCapabilities(options.sceneJson ?? options.sceneJsonText),
    ...(options.capabilities || {})
  };
}

export function jsonStringForScript(payload, indent = 2) {
  return JSON.stringify(payload, null, indent).replace(/<\/script/gi, "<\\/script");
}

export function buildImportMapHtml(options = {}) {
  const capabilities = resolveTemplateCapabilities(options);
  const imports = {
    "threejson/runtime": `${THREEJSON_CDN}/core/runtime.js`,
    three: "https://esm.sh/three@0.184.0",
    "three/examples/jsm/": "https://esm.sh/three@0.184.0/examples/jsm/",
    "@tweenjs/tween.js": "https://esm.sh/@tweenjs/tween.js@25.0.0"
  };
  if (capabilities.csg) {
    imports["three-mesh-bvh"] = "https://esm.sh/three-mesh-bvh@0.9.10?deps=three@0.184.0";
    imports["three-bvh-csg"] =
      "https://esm.sh/three-bvh-csg@0.0.18?deps=three@0.184.0,three-mesh-bvh@0.9.10";
  }
  for (const [capability, [specifier, url]] of Object.entries(OPTIONAL_TEMPLATE_DEPENDENCIES)) {
    if (capabilities[capability]) imports[specifier] = url;
  }
  return `<script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n  </script>`;
}

export function buildHtmlTemplate({ sceneJsonText, inlineJson, capabilities }) {
  const sceneSource = inlineJson
    ? `const sceneJson = ${sceneJsonText};`
    : `const sceneJson = await fetch("./assets/json/scene.json").then((response) => response.json());`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ThreeJSON Scene</title>
  <link rel="icon" href="${ASSETS_CDN}img/favicon.ico" type="image/x-icon">
  ${buildImportMapHtml({ sceneJsonText, capabilities })}
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #11151b; }
    canvas { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script type="module">
    import { createJsonScene } from "threejson/runtime";
    ${sceneSource}
    const canvas = document.getElementById("canvas");
    const runtime = await createJsonScene(sceneJson, {
      canvas,
      resetScene: true,
      assetsBase: "${ASSETS_CDN}"
    });
    runtime.start?.();
    runtime.resize?.(innerWidth, innerHeight);
    window.addEventListener("resize", () => runtime.resize?.(innerWidth, innerHeight));
  </script>
</body>
</html>
`;
}

export function buildPackageJson(type, options = {}) {
  const scripts =
    type === "electron"
      ? { dev: "vite --host 0.0.0.0", start: "electron .", build: "vite build" }
      : { dev: "vite --host 0.0.0.0", build: "vite build", preview: "vite preview" };
  const deps = {
    threejson: TEMPLATE_THREEJSON_VERSION,
    three: "^0.184.0",
    "@tweenjs/tween.js": "^25.0.0"
  };
  const capabilities = resolveTemplateCapabilities(options);
  if (capabilities.csg) {
    deps["three-mesh-bvh"] = "^0.9.10";
    deps["three-bvh-csg"] = "^0.0.18";
  }
  for (const [capability, [specifier, , version]] of Object.entries(OPTIONAL_TEMPLATE_DEPENDENCIES)) {
    if (capabilities[capability]) deps[specifier] = version;
  }
  if (type === "react") {
    deps["@vitejs/plugin-react"] = "latest";
    deps.react = "latest";
    deps["react-dom"] = "latest";
    deps.vite = "latest";
  } else if (type === "vue") {
    deps["@vitejs/plugin-vue"] = "latest";
    deps.vue = "latest";
    deps.vite = "latest";
  } else if (type === "electron") {
    deps.electron = "latest";
    deps.vite = "latest";
  }
  return JSON.stringify({ type: "module", scripts, dependencies: deps }, null, 2);
}

export function buildReactFiles() {
  return {
    "index.html": `<div id="root"></div><script type="module" src="/src/main.jsx"></script>`,
    "src/main.jsx": `import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { createJsonScene } from "threejson/runtime";
import sceneJson from "../assets/json/scene.json";
import "./style.css";

function App() {
  const canvasRef = useRef(null);
  useEffect(() => {
    let runtime;
    let disposed = false;
    createJsonScene(sceneJson, { canvas: canvasRef.current, resetScene: true, assetsBase: "${ASSETS_CDN}" })
      .then((value) => {
        if (disposed) return;
        runtime = value;
        runtime.start?.();
        runtime.resize?.(innerWidth, innerHeight);
      });
    const onResize = () => runtime?.resize?.(innerWidth, innerHeight);
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      runtime?.dispose?.();
    };
  }, []);
  return <canvas ref={canvasRef} />;
}

createRoot(document.getElementById("root")).render(<App />);
`,
    "src/style.css": `html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:#11151b}canvas{display:block;width:100%;height:100%}`
  };
}

export function buildVueFiles() {
  return {
    "index.html": `<div id="app"></div><script type="module" src="/src/main.js"></script>`,
    "src/main.js": `import { createApp, onMounted, onBeforeUnmount, ref } from "vue";
import { createJsonScene } from "threejson/runtime";
import sceneJson from "../assets/json/scene.json";
import "./style.css";

createApp({
  setup() {
    const canvasRef = ref(null);
    let runtime;
    const onResize = () => runtime?.resize?.(innerWidth, innerHeight);
    onMounted(async () => {
      runtime = await createJsonScene(sceneJson, { canvas: canvasRef.value, resetScene: true, assetsBase: "${ASSETS_CDN}" });
      runtime.start?.();
      runtime.resize?.(innerWidth, innerHeight);
      window.addEventListener("resize", onResize);
    });
    onBeforeUnmount(() => {
      window.removeEventListener("resize", onResize);
      runtime?.dispose?.();
    });
    return { canvasRef };
  },
  template: "<canvas ref=\\"canvasRef\\"></canvas>"
}).mount("#app");
`,
    "src/style.css": `html,body,#app{margin:0;width:100%;height:100%;overflow:hidden;background:#11151b}canvas{display:block;width:100%;height:100%}`
  };
}

export function buildElectronFiles() {
  return {
    "index.html": `<canvas id="canvas"></canvas><script type="module" src="/src/renderer.js"></script>`,
    "main.js": `import { app, BrowserWindow } from "electron";

function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 800 });
  win.loadFile("dist/index.html");
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
`,
    "src/renderer.js": `import { createJsonScene } from "threejson/runtime";
import sceneJson from "../assets/json/scene.json";
import "./style.css";

const canvas = document.getElementById("canvas");
const runtime = await createJsonScene(sceneJson, { canvas, resetScene: true, assetsBase: "${ASSETS_CDN}" });
runtime.start?.();
runtime.resize?.(innerWidth, innerHeight);
window.addEventListener("resize", () => runtime.resize?.(innerWidth, innerHeight));
`,
    "src/style.css": `html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#11151b}canvas{display:block;width:100%;height:100%}`
  };
}

export function buildTemplateFiles(type) {
  if (type === "react") return buildReactFiles();
  if (type === "vue") return buildVueFiles();
  return buildElectronFiles();
}
