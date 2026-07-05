[中文](../quick-start.md) | [English](./quick-start.md)

# Quick Start

ThreeJSON now treats two input shapes as first-class:

- Friendly JSON: `sceneConfig + typed lists + friendlyMap`
- Standard JSON: `objectList + a small amount of top-level metadata`

Full examples (Tutorial Track 0):

- Friendly JSON: [examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html](../../examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html)
- Standard JSON: [examples/html-demo/track-00-runtime/00-04-standard-objectlist.html](../../examples/html-demo/track-00-runtime/00-04-standard-objectlist.html)

Index: [demo.html](../../demo.html) · Catalog: [tutorial.md](./tutorial.md)

## 0. Run the page

Open the page through a local static server. Do not rely on `file://`, because ES modules, textures, and OBJ / GLTF loading usually need HTTP.

### Running HTML in VS Code / Cursor

1. Open the project root in **VS Code** or **Cursor**.
2. Install the **Live Server** extension.
3. Right-click the `.html` file you want to preview and choose **Open with Live Server**.
4. Your browser will open the page through a local HTTP server.

### Running HTML in WebStorm

1. Open the project in **WebStorm**.
2. In the project view, right-click the `.html` file and choose **Run**.

## 1. Page skeleton

Use the same basic shape as `examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html` or `00-04-standard-objectlist.html`:

```html
<div id="rootContainer">
  <canvas id="canvasContainer">Sorry, your browser does not support WebGL.</canvas>
  <div id="loadingMask">Loading 3D scene...</div>
</div>
```

If your page indirectly uses files that still rely on bare module names, add an import map. The browser resolves the **entire dependency graph** (including transitive imports from `../core/index.js`), so every bare specifier used by `core` or its imports must be mapped—for example `three`, `three/examples/jsm/`, `three-mesh-bvh`, `three-bvh-csg`, `@tweenjs/tween.js`, `html2canvas-pro`, `gifuct-js`. When `core` adds new bare specifiers, update every bare-ESM page’s import map (see `tools/dev/importmap/bump-three-importmap.mjs`).

**On-demand specifiers** (map only when the scene or feature needs them; missing entries do not break pages that never use the capability):

- **`troika-three-text`** + **`fflate`**: lazy-loaded for `objType: "text"` with `mode: "sdf"` (default). Omit from the import map when the scene has no SDF text.
- **`gifuct-js`**: lazy-loaded for materials with `textureKind: "gif"`.

When `core` adds new bare specifiers, sync bare-ESM import maps (`node tools/dev/importmap/patch-gifuct-importmap.mjs`, etc.; Track 7 text lessons keep troika; other tutorial pages can use `strip-troika-importmap.mjs` to trim).

**Three.js versions**: officially supported **r179–r184** (examples use `0.184.0`). For older revisions and CSG overrides, see [`../three-compat.md`](../three-compat.md) (Chinese).

```html
<script type="importmap">
{
  "imports": {
    "three": "https://esm.sh/three@0.184.0",
    "three/examples/jsm/": "https://esm.sh/three@0.184.0/examples/jsm/",
    "three-mesh-bvh": "https://esm.sh/three-mesh-bvh@0.9.10?deps=three@0.184.0",
    "three-bvh-csg": "https://esm.sh/three-bvh-csg@0.0.18?deps=three@0.184.0,three-mesh-bvh@0.9.10",
    "@tweenjs/tween.js": "https://esm.sh/@tweenjs/tween.js@25.0.0",
    "html2canvas-pro": "https://esm.sh/html2canvas-pro@2.0.4",
    "gifuct-js": "https://esm.sh/gifuct-js@2.1.2"
  }
}
</script>
```

When the scene includes **SDF scene text** (`objType: "text"`, default `mode: "sdf"`), add to the same `imports`:

```json
    "fflate": "https://esm.sh/fflate@0.8.3",
    "troika-three-text": "https://esm.sh/troika-three-text@0.52.4?deps=three@0.184.0"
```

## 2. Load JSON through the unified entry

```js
import { createJsonScene } from "../core/index.js";

const response = await fetch("/assets/json/tutorial/track-00/00-03-friendly-full-scene.json");
const sceneData = await response.json();

sceneData.canvasWidth = window.innerWidth;
sceneData.canvasHeight = window.innerHeight;

const sceneRuntime = await createJsonScene(sceneData, {
  canvas: document.getElementById("canvasContainer"),
  resetScene: true
});

sceneRuntime.start();
```

`createJsonScene()` will:

