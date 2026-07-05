# 按 `name` 泛化对象操作 — Lab 备忘

状态：`idea`（**非发布承诺**；**本期不实现**）

关联：[`core/runtime/objectMutation`](../core/runtime/objectMutation/index.js)、命令模式、[`objectVisibility`](../core/handler/objectVisibility.js)（本期仅显隐）

## 设想

```js
operateObject(name, operate, params?)
// operate: "show" | "hide" | "move" | "rotate" | "delete" | ...
```

基于 `name` / `names[]` 的统一变更入口，内部可能复用 objectMutation / 命令栈。

## 本期范围

仅实现 **显隐**：

- `setObjectVisibleByThreeJsonId`
- `setObjectsVisibleByName` / `setObjectsVisibleByNames`
- `setObjectsVisibleByCustomBucket(s)`（可选）

## 风险

与现有编辑器历史、objectMutation 快照、命令模式职责重叠 — 需单独立项设计后再做。
