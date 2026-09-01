[中文](./runtime-object-commands.md) | [English](../en/runtime-object-commands.md)

# 运行时结构命令（sceneObjectCommands）

与 [runtime-object-mutation-quickref.md](./runtime-object-mutation-quickref.md) 并列：**mutation** 改已有对象；**commands** 增删对象。

## 导入

```js
import {
  addObjectFromDescriptor,
  addObjectFromDescriptorAsync,
  removeObjectById
} from "../core/index.js";
```

## addObjectFromDescriptor / addObjectFromDescriptorAsync

- 挂载父节点：仅 `options.parent`（`THREE.Scene` | `THREE.Object3D` | 父 `threeJsonId` 字符串）。
- 重复 `threeJsonId` → `{ ok: false, error: "duplicate threeJsonId ..." }`。
- 同步部署未产生对象且非 `needsAsync` → `{ ok: false, error: "deploy produced no object ..." }`。
- 同步版对 `externalModel` 等可能返回 `needsAsync: true`；完整等待用 Async 版（见 [development.md](./development.md) 命名约定）。

## removeObjectById

- 必须回传 `removedDescriptor`、`removedParentThreeJsonId`（供撤销删除）。
- `options.captureSubtree: true` → 额外 `removedSubtree[]`。
- `options.allowProtectedRemoval: true` → 允许删除 camera/renderer 等受保护运行时对象。
- 默认保护：`objType` 为 scene/camera/renderer/controls/renderloop/pass，或 system tag 为 `native-scene` / `environment` / `assist`。

## 勿混用

| 意图 | API |
|------|-----|
| 改属性 | `applyObjectPartial` / `applyObjectSnapshot` |
| 新增 | `addObjectFromDescriptor(Async)` |
| 删除 | `removeObjectById` |
| 撤销删除 | `addObjectFromDescriptor(removedDescriptor, { parent })` |

持久化与 `worldInfo.boxModelList` 无关；见 [lab/scene-canonical-collect-roadmap.md](../../lab/scene-canonical-collect-roadmap.md)。

## 复杂网格命令

`mesh.inspect`、`mesh.getTopology`、`mesh.validate`、`mesh.edit`、`mesh.buffer.*`、`mesh.bake` 和 `mesh.renderViews` 通过统一 command executor 提供。它们使用 revision 防止过期拓扑写入，并在完整校验和预构建成功后原子提交。完整参数、控制网格 schema、二进制 buffer 和渐进生成流程见[复杂模型与渐进建模](./complex-mesh.md)。
