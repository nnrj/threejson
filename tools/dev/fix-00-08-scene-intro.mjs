/**
 * Write 00-08-scene-intro.html with correct UTF-8 Chinese (not in temp_old).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = path.join(
  ROOT,
  "examples/html-demo/track-00-runtime/00-08-scene-intro.html"
);

const content = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ThreeJSON Tutorial \u00b7 Track 0 \u00b7 sceneConfig.intro</title>
  <link rel="icon" href="/assets/img/threejson.ico" type="image/x-icon">
  <script type="importmap">
    {
      "imports": {
        "threejson": "/builtins/full.js",
        "threejson/core": "/core/index.js",
        "three": "https://esm.sh/three@0.184.0",
        "three/examples/jsm/": "https://esm.sh/three@0.184.0/examples/jsm/",
        "@tweenjs/tween.js": "https://esm.sh/@tweenjs/tween.js@25.0.0",
        "html2canvas-pro": "https://esm.sh/html2canvas-pro@2.0.4",
        "gifuct-js": "https://esm.sh/gifuct-js@2.1.2",
        "three-mesh-bvh": "https://esm.sh/three-mesh-bvh@0.9.10?deps=three@0.184.0",
        "three-bvh-csg": "https://esm.sh/three-bvh-csg@0.0.18?deps=three@0.184.0,three-mesh-bvh@0.9.10"
      }
    }
  </script>
  <style>
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #222; font-family: Arial, "Microsoft YaHei", sans-serif; }
    #rootContainer { position: relative; width: 100vw; height: 100vh; }
    #canvasContainer { display: block; width: 100%; height: 100%; background: #111; }
    #loadingMask {
      position: absolute; inset: 0; z-index: 20; display: flex; align-items: center; justify-content: center;
      color: #fff; background: rgba(0,0,0,0.55); font-size: 15px;
    }
    #hint {
      position: absolute; left: 12px; bottom: 12px; z-index: 25; max-width: min(760px, 92vw);
      padding: 8px 10px; border-radius: 4px; background: rgba(10,10,10,0.55); color: #e0e0e0; font-size: 12px; line-height: 1.45;
    }
    code { color: #b8d4ff; }
  </style>
</head>
<body>
<div id="rootContainer">
  <canvas id="canvasContainer">\u9700\u8981 WebGL</canvas>
  <div id="loadingMask">\u52a0\u8f7d\u4e2d\u2026</div>
  <div id="hint">\u3010Track 0 \u00b7 intro\u3011<code>sceneConfig.intro.postLoad</code> \u00b7 \u90e8\u7f72\u5b8c\u6210\u540e\u7247\u5934\uff08Logo + \u6587\u5b57\uff0c\u70b9\u51fb\u8df3\u8fc7\uff09\u00b7 \u6570\u636e\uff1a<code>/assets/json/tutorial/track-00/00-08-scene-intro.json</code></div>
</div>
<script type="module">
  import { createJsonScene } from "threejson/core";

  const sceneJsonUrl = "/assets/json/tutorial/track-00/00-08-scene-intro.json";
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
      sceneRuntime = await createJsonScene(sceneData, { canvas, resetScene: true, assetsBase: "/assets" });
      window.addEventListener("resize", () => sceneRuntime?.resize?.(window.innerWidth, window.innerHeight));
      sceneRuntime.start();
      loadingMask.style.display = "none";
    } catch (err) {
      console.error(err);
      loadingMask.textContent = "\u52a0\u8f7d\u5931\u8d25\uff1a" + err.message;
    }
  }
</script>
</body>
</html>
`;

fs.writeFileSync(target, content, "utf8");
const verify = fs.readFileSync(target, "utf8");
console.log("written:", target);
console.log("需要 WebGL:", verify.includes("需要 WebGL"));
console.log("FFFD:", verify.includes("\uFFFD"));
console.log("assetsBase:", verify.includes("assetsBase"));
