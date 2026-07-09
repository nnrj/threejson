# ThreeJSON Examples

[中文](./README.md) | [English](./README_EN.md)

**Prerequisites**: `html-demo` needs static HTTP only; `vue-app` / `react-app` / `electron-apps` / `script` need **Node.js ≥ 24** ([`docs/en/development.md`](../docs/en/development.md)).

This directory contains:

- **[`html-app.html`](./html-app.html)**: minimal pure-HTML entry (friendly full scene `00-03-friendly-full-scene.json`). Serve the **repository root** and open `/examples/html-app.html`.
- **`html-demo/`**: static HTML + import map tutorials (read alongside `docs/`). Serve the **repository root** over HTTP; do not use `file://`.
- **`vue-app/`**: minimal Vite + Vue 3 integration (`npm install` and `npm run dev` inside that folder).
- **`react-app/`**: minimal Vite + React integration (same).
- **`electron-apps/`**: Electron desktop demos — `electron-app` (vanilla), `electron-vue`, `electron-react-app` (`npm install` and `npm run dev` in each subfolder).
- **`script/`**: Node helper scripts (e.g. AI scene updates).

The root [`html-demo/demo.html`](html-demo/demo.html) switches between pages under **`html-demo/`** and integrated pages such as `room-show.html`, the [scene editor](../tools/scene-host/editor/index.html), the [scene player](../tools/scene-host/player/index.html), and `port-show.html`. [`../index.html`](../index.html) redirects to the website at [`../website/index.html`](../website/index.html).

## `html-demo/` pages (selected)

See [`demo.html`](html-demo/demo.html) and [`docs/en/tutorial.md`](../docs/en/tutorial.md) for the full catalog.

- [`track-00-runtime/00-01-minimal-mesh.html`](./html-demo/track-00-runtime/00-01-minimal-mesh.html): Track 0 entry, `createJsonScene` + minimal friendly JSON
- [`track-00-runtime/00-07-manual-deploy-mesh.html`](./html-demo/track-00-runtime/00-07-manual-deploy-mesh.html) (optional): `createSceneRuntime` + `deployMesh` for a single box
- [`track-00-runtime/00-03-friendly-full-scene.html`](./html-demo/track-00-runtime/00-03-friendly-full-scene.html): friendly JSON full scene
- [`track-05-tooling/05-01-ai-scene.html`](./html-demo/track-05-tooling/05-01-ai-scene.html): AI scene generation
- [`track-03-assets/03-01-external-gltf.html`](./html-demo/track-03-assets/03-01-external-gltf.html): external glTF
- [`track-03-assets/03-03-native-three-domain.html`](./html-demo/track-03-assets/03-03-native-three-domain.html): native Three.js JSON domain
- [`track-02-visual-fx/02-05-scene-background.html`](./html-demo/track-02-visual-fx/02-05-scene-background.html): scene background and panorama

Because `html-demo/` sits one level deeper than the old `demo/` folder, engine imports use **`../../core/...`**. Textures and JSON should keep site-root paths such as `/assets/...`, with the static server started from the **repo root**.

### Import maps and `core` (bare ESM)

Without a bundler, the page's **`<script type="importmap">` must cover every bare specifier** pulled in by the full module graph (including transitive imports from `../../core/index.js`), e.g. `three`, `three/examples/jsm/`, `three-mesh-bvh`, `three-bvh-csg`, `@tweenjs/tween.js`, `html2canvas-pro`, `gifuct-js`. Pages such as `room-show.html`, `port-show.html`, `port-show-auto.html`, `tools/scene-host/editor/index.html`, and `tools/scene-host/player/index.html` are kept in sync with `examples/html-demo/track-*/*.html`. If you fork a page, copy the import map or switch to a bundled setup. See [`../docs/zh/quick-start.md`](../docs/zh/quick-start.md) for the snippet.

## Node scripts (`script/`)

- `script/ai-update-scene.mjs`: calls the AI pipeline to update a scene file from a prompt and write the result out
- `script/ai-update-scene.ps1`: Windows PowerShell wrapper
- `script/ai-update-scene.cmd`: Windows CMD wrapper that forwards to PowerShell

Example (from **repository root**):

```bash
node examples/script/ai-update-scene.mjs --prompt="Add a main road and two warehouses"
```

Windows (PowerShell):

```powershell
.\examples\script\ai-update-scene.ps1 -Prompt "Add a main road and two warehouses" -Provider chatgpt
```

Windows (CMD):

```cmd
examples\script\ai-update-scene.cmd "Add a main road and two warehouses" chatgpt
```
