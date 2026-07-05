# 运行时对象变更速查

[中文](./runtime-object-mutation-quickref.md) | [Core API](./api.md)

面向调用方：用 `threeJsonId` 在运行时改单个对象，不走整场景 `ingest`。

## 导入

```js
import {
  applyObjectChange,
  applyObjectPartial,
  applyObjectPartialAsync,
  captureObjectSnapshot,
  applyObjectSnapshot,
  applyObjectSnapshotAsync
} from "threejson/runtime-mutation";
```

也可继续从 `threejson/core` 导入同名 API（子路径只是按需入口）。

## 最常用三种场景

### 1) 改一个字段（path）

```js
const r = applyObjectChange("rack-001", "position.x", 120);
if (!r.ok) console.warn(r.error);
```

默认 strict：中间键不存在会失败（防止误写畸形结构）。

### 2) 改一组字段（partial）

```js
applyObjectPartial("rack-001", {
  name: "Rack-A1",
  visible: true,
  position: { x: 20, y: 0, z: 30 }
});
```

### 3) 做一次“可回滚”编辑

```js
const before = captureObjectSnapshot("rack-001");
const changed = applyObjectPartial("rack-001", { position: { x: 80, y: 0, z: 10 } });
if (!changed.ok) {
  applyObjectSnapshot("rack-001", before);
}
```

## sync / async 什么时候用

- `applyObjectPartial` / `applyObjectSnapshot`：同步返回，不等贴图完成。
- `applyObjectPartialAsync` / `applyObjectSnapshotAsync`：等待贴图完成后返回。

示例：

```js
await applyObjectPartialAsync("rack-001", {
  material: { textureUrl: "/assets/textures/metal.jpg" }
});
```

## createMissing（默认 false）

```js
// 默认 strict：material.textureUrl.path 若 material.textureUrl 不存在会失败
applyObjectChange("rack-001", "material.textureUrl.path", "/x.png");

// 显式放开：允许创建中间对象链
applyObjectChange("rack-001", "material.textureUrl.path", "/x.png", {
  createMissing: true
});
```

## needsRedeploy 怎么处理

当变更触发结构级字段（如 `geometry`、`objType`、`subScene`、`boxModelList`）时，返回值会标记 `needsRedeploy: true`。

```js
import { redeployObject } from "threejson/core";

const res = applyObjectChange("rack-001", "geometry.type", "sphere");
if (res.needsRedeploy) {
  redeployObject(scene, "rack-001");
}
```

## 选项速查

| 选项 | 默认 | 用途 |
|------|------|------|
| `createMissing` | `false` | path 写入时是否创建中间对象 |
| `markBindingDirty` | `true` | 是否触发 `markDescriptorBindingJsonDirty` |
| `scene + autoRedeploy` | 关闭 | 自动在 `needsRedeploy` 时调用 `redeployObject` |

## 返回值速查

```js
{
  ok,               // 成功 / 失败
  error,            // 失败信息
  threeJsonId,
  object3D,
  descriptor,
  needsRedeploy
}
```

`applyObjectChange` 额外带 `path` 与 `kind`（路径分类）。
