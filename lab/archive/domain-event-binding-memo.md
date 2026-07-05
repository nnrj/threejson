> **归档**：L3 草图已并入 [`scene-event-mechanism-evaluation.md`](../scene-event-mechanism-evaluation.md) §5。

# Domain 事件 / 消息绑定机制备忘

**状态**：`archived`（原 `parked`）

## 问题

宿主页面（`scene-editor.html`、`room-show.html`、`port-show.html`、`scene-player.html`）在双击等输入路径上**硬编码**业务行为，例如：

- `door.openOrCloseDoor(currObj)` — 门开关动画
- `cabinet.getAssociatedDeviceId` / `port.getAssociatedDeviceId` — 设备摄像头 UI

这与「domain 行为由 JSON / 运行时契约驱动，而非宿主写死」的长期方向不一致。

## 目标架构（初步）

```text
JSON（per threeJsonId 或 per record）
  events: { dblclick: { domain, handler, … } }
       ↓
core 通用 InteractionDispatcher / EventBus
  → canvas 指针事件 → pick → threeJsonId → 查绑定表
  → invokeDomainModel / domain.api[handler]
```

## 与现有设施

- [`registerInteractionResolver`](../core/handler/sceneExtensionRegistry.js) + `resolveInteractionTarget`（door 已注册）— 可演进为事件绑定的一层，但**尚未**接编辑器双击路径。
- 本期 **保留** `door.openOrCloseDoor` 等现状；事件机制立项后再迁移宿主硬编码。

## 本期保留、后续应迁移的调用点

| 宿主 | 硬编码 | 事件机制后 |
|------|--------|------------|
| scene-editor | `door.openOrCloseDoor` | `dblclick` 绑定 |
| scene-editor | `cabinet.getAssociatedDeviceId` + 摄像头 UI | `dblclick` / `select` |
| room-show / port-show / scene-player | door + cabinet/port 设备 id | 同上 |

**不迁移**：编辑器「添加对象」命令（已 generic `addToScene`）；domain drill-in / 属性面板属编辑器能力。

---

**评估**：必要性、可行性、与编辑器多标签关系见 [scene-event-mechanism-evaluation.md](./scene-event-mechanism-evaluation.md)。
