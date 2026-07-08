# ThreeJSON Examples

[中文](./README.md) | [English](./README_EN.md)

**前置条件**：`html-demo` 仅需静态 HTTP；`vue-app` / `react-app` / `electron-apps` / `script` 需 **Node.js ≥ 24**（见 [`docs/zh/development.md`](../docs/zh/development.md)）。

本目录包含：

- **[`html-app.html`](./html-app.html)**：纯 HTML 最小入口（友好 JSON 全场景 `00-03-friendly-full-scene.json`）。从**仓库根**启动静态服务后打开 `/examples/html-app.html`。
- **`html-demo/`**：无构建的 HTML + import map 教程合集（与 `docs/` 手册配合阅读）。请用本地静态服务器打开仓库根目录，勿用 `file://`。导入约定见 [`html-demo/README.md`](./html-demo/README.md)（`threejson` / `threejson/core` 与 npm 一致）。
- **`vue-app/`**：Vite + Vue 3 最小集成（`npm install` 与 `npm run dev` 在该子目录执行）。
- **`react-app/`**：Vite + React 最小集成（同上）。
- **`electron-apps/`**：Electron 桌面壳示例，含 `electron-app`（原生）、`electron-vue`、`electron-react-app` 三个子项目（各目录内 `npm install` 与 `npm run dev`）。
- **`script/`**：Node 辅助脚本（如 AI 更新场景）。

项目根目录的 [`../demo.html`](../demo.html) 可集中切换 **`html-demo/`** 下各页，以及 `room-show.html`、`scene-editor.html`、`scene-player.html`、`port-show.html` 等根目录整合页。[`../index.html`](../index.html) 会跳转到 `demo.html`。

## `html-demo/` 页面（节选）

完整列表见 [`demo.html`](../demo.html) 与 [`docs/zh/tutorial.md`](../docs/zh/tutorial.md)。

- [`track-00-runtime/00-01-minimal-mesh.html`](./html-demo/track-00-runtime/00-01-minimal-mesh.html)：Track 0 入口，`createJsonScene` + 最小友好 JSON。
- [`track-00-runtime/00-07-manual-deploy-mesh.html`](./html-demo/track-00-runtime/00-07-manual-deploy-mesh.html)（选修）：`createSceneRuntime` + `deployMesh` 单 box 手写部署。
- [`track-00-runtime/00-03-friendly-full-scene.html`](./html-demo/track-00-runtime/00-03-friendly-full-scene.html)：友好 JSON 全场景与 runtime 配置。
- [`track-05-tooling/05-01-ai-scene.html`](./html-demo/track-05-tooling/05-01-ai-scene.html)：AI 生成/调整场景 JSON 并实时渲染。
- [`track-03-assets/03-01-external-gltf.html`](./html-demo/track-03-assets/03-01-external-gltf.html)：glTF 外部模型。
- [`track-03-assets/03-03-native-three-domain.html`](./html-demo/track-03-assets/03-03-native-three-domain.html)：Three.js 原生 JSON 域模型。
- [`track-02-visual-fx/02-05-scene-background.html`](./html-demo/track-02-visual-fx/02-05-scene-background.html)：场景背景与全景。

`html-demo` 页面通过 import map 使用 **`from "threejson"`** / **`from "threejson/core"`**（映射到 `/builtins/full.js`、`/core/index.js`）。纹理与 JSON 仍建议使用站点根路径（如 `/assets/...`），并从**仓库根**启动静态服务。

### Import map 与 core（裸 ESM）

无打包器时，页面上的 **`<script type="importmap">` 必须覆盖 core 整条模块图里出现的裸说明符**（含 `three`、`three/examples/jsm/`、`three-mesh-bvh`、`three-bvh-csg`、`@tweenjs/tween.js`、`html2canvas-pro`、`gifuct-js` 等）。根目录的 `scene-editor.html`、`room-show.html`、`scene-player.html`、`port-show.html`、`port-show-auto.html` 与 `examples/html-demo/track-*/*.html` 均已对齐；若你复制示例自建页面，请一并复制 import map 或改用打包方案。详见 [`../docs/zh/quick-start.md`](../docs/zh/quick-start.md) 中的 import map 示例。

## Node 脚本（`script/`）

- `script/ai-update-scene.mjs`：调用 AI 按提示词修改场景文件并写回输出文件。
- `script/ai-update-scene.ps1`：Windows PowerShell 启动包装脚本。
- `script/ai-update-scene.cmd`：Windows CMD 启动包装脚本（内部转调 PowerShell）。

示例（在**仓库根目录**执行）：

```bash
node examples/script/ai-update-scene.mjs --prompt="增加一条主干道和两栋仓库"
```

Windows（PowerShell）：

```powershell
.\examples\script\ai-update-scene.ps1 -Prompt "增加一条主干道和两栋仓库" -Provider chatgpt
```

Windows（CMD）：

```cmd
examples\script\ai-update-scene.cmd "增加一条主干道和两栋仓库" chatgpt
```
