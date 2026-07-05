# Lab 文档约定

本目录记录**实验、评估、架构备忘与已落地项的历史索引**，与 [`doc/scope.md`](../doc/scope.md) 中的 **Core 发布承诺** 区分。读者若只需稳定 API，优先查 `doc/` 与 `core/ai/SKILL.md`。

---

## 状态标记（统一）

每篇 lab 文档**文首**应有一行 `**状态**：…`（或表格首行）。索引 [`README.md`](./README.md) 使用同一套标记。

| 标记 | 含义 | 何时使用 |
|------|------|----------|
| **`shipped`** | **已实现**，主路径可用 | 代码已落地；稳定说明可链到 `doc/` |
| **`partial`** | **部分实现** | 核心能力可用，仍有明确 backlog（写清 Phase / 缺口） |
| **`idea`** | **未实现**，开放探索 | 无排期；必要性 / 可行性待评估 |
| **`committed`** | **已立项，承诺实现** | 路线图 / plan 已拍板，尚未编码 |
| **`deferred`** | **远期计划** | 有意做，**非当前周期**；无具体排期 |
| **`parked`** | **搁置** | 当前周期**明确不做**；可能日后重评 |
| **`rejected`** | **不承诺实现** | 方案评估后否决，或永久超出 scope |
| **`archived`** | **历史归档** | 迁移日志、已关闭 initiative；见 [`archive/`](./archive/) |

**不再单独使用的旧标记**（整理时统一映射）：

| 旧标记 | 映射为 |
|--------|--------|
| 已落地 / 已收尾 / v1 已实现 / enabled / active / resolved | `shipped` 或 `partial`（视 backlog） |
| 本期不做 / 不建议实现 / 非发布承诺 | `parked` 或 `rejected` |
| 预研 / 远期 / memo / 草案 | `idea` 或 `deferred` |

**`spike`**：可选，表示 PoC / 技术探针，通常与 `idea` 并列；探针结论后应改为上表之一。

---

## 文档类型

| 类型 | 命名建议 | 生命周期 |
|------|----------|----------|
| **正史** | `*-roadmap.md`、`*-assessment.md` | `shipped` 后保留在 `lab/` 根目录，链到 `doc/` |
| **备忘** | `*-memo.md` | `idea` / `partial` / `deferred`；立项后升为正史或归档 |
| **评估** | `*-evaluation.md` | 结论写清；子方案标 `deferred` / `rejected` |
| **gap / 审计** | 并入相关 memo 或 **归档** | 一次性清理记录 → `archive/` |
| **归档** | `lab/archive/*.md` | 只读历史；根目录 README 留一行指针 |

---

## 贡献规则

1. **新开主题**：在 [`README.md`](./README.md) 增一行，并添加 `lab/<topic>-memo.md`（文首写状态 + 日期）。
2. **已 shipped 且仅剩迁移日志**：合并要点到正史 doc 后移入 [`archive/`](./archive/)。
3. **重复主题**：保留一篇 **hub**（评估或 roadmap），其余合并或归档；勿留三份同义索引。
4. **与 `doc/` 分工**：可声明式 JSON / 公共 API → `doc/`；未承诺行为、宿主集成、编辑器 backlog → `lab/`。
5. **交叉链接**：归档后更新指向 `archive/` 或 hub 正史；避免链到已删路径。

---

## 与产品承诺的关系

```text
doc/scope.md          → Core 对外承诺
lab/ (shipped/partial) → 已实现或部分实现的实现索引
lab/ (idea~deferred)   → 排期参考，非承诺
lab/ (parked/rejected) → 明确不做或否决
lab/archive/           → 已完成工作的审计 / 迁移记录
```
