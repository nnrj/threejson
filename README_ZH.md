# ThreeJSON

[中文](./README_ZH.md) | [English](./README.md)

[![CI](https://github.com/nnrj/threejson/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/nnrj/threejson/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/nnrj/threejson)](./LICENSE)

ThreeJSON 是一个由 JSON 驱动的 [Three.js](https://threejs.org/) 场景运行时：你可以通过配置来构建 3D 场景，而不必手写大量 Three.js 模板代码。

**官网**：https://threejson.org/

**仓库**：[github.com/nnrj/threejson](https://github.com/nnrj/threejson) · **问题反馈**：[Issues](https://github.com/nnrj/threejson/issues)

**npm**：[threejson - npm](https://www.npmjs.com/package/threejson) · [@threejson/assets - npm](https://www.npmjs.com/package/@threejson/assets?activeTab=versions)

**示例**：[ThreeJSON 示例 ]([ThreeJSON](https://threejson.org/website/#/examples))    **场景编辑器**：[ThreeJSON 场景编辑器](https://threejson.org/tools/scene-host/editor/index.html)



**一句话概括：**

ThreeJSON 是一个面向 3D 世界的 JSON 驱动运行时。它把场景表示为可持久化、可修改、可扩展的数据，通过统一运行时完成场景装配、对象管理、动画更新与业务域扩展，也能为编辑器和 AI/Agent 场景生成提供稳定接口。

## 在你的项目中使用

```bash
npm install threejson
```

此外，部分内置模型和场景 JSON 依赖 `assets` 资源包（包含纹理、示例场景 JSON 等）。默认情况下无需手动安装资源包，ThreeJSON 会先按当前 base 解析，失败后自动回退到 CDN。

如果你希望在本地接入资源包，可单独安装 `assets` 资源包：

```bash
npm install @threejson/assets
```

## 开发环境

在本仓库内运行测试、示例与外置工具（Agent bridge、MCP）需要 **Node.js 24+**。

```bash
git clone https://github.com/nnrj/threejson.git
cd threejson
nvm use          # 读取 .nvmrc
npm ci && npm test
```

详见 **[`docs/zh/development.md`](docs/zh/development.md)**。

## 贡献与 AI 生成代码

本开源项目**允许**提交 AI 辅助生成的代码，但须遵守 [`docs/zh/development.md`](docs/zh/development.md) 中的 **AI 生成代码贡献规范**（代码与文档同步、方案须人类评审、提交时附带 `docs/dev/plans/` 方案目录等）。详见该文档与 [`docs/dev/plans/README.md`](docs/dev/plans/README.md)。

## 文档

完整的调用指南、JSON 格式说明和 API 参考，请查看 **[`docs/zh/README.md`](docs/zh/README.md)**。

如果你想了解 `domains/` 的设计、`domainModelList` 的写法，或如何创建自定义业务域，请查看 **[`docs/zh/domains.md`](docs/zh/domains.md)**。

## 通过 npm 安装（包名：`threejson`）

你需要在自己的应用中安装这些对等依赖（版本需满足 [`package.json`](package.json) 中 `peerDependencies` 字段的要求）：

- **Three.js**：`>= 0.179.0`（推荐 **0.184.x**，开发与测试主版本）。版本矩阵见 [`docs/zh/three-compat.md`](docs/zh/three-compat.md)。

```bash
npm install threejson three @tweenjs/tween.js html2canvas-pro
```

若材质使用 **`textureKind: "gif"`**，运行时会 `import("gifuct-js")`；由打包器从 **`node_modules`**（本包已声明 `gifuct-js` 依赖，通常随 `threejson` 一并安装）解析即可。

若场景含 **`objType: "text"`** 且 **`mode: "sdf"`**（默认），运行时会懒加载 **`troika-three-text`**（本包 `dependencies`，打包器通常自动解析）；仅用 `texture` / `mesh` 模式或无文字对象时无需额外配置。

示例：

```js
import { createSceneRuntime, deployMesh, door } from "threejson";
import { applyJsonPatchToObjectDescriptor } from "threejson/patch";
import { applyJsonPatchToJsonDocument } from "threejson/patch-core";
```

若你只想使用纯 core（不自动注册内置域），使用：`import { createSceneRuntime } from "threejson/core"`。需要自行控制注册顺序时，可再 `import "threejson/builtins/register"`。

### 静态资源（纹理 / 模型 / 场景 JSON）

npm 安装后，内置 domain 与场景 JSON 中的 `/assets/...` 路径默认先按当前 base 解析，失败后自动回退到 jsDelivr 上的 [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets)（版本见运行时 `ASSETS_PACKAGE_VERSION`）。无需单独安装资源包即可通过 CDN 加载。

**切换为本地静态目录**（克隆仓库、自托管时）：

```js
import { createJsonScene, LOCAL_ASSETS_BASE, setAssetsBaseUrl } from "threejson/core";

setAssetsBaseUrl(LOCAL_ASSETS_BASE); // "/assets"

await createJsonScene(payload, {
  canvas,
  assetsBase: "/assets" // 或仅在 JSON 中写 sceneConfig.assetsBase
});
```

优先级（高覆盖低）：`createJsonScene({ assetsBase })` → `sceneConfig.assetsBase` → `setAssetsBaseUrl()` → 当前 base 优先、失败后回退 CDN。场景 JSON 内可继续写 `/assets/textures/...`，加载时按当前 base 重写；完整 `https://` URL 不受影响。

第二、三行为可选：**L3 Patch**（写回 `objJson` 并标记 binding 脏）与 **纯 JSON Patch**（无 Three 依赖，便于测试/自定义脏策略）。

打包工具（如 Vite、Webpack 等）会从 `node_modules` 中解析 `three` 及其附加模块。

**npm 打包 与 import map + CDN 的取舍**：npm + 打包便于**版本锁定**、**可复现构建**与按需打包；需维护构建链。import map 指向 **esm.sh / jsdelivr** 等可在**无构建**的 HTML 中直接跑 ES 模块，但依赖**公网 CDN 可用性**，且应在 URL 中**固定主版本**以降低漂移风险。

## 不使用 npm（克隆仓库 + 静态服务器）

克隆该仓库后，通过 HTTP 提供静态服务（例如使用 Live Server）。在 import map 中映射 **`threejson`** → [`builtins/full.js`](builtins/full.js)、**`threejson/core`** → [`core/index.js`](core/index.js)（或 [`index.js`](index.js)），即可在 HTML 里写 `import { createJsonScene } from "threejson"`，与 npm 一致。详见 [`examples/html-demo/README.md`](examples/html-demo/README.md)。另可选用相对路径 `core/index.js` + `builtins/register.js`（见该目录下的 `00-05-import-paths.html`）。为 `three`、`@tweenjs/tween.js`、`html2canvas-pro` 配置 [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap)。**按需**补充：**`gifuct-js`**（`textureKind: "gif"`）、**`troika-three-text`** + **`fflate`**（SDF 场景文字）；详见 [`docs/zh/quick-start.md`](docs/zh/quick-start.md)。

## 本地快速预览

启动静态服务器后，打开仓库根目录下的 [`index.html`](index.html)。它会重定向到 [`website/index.html`](website/index.html)。教程索引位于 [`examples/html-demo/demo.html`](examples/html-demo/demo.html)，该页面将 `examples/html-demo/*.html` 示例以及根目录下集成的页面汇总在一起，例如 [`room-show.html`](room-show.html)、[`tools/scene-host/editor/index.html`](tools/scene-host/editor/index.html)、[`tools/scene-host/player/index.html`](tools/scene-host/player/index.html) 和 [`port-show.html`](port-show.html)。

## 许可证

[MIT](./LICENSE)
