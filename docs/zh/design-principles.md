[中文](./design-principles.md) | [English](../en/design-principles.md)

# ThreeJSON 设计原则（贡献者与上游参考）

## 默认零心智

不使用的可选能力不应要求配置开关或初始化仪式。上游只加载自己需要的模块即可（例如 L3 Patch 使用 `threejson/patch` 子路径而非默认大包）。

## 规范真源与运行叠加层（「JSON 为王」的精确含义）

「JSON 为王」指 **规范真源（canonical descriptor）**：持久化、再加载、与声明式 core API（如 `descriptorSync`、L3 Patch）交互时，以 `userData.objJson` 及 `worldInfo` 中对应描述为准。这与 **运行叠加层（runtime overlay）** 不矛盾：游戏循环、物理、Mixer、脚本可直接改 `THREE.Object3D`，二者在时间上**不必逐帧相等**。

- **游戏 / 高频路径**：允许长期只维护运行态；在需要再次进入「以描述符为准」的 core 流程之前，宿主应调用 `reconcileTransformToDescriptor`（或等价批量提交），否则依赖 `objJson` 的路径可能读到陈旧值。详见 [`docs/scope.md`](./scope.md) 中的契约表。
- **声明式动画**：仍以 JSON `animations` 为配置真源；glTF 资产动画由 `AnimationMixer` 管线承担，由 `animationMode` 协调是否与声明式并存。

## 可选、非侵入

- **能力可拆**：物理、JSON Patch、插件等以独立模块或 `extensions/` 目录交付；core 主入口仅聚合稳定子集。`extensions/` 与 npm 可选 peer 心智一致：随仓维护的参考实现，semver 可与 core 脱钩，避免把具体引擎绑进默认包。
- **行为可预测**：未 import、未注册时，运行路径与历史版本一致，无隐式副作用。

## Core 与 extensions 的划界

下列原则用于判断新能力应进入 **core** 还是 **`extensions/`** / **宿主**，适用于任意需求（不限于某一类控制器或玩法）。与 [`docs/scope.md`](./scope.md) 中「明确不纳入 Core」的条目互补：后者列举典型**基础设施/产品层**（专网同步、ECS 框架、成品级编辑器 UI、反作弊等），本节给出**一般性判据**。

### 放进 core 时，通常应同时满足

| 判据 | 含义 |
|------|------|
| **声明式装配** | 可通过标准 / 友好 JSON、`objType` 或稳定的 runtime 描述符表达，并由加载链统一创建与更新。 |
| **跨业务通用** | 不依赖某一行业场景专有命名、专有 mesh 或专有业务流程（如仅适用于某港口 floor 的 refName 约定）。 |
| **无重依赖** | 不强制引入 WASM、大二进制或可选 peer；默认可在仅 Three.js + core 下工作。 |
| **薄封装 Three 惯例** | 对齐 Three.js 教程式用法（控制器、相机、灯光、帧循环），避免在 core 内再造游戏引擎或 ECS。 |
| **默认可关** | 符合「默认零心智」：未配置时不改变现有行为；新字段均为可选，不新增必填项。 |

典型归属 core 的能力：视口 `camera` / `renderer`、与场景查看相关的 `controls` 类型（如 orbit、第一人称漫游输入）、通用灯光与 `renderLoop`、从 JSON 装配场景图与对象身份、与描述符交互的 core API（`descriptorSync`、L3 Patch 子路径等）。

### 放进 extensions 或宿主时，通常具备其一即可

| 判据 | 含义 |
|------|------|
| **可替换后端** | 多种实现并存（如不同物理引擎）；core 只保留**稳定接口**（契约 + 降级），具体引擎在 `extensions/` 注册。 |
| **重依赖或大体量** | WASM、专用库、与 core semver 不宜强绑定的参考实现。 |
| **业务语义** | 与具体项目、domain、场景资源命名强绑定（如仅对某张业务地板贴地、与告警规则联动）。 |
| **玩法与基础设施** | 武器、伤害、匹配、反作弊、签名校验等；或 [`docs/scope.md`](./scope.md) 已列明的专网同步、ECS 产品化等。 |
| **集成页 / 产品 UI** | 仓库内演示页、编辑器壳层；作为示例或产品，而非默认库 API。 |

