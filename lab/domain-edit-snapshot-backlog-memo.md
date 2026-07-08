# Domain 编辑 / 快照 — 待讨论 backlog（非承诺）

**状态**：`idea`（**待讨论**；**未必实现**）  
**日期**：2026-06-09  
**讨论基线**：[domain 编辑快照整合](file:///C:/Users/nnrj/.cursor/plans/domain_编辑快照整合_5c6c8603.plan.md)（Phase A / B 已落地）

与 [`docs/zh/scope.md`](../docs/zh/scope.md) 无发布承诺。本节仅收录整合方案中 **明确未立项** 或标为 **P2 / 另议题** 的条目，供后续评审；**不表示排期或必须做**。

---

## 已落地（本备忘不重复展开）

整合方案 **Phase A + B** 已在仓库实现，包括但不限于：

- 依赖方向条文：[`docs/zh/design-principles.md`](../docs/zh/design-principles.md) §依赖方向
- `bound` 导出：有 `capturePersistDescriptor` 则合并；否则 `persistSource` + 根变换（**不阻断整场景**）
- 子件漂移：`collectDomainExportCaveats` + 编辑器保存后 **非阻断** warning
- cabinet `capture` 对齐 instance-only；移除 `groupInfo.cabinetInfo`
- bind 时 `isKnownDomainHandler` 校验

详见 [`core/handler/domainDeployDescriptor.js`](../core/handler/domainDeployDescriptor.js)、[`tools/common/editor-single/domainEditSession.js`](../tools/common/editor-single/domainEditSession.js)、[`tests/domainBoundExport.test.mjs`](../tests/domainBoundExport.test.mjs)。

---

## 待讨论项 1 — Phase C：`childMutations` overlay

| 项 | 说明 |
|----|------|
| **动机** | `bound` + `capturePersistDescriptor` **不采集** drill-in 子 mesh 平移；退化 group 会丢 domain 语义。overlay 想在 domain 壳上挂 `childMutations.ops[]`，deploy 后回放。 |
| **现状** | `editorSettings.domainEdit.enableChildMutationOverlay` 存在且默认 `false`；[`exportWysiwygDeployRootFromObject3D`](../core/util/sceneToJson.js) 导出时会 `delete childMutations`；**无** drill-in 退出写入、**无** load 回放。 |
| **若做** | drill-in 退出 + 开关打开 + 用户选 bind 时写入 net transform ops；core **通用** deploy 后回放（`objectMutation` 或 registry 钩子）；**禁止** `sceneLoadHandler` 写死 domain 名；首期可能仅 transform + 有 `threeJsonId` 的子节点。 |
| **关联** | [`domain-runtime-mutation-contract-memo.md`](./domain-runtime-mutation-contract-memo.md) |
| **是否必做** | **否** — 整合方案 §8：「本期实现 childMutations 除非 Phase C 立项」。 |

---

## 待讨论项 2 — Phase D：undo 完整 redeploy

| 项 | 说明 |
|----|------|
| **动机** | 用户选「撤销」时期望回到加载原文的 **工厂拓扑**，而不只是变换回滚。 |
| **现状** | [`undoDomainChildEditFromPersistSource`](../tools/common/editor-single/domainEditSession.js)：`objJson` ← `persistSource` + [`restoreDomainChildTransforms`](../tools/common/editor-single/domainEditSession.js) 恢复 drill-in 基线变换。**不覆盖**增删子节点、换材质/几何、工厂级结构变化。 |
| **若做** | `persistSource` → `removeObjectById` + `invokeDomainModel` / `redeployObject`；与 scene 级 history 分工写清。 |
| **是否必做** | **否** — P2 增强；当前注释已标明「撤销 = 变换级回滚」。 |

---

## 待讨论项 3 — `mergeDomainModelList` 与 instance-only 多记录

| 项 | 说明 |
|----|------|
| **动机** | [`mergeDomainModelList`](../core/util/persistWorldInfoMerge.js) 按 `domain` id **单块**合并；room-show（`roomShow.json`）等多条 cabinet **instance** 并存时，增量 merge 路径可能与 instance-only 预期不一致。 |
| **影响面** | 主要影响 **friendly JSON 增量 merge** / `buildPersistPayloadWorldInfoPrimary`；与编辑器 `fullReplace` + `sceneToJson` 快照 **正交**。 |
| **若做** | 单独立项：按 `threeJsonId` / 条目身份分块合并，或文档明确「增量 merge 仅适用于旧形态」。 |
| **是否必做** | **否** — 整合方案 §5.5 标为低优 / 另议题。 |

---

## 待讨论项 4 — 属性面板与 bind 流程（P2 UX）

| 项 | 说明 |
|----|------|
| **现状** | 面板可编辑 `domain` / `handler`，但**不会**自动写回 `persistSource` 或触发 bind；仅在 drill-in 退出弹窗「绑定解析器」时生效。 |
| **若做** | 面板「应用绑定」按钮；或 blur 时校验并提示；与 `bindDomainParserOnRoot` 对齐。 |
| **是否必做** | **否** — 体验优化，非快照正确性阻塞项。 |

---

## 能力边界（已知限制，非 backlog 实现项）

- **编辑未决仍阻断**：`childrenDirty` / `pendingResolution` → `assertSceneExportable` 阻断（防止未选择退化/绑定/撤销时自动保存）。
- **bound 子件微调**：无 overlay 时，子 mesh gizmo 改动通常 **不进 JSON**；保存成功时可有 warning，见 `collectDomainExportCaveats`。
- **capture 质量因域而异**：机柜等仅有根级 + 业务字段合并；子树 WYSIWYG 仍建议 **degrade → group** 或等 overlay。

---

## 重新立项时可用的粗判据

| 议题 | 可考虑立项当… |
|------|----------------|
| Phase C overlay | 产品明确要求「bound 保留 domain 且子件平移可重载」，且不愿普遍退化 group |
| Phase D redeploy | 撤销频繁误用、用户反馈「撤销后结构仍错」 |
| mergeDomainModelList | 仍依赖 friendly 增量保存且多 instance 同 domain 丢数据 |
| 面板 bind UX | 用户常手改 handler 却忘记在弹窗确认 |

---

## 相关文档

| 文档 | 关系 |
|------|------|
| [domain-persist-snapshot-memo.md](./domain-persist-snapshot-memo.md) | capture / merge 钩子（机柜）；部分路径已随 instance-only 演进 |
| [scene-canonical-collect-roadmap.md](./scene-canonical-collect-roadmap.md) | `sceneToJson` 正史 |
| [domain-runtime-mutation-contract-memo.md](./domain-runtime-mutation-contract-memo.md) | overlay 若做，应对齐 mutation 契约 |
