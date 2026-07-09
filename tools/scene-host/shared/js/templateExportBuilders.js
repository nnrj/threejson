const ASSETS_CDN = "https://cdn.jsdelivr.net/npm/@threejson/assets@latest/assets/";

export function jsonStringForScript(payload, indent = 2) {
  return JSON.stringify(payload, null, indent).replace(/<\/script/gi, "<\\/script");
}

export function buildImportMapHtml() {
  return `<script type="importmap">
    {
      "imports": {
        "threejson": "https://cdn.jsdelivr.net/npm/threejson/builtins/full.js",
        "threejson/core": "https://cdn.jsdelivr.net/npm/threejson/core/index.js",
        "three": "https://esm.sh/three@0.184.0",
        "three/examples/jsm/": "https://esm.sh/three@0.184.0/examples/jsm/",
        "@tweenjs/tween.js": "https://esm.sh/@tweenjs/tween.js@25.0.0",
        "fflate": "https://esm.sh/fflate@0.8.3",
        "html2canvas-pro": "https://esm.sh/html2canvas-pro@2.0.4",
        "gifuct-js": "https://esm.sh/gifuct-js@2.1.2",
        "three-mesh-bvh": "https://esm.sh/three-mesh-bvh@0.9.10?deps=three@0.184.0",
        "three-bvh-csg": "https://esm.sh/three-bvh-csg@0.0.18?deps=three@0.184.0,three-mesh-bvh@0.9.10",
        "troika-three-text": "https://esm.sh/troika-three-text@0.52.4?deps=three@0.184.0"
      }
    }
  </script>`;
}

export function buildHtmlTemplate({ sceneJsonText, inlineJson }) {
  const sceneSource = inlineJson
    ? `const sceneJson = ${sceneJsonText};`
    : `const sceneJson = await fetch("./assets/json/scene.json").then((response) => response.json());`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ThreeJSON Scene</title>
  <link rel="icon" href="${ASSETS_CDN}img/threejson.ico" type="image/x-icon">
  ${buildImportMapHtml()}
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #11151b; }
    canvas { display: block; width: 100%; height: 100%; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <script type="module">
    import { createJsonScene } from "threejson/core";
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

export function buildPackageJson(type) {
  const scripts =
    type === "electron"
      ? { dev: "vite --host 0.0.0.0", start: "electron .", build: "vite build" }
      : { dev: "vite --host 0.0.0.0", build: "vite build", preview: "vite preview" };
  const deps = {
    threejson: "latest",
    three: "^0.184.0",
    "@tweenjs/tween.js": "^25.0.0",
    fflate: "^0.8.3",
    "html2canvas-pro": "^2.0.4",
    "gifuct-js": "^2.1.2",
    "three-mesh-bvh": "^0.9.10",
    "three-bvh-csg": "^0.0.18",
    "troika-three-text": "^0.52.4"
  };
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
import { createJsonScene } from "threejson/core";
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
import { createJsonScene } from "threejson/core";
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
    "src/renderer.js": `import { createJsonScene } from "threejson/core";
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
