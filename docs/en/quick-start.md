[中文](../zh/quick-start.md) | [English](./quick-start.md)

# ThreeJSON Quick Start

ThreeJSON is a JSON-driven runtime for Three.js scenes. You describe the scene, camera, lights, objects, materials, interactions, and runtime options in JSON; ThreeJSON deploys that description into a Three.js scene.

This guide focuses on one task: getting your first runnable ThreeJSON scene into your own project. For API details, see [API](./api.md). For JSON fields, see [JSON Format](./json-format.md).

## 1. Install Or Import

### npm

```bash
npm install threejson three
```

`three` is the core peer dependency. Some features use optional packages:

```bash
npm install @tweenjs/tween.js html2canvas-pro fflate gifuct-js three-bvh-csg troika-three-text
```

Install them when you use animation helpers, screenshots, archives, GIF textures, CSG, text, or related features.

If your JSON references the official sample assets, you can install the optional asset package:

```bash
npm install @threejson/assets
```

ThreeJSON can also resolve official assets from CDN. In production apps, prefer hosting assets under your own `public/assets` or CDN and set `assetsBase`.

### CDN / Plain HTML

Without a bundler, use native ES modules and an import map:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://esm.sh/three@0.184.0",
    "threejson": "https://esm.sh/threejson@0.1.0-alpha.4",
    "threejson/core": "https://esm.sh/threejson@0.1.0-alpha.4/core"
  }
}
</script>
```

Application code should import public package entries such as `threejson` and `threejson/core`. Do not import repository internals such as `../core/index.js`.

> Browser modules, textures, and models are not reliable through `file://`. Serve pages through HTTP, for example Vite, Live Server, or `npx serve`.

## 2. Minimal JSON

```js
const sceneJson = {
  version: "next",
  name: "hello-threejson",
  sceneConfig: {
    scene: { background: "#11151b" },
    camera: {
      fov: 55,
      near: 0.1,
      far: 200,
      position: { x: 10, y: 8, z: 12 }
    },
    controls: {
      enableDamping: true,
      target: { x: 0, y: 1.5, z: 0 }
    },
    renderer: { antialias: true, ratioRate: 1 },
    lights: [
      { type: "ambient", color: "#ffffff", intensity: 0.8 },
      {
        type: "directional",
        color: "#ffffff",
        intensity: 1.2,
        position: { x: 10, y: 16, z: 12 }
      }
    ],
    renderLoop: { autoResize: true, firstAutoResize: true }
  },
  worldInfo: {
    boxModelList: [
      {
        threeJsonId: "box-1",
        name: "Box",
        objType: "box",
        geometry: { width: 3, height: 3, depth: 3 },
        position: { x: 0, y: 1.5, z: 0 },
        material: { type: "standard", color: "#5470c6" }
      }
    ]
  }
};
```

`worldInfo` is the human-friendly JSON shape and remains convenient for hand-written examples. For programmatic or AI generation, prefer the uniform standard `objectList` shape; ThreeJSON normalizes either form for loading.

## 3. Plain HTML

Create `index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ThreeJSON Demo</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    #stage { width: 100vw; height: 100vh; display: block; background: #11151b; }
  </style>
  <script type="importmap">
  {
    "imports": {
      "three": "https://esm.sh/three@0.184.0",
      "threejson": "https://esm.sh/threejson@0.1.0-alpha.4"
    }
  }
  </script>
</head>
<body>
  <canvas id="stage"></canvas>

  <script type="module">
    import { createJsonScene } from "threejson";

    const sceneJson = {
      version: "next",
      sceneConfig: {
        scene: { background: "#11151b" },
        camera: { fov: 55, near: 0.1, far: 200, position: { x: 10, y: 8, z: 12 } },
        controls: { enableDamping: true, target: { x: 0, y: 1.5, z: 0 } },
        renderer: { antialias: true },
        lights: [
          { type: "ambient", color: "#ffffff", intensity: 0.8 },
          { type: "directional", color: "#ffffff", intensity: 1.2, position: { x: 10, y: 16, z: 12 } }
        ],
        renderLoop: { autoResize: true, firstAutoResize: true }
      },
      worldInfo: {
        boxModelList: [
          {
            threeJsonId: "box-1",
            objType: "box",
            geometry: { width: 3, height: 3, depth: 3 },
            position: { x: 0, y: 1.5, z: 0 },
            material: { type: "standard", color: "#5470c6" }
          }
        ]
      }
    };

    const runtime = await createJsonScene(sceneJson, {
      canvas: document.querySelector("#stage"),
      resetScene: true,
      assetsBaseMode: "cdn-first"
    });

    runtime.start();
    window.addEventListener("beforeunload", () => runtime.dispose());
  </script>
</body>
</html>
```

Start a static server:

```bash
npx serve .
```

Then open the printed local URL.

## 4. React

> This repo already ships runnable Vue / React example projects: `examples/vue-app` and `examples/react-app`. Each is its own standalone Vite project — install dependencies and start its dev server from a terminal inside the subfolder. The central iframe on the ThreeJSON Demo index page cannot embed a standalone Vite app, so these two examples won't show up in the iframe preview:
>
> ```bash
> cd examples/vue-app && npm i && npm run dev
> cd examples/react-app && npm i && npm run dev
> ```

