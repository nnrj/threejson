# ThreeJSON Terminology Glossary

[中文](../glossary.md) | [English](./glossary.md)

This page defines **key concepts** used across ThreeJSON docs and code—Chinese/English term pairs and short definitions—so contributors, translators, and readers of both doc tracks stay aligned.

- **Language rules** (which layer uses which language, which pages skip UI i18n) live in [Development · Language and documentation policy](./development.md#language-and-documentation-policy)—that is **policy**, not this glossary.
- Topic docs (e.g. [Editor selection](../editor-selection.md)) may link here; details remain in those topics.

## Architecture and layers

| English | 中文 | Brief definition | 简要说明 | Anchor |
|---------|------|------------------|----------|--------|
| library (`core/`, `domains/`) | 引擎本体 / 库 | Browser/bundler ESM runtime importable by any host; no Node at runtime | 可被任意 HTML 或 npm 工程 import 的 ESM 运行时 | [`doc/README.md`](./README.md) |
| host (application) | 宿主 / 宿主应用 | Concrete page or product that imports the library | 使用本库的具体页面或产品 | [`doc/domains.md`](./domains.md) |
| business domain | 业务域 | Registered module under `domains/` dispatched via JSON `domain` + `handler` | `domains/<name>/` 下的可注册扩展模块 | [`doc/domains.md`](./domains.md) |
| extension | 扩展 | Optional replaceable backends under `extensions/` | `extensions/` 下可选参考实现 | [`doc/extensions.md`](./extensions.md) |
| canonical pages | 正本 | Root `scene-editor.html` / `scene-player.html`; current stable entry | 根目录编辑器/播放器稳定入口 | [`doc/tools.md`](./tools.md) |
| greenfield (`scene-host`) | 绿场 | Modular refactor of canonical pages under `tools/scene-host/` | 正本的模块化拆分重构 | [`doc/tools.md`](./tools.md) |
| integrated demo page | 集成页 / 业务演示页 | Industry showcase pages (room-show, port-show), not library API | 行业场景演示页 | [`doc/tools.md`](./tools.md) |
| zero mental overhead by default | 默认零心智 | Unused optional features need no config or init ceremony | 未用能力不要求配置仪式 | [`doc/design-principles.md`](./design-principles.md) |
| composition root | 组合根 | Entry orchestrating builders, runtime, domain registration | 编排加载与注册的入口 | [`core/BUSINESS_DOMAINS.md`](../../core/BUSINESS_DOMAINS.md) |

## Data contract and JSON shapes

| English | 中文 | Brief definition | 简要说明 | Anchor |
|---------|------|------------------|----------|--------|
| canonical descriptor / canonical source | 规范真源 | Authoritative JSON in `userData.objJson` for persist/reload/sync | 持久化与同步以 `objJson` 为准 | [`doc/scope.md`](./scope.md) |
| runtime overlay | 运行叠加层 | Direct `Object3D` mutations; need not match JSON every frame | 运行态可直接改 Object3D | [`doc/scope.md`](./scope.md) |
| JSON is canonical (precise sense) | JSON 为王 | Canonical descriptor semantics, not “JSON equals scene every frame” | 指规范真源，非逐帧相等 | [`doc/design-principles.md`](./design-principles.md) |
| descriptor | 描述符 | Object JSON record or normalized config slice | 单条对象 JSON 记录 | [`doc/json-format.md`](./json-format.md) |
| standard JSON | 标准 JSON | Whole-scene form with `objectList` + `objType` dispatch | `objectList` + `objType` 形态 | [`doc/design-principles.md`](./design-principles.md) |
| user-friendly JSON | 用户友好 JSON | Human-oriented lists under `worldInfo`; equal to standard JSON | `worldInfo` 分列表形态 | [`doc/design-principles.md`](./design-principles.md) |
| normalization | 归一化 | Friendly JSON translated to standard form before deploy | 加载链翻译为标准形态 | [`doc/json-format.md`](./json-format.md) |
| `persistSource` | 持久化源 | Per deploy-root instance-only persist record | 每 deploy 根一份 instance 记录 | [`doc/design-principles.md`](./design-principles.md) |
| in-memory scene package | 场景包 / 内存场景 | Full scene in host memory; export via `sceneToJson` | 宿主会话内完整场景 | [`doc/tools.md`](./tools.md) |

## `core/` layout (ideal reference, not mandatory)

| English | 中文 | Brief definition | 简要说明 | Anchor |
|---------|------|------------------|----------|--------|
| builder | 构建器 | Create `Object3D` from JSON and first deploy | 创建 Object3D 并首次 deploy | [`doc/design-principles.md`](./design-principles.md) |
| handler (scene engine) | 编排 / 管线 | Scene load/save, registry, dispatch, frame loop (**not** DOM handlers) | Scene pipeline，非 DOM handler | [`doc/design-principles.md`](./design-principles.md) |
| runtime | 运行变更 | Post-load mutations after registration | 已加载后的 mutation | [`doc/runtime-object-mutation-quickref.md`](./runtime-object-mutation-quickref.md) |
| deploy | 部署 | Create from descriptor and add to scene | 描述符 → scene.add | `deployMesh`, `createJsonScene` |
| redeploy | 再部署 | Rebuild after structural changes (`needsRedeploy`) | 结构变更后重建 | [`doc/runtime-object-mutation-quickref.md`](./runtime-object-mutation-quickref.md) |
| reconcile / write-back | 写回描述符 | Sync `Object3D` state back into `objJson` | 运行态写回 JSON | [`doc/scope.md`](./scope.md) |
| scene ingest / `createJsonScene` | 整场景加载 | Full load: normalize, deploy, register, loop | 完整加载链 | [`doc/api.md`](./api.md) |
| `objectRegistry` | 对象注册表 | Index + lifecycle for ids; not a god command object | 索引与生命周期 | [`doc/design-principles.md`](./design-principles.md) |

## Identity and object fields

| English | 中文 | Brief definition | 简要说明 | Anchor |
|---------|------|------------------|----------|--------|
| `threeJsonId` | ThreeJSON 对象 ID | Stable in-scene id for APIs | mutation/API 主键 | [`doc/runtime-object-mutation-quickref.md`](./runtime-object-mutation-quickref.md) |
| `refName` | 引用名 | Logical name for cross-record references | 跨记录逻辑名 | [`doc/scope.md`](./scope.md) |
| `objType` | 对象类型 | Dispatch key in standard JSON | 标准 JSON 分发键 | [`doc/json-format.md`](./json-format.md) |
| `subScene` | 子场景 | Nested children on containers | 容器内嵌子对象列表 | [`doc/json-format.md`](./json-format.md) |
| domain record | 域记录 | Entry routed to a business domain | 域调度条目 | [`doc/domains.md`](./domains.md) |

## Host configuration

| English | 中文 | Brief definition | 简要说明 | Anchor |
|---------|------|------------------|----------|--------|
| `sceneConfig` | 场景配置 | JSON-embedded config read by core | core 读取的场景 JSON 配置 | [`doc/tools.md`](./tools.md) |
| `sysConfig` | 系统配置 | Per-page inline object; not read by core | 页内配置，core 不读 | [`doc/tools.md`](./tools.md) |
| `worldInfo` | 世界信息 | Friendly-JSON container for content lists | 友好 JSON 内容容器 | [`doc/json-format.md`](./json-format.md) |

## Visualization and interaction

| English | 中文 | Brief definition | 简要说明 | Anchor |
|---------|------|------------------|----------|--------|
| outline (editor) | 描边 | Editor-only `BoxHelper` (#E59520) | 编辑器 BoxHelper | [`doc/editor-selection.md`](../editor-selection.md) |
| highlight (`OutlinePass`) | 高亮 | Post-process channels: info / locate / alarm | 后处理高亮通道 | [`doc/editor-selection.md`](../editor-selection.md) |
| `infoPanel` | 信息面板 | Static texture signage | 静态贴图标牌 | [`doc/info-panels.md`](./info-panels.md) |
| `css3dPanel` | CSS3D 面板 | Interactive DOM over WebGL | 可交互 DOM 面板 | [`doc/info-panels.md`](./info-panels.md) |
| `text` | 场景文字 | Text without required backing panel | 无背板文字实体 | [`doc/info-panels.md`](./info-panels.md) |
| `sprite` | 精灵标记 | Single-texture marker icon | 贴图标记点 | [`doc/info-panels.md`](./info-panels.md) |
| `devicePanel` | 设备面板 | Device panel; visibility key `name: "devicePanel"` | 设备域面板显隐键 | [`doc/api.md`](./api.md) |
| `cabNumPanel` | 机柜编号面板 | Cabinet door numbers; not `infoPanel` | 机柜门编号专用 name | [`doc/api.md`](./api.md) |
| `devicePanelRef` | 设备面板引用 | Panel `threeJsonId`; overrides inline defs | 面板 id 运行时真源 | [`doc/api.md`](./api.md) |

## Runtime mutation API

| English | 中文 | Brief definition | 简要说明 | Anchor |
|---------|------|------------------|----------|--------|
| `applyObjectChange` | 单路径变更 | Single-field change by path | 按 path 改单字段 | [`doc/runtime-object-mutation-quickref.md`](./runtime-object-mutation-quickref.md) |
| `applyObjectPartial` | 局部合并 | Multi-field partial merge | 多字段 partial | 同上 |
| snapshot | 快照 | Captured slice for undo/rollback | 可回滚 descriptor 片段 | 同上 |
| `descriptorSync` | 描述符同步 | Descriptor merge and binding cooperation | 描述符合并与绑定 | [`doc/scope.md`](./scope.md) |
| L3 JSON Patch | L3 Patch | Opt-in `threejson/patch`; whitelisted ops | 按需 JSON Patch 子路径 | [`doc/scope.md`](./scope.md) |

## Documentation and i18n

| English | 中文 | Brief definition | 简要说明 | Anchor |
|---------|------|------------------|----------|--------|
| language & documentation policy | 语言与文档策略 | Rules for language per layer | 各层语言规则 | [`doc/development.md`](./development.md) |
| terminology glossary | 术语对照表 | This page; concept definitions | 本页；概念词典 | This page |
| application i18n | 应用层 i18n | Runtime UI locales (scene-host) | scene-host UI 翻译 | [`tools/scene-host/shared/i18n/`](../../tools/scene-host/shared/i18n/) |
| bilingual doc track | 双轨文档 | `doc/` + `doc/en/` mirrors | 中英文档镜像 | [`doc/en/README.md`](./README.md) |

---

When adding a cross-cutting concept, add one row here and link from the topic doc on first use.
