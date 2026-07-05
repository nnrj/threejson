# Native 通用对象创建备忘

状态：`partial`（v1 已实现；双轨入口与 allowlist 仍演进中）

关联：[`core/builder/nativeObjectBuilder.js`](../core/builder/nativeObjectBuilder.js)、[`core/handler/nativeParseMode.js`](../core/handler/nativeParseMode.js)。**主文档示例**（torusKnot 推断、显式 native 层级）：[`doc/json-format.md` § objType: native](../doc/json-format.md#objtype-native通用-threejs-对象)。

## 动机

ThreeJSON 无法逐一维护 Three.js 全量对象类型；用户可通过 **ObjectLoader 可识别的 JSON** 声明单条对象，并与 `box` 一样获得 `userData.objJson` / `threeJsonId` / 导出能力。

与以下能力 **不冲突**：

| 通道 | 入口 |
|------|------|
| `sceneInfoList` | 嵌入整段 Scene `toJSON()` |
| `domain: "nativeThree"` | 整图 URL / `parseInline` |
| **`objType: "native"`** | `objectList` 单条 |

## 控制字段

- **`parseMode`**：`auto`（默认）| `native` | `default`
- **`threeType`**：ObjectLoader 节点 type（如 `Mesh`、`Group`）
- **`nativeShapeHeuristic`**：JSON 形态猜 BoxGeometry；**默认 false**；有误判风险

## 双轨入口

1. `objType: "native"` + `threeType`（或 `geometry.type` 反推宿主）
2. 任意 `objType` + `parseMode: "native"`

## JSON 形态

- **扁平**：单 Mesh / 单几何
- **层级**：`children: [...]` 递归，根多为 `Group`

## 优先级

专用解析器（与现网 deploy 一致）→ native（ObjectLoader）→ `enableDefaultModel` 红盒 / skip

`parseMode: "native"` 在 **`deployObjectRecord` 入口**短路，跳过全部专用分支。

## 类型表

**无 ThreeJSON allowlist**；能否创建由 **ObjectLoader + 当前 three 版本** 决定。

## 友好字段 v1

- 直传 `geometry.*` / `material.color` / `material.type`
- **`textureUrl`**：`parse` 后处理挂到 `material.map`（与 box 类似）
- **不做**通用预映射框架

## 归一化

`parseMode` 为 `auto`/`native` 时，未知 `objType` **不再**在 friendly 归一化阶段 preemptive coerce 为 `box`。

## 退出条件 / 延后

- Tier-3 按描述符重建 native 对象
- 编辑器属性模板
- 可选 `nativeTypePolicy: allowlist`（企业审计，v1 不做）
