[中文](./glossary.md) | [English](../en/glossary.md)

# ThreeJSON 术语对照表

[中文](./glossary.md) | [English](../en/glossary.md)

本页集中定义 ThreeJSON 文档与代码中**易混淆的关键概念**的中英对应与简要含义，供贡献者、翻译者与双轨文档读者对齐用词。

- **语言分层规则**（何处用中文/英文、是否做 UI i18n）见 [开发与工具链 · 语言与文档策略](./development.md#语言与文档策略)，**不是**本术语表。
- 专题文档中的局部定义（如 [编辑器选中](./editor-selection.md)）可链到此处；细节仍以专题为准。

## 架构与分层

| 中文 | English | 简要说明 | Brief definition | 锚点 |
|------|---------|----------|------------------|------|
| 引擎本体 / 库 | library (`core/`, `domains/`) | 可被任意 HTML 或 npm 工程 import 的 ESM 运行时；不依赖 Node | Browser/bundler ESM runtime importable by any host; no Node at runtime | [`docs/README.md`](./README.md) |
| 宿主 / 宿主应用 | host (application) | 使用本库的具体页面或产品（编辑器、RoomShow、业务大屏等），与库分层 | A concrete page or product that imports the library (editor, demos, dashboards) | [`docs/domains.md`](./domains.md#文档分层库-vs-应用) |
| 业务域 | business domain | `domains/<name>/` 下的可注册扩展模块，由 JSON `domain` + `handler` 调度 | Registered module under `domains/` dispatched via JSON `domain` + `handler` | [`docs/domains.md`](./domains.md#什么是-domain) |
| 扩展 | extension | `extensions/` 下可选、可替换后端的参考实现（如物理），semver 可与 core 脱钩 | Optional replaceable backends under `extensions/` (e.g. physics) | [`docs/extensions.md`](./extensions.md) |
| 正本 | canonical pages | [`tools/scene-host/`](../../tools/scene-host/) 编辑器 / 播放器；当前稳定推荐入口（历史单文件版本已退役归档至 [`tools/old_version/`](../../tools/old_version/)） | [`tools/scene-host/`](../../tools/scene-host/) editor / player; current stable entry (the legacy single-file pages are retired to [`tools/old_version/`](../../tools/old_version/)) | [`docs/tools.md`](./tools.md#scene-host正式版) |
| 绿场（历史术语） | greenfield (historical) | `tools/scene-host/` 对旧版单文件正本的模块化拆分重构，Phase 5 切换已完成，现即「正本」 | Modular refactor of the old single-file pages under `tools/scene-host/`; Phase 5 switchover is complete and it is now the canonical pages | [`docs/tools.md`](./tools.md) |
| 集成页 / 业务演示页 | integrated demo page | 如 `room-show.html`、`port-show.html`；展示行业场景，非库 API 本身 | Industry showcase pages (e.g. room-show, port-show), not library API | [`docs/tools.md`](./tools.md) |
| 默认零心智 | zero mental overhead by default | 未使用的可选能力不要求配置或初始化仪式 | Unused optional features need no config or init ceremony | [`docs/design-principles.md`](./design-principles.md#默认零心智) |
| 组合根 | composition root | 编排 builder、runtime、domain 注册的入口（如 `sceneLoadHandler`） | Entry that orchestrates builders, runtime, and domain registration | [`core/BUSINESS_DOMAINS.md`](../../core/BUSINESS_DOMAINS.md) |

## 数据契约与 JSON 形态

| 中文 | English | 简要说明 | Brief definition | 锚点 |
|------|---------|----------|------------------|------|
| 规范真源 | canonical descriptor / canonical source | 持久化、再加载及与 `descriptorSync`/Patch 交互时，以 `userData.objJson` 等描述为准 | Authoritative JSON in `userData.objJson` (and matching `worldInfo`) for persist/reload/sync | [`docs/scope.md`](./scope.md#规范真源canonical与运行时叠加层runtime) |
| 运行叠加层 | runtime overlay | 游戏循环、物理、脚本等直接改 `Object3D`；不必每帧与 JSON 一致 | Direct `Object3D` mutations in loops/scripts; need not match JSON every frame | [`docs/scope.md`](./scope.md#规范真源canonical与运行时叠加层runtime) |
| JSON 为王 | JSON is canonical (precise sense) | 指规范真源语义，**不**否认运行叠加层的存在 | Means canonical descriptor semantics, not “JSON equals scene every frame” | [`docs/design-principles.md`](./design-principles.md#规范真源与运行叠加层json-为王的精确含义) |
| 描述符 | descriptor | 对象的 JSON 记录或归一化后的配置片段（常指单条 `objJson`） | Object JSON record or normalized config slice (often one `objJson`) | [`docs/json-format.md`](./json-format.md) |
| 标准 JSON | standard JSON | `objectList` + `objType` 统一分发的整场景形态；适于程序与 AI | Whole-scene form with `objectList` + `objType` dispatch | [`docs/design-principles.md`](./design-principles.md#标准-json-与用户友好-json同级入口) |
| 用户友好 JSON | user-friendly JSON | `worldInfo` 分列表（如 `boxModelList`）的人类可读形态；与标准 JSON **同级** | Human-oriented lists under `worldInfo`; **equal** status to standard JSON | [`docs/design-principles.md`](./design-principles.md#标准-json-与用户友好-json同级入口) |
| 归一化 | normalization | 加载链上将友好 JSON 翻译为标准形态再走同一装配管线 | Load pipeline translates friendly JSON to standard form before deploy | [`docs/json-format.md`](./json-format.md) |
| 持久化源 | `persistSource` | 每个 deploy 根一份的 instance-only 加载记录；core 不统一改为 `items[]` bundle | Per deploy-root instance-only persist record | [`docs/design-principles.md`](./design-principles.md#依赖方向coredomains-宿主) |
| 场景包 / 内存场景 | in-memory scene package | 宿主 `sysConfig.jsonData` 等会话内完整场景，导出时走 `sceneToJson` | Full scene held in host memory; export via `sceneToJson` | [`docs/tools.md`](./tools.md#sceneconfig-与-sysconfig) |

## `core/` 目录分工（理想参照，非强制）

| 中文 | English | 简要说明 | Brief definition | 锚点 |
|------|---------|----------|------------------|------|
| 构建器 | builder (`core/builder/`) | 从 JSON **创建** `Object3D` 并 **首次 deploy**（含 async 贴图、外部模型） | Create `Object3D` from JSON and **first deploy** | [`docs/design-principles.md`](./design-principles.md#core-源码目录builder--handler--runtime理想参照非强制) |
| 编排 / 管线 | handler (`core/handler/`) | **Scene engine / pipeline**：整场景 load/save、registry、域调度、帧循环（**非** DOM 事件 handler） | Scene load/save, registry, domain dispatch, frame loop (**not** DOM handlers) | [`docs/design-principles.md`](./design-principles.md#core-源码目录builder--handler--runtime理想参照非强制) |
| 运行变更 | runtime (`core/runtime/`) | 场景已加载、对象已注册后的 mutation（patch、显隐、redeploy 等） | Post-load mutations after objects are registered | [`docs/runtime-object-mutation-quickref.md`](./runtime-object-mutation-quickref.md) |
| 部署 | deploy | 根据描述符创建并 `scene.add` 对象（首次或 subScene 内） | Create from descriptor and add to scene | `deployMesh`, `deployInfoPanel`, `createJsonScene` |
| 再部署 | redeploy | 结构级字段变更后重建对象（`needsRedeploy: true`） | Rebuild object after structural field changes | [`docs/runtime-object-mutation-quickref.md`](./runtime-object-mutation-quickref.md#needsredeploy-怎么处理) |
| 写回描述符 | reconcile / write-back | 将 `Object3D` 变换等同步回 `objJson`（如 `reconcileTransformToDescriptor`） | Sync transforms from `Object3D` back into `objJson` | [`docs/scope.md`](./scope.md) |
| 整场景加载 | scene ingest / `createJsonScene` | 归一化 payload、deploy 内容、注册对象、启动循环等完整加载链 | Full load pipeline: normalize, deploy, register, loop | [`docs/api.md`](./api.md) |
| 对象注册表 | `objectRegistry` | `threeJsonId` / `uuid` / `name` / `refName` 索引与生命周期，非“上帝命令类” | Index + lifecycle for object ids; not a god-object for all commands | [`docs/design-principles.md`](./design-principles.md#对象注册表与描述符--场景同步) |

## 身份与对象字段

| 中文 | English | 简要说明 | Brief definition | 锚点 |
|------|---------|----------|------------------|------|
| ThreeJSON 对象 ID | `threeJsonId` | 场景内稳定的业务主键，mutation/API 常用 | Stable in-scene id for APIs and mutation | [`docs/runtime-object-mutation-quickref.md`](./runtime-object-mutation-quickref.md) |
| 引用名 | `refName` | 跨记录引用、域内约定的逻辑名 | Logical name for cross-record references | [`docs/scope.md`](./scope.md) |
| 对象类型 | `objType` | 标准 JSON 分发键（`box`、`infoPanel`、`domain` 等） | Dispatch key in standard JSON | [`docs/json-format.md`](./json-format.md) |
| 子场景 | `subScene` | 可嵌套容器（如 group）内子对象列表；group 上勿用已废弃的 `boxModelList` | Nested child list on containers; prefer over legacy group fields | [`docs/json-format.md`](./json-format.md) |
| 域记录 | domain record | `objType: "domain"` 或友好 JSON `domainModelList` 条目 | Entry routed to a registered business domain | [`docs/domains.md`](./domains.md) |

## 宿主配置

| 中文 | English | 简要说明 | Brief definition | 锚点 |
|------|---------|----------|------------------|------|
| 场景配置 | `sceneConfig` | 写在场景 JSON 内、**core 会读取**的运行时/视口等契约 | JSON-embedded config read by **core** | [`docs/tools.md`](./tools.md#sceneconfig-与-sysconfig) |
| 系统配置 | `sysConfig` | 各 HTML 页内联对象；core **不读**；镜像 `sceneConfig` 子集并含编辑器设置 | Per-page inline object; **not** read by core | [`docs/tools.md`](./tools.md#sceneconfig-与-sysconfig) |
| 世界信息 | `worldInfo` | 友好 JSON 中场景内容与列表的常用容器 | Common friendly-JSON container for scene content lists | [`docs/json-format.md`](./json-format.md) |

## 可视化与交互（选中 / 面板）

| 中文 | English | 简要说明 | Brief definition | 锚点 |
|------|---------|----------|------------------|------|
| 描边 | outline (editor) | 编辑器专用 `THREE.BoxHelper`，固定色 `#E59520`；**不是**业务高亮 | Editor-only `BoxHelper` (#E59520); **not** business highlight | [`docs/editor-selection.md`](./editor-selection.md#术语) |
| 高亮 | highlight (`OutlinePass`) | 后处理描边通道：`info` / `locate` / `alarm` | Post-process outline channels: info / locate / alarm | [`docs/editor-selection.md`](./editor-selection.md#术语) |
| 信息面板 | `infoPanel` | 静态贴图标牌（text/html/img）；`objType` 或 `infoPanelList` | Static texture signage; `objType` or `infoPanelList` | [`docs/info-panels.md`](./info-panels.md) |
| CSS3D 面板 | `css3dPanel` | 真实 DOM 叠在 WebGL 上，可点击/输入 | Real DOM over WebGL; interactive | [`docs/info-panels.md`](./info-panels.md) |
| 场景文字 | `text` (`objType: text`) | 无强制背板的 SDF/贴图/mesh 文字 | Text entity without required backing panel | [`docs/info-panels.md`](./info-panels.md) |
| 精灵标记 | `sprite` | 单张贴图标记点（非多行文本面板） | Single-texture marker icon | [`docs/info-panels.md`](./info-panels.md) |
| 设备面板 | `devicePanel` | 设备域绑定的面板；运行时 `Object3D.name` 批量显隐键 | Device-bound panel; batch visibility via `name: "devicePanel"` | [`docs/api.md`](./api.md#domainsdevice-设备面板) |
| 机柜编号面板 | `cabNumPanel` | 机柜门编号标签专用 `name`；与 `infoPanel` 区分以免被 `clearView` 误隐藏 | Cabinet door number labels; distinct from `infoPanel` | [`docs/api.md`](./api.md#domainsdevice-设备面板) |
| 设备面板引用 | `devicePanelRef` | 指向面板 `threeJsonId` 的运行时真源；优先级高于内嵌 `info`/`infoPanel` | Points to panel `threeJsonId`; overrides inline definitions | [`docs/api.md`](./api.md#domainsdevice-设备面板) |

## 运行时变更 API

| 中文 | English | 简要说明 | Brief definition | 锚点 |
|------|---------|----------|------------------|------|
| 单路径变更 | `applyObjectChange` | 按 path 改单字段；默认 strict | Single-field change by path; strict by default | [`docs/runtime-object-mutation-quickref.md`](./runtime-object-mutation-quickref.md) |
| 局部合并 | `applyObjectPartial` | 多字段 partial merge；同步不等贴图 | Multi-field partial merge; sync, no texture wait | 同上 |
| 快照 | snapshot (`captureObjectSnapshot`) | 捕获可回滚的 descriptor 片段 | Captured descriptor slice for undo/rollback | 同上 |
| 描述符同步 | `descriptorSync` | 描述符局部合并、脏标记、与绑定协作 | Descriptor merge, dirty flags, binding cooperation | [`docs/scope.md`](./scope.md) |
| L3 Patch | L3 JSON Patch | 按需 `threejson/patch`；RFC 6902 式白名单 patch | Opt-in `threejson/patch`; whitelisted RFC 6902 ops | [`docs/scope.md`](./scope.md) |

## 文档与国际化

| 中文 | English | 简要说明 | Brief definition | 锚点 |
|------|---------|----------|------------------|------|
| 语言与文档策略 | language & documentation policy | 各层用什么语言、哪些页面冻结 i18n 的**规则** | Rules for language per layer and frozen i18n pages | [`docs/development.md`](./development.md#语言与文档策略) |
| 术语对照表 | terminology glossary | 本页；关键概念的**中英名与定义**，非 UI 文案表 | This page; concept names and definitions, not UI strings | 本页 |
| 应用层 i18n | application i18n | `tools/scene-host` 等 UI 的 `zh-CN` / `en-US` 运行时翻译 | Runtime UI locales in scene-host etc. | [`tools/scene-host/shared/i18n/`](../../tools/scene-host/shared/i18n/) |
| 双轨文档 | bilingual doc track | `docs/` 中文 + `docs/en/` 英文镜像 | Chinese `docs/` plus English `docs/en/` mirrors | [`docs/en/README.md`](../en/README.md) |

---

维护建议：新增跨文档概念时在此补一行，并在专题文档首次出现处链到本页对应小节。
