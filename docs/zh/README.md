[中文](./README.md) | [English](../en/README.md)

# ThreeJSON 调用者手册

[中文](./README.md) | [English](../en/README.md)

ThreeJSON 是一个基于 Three.js 的 Web3D JSON 运行时。调用者不需要直接手写大量 Three.js 场景搭建、渲染循环、控制器、光源和模型创建代码，而是通过配置来描述场景与对象。ThreeJSON core 负责解析配置、创建 Three.js 对象、启动渲染循环，并更新声明式动画。

本手册面向引擎调用者，重点说明 `core/handler/` 中的场景管线，以及 `core/builder/` 下的通用模型解析与绘制方法，例如 `core/builder/modelBuilder.js`。`builder / handler / runtime` 的理想职责划分见 [设计原则](./design-principles.md#core-源码目录builder--handler--runtime-理想参考非强制)。仓库中当前仍包含一些机房和机柜相关的业务实现，这些内容后续可能会继续收敛，不是本文重点。

## 文档目录

- [快速开始](./quick-start.md)：用 `createSceneRuntime()` 从配置创建一个最小可运行场景。
- [JSON 格式手册](./json-format.md)：运行时配置，以及盒体、球体、组合、线段、信息面板、场景文字（`objType: text`）、热力图、动画平面和外部模型的 JSON 写法。
- [信息面板专题](./info-panels.md)：infoPanel / css3dPanel 选型、分类型示例和 Demo 索引。
- [业务域与 `domains/`](./domains.md)：`domainModelList`、`businessDomains`、业务域注册方式，以及如何创建自定义 domain。
- [可选扩展与 `extensions/`](./extensions.md)：PluginHost、JSON `extensions` 容器、内置参考实现和自定义扩展接入。
- [核心 API](./api.md)：调用者最常用的运行时 API，包括 [`createJsonScene`](./api.md#createjsonscenepayload-options) 和 [静态资源基址](./api.md#static-assets-coreutilassetsbasejs)。
- [工具与宿主应用](./tools.md)：`sysConfig` / `sceneConfig` 的边界说明（编辑器、播放器等）。
- [运行时对象变更速查](./runtime-object-mutation-quickref.md)：`applyObjectChange` / 局部更新 / 快照 / 重新部署。
- [能力边界](./scope.md)：core 与扩展的边界，以及规范真源与运行时叠加层。
- [设计原则](./design-principles.md)：可选功能、非侵入式设计与安全占位。
- [Demo 页面](./demos.md)：`examples/html-demo/` 与仓库根页面各自演示什么。
- [场景加载生命周期](./scene-load-lifecycle.md)：`createJsonScene` 的阶段钩子与 SDF 文字字体预热（中英双语）。

仓库根目录默认入口是 [`../index.html`](../../index.html)，会跳转到 [`website/index.html`](../../website/index.html)。教程索引 [`demo.html`](../../examples/html-demo/demo.html) 可以在 `examples/html-demo/` 的示例和集成页之间切换，例如 `room-show.html`、[`场景编辑器`](../../tools/scene-host/editor/index.html)、[`场景播放器`](../../tools/scene-host/player/index.html) 和 `port-show.html`。

## npm 安装（可选）

仓库已经提供了根目录 [`../package.json`](../../package.json)，包名为 **`threejson`**。如果要在自己的应用中安装它，请同时安装 peer 依赖，以便打包器能从 `node_modules` 正确解析诸如 `three` 之类的导入：

```bash
npm install threejson three @tweenjs/tween.js html2canvas-pro
```

推荐从包根导入：

```js
import { createSceneRuntime, deployMesh } from "threejson";
```

如果你只是想直接使用克隆仓库里的源码，也可以从 `../core/index.js` 导入。当前版本和 peer 依赖范围请以根目录 [`../package.json`](../../package.json) 为准。

## 推荐用法

1. 使用 `createSceneRuntime()` 创建 `scene`、`camera`、`renderer`、`controls`、光源和统一渲染循环。
2. 准备对象 JSON 描述。
3. 使用 `deployMesh()`、`createGroup()`、`createLine2()`、`createHeatmap()` 等方法把 JSON 转成 Three.js 对象。
4. 调用 `sceneRuntime.start()` 启动统一渲染循环。

最小示例：

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
  material: { type: "standard", color: "#409eff" }
};

deployMesh(boxJson, sceneRuntime.scene);
sceneRuntime.start();
```

## 运行说明

### 在 VS Code / Cursor 中运行 HTML

1. 用 **VS Code** 或 **Cursor** 打开仓库根目录。
2. 安装 **Live Server** 扩展。
3. 在文件树中对需要预览的 `.html` 文件右键，选择 **Open with Live Server**。
4. 浏览器会通过本地 HTTP 服务自动打开页面。

### 在 WebStorm 中运行 HTML

1. 用 **WebStorm** 打开项目。
2. 在项目视图中对需要运行的 `.html` 文件右键，选择 **Run**。

### 其他说明

- 请通过本地静态服务器访问页面，不建议直接用 `file://` 打开。ES Module、纹理以及 OBJ / GLTF 加载通常都需要 HTTP 环境。
- 引擎使用 `three`、`@tweenjs/tween.js`、`html2canvas-pro` 等裸模块名；如果不使用打包器，需要手动配置 import map 指向 CDN。使用 Vite 或 Webpack 时，这些依赖会从 `node_modules` 解析。
- 纹理路径可以直接使用项目根路径，比如 `/assets/textures/...`。`examples/html-demo/` 下的页面通常从 `../../core/...` 导入引擎模块。
- 安装 `threejson` 后，JSON 中的 `/assets/...` 路径默认先尝试当前 base，失败后回退到 jsDelivr [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets)；克隆仓库的演示页面仍可使用 `assetsBase: "/assets"` 或 `setAssetsBaseUrl("/assets")` 指向本地资源。
- `rotationX`、`rotationY` 和 `rotationZ` 的单位是弧度，不是角度。
- 引擎会把原始 JSON 保存在 `userData.objJson` 上，便于后续做类型判断、隐藏、删除或业务扩展。
- 想看一个现代示例，可以从 [`examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html`](../../examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html) 和 `assets/json/sceneRuntimeBasic.json` 开始。
