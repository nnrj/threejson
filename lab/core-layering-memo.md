# core/ 目录分层：builder · handler · runtime（远期设想）

**状态**：`idea` — 组织与认知上的目标态，**非发布承诺**；**不要求**现有代码立刻按此搬迁。

**关联**：[docs/zh/design-principles.md](../docs/zh/design-principles.md)（理想职责简述）、[docs/zh/scope.md](../docs/zh/scope.md)（Canonical vs Runtime overlay）、[domain-runtime-mutation-contract-memo.md](./domain-runtime-mutation-contract-memo.md)、[core/runtime/objectMutation/](../core/runtime/objectMutation/)

---

## 1. 背景

开发过程中自然浮现一种秩序：

| 直觉 | 含义 |
|------|------|
| **builder** | 加载链：把 JSON / `.tjz` / 描述符 **解析并首次渲染** 到 `THREE.Scene` |
| **runtime** | 场景就绪 **之后**：对象属性变更、增删、描述符 patch、显隐等 |
| **handler** | 角色一度不清晰；实际仓库里它更像 **场景引擎管线 + 共享基础设施** |

本文记录 2026-06 对 `core/` 的盘点结论与远期整理方向，避免与大重构计划混淆。

---

## 2. 现状快照（盘点时）

| 目录 | 规模（约） | 实际承担 |
|------|------------|----------|
| `core/builder/` | ~50 个 JS |  mostly **create* / deploy* / 纹理与外部模型加载**；少量运行时成分（如 box 变换 sync、plane 滚动动画驱动挂钩） |
| `core/handler/` | ~55 个 JS | **加载编排**（`sceneLoadHandler`）、**注册表**（`objectRegistry`）、**导入导出**、**域调度**、**帧循环/动画**，以及大量 **加载后 API**（如 `infoPanelRuntime`、`objectObjType`、`descriptorSync`） |
| `core/runtime/` | **5 个 JS** | 显式 post-load：`objectMutation`、`sceneObjectCommands`；另含 **加载期** 的 `deployScheduler`、`sceneLoadLifecycle`（边界略混） |

**命名与位置不一致示例**（不要求立刻改）：

- `core/handler/infoPanelRuntime.js` — 职责属 runtime，目录在 handler
- `core/handler/sceneRuntimeHandler.js` — 创建 renderer/scene/camera，实为 **viewport 引导**，非「加载后 mutation」
- `core/builder/css3d/css3dRuntime.js` — CSS3DRenderer 生命周期
- `core/handler/modelHandler.js` — 碰撞预览；盒体列表聚合见 `boxModelListCoalescer.js`，CSG 见 `csgBrushOps.js`

对外稳定面仍是 [`core/index.js`](../core/index.js) 与 [`docs/zh/api.md`](../docs/zh/api.md) 的 **能力名**，而非目录名。

---

## 3. 理想职责（目标态，非强制）

### 3.1 builder — 装配与首次 deploy

**何时**：从描述符到 `Object3D` 的 **创建**；可含 async 资源加载。

**典型**：

- `createMesh` / `deployMesh`、`createGroup`、`loadExternalModel`
- `infoPanelBuilder`、`nativeObjectLoader`、各 `*Builder.js`

**不宜默认承担**：已注册对象的 patch、按 `threeJsonId` 的 redeploy 命令、每帧游戏逻辑。

### 3.2 runtime — 场景已存在后的变更

**前提**：对象已通过加载链进入场景，且通常已 `registerObject`（有 `threeJsonId`）。

**典型**：

- [`objectMutation`](../core/runtime/objectMutation/index.js)（npm：`threejson/runtime-mutation`）
- [`sceneObjectCommands`](../core/runtime/sceneObjectCommands.js)（增删对象）
- 显隐 / 按 objType 批量操作 / 面板内容更新 / `descriptorSync` 写回 等 **post-load** API

**与 Canonical 的关系**：允许只改 `Object3D`（runtime overlay）；再进入持久化或 Patch 前需 `reconcileTransformToDescriptor` 等（见 scope）。

### 3.3 handler — 编排与横切基础设施

**不是** DOM 事件 handler，而是 **Scene Engine / Pipeline**：

- 整场景 load/save 编排（`sceneLoadHandler`、`sceneFriendlyNormalizer`）
- 对象注册表与索引（`objectRegistry`、`objTypeIndex`、`bucketIndex`）
- 业务域 registry 与 `invokeDomainModel`
- 帧循环与声明式动画（`frameLoopHandler`、`animationHandler`）
- 导入导出、JSON 校验、资源回收

