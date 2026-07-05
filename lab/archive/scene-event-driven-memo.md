> **归档**：内容已并入 [`scene-event-mechanism-evaluation.md`](../scene-event-mechanism-evaluation.md) §0。

# 场景事件驱动机制（设想备忘）

**状态**：`archived`  
**日期**：2026-06-02  
**关联**：[standard-json-shape-proposal.md](./standard-json-shape-proposal.md) §10f

---

## 动机

业务行为（设备告警高亮、面板联动、属性变更响应）不应写入场景 JSON（如 `alarmList`）。宜由宿主在 **运行时** 订阅事件并调用 core/domain API。

## 设想模型（VB6 式）

- **对象**：场景中已 deploy 的实体（按 `threeJsonId` / `name` 定位）。
- **事件**：单击、双击、指针进入/离开、属性变更、跨对象联动。
- **处理器**：宿主注册的回调；可调用 [`domains/sceneHighlight`](../domains/sceneHighlight/)、[`sceneHighlightInteraction`](../core/util/sceneHighlightInteraction.js)、mutation API 等。

## 与现有能力边界

| 能力 | 关系 |
|------|------|
| JSON Patch / `sceneObjectCommands` | 声明式 **状态变更**，非事件总线 |
| `sceneHighlight` locate/info/alarm | 运行时 **效果 API**，可由事件处理器调用 |
| `alarmList` in JSON | **不得**在事件系统完成前进入契约 |

## 退出条件（何时立项）

- 多个业务页重复实现相同「点击→高亮→面板」链路；
- 需要可配置的交互脚本而非硬编码 HTML；
- 与编辑器「预览模式」事件调试需求明确。

## 非承诺

本文仅为 lab 索引；**未开发前** `alarmList` 类业务仍不得塞进 JSON。

---

**评估**：L3/L4 分层、立项优先级、多标签是否前提等见 [scene-event-mechanism-evaluation.md](./scene-event-mechanism-evaluation.md)。
