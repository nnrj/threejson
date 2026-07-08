# Runtime 对象与「特殊对待」备忘

> **非发布承诺**（`idea`）。记录当前 JSON schema 与加载实现之间的差异，供后续评估是否将 runtime 项统一为 `objType` + registry。划界原则见 [`docs/zh/design-principles.md`](../docs/zh/design-principles.md) §Core 与 extensions 的划界。

## 背景

标准 JSON 已在 `objectList` 中声明 `scene`、`camera`、`renderer`、`controls`、`light`、`renderLoop` 等 **runtime objType**，但加载时多由 `createSceneRuntime` + `apply*Config` **硬编码** Three 类名；这些对象**不**进入 `objectRegistry`（它们不是场景图上的 `Object3D`），也缺少与内容物 `box` / `domain` 相同的 builder 分发。

若未来重复逻辑增多、或需要从 JSON Patch 修改 viewport / 输入，应评估 **通用化 / objType 化**，而不是在单点继续堆分支。

## 已是 runtime objType、实现仍硬编码

| objType | Three 对应 | 主要硬编码位置 | 待进一步评估 |
|---------|------------|----------------|--------------|
| `scene` | `Scene` + backdrop | `sceneRuntimeHandler`, `sceneBackdropResolver` | 异步背景是否独立描述 |
| `camera` | 仅 `PerspectiveCamera` | `createCamera` | 是否支持 `OrthographicCamera` |
| `renderer` | `WebGLRenderer` | `createRenderer` | |
| `controls` | 当前仅 `OrbitControls` | `createControls` → 计划改为 `controlsRegistry` | `firstPerson`、`fly` 等 |
| `light` | Ambient / Directional / Point / Spot | `createManagedLight` | |
| `renderLoop` | rAF 循环配置 | `frameLoopHandler` | 非 Three 对象 |

相关常量：`core/handler/sceneLoadHandler.js` → `CANONICAL_RUNTIME_OBJ_TYPES`。拆分逻辑：`sceneFriendlyNormalizer.js` → `splitCanonicalObjectList`。

## 未做成 objType、由页面或选项注入

| 能力 | 现状 | objType 化（待评估） |
|------|------|----------------------|
| `EffectComposer` / 后处理链 | `createSceneRuntime({ composer })` 或页面自建 | 复杂度高；或 `postProcessing` |
| `TransformControls` |  mainly `scene-editor.html` | 编辑器专用，可不进玩家/FPS 主线 |
| `FlyControls` / `MapControls` | 未使用 | 可作为 `controls.type` 扩展 |
| `PointerLockControls` | 未使用 | 计划纳入 `controls.type: "firstPerson"` |
| `TWEEN` | 部分 demo | 声明式 `animations` 已覆盖主路径 |
| `PluginHost` / `extensions` | `sceneConfig.extensions` | 容器已约定 |
| `CSS3DRenderer` | `core/builder/css3d`（`css3dPanel` + 双 pass） | 静态标牌仍用 `infoPanel`；可交互 DOM 走 core `css3dPanel` |

## 易混淆

- **`deviceCamera` 等业务模型**：场景**内容** mesh（如监控摄像头），不是视口 `objType: "camera"`。

## 集成页历史路径（并存，非两套 core 分发器）

| 页面 | 运行时创建方式 | controls 来源 |
|------|----------------|---------------|
| `port-show.html` | `createJsonScene` | JSON / `sceneConfig` 合并，经 core 归一化 |
| `room-show.html` | `createSceneRuntime` | 页面 JS 写死 Orbit 参数，不读 JSON `controls` |

实施后 core 内仅 **一个** `controlsRegistry`；各页面是否走 JSON 由页面调用方式决定，见第一人称方案计划。

## 建议的退出条件（何时做 runtime 全面通用化）

- 第三种以上 `controls.type` 或 runtime 配置重复代码明显增多；
- 需要从 JSON Patch 修改 runtime 对象；
- AI / 流水线要求统一描述 viewport + 输入 + 循环。

在此之前：**优先 `controls` registry**；其余 runtime 项 **按需再评估**。

## 相关文档与计划

- [`docs/zh/design-principles.md`](../docs/zh/design-principles.md) — Core 与 extensions 划界
- [`lab/extension-json.md`](./extension-json.md) — 扩展 JSON 容器
- 第一人称 / 漫游实现计划（`.cursor/plans` 或贡献者本地 plan 文件）
