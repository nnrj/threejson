[中文](../zh/README.md) | [English](./README.md)

# ThreeJSON Caller Guide

ThreeJSON is a Web3D JSON runtime built on top of Three.js. Instead of hand-writing large amounts of scene setup, render-loop, controls, lights, and mesh creation code, callers describe scenes and objects as configuration data. The ThreeJSON core then parses that configuration, creates the corresponding Three.js objects, starts the render loop, and updates declarative animations.

This handbook is written for library callers. It focuses on the scene pipeline under `core/handler/` and general-purpose object builders under `core/builder/` such as `core/builder/modelBuilder.js`. An **ideal, non-mandatory** view of `builder` / `handler` / `runtime` is in [Design principles](./design-principles.md#core-source-layout-builder--handler--runtime-ideal-reference-not-mandatory). The repository still contains some business-specific machine-room and cabinet code, but those parts are not the main focus of this handbook.

## Contents

- [Quick Start](./quick-start.md): create a minimal runnable scene with `createSceneRuntime()`.
- [JSON Format Guide](./json-format.md): runtime config plus the JSON formats for boxes, spheres, groups, lines, info panels, scene text (`objType: text`), heatmaps, animated planes, and external models.
- [Info panels guide](./info-panels.md): infoPanel / css3dPanel selection, per-type examples, and demo index.
- [Business Domains and `domains/`](./domains.md): `domainModelList`, `businessDomains`, domain registration, and custom domains.
- [Optional extensions and `extensions/`](./extensions.md): PluginHost, JSON `extensions` containers, bundled references, and custom extension wiring.
- [Core API](./api.md): the most commonly used runtime APIs for callers (including [`createJsonScene`](./api.md#createjsonscenepayload-options) and [static asset base URLs](./api.md#static-assets-coreutilassetsbasejs)).
- [Tools and host apps](./tools.md): `sysConfig` / `sceneConfig` boundaries (editor, player, etc.).
- [Runtime object mutation quickref](./runtime-object-mutation-quickref.md): `applyObjectChange` / partial / snapshot / redeploy.
- [Development](./development.md): Node version, tests, AI verification, sync/async API naming.
- [Terminology glossary](./glossary.md): key concept pairs and short definitions (complements [language policy](./development.md#language-and-documentation-policy)).
- [Scope](./scope.md): core vs extensions and canonical vs runtime overlays.
- [Design principles](./design-principles.md): optional features, non-invasiveness, and security placeholder.
- [Demo Pages](./demos.md): what each page under `examples/html-demo/` and the repo root demonstrates.
- [Scene load lifecycle](./scene-load-lifecycle.md): `createJsonScene` phase hooks and SDF text font preload (bilingual).

The default entry page at the repo root is [`../index.html`](../../index.html), which redirects to [`../demo.html`](../../demo.html). `demo.html` lets you switch between the `examples/html-demo/` samples and the root-level integrated pages such as `room-show.html`, `scene-editor.html`, `scene-player.html`, and `port-show.html`.

## npm Install (Optional)

The repository already provides a root [`../package.json`](../../package.json) and the package name is **`threejson`**. When installing it into your own application, also install the peer dependencies so your bundler can resolve imports such as `three` from `node_modules`:

```bash
npm install threejson three @tweenjs/tween.js html2canvas-pro
```

Prefer importing from the package root:

```js
import { createSceneRuntime, deployMesh } from "threejson";
```

Before publishing to npm, you can still import directly from the cloned source path `../core/index.js`. See the root [`../package.json`](../../package.json) for the current package version and peer dependency range.

## Recommended Usage

1. Use `createSceneRuntime()` to create the `scene`, `camera`, `renderer`, `controls`, lights, and the shared render loop.
2. Prepare object JSON descriptions.
3. Convert JSON objects into Three.js objects with `deployMesh()`, `createGroup()`, `createLine2()`, `createHeatmap()`, and similar helpers.
4. Call `sceneRuntime.start()` to start the shared render loop.

Minimal example:

```js
import { createSceneRuntime, deployMesh } from "../core/index.js";

const sceneRuntime = createSceneRuntime({
  canvas: document.getElementById("canvasContainer"),
  config: {
    canvasWidth: window.innerWidth,
    canvasHeight: window.innerHeight,
    scene: { background: "#222222" },
    camera: { fov: 60, near: 0.1, far: 2500, position: { x: 220, y: 180, z: 280 } },
    renderer: { antialias: true, ratioRate: 1 },
    controls: { enableDamping: true, target: { x: 0, y: 40, z: 0 } },
    lights: [
      { type: "ambient", color: "#ffffff", intensity: 0.45 },
      { type: "directional", color: "#ffffff", intensity: 0.9, position: { x: 300, y: 400, z: 300 } }
    ],
    renderLoop: { autoResize: true, firstAutoResize: true }
  }
});

const boxJson = {
  name: "demo-box",
  objType: "box",
  geometry: { width: 100, height: 80, depth: 60 },
  position: { x: 0, y: 40, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: {
    type: "standard",
    color: "#409eff"
  }
};

deployMesh(boxJson, sceneRuntime.scene);
sceneRuntime.start();
```

## Running Notes

### Running HTML in VS Code / Cursor

1. Open the project root in **VS Code** or **Cursor**.
2. Install the **Live Server** extension.
3. In the file explorer, right-click the `.html` file you want to preview and choose **Open with Live Server**.
4. Your browser will open the page over a local HTTP server.

### Running HTML in WebStorm

1. Open the project in **WebStorm**.
2. In the project view, right-click the `.html` file you want to run and choose **Run**.

### Other Notes

- Serve pages over a local static server instead of opening them with `file://`. ES modules, textures, and OBJ / GLTF loading usually require HTTP.
- The engine uses bare module specifiers such as `three`, `@tweenjs/tween.js`, and `html2canvas-pro`. Without a bundler, add an `importmap` that maps them to a CDN. With Vite or Webpack, they will be resolved from `node_modules`.
- Texture paths can use project-root paths such as `/assets/textures/...`. Pages inside `examples/html-demo/` usually import engine modules from `../../core/...`.
- **With `npm install threejson`**: built-in domains and `/assets/...` paths in JSON try the active base first and fall back to jsDelivr [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets) (see [Static assets in `api.md`](./api.md#static-assets-coreutilassetsbasejs)). Cloned-repo demos can still use `assetsBase: "/assets"` or `setAssetsBaseUrl("/assets")` for the local mount.
- `rotationX`, `rotationY`, and `rotationZ` use radians, not degrees.
- The engine stores the original JSON on `userData.objJson`, which is useful for later type checks, hiding, deletion, or business extensions.
- Start with [`examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html`](../../examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html) and `assets/json/sceneRuntimeBasic.json` for a modern example.
