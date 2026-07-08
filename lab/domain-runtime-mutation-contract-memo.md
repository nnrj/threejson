# Domain 运行时变更契约（与 objectMutation / sceneObjectCommands 对齐）

**状态**：`idea`（文档约定；**未遵循的 domain 待逐步改进**）  
**日期**：2026-06-02  
**来源**：[core 增删对象 API 方案](file:///C:/Users/nnrj/.cursor/plans/core_增删对象_api_ed4e1c45.plan.md) 讨论 3-12 / 4-12

关联：[`docs/zh/domains.md`](../docs/zh/domains.md)、[`core/BUSINESS_DOMAINS.md`](../core/BUSINESS_DOMAINS.md)、[`core/runtime/objectMutation/`](../core/runtime/objectMutation/)、拟议 `core/runtime/sceneObjectCommands.js`

与 [`docs/zh/scope.md`](../docs/zh/scope.md) 无发布承诺。

---

## 目标

- **创建（增）**：domain 仍可保留专用入口（`invokeDomainModel`、`businessDomains.cabinet`、`deployMeshWithDomains` 等），不必强行并入 `addObjectFromDescriptor`。
- **变更 / 删除 / 撤销**：宿主与编辑器对外体验与 primitive **一致**——统一使用 `threeJsonId` + core **mutation** / **sceneObjectCommands**，不直接 `scene.remove` 绕开注册表。

---

## 数据面契约（MUST）

部署完成后，凡希望参与编辑器选中、属性面板、撤销的 domain 根对象：

| 项 | 要求 |
|----|------|
| `threeJsonId` | 稳定、唯一；写入 descriptor 与 `userData` |
| `userData.objJson` | 规范真源（canonical descriptor）；与 [`design-principles`](../docs/zh/design-principles.md) 一致 |
| `registerObject` | 根及需按 id 查询的子节点均注册（与 [objectRegistry](../core/handler/objectRegistry.js) 一致） |
| 移除 | 使用 `removeObjectById`（或等价 core 路径），**禁止**仅 `scene.remove` + 局部 dispose |

---

## 变更 API（宿主 SHOULD）

| 操作 | API |
|------|-----|
| 改属性 / 变换 | `applyObjectPartial` / `applyObjectSnapshot`（[objectMutation](../core/runtime/objectMutation/index.js)） |
| 增（通用 descriptor） | `addObjectFromDescriptor` / `Async` |
| 增（聚合 domain，如 cabinet items） | 专用 domain API（可保留） |
| 删 | `removeObjectById`；复杂 group 可选 `captureSubtree: true`（见 sceneObjectCommands 方案） |

mutation/commands **不区分** objType 与 domain：只认 `threeJsonId` 与 `objJson`。

---

## Domain 实现约定（SHOULD / MAY）

写入 [`docs/zh/domains.md`](../docs/zh/domains.md) 时建议包含：

### SHOULD

- 部署结束：`registerObject(root, descriptor, { recursive: 按子树是否需要独立 id })`。
- 运行中若修改了子树结构或业务字段，在导出/删除前将运行态合并回 `userData.objJson`（避免「碎片化 group」导致 undo 失败）。

### MAY（复杂 domain）

- **`captureDescriptor(object3D)`**：将运行态（统计项、动态子节点等）写回可持久化 descriptor；供保存与 `removeObjectById` 的 `removedDescriptor` 使用。
- **`redeployFromDescriptor(scene, threeJsonId)`**：大改时委托 `redeployObject`，与 mutation 返回的 `needsRedeploy` 一致。

**不要求**每个 domain 实现同名 `add`/`remove` 方法表；**不**要求把 `resolveDomainModel` 改成与 `deployMesh` 相同签名。

---

## 待改进 domain（备忘）

以下未逐项审计；立项时按本契约做 gap 列表：

- 凡仍让宿主 `scene.remove` 且未 `unregisterObject` 的路径
- 子 mesh 有 `threeJsonId` 但父 `objJson` 未包含子记录（影响 group undo，见 persist/sceneObjectCommands 方案中的 `captureSubtree`）
- cabinet / port 等：创建走专用 API 的，需确认删除与属性变更已走 core 统一 API

### 注册合规（2026-06 审计）

内置 10 域（`builtinDomainManifest.generated.js`）**均已通过** `validateDomainDescriptor`：`box`, `cabinet`, `door`, `floor`, `glass`, `nativeThree`, `port`, `sceneHighlight`, `wall`, `weather`。自动化：`tests/businessDomainManifest.test.mjs`。

**语义例外（已文档化，不要求改代码）**：

| id | 要点 |
|----|------|
| nativeThree | `create*` 为加载描述；Object3D 异步入库 |
| sceneHighlight | `create*`/`deploy*` 为 pass/composer 副作用 |
| weather | `deployWeather` 为 async |

**运行时变更待查**（立项时逐项代码审计）：

| 域 / 路径 | 待查 |
|-----------|------|
| **door** | 域内 `registerObject`；删除是否走 `removeObjectById` |
| **cabinet / port** | 专用 `deploy*` 后 `threeJsonId` / 注册表；统计叠加子节点与 undo |
| **box / wall / glass / floor** | 依赖 `deployMesh` 是否统一注册；宿主删除是否绕开 registry |
| **nativeThree** | 异步加载完成后的 id 与撤销快照 |
| **sceneHighlight** | pass 对象是否参与 object registry / 删除 |
| **weather** | points/mesh 部署后的 `threeJsonId` 与删除 |

应用层（模型面板、`addToScene` 白名单等）属**产品配置**，不在 `docs/zh/domains.md` 必选 API。

---

## 与 objType `floor` 的说明

core **无**独立「floor」领域类型；仅为降低心智的 **preset objType**（与 `wall`、`glass` 类似，由 domain 合并后按 `box` 部署）。本契约不对 `floor` 做删除保护或特殊分支。

---

## 退出条件

- `docs/zh/domains.md` 纳入本节要点。
- 编辑器 Phase B 删除/属性/撤销仅通过 mutation + sceneObjectCommands。
- 主要 business domain 通过「注册表 + objJson」抽检清单。
