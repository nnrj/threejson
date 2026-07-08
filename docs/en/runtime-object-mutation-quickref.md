[中文](../zh/runtime-object-mutation-quickref.md) | [English](./runtime-object-mutation-quickref.md)

# Runtime Object Mutation Quick Reference

[中文](../zh/runtime-object-mutation-quickref.md) | [Core API](./api.md)

For callers who want to mutate a single runtime object by `threeJsonId` without using full-scene `ingest`.

## Import

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

You can also import the same APIs from `threejson/core` (subpath exports are optional, not mandatory).

## Three Common Cases

### 1) Change one field (path)

```js
const r = applyObjectChange("rack-001", "position.x", 120);
if (!r.ok) console.warn(r.error);
```

Default behavior is strict: missing intermediate keys cause failure (prevents accidental malformed trees).

### 2) Change multiple fields (partial)

```js
applyObjectPartial("rack-001", {
  name: "Rack-A1",
  visible: true,
  position: { x: 20, y: 0, z: 30 }
});
```

### 3) Do an edit with rollback protection

```js
const before = captureObjectSnapshot("rack-001");
const changed = applyObjectPartial("rack-001", { position: { x: 80, y: 0, z: 10 } });
if (!changed.ok) {
  applyObjectSnapshot("rack-001", before);
}
```

## When to use sync vs async

- `applyObjectPartial` / `applyObjectSnapshot`: returns immediately, does not wait for texture completion.
- `applyObjectPartialAsync` / `applyObjectSnapshotAsync`: waits until texture loading settles.

Example:

```js
await applyObjectPartialAsync("rack-001", {
  material: { textureUrl: "/assets/textures/metal.jpg" }
});
```

## `createMissing` (default `false`)

```js
// Default strict mode: fails when material.textureUrl does not exist
applyObjectChange("rack-001", "material.textureUrl.path", "/x.png");

// Explicitly allow creating missing intermediate objects
applyObjectChange("rack-001", "material.textureUrl.path", "/x.png", {
  createMissing: true
});
```

## How to handle `needsRedeploy`

When the mutation touches structural fields (such as `geometry`, `objType`, `subScene`, or `boxModelList`), result contains `needsRedeploy: true`.

```js
import { redeployObject } from "threejson/core";

const res = applyObjectChange("rack-001", "geometry.type", "sphere");
if (res.needsRedeploy) {
  redeployObject(scene, "rack-001");
}
```

## Options Quick Table

| Option | Default | Purpose |
|------|------|------|
| `createMissing` | `false` | Whether path mutation can create intermediate objects |
| `markBindingDirty` | `true` | Whether to call `markDescriptorBindingJsonDirty` |
| `scene + autoRedeploy` | off | Auto-call `redeployObject` when `needsRedeploy` is true |

## Return Shape Quick Table

```js
{
  ok,               // success / failure
  error,            // error message when failed
  threeJsonId,
  object3D,
  descriptor,
  needsRedeploy
}
```

`applyObjectChange` additionally includes `path` and `kind` (path classification).