With Vite React:

```bash
npm create vite@latest threejson-react -- --template react
cd threejson-react
npm install
npm install threejson three
npm run dev
```

Component:

```jsx
import { useEffect, useRef } from "react";
import { createJsonScene } from "threejson";

const sceneJson = {
  version: "next",
  sceneConfig: {
    scene: { background: "#11151b" },
    camera: { position: { x: 10, y: 8, z: 12 }, fov: 55, near: 0.1, far: 200 },
    controls: { enableDamping: true, target: { x: 0, y: 1.5, z: 0 } },
    lights: [{ type: "ambient", intensity: 1 }],
    renderLoop: { autoResize: true, firstAutoResize: true }
  },
  worldInfo: {
    boxModelList: [
      {
        threeJsonId: "box-1",
        objType: "box",
        geometry: { width: 3, height: 3, depth: 3 },
        position: { y: 1.5 },
        material: { type: "standard", color: "#5470c6" }
      }
    ]
  }
};

export default function ThreeJsonCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    let runtime;
    let disposed = false;

    createJsonScene(sceneJson, {
      canvas: canvasRef.current,
      resetScene: true,
      assetsBaseMode: "cdn-first"
    }).then((nextRuntime) => {
      if (disposed) {
        nextRuntime.dispose();
        return;
      }
      runtime = nextRuntime;
      runtime.start();
    });

    return () => {
      disposed = true;
      runtime?.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100vw", height: "100vh", display: "block" }} />;
}
```

## 5. Vue

With Vite Vue:

```bash
npm create vite@latest threejson-vue -- --template vue
cd threejson-vue
npm install
npm install threejson three
npm run dev
```

Component:

```vue
<template>
  <canvas ref="canvasRef" class="stage"></canvas>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { createJsonScene } from "threejson";

const canvasRef = ref(null);
let runtime = null;

const sceneJson = {
  version: "next",
  sceneConfig: {
    scene: { background: "#11151b" },
    camera: { position: { x: 10, y: 8, z: 12 }, fov: 55, near: 0.1, far: 200 },
    controls: { enableDamping: true, target: { x: 0, y: 1.5, z: 0 } },
    lights: [{ type: "ambient", intensity: 1 }],
    renderLoop: { autoResize: true, firstAutoResize: true }
  },
  worldInfo: {
    sphereModelList: [
      {
        threeJsonId: "sphere-1",
        objType: "sphere",
        geometry: { radius: 2, widthSegments: 32, heightSegments: 16 },
        position: { y: 2 },
        material: { type: "standard", color: "#73c0de" }
      }
    ]
  }
};

onMounted(async () => {
  runtime = await createJsonScene(sceneJson, {
    canvas: canvasRef.value,
    resetScene: true,
    assetsBaseMode: "cdn-first"
  });
  runtime.start();
});

onBeforeUnmount(() => {
  runtime?.dispose();
});
</script>

<style scoped>
.stage {
  width: 100vw;
  height: 100vh;
  display: block;
  background: #11151b;
}
</style>
```

## 6. Electron

In Electron, ThreeJSON runs in the renderer process. The rendering code is the same as a browser app. Prefer Vite or another frontend build tool for the renderer.

Install:

```bash
npm install threejson three
```

Renderer code:

```js
import { createJsonScene } from "threejson";

const runtime = await createJsonScene(sceneJson, {
  canvas: document.querySelector("#stage"),
  resetScene: true,
  assetsBaseMode: "cdn-first"
});

runtime.start();
window.addEventListener("beforeunload", () => runtime.dispose());
```

Path notes for Electron:

- In development, load the renderer through a dev server instead of debugging modules and textures with `file://`.
- In production, place assets in the app package and expose them through a custom protocol or build-tool public path.
- JSON asset paths should be public URLs that the renderer can load, such as `/assets/textures/xxx.webp` or a CDN URL. Do not use local absolute file paths.

## 7. Assets

ThreeJSON resolves `/assets/...` and `assets/...` against the active asset base. Common setup:

```js
await createJsonScene(sceneJson, {
  canvas,
  assetsBase: "https://cdn.jsdelivr.net/npm/@threejson/assets@1.0.0",
  assetsBaseMode: "cdn-first"
});
```

Or configure globally:

```js
import { setAssetsBaseUrl, setAssetsBaseMode } from "threejson/core";

setAssetsBaseUrl("/assets");
setAssetsBaseMode("base-first");
```

Recommendations:

- Put app assets under `public/assets` and write `/assets/...` in JSON.
- Use the `@threejson/assets` CDN for official sample assets.
- On GitHub Pages, do not assume `/assets` points to your project assets; project pages are usually deployed under a subpath.
- Use an HTTP server for local development to avoid `file://` module and cross-origin issues.

## 8. Next Steps

- Read [JSON Format](./json-format.md) for `sceneConfig`, `worldInfo`, `objectList`, and object fields.
- Read [API](./api.md) for runtime, object mutation, export, events, and assets APIs.
- Open the website examples and edit JSON on the left while the scene updates on the right.
