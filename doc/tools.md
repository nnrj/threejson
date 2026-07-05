# ThreeJSON 工具与宿主应用

[调用者手册目录](./README.md) | [JSON 配置手册](./json-format.md)（core 契约） | [外置工具链 README](../tools/README.md)

本文描述**基于 ThreeJSON core 的宿主应用**（场景编辑器、播放器、演示页等）与 **`sysConfig`** 的约定。Core 调用者只需阅读 [`json-format.md`](./json-format.md) 与 [`api.md`](./api.md)；本文不替代 core 文档。

远期规划中，根目录 `scene-editor.html` / `scene-player.html` 的逻辑将迁入 [`tools/scene-host/`](../tools/scene-host/)（契约不变）。**当前阶段仍以根 HTML 为正本**；绿场为拆分重构版，尚在对齐与调试中。

## scene-host 绿场（拆分重构 · 对齐中）

[`tools/scene-host/`](../tools/scene-host/) 是 [`scene-editor.html`](../scene-editor.html)、[`scene-player.html`](../scene-player.html) 的**模块化拆分重构**，从正本复制逻辑后整理，与正本**代码不耦合**（拆分期不修改正本 HTML 与 [`tools/common/editor-single/`](../tools/common/editor-single/)）。

| 入口 | 路径 | 状态 |
|------|------|------|
| **正本** 编辑器 | [`scene-editor.html`](../scene-editor.html) | **稳定版（当前推荐）** |
| **正本** 播放器 | [`scene-player.html`](../scene-player.html) | **稳定版（当前推荐）** |
| 绿场 编辑器 | [`tools/scene-host/editor/index.html`](../tools/scene-host/editor/index.html) | 对齐与调试中 |
| 绿场 播放器 | [`tools/scene-host/player/index.html`](../tools/scene-host/player/index.html) | 对齐与调试中 |
| 绿场 Desktop | [`tools/scene-host/desktop/README.md`](../tools/scene-host/desktop/README.md) | `npm run start:editor` / `start:player` |
| 说明 | [`tools/scene-host/README.md`](../tools/scene-host/README.md) | — |

绿场与正本 **共用** settings / localStorage / 播放列表等存储（同 key、同 `setting.json` 路径），便于并行对照。验收完成前，文档、教程与默认书签仍以 **正本 HTML** 为准。

## 生态概览

| 组件 | 路径 | 说明 |
|------|------|------|
| 场景编辑器（**正本**） | [`scene-editor.html`](../scene-editor.html) | 通用场景编辑、保存、AI、命令层；**当前稳定版** |
| 场景播放器（**正本**） | [`scene-player.html`](../scene-player.html) | 播放列表、巡检；**当前稳定版** |
| 编辑器 / 播放器（**绿场**） | [`tools/scene-host/`](../tools/scene-host/README.md) | 正本的拆分重构；对齐与调试中 |
| 编辑器命令层 | [`tools/common/editor-single/command/`](../tools/common/editor-single/command/) | `editor.*` 命令，供 HTML 接入 |
| 业务演示 | [`room-show.html`](../room-show.html)、[`port-show.html`](../port-show.html) 等 | 机房/港口等业务大屏 |
| 外置 Agent / MCP | [`tools/threejson-agent/`](../tools/threejson-agent/README.md)、[`doc/mcp-cursor.md`](./mcp-cursor.md) | 不依赖页面 `sysConfig` |

## `sceneConfig` 与 `sysConfig`

| | `sceneConfig` | `sysConfig` |
|---|---------------|-------------|
| 层级 | 场景 JSON 内（`payload.sceneConfig`） | 各 HTML 页内联对象 |
| core 是否读取 | **是**（`normalizeScenePayload` → `createJsonScene`） | **否** |
| 持久化 | 随场景保存/导出 | 会话级；`jsonData` 为内存中的完整场景包 |

### 合并契约（工具加载场景时）

对**可通用**配置（任何带 canvas 的宿主都能用）：

1. **`sceneConfig` 为契约超集** — 第三方只读 JSON 即可。
2. **`sysConfig` 镜像子集** — 提供 settings 同步后的运行时值；**不删除**已有字段。
3. **优先级**：

```
sceneConfig / JSON 显式字段
  →（缺字段时）sysConfig / editorSettings / playerSettings
  → createJsonScene options / runtimeDefaults / 引擎默认
```

4. **视口集成**：`canvasWidth` / `canvasHeight` 可选写在 JSON；工具用 `sysConfig` 跟踪容器尺寸，**仅当 JSON 未写时**注入。运行中默认 `autoResize: true`，画面跟 canvas DOM 尺寸（工具 `windowResize` 亦会 `renderLoop.resize`）。

实现入口：`buildEditorRuntimeConfig` / `buildPlayerRuntimeConfig`（`scene-editor.html`、`scene-player.html`）。

**canonical 纯 `objectList`**（无顶层 `sceneConfig`）：不注入 `sceneConfig` 对象；渲染类 settings 经 **`createJsonScene` options** 传入。