`extensions/` 的 JSON 容器约定见 [`docs/extensions.md`](./extensions.md) 与 [`lab/extension-json.md`](../../lab/extension-json.md)。

### 可拆 ≠ 该拆

能力**可以**拆进 extension，不代表**应该**默认外置。若属于「跨项目通用的场景查看 / 输入 / 装配」，放在 core 能减少宿主重复造轮子；若属于「重引擎或强业务」，外置以保持默认包稳定。core **不**追求成为完整游戏引擎；**应**把通用、可声明式装配的运行时能力做到 JSON 一等公民。

### 不锁死扩展

划界不意味着宿主只能使用 core 已实现的类型。下列出口应长期保留：

- **`controls.enabled: false`**（或等价项）：不创建库内控制器，由宿主完全接管输入。
- **仅加载场景图**：例如 `createJsonScene` 不传 canvas，或只部署内容，相机与控制器由宿主自建。
- **帧钩子与插件**：`beforeFrame` / `afterRender`、`PluginHost`、`sceneConfig.extensions`，用于叠加物理、玩法与自定义逻辑。
- **可扩展注册表**（按需）：如 `controls.type` 的 registry 允许扩展包或宿主注册新类型，而非写死枚举。

未 import、未注册扩展时，行为须与历史版本一致（见上一节「行为可预测」）。

## 对象注册表与「描述符 ↔ 场景」同步

- **`objectRegistry`**：定位为 **索引 + 生命周期**（`threeJsonId` / `uuid` / `name` / `refName` 等），不是承载所有业务命令的「上帝类」。命令式变换、Mixer 等走 `sceneRuntimeApi` 等专用入口。
- **双向同步**：Three.js 没有任意 JSON ↔ `Object3D` 全状态的内建 binding。全量实时监视成本高、默认应关闭；采用 **分级**（变换级轻量同步、白名单 + 节流、显式重建）并在文档中写清成本。实现细节见 `worldInfo.descriptorBinding` 与 [`sceneDescriptorBinding.js`](../../core/handler/sceneDescriptorBinding.js) 相关说明。

## core 源码目录：builder / handler / runtime（理想参照，非强制）

仓库内 `core/builder/`、`core/handler/`、`core/runtime/` 是**历史演进下的物理布局**，并**未**严格按职责拆清。下列分工是贡献者理解代码与放置**新模块**时的**倾向性参照**，不是必须满足的架构 law；违反不视为缺陷，也**不**以此为由要求大规模搬迁。

| 目录 | 理想职责 | 典型内容 |
|------|----------|----------|
| **`builder/`** | 从 JSON / 描述符 **创建** `Object3D` 并 **首次 deploy**（含 async 贴图、外部模型） | `createMesh`、`deployMesh`、`infoPanelBuilder`、`loadExternalModel` |
| **`runtime/`** | 场景 **已加载且对象已注册** 之后的变更 | `objectMutation`（`threejson/runtime-mutation`）、`sceneObjectCommands`、显隐/patch/redeploy 类 API |
| **`handler/`** | **编排与横切**：整场景 load/save、registry、域调度、帧循环、导入导出 | `sceneLoadHandler`、`objectRegistry`、`businessDomainRegistry`、`frameLoopHandler` |

要点：

- **`handler` 不是** DOM 事件 handler，而是 **Scene Engine / Pipeline**；其中仍含不少历史上放在 handler 的 post-load API（如 `infoPanelRuntime.js`），与理想态有偏差。
- **`builder` 与 `runtime` 不必一一配对**（例如不存在也不需要有完整的 `modelRuntime.js` 镜像 `modelBuilder.js`）。
- **Composition root** 仍在 handler 层（如 `sceneLoadHandler` 同时 import builder 与 `runtime/deployScheduler`），与 [BUSINESS_DOMAINS.md](../../core/BUSINESS_DOMAINS.md) 一致。

远期整理设想与盘点细节见 [`lab/core-layering-memo.md`](../../lab/core-layering-memo.md)（**非发布承诺**）。