- create the runtime objects
- detect whether the payload is friendly JSON or standard JSON
- normalize everything into standard `objectList`
- deploy records in `objType` phases

### Vue, React (Vite)

When you install from npm, the package name is **`threejson`**. Also install the versions listed under `peerDependencies` in [`package.json`](../package.json) (`three`, `@tweenjs/tween.js`, `html2canvas-pro`, and so on). Vite resolves bare specifiers from `node_modules`, so you do not need an import map.

Minimal runnable samples live in the repo (run `npm install` and `npm run dev` inside each folder):

- [`examples/vue-app`](../examples/vue-app)
- [`examples/react-app`](../examples/react-app)

Notes:

- **Vue**: in `onMounted`, take a `canvas` ref, `await createJsonScene(..., { canvas })`, then `start()`; in `onBeforeUnmount`, call `stop()` and `dispose()` on the returned runtime.
- **React**: keep the canvas in `useRef`, initialize inside `useEffect`, and call `stop()` / `dispose()` in the effect cleanup. With **StrictMode** enabled, the effect runs twice in development—if async work finishes after teardown, guard with an `alive` flag (see `examples/react-app/src/App.tsx`).
- **Assets**: put JSON and textures under `public/` (the samples use `public/demo-assets/scene/` and `public/demo-assets/textures/` with root-absolute paths like `/demo-assets/...` inside the JSON). `server.fs.allow` in `vite.config.ts` is for resolving the linked `threejson` package from the repo root, not for loading demo textures from `assets/`.

## 3. Minimal friendly JSON

```json
{
  "name": "friendly-scene",
  "friendlyMap": {
    "glassList": {
      "objType": "glass",
      "defaults": {
        "material": {
          "type": "standard",
          "transparent": true,
          "opacity": 0.35
        }
      }
    }
  },
  "sceneConfig": {
    "scene": { "background": "#222222" },
    "camera": { "fov": 60, "position": { "x": 180, "y": 120, "z": 220 } },
    "renderer": { "antialias": true },
    "controls": { "enableDamping": true, "target": { "x": 0, "y": 30, "z": 0 } },
    "lights": [
      { "type": "ambient", "color": "#ffffff", "intensity": 0.45 }
    ],
    "renderLoop": { "autoResize": true, "firstAutoResize": true }
  },
  "worldInfo": {
    "boxModelList": [
      {
        "name": "main-box",
        "objType": "box",
        "geometry": { "width": 80, "height": 80, "depth": 80 },
        "position": { "x": -60, "y": 40, "z": 0 },
        "material": { "type": "standard", "color": "#409eff" }
      }
    ],
    "glassList": [
      {
        "name": "glass-box",
        "geometry": { "width": 70, "height": 100, "depth": 70 },
        "position": { "x": 60, "y": 50, "z": 0 },
        "material": { "color": "#67c23a" }
      }
    ],
    "infoPanelList": [
      {
        "text": "hello friendly json",
        "type": "text",
        "panelBoxType": "sprite"
      }
    ]
  }
}
```

## 4. Minimal standard JSON

```json
{
  "name": "standard-scene",
  "canvasWidth": 1920,
  "canvasHeight": 1080,
  "objectList": [
    { "objType": "scene", "background": "#222222" },
    { "objType": "camera", "fov": 60, "position": { "x": 180, "y": 120, "z": 220 } },
    { "objType": "renderer", "antialias": true },
    { "objType": "controls", "enableDamping": true, "target": { "x": 0, "y": 30, "z": 0 } },
    { "objType": "light", "type": "ambient", "color": "#ffffff", "intensity": 0.45 },
    { "objType": "renderLoop", "autoResize": true, "firstAutoResize": true },
    {
      "name": "main-box",
      "objType": "box",
      "geometry": { "width": 80, "height": 80, "depth": 80 },
      "position": { "x": 0, "y": 40, "z": 0 },
      "material": { "type": "standard", "color": "#409eff" }
    }
  ]
}
```

## 5. Resize and cleanup

```js
window.addEventListener("resize", () => {
  sceneRuntime.resize({
    width: window.innerWidth,
    height: window.innerHeight
  });
});

window.addEventListener("beforeunload", () => {
  sceneRuntime.dispose();
});
```

## 6. Which JSON should you choose?

- Use friendly JSON when humans will read and edit the scene by hand.
- Use standard JSON when the payload is generated by code or AI, or when you want the canonical IR directly.
- Both shapes end up in the same standard `objectList` pipeline internally.
