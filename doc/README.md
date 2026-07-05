# ThreeJSON 调用者手册

[中文](./README.md) | [English](./en/README.md)

ThreeJSON 是一个基于 ThreeJS 的 Web3D JSON 解析引擎。调用者不直接编写大量 ThreeJS 场景、渲染循环、控制器、光源和模型创建代码，而是定义描述场景与对象的配置，ThreeJSON core 负责解析配置、创建 ThreeJS 对象、启动渲染循环并更新声明式动画。

本手册面向引擎调用者，重点说明 `core/handler/` 中的场景管线与 `core/builder/` 下的通用模型解析与绘制（如 `core/builder/modelBuilder.js`）；`core/` 目录的理想职责划分（builder / handler / runtime）见 [设计原则](./design-principles.md#core-源码目录builder--handler--runtime理想参照非强制)（**非强制**）。项目中当前仍包含一些机房业务方法和机柜模型，这些内容后续可能会移除，本文档不作为重点说明。

## 文档目录

- [快速开始](./quick-start.md)：如何用 `createSceneRuntime()` 从配置创建场景运行时。
- [JSON 配置手册](./json-format.md)：场景运行时、盒子、球体、组合、线条、信息面板、场景文字（`objType: text`）、热力图、动态平面和外部模型的 JSON 写法。
- [信息面板专题](./info-panels.md)：infoPanel / css3dPanel 选型、分类型示例与 Demo 索引。
- [事件机制与 EventScript](./event-mechanism.md)：JSON `events` 绑定、运行时 ELM、`bindSceneEventRuntime` 与 EventScript DSL 语法。
- [业务域与 `domains/`](./domains.md)：`domainModelList`、`businessDomains`、业务域注册方式，以及如何创建自定义 domain。
- [可选扩展与 `extensions/`](./extensions.md)：PluginHost、JSON `extensions` 容器、内置参考实现与自定义 extension 接入。
- [核心 API](./api.md)：调用者最常用的引擎方法（含 [`createJsonScene`](./api.md#createjsonscenepayload-options) 与[静态资源基址](./api.md#静态资源coreutilassetsbasejs)）。
- [Tools 与宿主应用](./tools.md)：`sysConfig` / `sceneConfig` 边界（编辑器、播放器等）。
- [运行时对象变更速查](./runtime-object-mutation-quickref.md)：`applyObjectChange` / `applyObjectPartial` / snapshot / redeploy 的实战用法。
- [能力范围](./scope.md)：core 与扩展边界、规范真源与运行时叠加层概要。
- [设计原则](./design-principles.md)：规范真源与运行叠加、`objectRegistry` 边界、可选能力与安全占位。
- [开发与工具链](./development.md)：Node 版本、测试、AI 凭据与 **AI 生成代码贡献规范**。
- [术语对照表](./glossary.md)：关键概念中英名与简要定义（与 [语言与文档策略](./development.md#语言与文档策略) 互补）。
- [开发方案归档](./dev/plans/README.md)：`doc/dev/plans/` 目录约定与示例。
- [Lab 实验索引](../lab/README.md)：未来能力草案（非发布承诺）；状态标记见 [`lab/CONVENTIONS.md`](../lab/CONVENTIONS.md)。
- [演示页面说明](./demos.md)：`examples/html-demo/` 与项目根目录各示例页对应的功能点。
- [场景加载生命周期](./scene-load-lifecycle.md)：`createJsonScene` 阶段钩子与 SDF 文字字体预热时序（中英双语）。

## 仓库目录结构（速查）

下列为从仓库根 [`..`](../) 出发的常见路径，便于在克隆后快速定位；与根 [`README.md`](../README.md) 互补。

```
ThreeJSON/
├── core/                 # 引擎主体：handler（场景/帧循环/注册表）、builder（几何与材质）、plugin、cache、ai、util
├── doc/                  # 调用者手册与 JSON 契约（含 doc/en/ 英文镜像）
├── lab/                  # 未来能力草案与历史计划摘录，非发布承诺
├── extensions/           # 可选扩展（如 physics-rapier、simple-gravity），按需 import
├── domains/              # 业务域实现（port、cabinet、wall、nativeThree 等）与域级 JSON 拼装
├── examples/
│   ├── html-demo/        # 无打包器、import map 驱动的最小示例（学习 core 的首选）
│   ├── vue-app/ / react-app/  # 框架集成样例
│   └── script/           # 维护用小脚本（如 AI 批处理）
├── resources/
│   ├── json/             # 示例与演示用场景 JSON
│   ├── textures/ / model/  # 演示资源（贴图；model/obj、model/gltf 等外部模型）
├── tests/                # Node 侧单测（如 patch、descriptor、插件）
├── tools/                # 外置工具链（agent、MCP、desktop、dev 维护脚本）
│   ├── threejson-agent/  # bridge/, components/, shell/py/ (Python CLI+GUI)
│   ├── mcp-threejson/
│   ├── threejson-agent-desktop/
│   └── dev/              # importmap / migrate / build；plans/ 为 AI/变更方案归档
├── index.html / demo.html
└── *.html                # 根目录业务演示页（机房、港口、编辑器等），逐步向 runtime 配置收敛
```

**调用者最常打开**：[`core/index.js`](../core/index.js)（或 npm 包 `threejson`）、[`doc/json-format.md`](./json-format.md)、[`examples/html-demo/`](../examples/html-demo/)、[`assets/json/`](../assets/json/)。

仓库根目录默认入口为 [`../index.html`](../index.html)，会跳转到 [`../demo.html`](../demo.html)。`demo.html` 可集中切换 `examples/html-demo/` 子目录示例，以及 `room-show.html`、`scene-editor.html`、`scene-player.html`、`port-show.html` 等根目录页面。

## npm 安装（可选）

仓库已提供根目录 `package.json`，包名为 **`threejson`**。在业务工程内安装时，请同时安装 peer 依赖（由打包器从 `node_modules` 解析 `import 'three'` 等）：

```bash
npm install threejson three @tweenjs/tween.js html2canvas-pro
```

入口与克隆源码一致，建议从包根导入：

```js
import { createSceneRuntime, deployMesh } from "threejson";
```

发布到 npm 前你可继续只用克隆路径 `../core/index.js`；具体版本与 peer 范围见根目录 [`package.json`](../package.json)。Three.js **正式支持 r179–r184**，详见 [`three-compat.md`](./three-compat.md)。

## 推荐使用方式

1. 使用 `createSceneRuntime()` 根据配置创建 `scene`、`camera`、`renderer`、`controls`、光源和统一渲染循环。
2. 准备对象 JSON 配置。
3. 调用 `deployMesh()`、`createGroup()`、`createLine2()`、`createHeatmap()` 等方法把对象 JSON 转成 ThreeJS 对象。
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
  material: {
    type: "standard",
    color: "#409eff"
  }
};

deployMesh(boxJson, sceneRuntime.scene);
sceneRuntime.start();
```

## 运行注意

### 在 VS Code / Cursor 中运行 HTML

1. 使用 **VS Code** 或 **Cursor** 打开本项目根目录。
2. 在扩展市场安装 **Live Server** 插件（VS Code 与 Cursor 均支持同名扩展）。
3. 在资源管理器中，对需要预览的 `.html` 文件**右键**，选择 **Open with Live Server**（中文界面可能显示为「使用 Live Server 打开」）。
4. 浏览器将自动打开对应页面（通常通过本地 HTTP 端口访问）。

### 在 WebStorm 中运行 HTML

1. 使用 **WebStorm** 打开本项目。
2. 在工程视图中，对需要运行的 `.html` 文件**右键**，选择 **运行「xxx.html」**（菜单项中的 `xxx` 为当前文件名）。

### 其他注意事项

- 请通过本地静态服务器访问页面，不建议直接用 `file://` 打开。ES Module、纹理、OBJ/GLTF 文件加载通常需要 HTTP 环境。

- 引擎模块使用裸模块名（`three`、`@tweenjs/tween.js`、`html2canvas-pro` 等）。无打包器时，页面需配置 `importmap` 将这些说明符映射到 CDN；使用 Vite/Webpack 时由 `node_modules` 解析。
- 纹理路径可以使用项目根路径，例如 `/assets/textures/...`。页面若在 `examples/html-demo/` 子目录中，引擎模块导入通常写成 `../../core/...`。
- **npm 安装 `threejson` 时**：内置 domain 与 JSON 内 `/assets/...` 默认解析到 jsDelivr [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets)（见 [`api.md` 静态资源](./api.md#静态资源coreutilassetsbasejs)）。克隆仓库跑 demo 需 `assetsBase: "/assets"` 或 `setAssetsBaseUrl("/assets")`。
- `rotationX/rotationY/rotationZ` 使用弧度值，不是角度。
- 引擎会把原始 JSON 放入对象的 `userData.objJson`，后续可通过该字段做类型判断、隐藏、删除或业务扩展。
- 推荐优先参考 [`examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html`](../examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html) 与 `assets/json/sceneRuntimeBasic.json`。
