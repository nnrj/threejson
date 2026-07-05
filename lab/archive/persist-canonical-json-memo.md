> **归档**：只读历史。**正史** [`scene-canonical-collect-roadmap.md`](../scene-canonical-collect-roadmap.md)。

# 持久化：标准 JSON 为存档真源（演进备忘）

**状态**：`archived`  
**日期**：2026-06-02  

> **正史文档**：[scene-canonical-collect-roadmap.md](./scene-canonical-collect-roadmap.md)  
> 本文保留**问题背景**与历史讨论；实现细节、API、阶段划分以 roadmap 与代码为准。

---

## 问题（改造前）

- 运行时真相：`THREE.Scene` + `userData.objJson` + `objectRegistry`。
- 编辑器保存曾走 `collectCurrentWorldInfo()` → `worldInfo.*List` 分桶 → 再 `convertFriendlyJsonToStandardJson`。
- core `exportJsonScene` 默认 `format:"standard"` 却 friendly-first + `scene.traverse`，与编辑器行为不一致。

**缺口**：缺少「scene 一次反扫 → 直接 `objectList`」的单一权威函数。

---

## 已落地结论

| 层 | 职责 |
|----|------|
| 运行时 | 编辑、渲染、mutation；只动 scene + objJson |
| 友好 JSON | 人类可读分组；**导出**经 `sceneToFriendlyJson` |
| 标准 JSON | `threeJsonId` + `objectList` + `sceneConfig`；编辑器保存与 `sysConfig.jsonData` 主存 |

- **core**：[`sceneToJson` 族](../core/util/sceneToJson.js) + `exportJsonScene` 薄封装  
- **编辑器**：`resolveEditorMergeBase()` → `sysConfig.jsonData` + `sceneToJson`；`autoSnapshot` 仅退出恢复；用户保存时 `sysConfig.jsonData` 整包同步  
- **友好 JSON 地位未废除**：与标准 JSON 同级；仅 scene→JSON **反扫**改为标准优先  

---

## 与 V2.1 sceneObjectCommands 的边界

- `addObjectFromDescriptor` / `removeObjectById`：**不**读写 `worldInfo.*List`。
- 增删后 `markSceneNeedsReserialize()`；保存走 `sceneToJson` read 路径。

---

## 退出条件 / 完成定义（已满足）

- [x] 编辑器默认保存为标准 JSON（方案 B），经 `sceneToJson` 往返  
- [x] 友好 JSON 仍为同级导出形态（`sceneToFriendlyJson`）  
- [x] `collectCurrentWorldInfo` 已删除；`exportJsonScene` 不再 traverse 分桶  

回归与扩展测试见 [`tests/sceneToJson.test.mjs`](../tests/sceneToJson.test.mjs)。
