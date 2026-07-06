/**
 * One-off generator for tutorial HTML pages (run from repo root).
 * node tools/dev/generate-tutorial-pages.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PAGE_ROOT = "../../../";

const IMPORTMAP = `  <script type="importmap">
    {
      "imports": {
        "three": "https://esm.sh/three@0.184.0",
        "three/examples/jsm/": "https://esm.sh/three@0.184.0/examples/jsm/",
        "@tweenjs/tween.js": "https://esm.sh/@tweenjs/tween.js@25.0.0",
        "html2canvas-pro": "https://esm.sh/html2canvas-pro@2.0.4",
        "gifuct-js": "https://esm.sh/gifuct-js@2.1.2",
        "three-mesh-bvh": "https://esm.sh/three-mesh-bvh@0.9.10?deps=three@0.184.0",
        "three-bvh-csg": "https://esm.sh/three-bvh-csg@0.0.18?deps=three@0.184.0,three-mesh-bvh@0.9.10"
      }
    }
  </script>`;

const FETCH_PAGES = [
  ["track-00-runtime", "00-01-minimal-mesh.html", "00-01-minimal-mesh.json", "Track 0 · 最小场景", "单盒子 + createJsonScene + 声明式旋转"],
  ["track-00-runtime", "00-02-primitives-materials.html", "00-02-primitives.json", "Track 0 · 基础几何与材质", "多 primitive、纹理地板、玻璃与 PBR"],
  ["track-00-runtime", "00-03-friendly-full-scene.html", "00-03-friendly-full-scene.json", "Track 0 · 友好 JSON 全场景", "sceneConfig + typed lists + friendlyMap"],
  ["track-00-runtime", "00-04-standard-objectlist.html", "00-04-standard-objectlist.json", "Track 0 · 标准 JSON 全场景", "与 t00-03 同场景 · objectList 写法对照"],
  ["track-00-runtime", "00-05-import-paths.html", "00-03-friendly-full-scene.json", "Track 0 · 导入路径", "拆开 core + builtins/register；对照 import map 的 threejson"],
  ["track-01-geometry", "01-01-group-line-panel.html", "01-01-group-line-panel.json", "Track 1 · 组合线条面板", "groupList / lineList / infoPanelList"],
  ["track-01-geometry", "01-02-plane-line-topology.html", "01-02-plane-line-topology.json", "Track 1 · 平面与线拓扑", "plane + line / lineSegments / lineLoop"],
  ["track-01-geometry", "01-03-preset-objtypes.html", "01-03-preset-objtypes.json", "Track 1 · 预设 objType", "wall / floor / glass + friendlyMap"],
  ["track-01-geometry", "01-04-csg-joins.html", "01-04-csg-joins.json", "Track 1 · CSG 布尔", "joins / holes 示例"],
  ["track-02-visual-fx", "02-01-heatmap-wind.html", "02-01-heatmap-wind.json", "Track 2 · 热力与风带", "heatList + windList"],
  ["track-02-visual-fx", "02-03-weather-domain.html", "02-03-weather-domain.json", "Track 2 · 天气域", "domain weather rain/snow"],
  ["track-02-visual-fx", "02-04-sprite-tube-instanced.html", "02-04-sprite-tube-instanced.json", "Track 2 · Sprite Tube Instanced", "spriteList / tubeList / instancedList"],
  ["track-02-visual-fx", "02-06-audio-spatial.html", "02-06-audio-spatial.json", "Track 2 · 空间音频", "audioList ambient + positional（需用户手势播放）"],
  ["track-03-assets", "03-04-obj-maps-fallback.html", "03-04-obj-maps-fallback.json", "Track 3 · OBJ maps", "objModelList 加载 maps_fallback/alpaca.obj"],
];

function buildFetchPage(trackDir, fileName, jsonName, title, hint) {
  const track = trackDir.replace("track-", "").split("-")[0];
  const jsonUrl = `${PAGE_ROOT}assets/json/tutorial/track-${track}/${jsonName}`;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ThreeJSON Tutorial · ${title}</title>
${IMPORTMAP}
  <style>
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #222; font-family: Arial, "Microsoft YaHei", sans-serif; }
    #rootContainer { position: relative; width: 100vw; height: 100vh; }
    #canvasContainer { display: block; width: 100%; height: 100%; background: #111; }
    #loadingMask {
      position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center;
      color: #fff; background: rgba(0,0,0,0.55); font-size: 15px;
    }
    #hint {
      position: absolute; left: 12px; bottom: 12px; z-index: 25; max-width: min(720px, 92vw);
      padding: 8px 10px; border-radius: 4px; background: rgba(10,10,10,0.55); color: #e0e0e0; font-size: 12px; line-height: 1.45;
    }
  </style>
</head>
<body>
<div id="rootContainer">
  <canvas id="canvasContainer">需要 WebGL</canvas>
  <div id="loadingMask">加载中…</div>
  <div id="hint">【${title}】数据：<code>${jsonUrl}</code>。${hint}</div>
</div>
<script type="module">
  import { createJsonScene } from "../../../core/index.js";

  const sceneJsonUrl = "${jsonUrl}";
  const canvas = document.getElementById("canvasContainer");
  const loadingMask = document.getElementById("loadingMask");
  let sceneRuntime;

  window.addEventListener("DOMContentLoaded", init);
  window.addEventListener("beforeunload", () => sceneRuntime?.dispose?.());

  async function init() {
    try {
      const response = await fetch(sceneJsonUrl);
      if (!response.ok) throw new Error("HTTP " + response.status);
      const sceneData = await response.json();
      sceneData.canvasWidth = window.innerWidth;
      sceneData.canvasHeight = window.innerHeight;
      sceneRuntime = await createJsonScene(sceneData, { canvas, resetScene: true, assetsBase: "${PAGE_ROOT}assets" });
      window.addEventListener("resize", () => sceneRuntime?.resize?.(window.innerWidth, window.innerHeight));
      sceneRuntime.start();
      loadingMask.style.display = "none";
    } catch (err) {
      console.error(err);
      loadingMask.textContent = "加载失败：" + err.message;
    }
  }
</script>
</body>
</html>
`;
}

for (const [dir, file, json, title, hint] of FETCH_PAGES) {
  const outDir = path.join(ROOT, "examples/html-demo", dir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, file), buildFetchPage(dir, file, json, title, hint), "utf8");
}

console.log("Wrote", FETCH_PAGES.length, "fetch-based tutorial pages");
