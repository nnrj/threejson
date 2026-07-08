[中文](./editor-selection.md) | [English](../en/editor-selection.md)

# 编辑器选中：描边与高亮分工

本文描述编辑器与集成页「选中效果」的统一约定。

## 术语

详见 [术语对照表 · 可视化与交互](./glossary.md#可视化与交互选中--面板)；本节为编辑器约定摘要。

- **描边**：`THREE.BoxHelper`（编辑器专用），颜色固定为 `#E59520`。
- **高亮**：后处理 `OutlinePass`（`domains/sceneHighlight`），三通道颜色为：
  - `info`：白色（信息选中）
  - `locate`：黄色（定位 / 告警已处理）
  - `alarm`：红色（告警）

## 三层分工（core / domain / page）

1. **core**
   - 只提供通用运行时与通用工具，不感知业务字段（例如 `lightType`、`otherDeviceID`）。
   - 交互 controller：`core/util/sceneHighlightInteraction.js`。
   - 描边 helper：`core/util/boxEdgeHelper.js`（编辑器专用）。

2. **domain：sceneHighlight**
   - 负责创建/部署 OutlinePass（JSON 化与 runtime bundle）。
   - 提供页面初始化门面：`createPageHighlightSetup()`。

3. **page（scene-editor 与六集成页）**
   - 负责业务路由（例如 `lightType` 决定调用 `info/locate/alarm` 哪个通道）。
   - 编辑器需要描边时，仅在页面侧创建 `BoxHelper`，不进入 core 高亮域。

## 编辑器六条规则（保持不变）

1. 后处理高亮只用于「展示选中状态」，不替代编辑器的 BoxHelper 描边。
2. `info` 通道应保持「单选覆盖」语义：每次 `setInfoHighlight()` 覆盖上一条。
3. `locate` / `alarm` 通道用于「叠加」，用 `addLocateObjects()` / `addAlarmObjects()`。
4. 页面清理视图（clearView）只清 `info`，不要误清业务叠加通道（集成页适用）。
5. 编辑器右键退出编辑时应 `controller.clearAll()`，并隐藏 BoxHelper。
6. core 不引入任何业务枚举与业务字段判断；业务只留在页面。

