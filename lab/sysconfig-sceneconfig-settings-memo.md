# Tools settings 与 sceneConfig 合并 — 分类级总开关（备忘）

**状态**：`idea` — **本期不实现**。

## 背景

编辑器/播放器 settings 与场景 JSON `sceneConfig` 的合并采用 **A/B/C 三分法**（见 [`doc/tools.md`](../doc/tools.md)）：

- **A**：JSON 有字段则 JSON 优先；缺字段用 settings/sysConfig 兜底（`valueOr`）。
- **B**：加载策略经 `createJsonScene` options（补光、补相机等）。
- **C**：少数显式「压过 JSON」开关（如「覆盖用户相机」）。

不为每个 `sceneConfig` 字段增加「取代用户 JSON」复选框。

## 远期设想：分类级总开关

若产品需要「我的渲染偏好始终优先于场景 JSON」，可增加 **一个** 分类级主开关，例如：

- 「渲染：始终使用我的设置（忽略场景 JSON 中的 `renderer` / `renderLoop`）」
- 或「控制：始终使用我的 orbit 默认」

### 原则

1. **按分类**，不按字段 — 避免 20+ 个 per-field 复选框。
2. 勾选后 runtime **优先 settings**，**不改写磁盘 JSON**（与现有 C 类语义一致）。
3. 与 A 类兜底互斥或叠加关系需在 UI hint 中写清。

### 触发条件（立项时再定）

- 用户反馈「每个场景都要在 JSON 里改抗锯齿」过于繁琐，且不愿仅依赖 A 类缺省兜底。
- 有明确产品场景需要「巡检播放器全局低 FPS」等跨场景策略。

### 实现注意

- 合并点仍在 `build*RuntimeConfig` / `createJsonScene` options，不新增 core 契约。
- canonical 纯 `objectList` 路径继续只走 options，不注入 `sceneConfig` 对象。

## 相关

- 评估正史：[`sysConfig-vs-sceneConfig-assessment.md`](./sysConfig-vs-sceneConfig-assessment.md)
- Tools 文档：[`doc/tools.md`](../doc/tools.md)
