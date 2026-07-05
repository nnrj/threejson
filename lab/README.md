# Lab：实验与架构备忘索引

本目录**不是**发布承诺；与 [`doc/scope.md`](../doc/scope.md) 的 Core 承诺区分。

**状态标记**（全文统一，定义见 [`CONVENTIONS.md`](./CONVENTIONS.md)）：

| 标记 | 含义 |
|------|------|
| `shipped` | 已实现 |
| `partial` | 部分实现，仍有 backlog |
| `idea` | 未实现，开放探索 |
| `committed` | 已立项，承诺实现 |
| `deferred` | 远期计划 |
| `parked` | 当前周期不做 |
| `rejected` | 不承诺实现 |
| `archived` | 历史归档 → [`archive/`](./archive/) |

---

## 标准 JSON / 持久化（正史）

| 主题 | 路径 | 状态 | 说明 |
|------|------|------|------|
| 标准 JSON 反扫（HOW） | [scene-canonical-collect-roadmap.md](./scene-canonical-collect-roadmap.md) | `shipped` | `sceneToJson` 族、编辑器迁移、merge 基座 |
| 标准 JSON 外形（WHAT） | [standard-json-shape-proposal.md](./standard-json-shape-proposal.md) | `shipped` | 方案 B、`jsonOrigin`、去 `worldId` |
| sysConfig / sceneConfig 字段归属 | [sysConfig-vs-sceneConfig-assessment.md](./sysConfig-vs-sceneConfig-assessment.md) | `shipped` | A/B/C 合并契约；宿主见 [`doc/tools.md`](../doc/tools.md) |
| Domain 持久化快照钩子 | [domain-persist-snapshot-memo.md](./domain-persist-snapshot-memo.md) | `shipped` | `capturePersistDescriptor` / merge 下沉到域 |
| subScene 嵌套 | [subscene-memo.md](./subscene-memo.md) | `shipped` | 加载/导出/editor layout；用户文档见 `doc/json-format` |
| 分帧对象部署 | [`core/runtime/deployScheduler.js`](../core/runtime/deployScheduler.js) + [`doc/api.md`](../doc/api.md) | `shipped` | 默认 immediate；可选 `frameBudget` / `timeslot` |
| 场景 intro postLoad | [`doc/json-format.md`](../doc/json-format.md#sceneconfigintro-可选加载完成后片头) | `shipped` | `excludeFromLoadWait` / `blockInteraction`（2026-07） |
| Load gate 扩展（per-object） | [scene-load-gate-memo.md](./scene-load-gate-memo.md) | `idea` | 方案 C1–C3 备忘；**不承诺实现** |

归档：持久化背景、worldInfo 清理审计 → [`archive/`](./archive/)

---

## 场景编辑器

| 主题 | 路径 | 状态 | 说明 |
|------|------|------|------|
| 右栏 UI backlog | [scene-editor-ui-memo.md](./scene-editor-ui-memo.md) | `idea` | 子标签、【调度】、全屏 JSON、场景树布局 |
| AI 生成增强 | [scene-ai-enhancement-memo.md](./scene-ai-enhancement-memo.md) | `partial` | core/ai 已完善；编辑器 UI 部分可选接入 |
| AI Agent 迭代应用 | [scene-ai-agent-iterative-improvement-memo.md](./scene-ai-agent-iterative-improvement-memo.md) | `partial` | Phase 0–1 已落地；Phase 2–3 待评估 |
| 材质面板二期 | [archive/material-panel-phase2-shipped.md](./archive/material-panel-phase2-shipped.md) | `archived` | 2026-06 已收尾 |
| 纹理采样编辑器 backlog | [texture-sampling-editor-backlog-memo.md](./texture-sampling-editor-backlog-memo.md) | `parked` | v1 已落地；不做 G `textureDefaults` 与 infoPanel 采样 UI |
| 材质描述符持久化 vs 运行时 | [material-descriptor-persisted-vs-runtime.md](./material-descriptor-persisted-vs-runtime.md) | `deferred` | M1–M4 根治路线图 |
| 材质面板 / assetRegistry | [asset-registry-lifecycle-memo.md](./asset-registry-lifecycle-memo.md) | `idea` | 方案 B 已用；refCount / 方案 C 未做 |

---

## AI / Prompt

| 主题 | 路径 | 状态 | 说明 |
|------|------|------|------|
| 运行时 Skill 与文档 | [`core/ai/`](../core/ai/) | `shipped` | 2026-06 能力对齐；人类入口 [`SKILL.md`](../core/ai/SKILL.md) |
| AI Skill gap 矩阵 | [archive/ai-skill-gap-matrix.md](./archive/ai-skill-gap-matrix.md) | `archived` | PR 对照表；正史在 core/ai |

---

## Domain / 业务

| 主题 | 路径 | 状态 | 说明 |
|------|------|------|------|
| 嵌套 Domain（qualified id） | [nested-domain-memo.md](./nested-domain-memo.md) | `shipped` | `weather.rain` / `weather.wind` 试点 |
| 运行时变更契约 | [domain-runtime-mutation-contract-memo.md](./domain-runtime-mutation-contract-memo.md) | `idea` | MUST/SHOULD + 合规审计 backlog |
| Domain 编辑 / 快照 backlog | [domain-edit-snapshot-backlog-memo.md](./domain-edit-snapshot-backlog-memo.md) | `idea` | Phase C/D；**未必实现** |
| 场景事件机制（L3/L4 + **V2 设想** §10） | [scene-event-mechanism-evaluation.md](./scene-event-mechanism-evaluation.md) | `idea` | L3 **`deferred`**；L4 **`rejected`**；V2 **`idea`** |
| 编辑器事件脚本工作区 V2（目录树/多标签） | [scene-editor-event-script-workspace-v2-memo.md](./scene-editor-event-script-workspace-v2-memo.md) | `deferred` | **本期不做**；事件机制 M1–M6 后再议 |
| Extension JSON 形状（草案） | [extension-json.md](./extension-json.md) | `idea` | 正式接入 [`doc/extensions.md`](../doc/extensions.md) |
| 第三方 Extension 标准 | [third-party-extension-adoption-memo.md](./third-party-extension-adoption-memo.md) | `parked` | **不做** CLI/manifest；复制 bootstrap 已可行 |

---

## 渲染 / 几何 / 资源

| 主题 | 路径 | 状态 | 说明 |
|------|------|------|------|
| Shader Preset 架构 | [shader-preset-architecture.md](./shader-preset-architecture.md) | `shipped` | registry + `nature.sky` / `nature.water` |
| CSG 泛化与不规则体 | [csg-and-irregular-geometry-roadmap.md](./csg-and-irregular-geometry-roadmap.md) | `deferred` | joins/inters/holes 扩展 |
| Native 通用对象 | [native-object-dispatch-memo.md](./native-object-dispatch-memo.md) | `partial` | `objType: native` / `parseMode` v1 |
| 场景 Helpers | [scene-helpers-memo.md](./scene-helpers-memo.md) | `partial` | v1 grid/axes 单实例；多实例为 `deferred` |
| 静态资源与在线托管 | [assets-online-hosting-memo.md](./assets-online-hosting-memo.md) | `done` | `@threejson/assets@1.0.0`、jsDelivr 默认基址 |
| TJZ 流式 ingest | [tjz-streaming-ingest-memo.md](./tjz-streaming-ingest-memo.md) | `idea` | 分块载入 PoC 设计 |
| 资源回收进阶 | [resource-reclaimer-advanced-memo.md](./resource-reclaimer-advanced-memo.md) | `deferred` | 可见性驱逐 / LOD 代理预研 |
| html2canvas 并发正式化 | [archive/html-info-panel-html2canvas-concurrency-memo.md](./archive/html-info-panel-html2canvas-concurrency-memo.md) | `rejected` | Debug 内联队列保留 |

---

## 交互 / 第一人称 / 物理

| 主题 | 路径 | 状态 | 说明 |
|------|------|------|------|
| 第一人称 / FPS 集成 | [first-person-integration.md](./first-person-integration.md) | `partial` | core firstPerson + Rapier 桥接 |
| room-show FPS 必要性评估 | [room-show-first-person-evaluation-memo.md](./room-show-first-person-evaluation-memo.md) | `idea` | **非实施承诺** |
| 第二物理后端 | [future-physics.md](./future-physics.md) | `deferred` | 与 `extensions/physics-rapier` 并列时的契约 |
| renderLoop autoFps | [renderloop-autofps-memo.md](./renderloop-autofps-memo.md) | `idea` | 动态帧率设想 |

---

## 架构 / 基础设施

| 主题 | 路径 | 状态 | 说明 |
|------|------|------|------|
| core 目录分层 | [core-layering-memo.md](./core-layering-memo.md) | `idea` | builder/handler/runtime 理想参照；**非强制搬迁** |
| 模块 import 环 backlog | [module-import-cycle-backlog-memo.md](./module-import-cycle-backlog-memo.md) | `parked` | #4 已落地；#5–#13 **不承诺** |
| defaultModel import 环 | [default-model-import-cycle-memo.md](./default-model-import-cycle-memo.md) | `parked` | 方案 A 已拆；方案 B 待评估 |
| Tools settings 分类总开关 | [sysconfig-sceneconfig-settings-memo.md](./sysconfig-sceneconfig-settings-memo.md) | `deferred` | 见 `doc/tools.md` A/B/C |
| npm 发布与 Monorepo | [npm-publish-and-monorepo-memo.md](./npm-publish-and-monorepo-memo.md) | `deferred` | **开发期不实发 npm** |
| 历史 Plan 摘录 | [roadmap-from-plans.md](./roadmap-from-plans.md) | `idea` | 从 `.cursor/plans` 整理；非承诺 |
| 对象 `name` 层级筛选 | [object-name-hierarchy-memo.md](./object-name-hierarchy-memo.md) | `parked` | 本期不做 |
| 按 `name` 泛化 operateObject | [object-operate-by-name.md](./object-operate-by-name.md) | `parked` | 与命令模式重合待设计 |
| Runtime objType 特殊对待 | [runtime-objtypes-memo.md](./runtime-objtypes-memo.md) | `idea` | 视口/控制器 schema 差异 |
| 场景图 parent.remove 审计 | [archive/scene-graph-parent-remove-memo.md](./archive/scene-graph-parent-remove-memo.md) | `archived` | flat graph 已落地 |
| 可选安全 / 防篡改 | — | `deferred` | 见 [`doc/design-principles.md`](../doc/design-principles.md) |
| L4 用户脚本沙箱 | — | `rejected` | 见事件评估与 roadmap-from-plans |

---

## 贡献

新开主题：在对应分类增行 + 添加 `lab/<topic>-memo.md`（文首 `**状态**：` + 日期）。已关闭 initiative 移入 [`archive/`](./archive/) 并在本表改 `archived`。