### settings 与 JSON：A / B / C（优先级语义）

| 类型 | 行为 | 示例 |
|------|------|------|
| **A. 兜底** | JSON 有值则 JSON 赢 | 抗锯齿、FPS、`controls.autoRotate`（文案：「可被场景 JSON 覆盖」） |
| **B. 加载策略** | `createJsonScene` options | `autoFillLights`、`autoFitCamera`（auto/off/prompt） |
| **C. 显式压过 JSON** | 独立 checkbox + hint | `deployAutoFitOverrideExplicitCamera`、`overrideSceneRenderLoop`（覆盖 JSON 的 fps/lowFps） |

补充：`earlyRenderWhileLoading` 为宿主渲染体验开关（默认开启），仅控制加载阶段是否提前启动 renderLoop，不改变场景 JSON 内容与持久化语义。

不为每个 `sceneConfig` 字段增加「取代 JSON」复选框。远期分类级总开关见 [`lab/sysconfig-sceneconfig-settings-memo.md`](../lab/sysconfig-sceneconfig-settings-memo.md)（**本期不实现**）。

### 配置归属：A / B / C（配置语义）

> 为避免与上节「settings 优先级 A/B/C」混淆，本节定义的是**配置归属语义**：
> 哪些应该进 JSON，哪些仅是加载策略，哪些仅是宿主会话态。

| 类 | 名称 | 生效阶段 | 典型载体 | 是否应默认持久化进场景 JSON |
|----|------|----------|----------|------------------------------|
| **A** | 部署/渲染链参数 | `normalizeScenePayload` → `createJsonScene` 部署链 | `sceneConfig.*`（或标准 JSON runtime 等价） | **是** |
| **B** | 加载策略参数 | `createJsonScene(payload, options)` | `editorSettings/playerSettings` → options | **否**（除非作者显式写 `runtimeDefaults`） |
| **C** | 宿主会话/方法参数 | 页面运行中调用 | `sysConfig`、DOM 事件、`renderLoop.resize()` 等 | **否** |

#### 两个常见易混项

| 项 | 归属 | 说明 |
|----|------|------|
| `sceneConfig.helpers.grid/axes` | A | 场景内 `GridHelper/AxesHelper`，随场景可保存 |
| `editorSettings.editing.showGridHelper`（editorOnly 网格） | C | 仅编辑器参考网格，不属于场景内容，不进 JSON |

#### `canvasWidth/canvasHeight` 的边界说明

- 作为 JSON/`sceneConfig` 字段时，语义是**初始视口 hint**（A）。
- 运行中画布尺寸仍由 `autoResize` + 宿主 resize 路径控制（C）。
- 因此不要求每个场景必须写 `canvasWidth/Height`，缺省时可由宿主容器尺寸兜底。

### 工具专有（仅 `sysConfig`）

不要求 `sceneConfig` 支持：`jsonData`、`sceneLocked`、`dragLocked`、`meshObjects`、`meshList`、`initFlags`、`callFlags`、`progressFlag`、`clickHighLightFlag`、`optimizeJson` 等。

### `sysConfig.jsonData` 与保存

- 编辑器 `sceneToJson` 的 merge 基座为 `sysConfig.jsonData`（见 [`api.md`](./api.md)）。
- 持久化细节：[`lab/scene-canonical-collect-roadmap.md`](../lab/scene-canonical-collect-roadmap.md)。

## 场景编辑器 / 播放器要点

- **Settings 存储**：编辑器 `localStorage` + [`assets/json/other/scene-editor/setting.json`](../assets/json/other/scene-editor/setting.json) 模板；播放器同类。
- **加载管线**：`sysConfig.jsonData` → `build*ScenePayload()` → `createJsonScene`。
- **场景管理 UI**：读写 `payload.sceneConfig`（含 `helpers.grid/axes.visible`、`controls.autoRotate` 等）；「应用到画布」触发重新加载。

## 相关文档

| 文档 | 说明 |
|------|------|
| [`editor-selection.md`](./editor-selection.md) | 描边 vs 后处理高亮 |
| [`json-templates/README.md`](./json-templates/README.md) | 手写场景模板 |
| [`demos.md`](./demos.md) | 演示页索引 |
| [`tutorial.md`](./tutorial.md) | 教程 t05-03 / t05-04 |
| [`tools/common/editor-single/README.md`](../tools/common/editor-single/README.md) | `editor.*` 命令接线 |
| [`lab/sysConfig-vs-sceneConfig-assessment.md`](../lab/sysConfig-vs-sceneConfig-assessment.md) | 完整评估与字段对照 |

## 与 core 文档的边界

- **场景语义**（相机、灯光、背景、helpers、deployScheduler）→ 写 `sceneConfig`，见 [`json-format.md`](./json-format.md)。
- **页面 UI**（告警列表、侧栏开关等）→ 不写场景 JSON；见 [`lab/standard-json-shape-proposal.md`](../lab/standard-json-shape-proposal.md) §10b。
