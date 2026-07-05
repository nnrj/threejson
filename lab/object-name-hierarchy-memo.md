# 对象 `name` 层级筛选 — Lab 备忘

状态：`idea`（**非发布承诺**；**不保证**将来实现）

关联：[`对象标识字段重构`](../.cursor/plans/对象标识字段重构_d2717a33.plan.md)（若 plan 已归档，见 `doc/json-format.md` 对象身份专章）

## 背景

本期 `name` 语义：**opaque 字符串、全字精确匹配**（`getObjectsByName` / `setObjectsVisibleByName`）。`room-wall` 与 `cabinet-wall` **无**隐式关联。

曾讨论过的增强：类似 CSS 选择器的层级筛选（如 `room.*`、`*.wall`），或 `xxx.yyy.zzz` 分段 name，以便「按前缀/后缀批量操作」。

## 结论（本期）

- **本期不做**
- **不承诺**以后一定做
- 分层批量请用 **`customBucket`**（与 `name` 双轨，4b）

## 若将来探索（无设计定稿）

可能形态（仅供备忘，非 API 承诺）：

- `sceneConfig.nameSelectorMode` 或类似开关，**默认 `false`**
- 开启后才启用前缀/通配/Glob 等规则
- 关闭时行为与本期一致：仅精确匹配

实现成本与风险：用户负担、与 `name` 可重复语义冲突、文档与测试面大 — 故搁置。

## 相关 lab

- 泛化 `operateObject(name, operate, params)`：见 `lab/object-operate-by-name.md`（待建）