## 标准 JSON 与用户友好 JSON（同级入口）

**标准 JSON** 与 **用户友好 JSON** 是两种**同等地位**的对外形态，并非「新取代旧」的关系。

- **标准 JSON**：以 **`objectList` + 顶层少量元信息** 表达整场景，用 **`objType`** 做统一分发；结构整齐划一，更适于程序处理、流水线工具与 **AI 生成** 等场景。
- **用户友好 JSON**：按人类习惯拆分、命名与分组（例如 `sceneConfig`、`worldInfo` 等常见布局）；便于阅读、手写与局部修改。**其字段与组织方式不是遗留或过渡格式。**

在 **core 内部**，用户友好 JSON 会在加载链上被 **翻译 / 归一** 为标准形态，再走同一套解析与装配；选用哪一种由团队与场景决定。字段说明与示例见 [`docs/json-format.md`](./json-format.md)。

## 安全与不可信输入（占位，非当前实现）

- 防作弊、签名校验、不可信 Patch 过滤等属于**独立专题**；若未来提供，应为 **显式启用** 的可选层，默认关闭。
- 从网络接收的 JSON Patch 或场景片段：**校验与来源认证由宿主或中间件负责**，ThreeJSON 不默认执行无白名单的任意 patch。

## 与 Three.js 的关系

ThreeJSON 旨在消化「用 JSON 描述 Three.js 场景」的重复劳动；不替代 Three.js 渲染管线，也不在 core 中绑定特定游戏架构（如完整 ECS）。

对齐惯例而非重复造轮：每帧钩子、变换、后处理 `EffectComposer`、原生 `AnimationMixer` 等优先按 Three.js 教程式用法使用；ThreeJSON 提供稳定身份、从 JSON 装配场景图，以及可选的写回与扩展挂载点。

## 依赖方向：core / domains / 宿主

下列约束说明 **谁可以 import 谁**、以及职责边界。与 [`core/BUSINESS_DOMAINS.md`](../../core/BUSINESS_DOMAINS.md) 的 Composition Root 说明互补。

1. **依赖单向**：`domains → core`；`宿主（含场景编辑器、RoomShow 等）→ core + domains`。禁止 `core → domains`（在 core 内 import 具体域模块）、禁止 `domains → 宿主`。
2. **core 可以且应当**承载跨域通用能力（加载、导出、编辑状态机、registry、mutation）。新增能力优先做成 **通用机制 + 注册钩子**，而非在 core 写死某一 `domain` 名。
3. **禁止 core 承载某一应用的交互细节**（弹窗文案、drill-in 手势、编辑器设置项）；这些留在宿主，core 只暴露中性 API（如 `assertSceneExportable`、`exportDeployRootDescriptor`）。
4. **调度契约**：core 调度只认 JSON 的 `domain` + `handler` 与 registry；业务差异在 `domains/*/index.js` 的 `api` 钩子中扩展。
5. **持久化形态**：authoritative 加载记录为 **instance-only** `persistSource`（每个 deploy 根一份）；core 不统一改写为 `items[]` bundle。
6. **编辑器与快照**：运行时真源是 Scene + `userData`；持久化出口是 `sceneToJson`；core 不必认识「编辑器」这一宿主概念。
7. **视觉常量**（颜色、透明度等）：**core** 仅在 [`core/theme/runtimeVisualDefaults.js`](../../core/theme/runtimeVisualDefaults.js) 集中定义 core 源码内实际使用的缺省值；**domains** 各自维护本域 palette（机柜壳体、门扇等域内专属色）；**宿主** 可 import core 与 domain 的导出常量，但不得将宿主或 domain 专属常量写入 core。当某一 domain **基于另一 domain 实现**（如 cabinet 委托 stat 绘制容量方柱、port 复用 stat 方柱样式）时，在创建或配置该依赖域对象时**应刻意 import 并应用被依赖域 palette 中的常量**，以保持视觉一致；业务上也可显式传入自定义颜色覆盖缺省。禁止的是无 compose 关系的 palette 交叉引用，以及 `core → domains` 反向依赖。

业务域扩展与 JSON 形态详见 [`docs/domains.md`](./domains.md)。
