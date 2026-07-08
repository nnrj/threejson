[中文](./extensions.md) | [English](../en/extensions.md)

# 可选扩展与 `extensions/`

[中文](./extensions.md) | [English](../en/extensions.md)

本页面向 **基于 ThreeJSON 的宿主应用开发者**，说明如何接入仓库内 [`extensions/`](../../extensions/) 参考实现，以及如何编写**自定义 extension**（物理、图表、贴地、粒子 provider 等横切运行时能力）。

- **声明式业务对象**（机柜、门、港口模型等）见 [业务域与 `domains/`](./domains.md)，不要与 extension 混用。
- JSON 字段细节见 [JSON 配置手册 · 可选扩展配置](./json-format.md#可选扩展配置-extensions)；API 见 [核心 API · PluginHost / onSceneReady](./api.md#corepluginpluginhostjs)。

## extension 与 domain 怎么选

| | **extension** | **domain** |
|---|---------------|------------|
| 典型能力 | 物理、FPS 贴地、图表桥接、粒子后端 | 业务复合模型、行业 JSON 调度 |
| JSON 入口 | `sceneConfig.extensions[id]`、物体 `extensions[id]` | `objType: "domain"`、`domainModelList` |
| core 是否自动加载 | **否**（宿主 import + bootstrap） | 主入口 `threejson` 注册内置域 |
| 第三方标准 CLI | **无**（见下文「自定义扩展」） | ✅ `threejson add-domain` |

术语对照：[术语表 · 架构与分层](./glossary.md#架构与分层)。

## 架构要点

1. **不自动加载**：`core/index.js` 与 `import { createJsonScene } from "threejson"` **不会** import `extensions/`。未 import、未 register 时，行为与纯 core 一致（[设计原则 · 行为可预测](./design-principles.md#可选非侵入)）。
2. **npm 子路径**：安装 `threejson` 后按需引用，例如 `threejson/extensions/physics-rapier/bootstrapFromScene.js`。 tarball 内含参考代码 ≠ 默认启用。
3. **重依赖 optional peer**：如 `@dimforge/rapier3d-compat`、`echarts` 由**你的工程**安装；见根 [`package.json`](../../package.json) 的 `peerDependenciesMeta`。
4. **core 只约定 JSON 容器**：合并 `extensions` 映射、提供 `PluginHost` 与若干 registry；**不解析**各插件专有字段语义（[`core/util/extensionsUtil.js`](../../core/util/extensionsUtil.js)）。

## JSON 容器约定

### 场景级

`sceneConfig.extensions["<extensionId>"]` — 全局开关与参数（如重力、启用标志）。

友好 JSON 可写 `worldInfo.extensions`；归一化时合并进 `sceneConfig.extensions`（`worldInfo` 与 `sceneConfig` 同 id 时，**后者覆盖前者**）。

标准 JSON 也可在顶层写 `"extensions"`（与 `objectList` 并列），归一化后并入 `sceneConfig.extensions`。

### 物体级

在同一条 `objectList[]` / `boxModelList[]` 记录上：

```json
"extensions": {
  "physics-rapier": {
    "rigidBody": "dynamic",
    "collider": { "type": "box" }
  }
}
```

配置写在哪条物体 JSON 上，即隐含绑定该物体（由扩展 bootstrap 解释）。

### 示例 JSON

- 物理 / Rapier：[`assets/json/tutorial/track-04/04-02-plugin-physics.json`](../../assets/json/tutorial/track-04/04-02-plugin-physics.json)
- FPS 漫游：[`04-03-fps-walk.json`](../../assets/json/tutorial/track-04/04-03-fps-walk.json)

## 宿主接入三步

扩展**不会**在 `createJsonScene` 内部自动 bootstrap；宿主在场景部署完成后负责挂载。

1. **import** 扩展模块（及 WASM / 第三方库，如 `RAPIER`）。
2. 创建 **`pluginHost`**（可选但推荐），传入 `createJsonScene(..., { pluginHost })`。
3. 在 **`onSceneReady(ctx)`** 中读取 `ctx.scene` / `ctx.sceneJson` / `ctx.pluginHost`，调用扩展的 `bootstrapXxxFromScene` 或 `pluginHost.register(...)`。

### 最小示例（PluginHost + 场景就绪）

```js
import { createJsonScene } from "threejson";
import { createPluginHost } from "threejson/core"; // 或 threejson 若 re-export

const pluginHost = createPluginHost();

await createJsonScene(payload, {
  canvas,
  pluginHost,
  async onSceneReady(ctx) {
    // 例：await bootstrapPhysicsRapierFromScene({ ...ctx, pluginHost, RAPIER });
  }
});
```

`onSceneReady` 上下文常用字段见 [api.md · onSceneReady](./api.md#corehandlersceneLoadHandlerjs--onsceneready)。

读取 JSON 扩展块：

```js
import {
  resolveSceneExtensions,
  readExtensionConfig
} from "threejson/core";

const sceneConfig = ctx.sceneJson?.sceneConfig ?? {};
const worldInfo = ctx.sceneJson?.worldInfo ?? {};
const sceneExt = resolveSceneExtensions(sceneConfig, worldInfo)["my-extension-id"];

const objJson = mesh.userData.objJson;
const perObject = readExtensionConfig(objJson, "my-extension-id");
```

生命周期总线说明：[场景加载生命周期](./scene-load-lifecycle.md)。

### Rapier 物理（内置参考实现）

```js
import RAPIER from "@dimforge/rapier3d-compat";
import { bootstrapPhysicsRapierFromScene } from "threejson/extensions/physics-rapier/bootstrapFromScene.js";

await RAPIER.init();

await createJsonScene(payload, {
  canvas,
  pluginHost,
  async onSceneReady(ctx) {
    await bootstrapPhysicsRapierFromScene({
      scene: ctx.scene,
      sceneJson: ctx.sceneJson,
      pluginHost,
      RAPIER
    });
  }
});
```

API 与各键含义：[`extensions/physics-rapier/README.md`](../../extensions/physics-rapier/README.md)。

### 粒子 provider（registry 路径）

无需 `PluginHost` 时，可在页面入口 side-effect 注册：

```js
import "threejson/extensions/particle-nebula"; // 注册 provider: "nebula"
```

JSON 中 `objType: "points"`（粒子发射器）可设 `provider: "nebula"`。自定义 provider 使用 `registerParticleEmitterProvider(id, deployer)`（见 [`extensions/particle-nebula/`](../../extensions/particle-nebula/index.js) 骨架）。

## 内置参考实现索引

完整目录说明：[`extensions/README.md`](../../extensions/README.md)。

| extension id | 目录 | bootstrap / 入口 | Demo |
|--------------|------|------------------|------|
| `physics-rapier` | `extensions/physics-rapier/` | `bootstrapPhysicsRapierFromScene` | [04-02-plugin-physics.html](../../examples/html-demo/track-04-interaction/04-02-plugin-physics.html) |
| （演示）simple-gravity | `extensions/simple-gravity/` | `createSimpleGravityPlugin` + `pluginHost.register` | 同上页「简易重力」 |
| `fps-walk` | `extensions/fps-walk/` | `bootstrapFirstPersonExtensionsFromScene` | [04-03-fps-walk.html](../../examples/html-demo/track-04-interaction/04-03-fps-walk.html) |
| Rapier 第一人称 | `physics-rapier/firstPersonBridge.js` | `bootstrapRapierFirstPersonFromScene` | [04-05-fps-rapier-collision.html](../../examples/html-demo/track-04-interaction/04-05-fps-rapier-collision.html) |
| `stat-echarts` | `extensions/stat-echarts/` | `bootstrapFromScene`（配合 stat 域） | Track 6 `06-04-stat-chart-echarts.html` |
| `nebula`（provider） | `extensions/particle-nebula/` | `registerParticleEmitterProvider` | 见 api / json-format 粒子节 |

教程索引：[tutorial.md · Track 4](./tutorial.md)（运行时交互与扩展）。

**已迁入 core、不属于 extension 的**：可交互 `css3dPanel`（[`json-format`](./json-format.md)）、`sceneConfig.extensions.assetLibrary` 贴图缓存、`sceneConfig.extensions.nativeGeometries` 等由 core 在加载链处理。

## 编写自定义 extension

在**应用仓库**内新建模块即可（不必修改 `node_modules/threejson`）：

1. 选定 **extension id**（全局唯一字符串，勿与内置 id 冲突）。
2. 实现 **`bootstrapYourExtensionFromScene(ctx)`**（或页面 load 时 `pluginHost.register`）。
3. 在 JSON 中写 `sceneConfig.extensions["your-id"]` 和/或物体级 `extensions["your-id"]`。
4. 应用入口 import 并在 `onSceneReady` 调用 bootstrap。

也可复制 [`extensions/`](../../extensions/) 下示例到你的工程（如 `src/threejson-extensions/`），将 `../../core/` 改为 `threejson/core`。

### 其他 core 注册点（按场景选用）

| 机制 | 适用 |
|------|------|
| `createPluginHost().register` | 帧循环钩子（`beforePhysics`、`afterRender` 等） |
| `registerParticleEmitterProvider` | 粒子 `provider` 字段 |
| `registerControlsType` | 新 `controls.type` |
| `registerObjTypeDeployer` | 新 `objType` deploy（更接近 domain 边界，见 [design-principles](./design-principles.md)） |

### 独立 npm 包

可发布 `@acme/threejson-extension-foo`，在用户应用中 import 并 bootstrap。**本期无**与 domain 对称的 `add-extension` CLI / `threejson.extensions.mjs` 约定；评估见 [lab/third-party-extension-adoption-memo.md](../../lab/third-party-extension-adoption-memo.md)。

## 相关文档

- [JSON · extensions 字段](./json-format.md#可选扩展配置-extensions)
- [核心 API · PluginHost / extensionsUtil](./api.md#corepluginpluginhostjs)
- [能力范围 · PluginHost 与 extensions/](./scope.md)
- [设计原则 · Core 与 extensions 划界](./design-principles.md#core-与-extensions-的划界)
- [业务域（对比）](./domains.md)
- Lab 草案（与本文互补）：[extension-json.md](../../lab/extension-json.md)
