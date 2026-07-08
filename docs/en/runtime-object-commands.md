[中文](../zh/runtime-object-commands.md) | [English](./runtime-object-commands.md)

# Runtime Object Commands

This page summarizes structural scene commands. It complements [Runtime Object Mutation](./runtime-object-mutation-quickref.md): mutation changes existing objects, while commands add or remove objects.

## Imports

```js
import {
  addObjectFromDescriptor,
  addObjectFromDescriptorAsync,
  removeObjectById
} from "../core/index.js";
```

## addObjectFromDescriptor / addObjectFromDescriptorAsync

- Parent mounting uses `options.parent`: a `THREE.Scene`, `THREE.Object3D`, or parent `threeJsonId` string.
- Duplicate `threeJsonId` returns `{ ok: false, error: "duplicate threeJsonId ..." }`.
- If sync deployment creates no object and is not `needsAsync`, it returns `{ ok: false, error: "deploy produced no object ..." }`.
- The sync API can return `needsAsync: true` for async assets such as `externalModel`; use the async API when you need to wait for completion.

## removeObjectById

- The result must include `removedDescriptor` and `removedParentThreeJsonId` so undo can restore the object.
- `options.captureSubtree: true` also returns `removedSubtree[]`.
- `options.allowProtectedRemoval: true` allows removing protected runtime objects such as camera and renderer.
- Protected by default: scene/camera/renderer/controls/renderloop/pass objects and system-tagged native scene, environment, or assist objects.

## API Choice

| Intent | API |
|--------|-----|
| Change properties | `applyObjectPartial` / `applyObjectSnapshot` |
| Add object | `addObjectFromDescriptor(Async)` |
| Remove object | `removeObjectById` |
| Undo removal | `addObjectFromDescriptor(removedDescriptor, { parent })` |