**为何不能「清空 handler」**：composition root 必须同时协调 builder、registry、runtime 调度与 domains；见 [BUSINESS_DOMAINS.md](../domains/BUSINESS_DOMAINS_ZH.md)。

### 3.4 关系示意

```text
JSON / tjz
  → handler（归一化、调度）
  → builder + objectDispatch（create / deploy）
  → handler objectRegistry（索引）
  → [场景就绪]
  → runtime（mutation / commands / 显隐 / patch）
  → handler（export / sceneToJson）
```

---

## 4. 关于「modelBuilder ↔ modelRuntime」

**不宜** 将 [`modelBuilder.js`](../core/builder/modelBuilder.js)（~3200 行）整文件 1:1 拆成 `modelRuntime.js`：

- 混合了几何创建、CSG、外部模型、材质加载与 deploy 入口
- 运行时能力已分散：`objectMutation`、`objectObjType`、`syncBoxModelTransformFromObject3D` 等
- 盲目对拆易 **循环依赖**（mutation 已 import builder + handler）

**更现实的远期切法**（若做）：只抽 **无几何创建** 的 API，例如 box 描述符 ↔ 变换 sync trio → `core/runtime/boxTransform.js`（名称待定），而非完整 modelRuntime。

---

## 5. 调整必要性评估

| 维度 | 结论 |
|------|------|
| 直觉是否合理 | **是**，与「JSON 为王 + runtime overlay」一致 |
| 功能 urgency | **低** — 目录乱不影响正确性 |
| 认知 / PR 争论 | **中高** — 新贡献者常问「改 builder 还是 handler」 |
| Big-bang 搬目录 | **不推荐** — deep import 面大、历史断裂、循环依赖风险 |

---

## 6. 推荐演进策略（远期，择期）

### 方案 A — 仅文档（成本最低）

- 在 [design-principles.md](../docs/zh/design-principles.md) 说明理想三层（**已完成索引**）
- 新代码 **倾向** 按职责选目录，**不** Retrofit 全库

### 方案 B — 契约 + 增量归位（若立项）

1. **新 post-load API** 默认进 `core/runtime/`，避免再在 `handler/` 新增 `*Runtime.js`
2. **试点迁移**（低风险优先）：
   - `infoPanelRuntime.js` → `core/runtime/infoPanel.js` + handler re-export
   - `objectObjType.js` → `core/runtime/`
   - `modelBuilder` 中 transform sync trio → `core/runtime/`
3. **可选重命名/clarify**：`deployScheduler`、`sceneLoadLifecycle` 更贴近「load」而非「post-load runtime」
4. **compat**：旧路径 re-export 1–2 minor（可选）

### 方案 C — Big-bang 目录重组

- **风险高**，与 [module-import-cycle-backlog-memo.md](./module-import-cycle-backlog-memo.md) 中「未承诺大搬移」精神一致，**不建议** 作为默认路线。

---

## 7. 新代码倾向规则（soft guideline）

| 问题 | 倾向 |
|------|------|
| 从 JSON 第一次造 Mesh/Group？ | `builder/` 或经 `objectDispatch` |
| 场景里已有对象，按 threeJsonId 改？ | `runtime/`（或现有 mutation/commands） |
| 整场景 load、export、registry、域调度？ | `handler/` |
| 业务语义？ | `domains/`，core 只留通用钩子 |

违反上述 **不视为 bug**；历史模块保持不动直至有明确 refactor 任务。

---

## 8. 退出条件

- 若长期维持「仅 index 稳定 + 文档约定」，本备忘保持 `idea` 即可
- 若完成方案 B 试点且测试/循环依赖可控，可将状态改为 `partial` 并更新本表「现状快照」
- 若决定永不物理分目录，可将本备忘标为 `parked`，仅保留 design-principles 中的概念说明

---

## 9. 参考（盘点时读过的模块）

- Load：`sceneLoadHandler`、`objectLoadHandler`、`modelBuilder`、`deployScheduler`
- Runtime API：`objectMutation`、`sceneObjectCommands`、`infoPanelRuntime`、`objectObjType`、`descriptorSync`
- 文档：`docs/zh/api.md` § runtime-mutation、§ sceneObjectCommands
