[中文](../zh/api.md) | [English](./api.md)

# ThreeJSON API

This document is for application developers integrating ThreeJSON. It assumes ThreeJSON is already available through npm, a CDN import map, or a bundler.

Use public package entries:

```js
import { createJsonScene } from "threejson";
import { deployJsonObjectAsync } from "threejson/core";
import { applyObjectPartial } from "threejson/runtime-mutation";
```

Do not import repository internals such as `../core/index.js` or `./handler/xxx.js`. Those paths are source layout details, not application contracts.

## 1. Import Entries

| Entry | Purpose |
| --- | --- |
| `threejson` | Recommended main entry. Registers built-in domains and re-exports public core APIs. |
| `threejson/core` | Core public APIs only. Use it for runtime, loading, export, and mutation capabilities. |
| `threejson/builtins` or `threejson/builtins/register` | Register built-in domains. |
| `threejson/domains/<name>` | Load one domain on demand, for example `threejson/domains/device`. |
| `threejson/extensions/<name>` | Load an extension on demand. |
| `threejson/runtime-mutation` | Mutate deployed objects. The main and core entries also export these APIs. |
| `threejson/patch` | JSON descriptor patch helpers. |
| `threejson/patch-core` | Lower-level patch application helpers. |

Main entry:

```js
import { createJsonScene, sceneToFriendlyJson } from "threejson";
```

Core entry:

```js
import {
  createJsonScene,
  deployJsonObjectAsync,
  getObjectByThreeJsonId
} from "threejson/core";
```

## 2. Create A Scene

### `createJsonScene(payload, options)`

The primary loading API. It creates the Three.js `Scene`, `Camera`, `WebGLRenderer`, controls, lights, objects, event runtime, and render loop from JSON.

```js
import { createJsonScene } from "threejson";

const runtime = await createJsonScene(sceneJson, {
  canvas: document.querySelector("#stage"),
  resetScene: true,
  assetsBaseMode: "cdn-first"
});

runtime.start();
```

Common `options`:

| Field | Description |
| --- | --- |
| `canvas` | `HTMLCanvasElement` used by `WebGLRenderer`. |
| `resetScene` | Whether to clear old scene objects when reloading. |
| `assetsBase` | Asset base URL, for example `/assets` or a CDN URL. |
| `assetsBaseMode` | Asset resolution mode, commonly `base-first`, `cdn-first`, or `local-first`. |
| `onProgress` / `onDeployProgress` | Loading or deployment progress callback. |
| `onWarning` | Non-fatal warning callback. |
| `beforeFrame` / `beforeRender` / `afterRender` | Render-loop hooks. |

Common runtime fields:

| Field | Description |
| --- | --- |
| `scene` | Three.js `Scene`. |
| `camera` | Active camera. |
| `renderer` | `WebGLRenderer`. |
| `controls` | Active controls, usually OrbitControls or a compatible adapter. |
| `renderLoop` | Render-loop object. |
| `start()` | Start rendering. |
| `stop()` | Stop rendering. |
| `resize(size?)` | Resize the renderer and camera. |
| `dispose()` | Dispose controls, renderer, backdrop, events, and object resources. |

Always dispose the runtime when the page or component is destroyed:

```js
window.addEventListener("beforeunload", () => runtime.dispose());
```

### `createJsonSceneFit(payload, options)`

Like `createJsonScene`, but with defaults suitable for examples and player-style view fitting.

```js
import { createJsonSceneFit } from "threejson/core";

const runtime = await createJsonSceneFit(sceneJson, { canvas });
runtime.start();
```

### `createJsonSceneFromInput(input, options)`

Accepts an object, JSON string, Blob, ArrayBuffer, or ThreeJSON archive input. For a plain JSON URL, fetch it in your application first.

```js
import { createJsonSceneFromInput } from "threejson/core";

const payload = await fetch("/assets/json/demo.json").then((res) => res.json());
const runtime = await createJsonSceneFromInput(payload, {
  canvas,
  assetsBaseMode: "cdn-first"
});
runtime.start();
```

### `createJsonSceneSimple(payload, options)`

A synchronous simplified load path. Use it only for simple scenes that do not need async backdrop, model, or texture waiting. Most apps should use `createJsonScene`.

## 3. Create Only The Runtime

### `createSceneRuntime(options)`

Creates Scene, Camera, Renderer, Controls, Lights, and RenderLoop without deploying ThreeJSON objects.

```js
import { createSceneRuntime } from "threejson/core";

const runtime = createSceneRuntime({
  canvas,
  config: {
    scene: { background: "#11151b" },
    camera: { position: { x: 8, y: 6, z: 10 }, fov: 55 },
    controls: { enableDamping: true },
    lights: [{ type: "ambient", intensity: 1 }]
  }
});

runtime.start();
```

Use this when you want ThreeJSON's runtime shell but still create or manage objects yourself.

## 4. Deploy Objects

### `createJsonObject(record, options)`

Creates an `Object3D` from one object record but does not add it to a scene.

```js
import { createJsonObject } from "threejson/core";

const mesh = createJsonObject({
  threeJsonId: "box-1",
  objType: "box",
  geometry: { width: 2, height: 2, depth: 2 },
  material: { color: "#5470c6" }
});

scene.add(mesh);
```

### `deployJsonObject(target, record, options)`

Creates an object and adds it to a target. The target can be a `THREE.Scene`, `THREE.Group`, or a runtime-like object containing `scene`.

```js
import { deployJsonObjectAsync } from "threejson/core";

await deployJsonObjectAsync(runtime.scene, {
  threeJsonId: "sphere-1",
  objType: "sphere",
  geometry: { radius: 1.2, widthSegments: 32, heightSegments: 16 },
  position: { x: 3, y: 1.2, z: 0 },
  material: { type: "standard", color: "#73c0de" }
});
```

Prefer async APIs when resources may be involved:

| API | Description |
| --- | --- |
| `createJsonObject(record, options)` | Create one object. |
| `createJsonObjectBatch(records, options)` | Create an array of objects. |
| `createJsonObjectAuto(input, options)` | Auto-detect single record or array. |
| `deployJsonObject(target, record, options)` | Synchronously deploy one object. |
| `deployJsonObjectAsync(target, record, options)` | Asynchronously deploy one object. |
| `deployJsonObjectBatchAsync(target, records, options)` | Asynchronously deploy an array. |
| `deployJsonObjectAutoAsync(target, input, options)` | Auto-detect and deploy asynchronously. |

## 5. Mutate Deployed Objects

Deployed objects are indexed by `threeJsonId`. Use runtime-mutation APIs to update the object and its JSON descriptor.

```js
import { applyObjectPartial } from "threejson/runtime-mutation";

applyObjectPartial("box-1", {
  position: { x: 2, y: 1.5, z: 0 },
  material: { color: "#91cc75" }
});
```

Common APIs:

| API | Description |
| --- | --- |
| `applyObjectPartial(threeJsonId, partial, options)` | Merge a partial object patch. |
| `applyObjectPartialAsync(threeJsonId, partial, options)` | Async partial patch, useful for textures. |
| `applyObjectChange(threeJsonId, path, value, options)` | Update one path, for example `"material.color"`. |
| `applyObjectChangeAsync(threeJsonId, path, value, options)` | Async path update. |
| `captureObjectSnapshot(threeJsonId)` | Capture a snapshot for undo-like workflows. |
| `applyObjectSnapshot(threeJsonId, snapshot, options)` | Restore a snapshot. |
| `getObjectField(threeJsonId, path)` | Read a descriptor field. |

Some fields can be synchronized directly, such as `position`, `rotation`, `scale`, `visible`, and common material fields. Structural changes may require redeploy:

```js
applyObjectPartial("box-1", patch, {
  scene: runtime.scene,
  autoRedeploy: true
});
```

## 6. Add And Remove Scene Objects

```js
import {
  addObjectFromDescriptor,
  addObjectFromDescriptorAsync,
  removeObjectById
} from "threejson/core";

await addObjectFromDescriptorAsync(runtime.scene, {
  threeJsonId: "box-2",
  objType: "box",
  geometry: { width: 1, height: 1, depth: 1 },
  position: { x: -3, y: 0.5, z: 0 },
  material: { color: "#fac858" }
});

removeObjectById(runtime.scene, "box-2");
```

These APIs maintain ThreeJSON descriptors and object indexes, which is better for editors, players, and interactive apps than direct `scene.add()` / `scene.remove()`.

## 7. Query Objects

```js
import {
  getObjectByThreeJsonId,
  getObjectByUuid,
  getObjectByRefName,
  getObjectsByName,
  resolveObjectDisplayLabel
} from "threejson/core";

const box = getObjectByThreeJsonId("box-1");
const label = resolveObjectDisplayLabel(box?.userData?.objJson);
```

Common queries:

| API | Description |
| --- | --- |
| `getObjectByThreeJsonId(id)` | Find by stable ThreeJSON ID. |
| `getObjectByUuid(uuid)` | Find by Three.js UUID. |
| `getObjectByRefName(refName)` | Find by `refName`. |
| `getObjectsByName(name)` | Find multiple objects by Three.js `name`. |
| `rebuildObjectRegistryFromScene(scene)` | Rebuild indexes from a scene. |

Visibility:

```js
import { setObjectVisibleByThreeJsonId } from "threejson/core";

setObjectVisibleByThreeJsonId("box-1", false);
```

## 8. JSON Conversion And Export

ThreeJSON supports standard JSON and friendly JSON.

```js
import {
  sceneToStandardJson,
  sceneToFriendlyJson,
  rebuildStandardJson,
  rebuildFriendlyJson,
  normalizeScenePayload,
  buildFriendlyScenePayloadFromCanonical
} from "threejson/core";

const standardFromScene = await sceneToStandardJson(runtime.scene);
const friendlyFromScene = await sceneToFriendlyJson(runtime.scene);

const normalized = normalizeScenePayload(inputPayload);
const friendlyFromPayload = buildFriendlyScenePayloadFromCanonical(
  inputPayload,
  normalized
);
```

Common APIs:

| API | Description |
| --- | --- |
| `sceneToJson(scene)` | Export JSON from the current scene. |
| `sceneToStandardJson(scene)` | Export standard `objectList` JSON from the current scene. |
| `sceneToFriendlyJson(scene)` | Export friendly `worldInfo` JSON from the current scene. |
| `rebuildStandardJson(scene)` | Rebuild standard JSON from the current scene. |
| `rebuildFriendlyJson(scene)` | Rebuild friendly JSON from the current scene. |
| `normalizeScenePayload(payload)` | Normalize input payload into the standard loader shape. |
| `buildFriendlyScenePayloadFromCanonical(source, canonical)` | Build friendly JSON from a canonical payload. |
| `collectObjectListFromScene(scene)` | Collect object records from a scene. |

Third-party model export:

```js
import { exportMesh, SUPPORTED_MESH_FORMATS } from "threejson/core";

const result = await exportMesh(runtime.scene, { format: "glb" });
const blob = result.data;
```

Supported formats are defined by `SUPPORTED_MESH_FORMATS`. Before GLB/GLTF/USDZ export, pending online textures are prepared for export. Textures that cannot be read because of CORS or decoding failures are omitted from the export clone and reported through `result.warnings`; the live scene is not modified. Pass `textureFailurePolicy: "error"` for strict failure instead.

## 9. Assets

```js
import {
  setAssetsBaseUrl,
  setAssetsBaseMode,
  assetUrl,
  DEFAULT_CDN_ASSETS_BASE
} from "threejson/core";

setAssetsBaseUrl("/assets");
setAssetsBaseMode("base-first");

const url = assetUrl("textures/environment/skybox/port360.webp");
```

Common fields and APIs:

| Name | Description |
| --- | --- |
| `assetsBase` | Asset base for one load task. Use it in `createJsonScene` options or `sceneConfig`. |
| `assetsBaseMode` | Asset resolution mode. |
| `setAssetsBaseUrl(url)` | Set the global asset base. |
| `setAssetsBaseMode(mode)` | Set the global asset mode. |
| `assetUrl(path)` | Build an asset URL from the current base. |
| `resolvePublicAssetUrl(url)` | Resolve a public asset path found in JSON. |
| `DEFAULT_CDN_ASSETS_BASE` | Default CDN base for `@threejson/assets`. |

Modes:

| Mode | Description |
| --- | --- |
| `base-first` | Prefer the current `assetsBase`. |
| `cdn-first` | Prefer the `@threejson/assets` CDN. |
| `local-first` | Prefer `/assets`. |
| `base-only` | Use only `assetsBase`. |
| `cdn-only` | Use only CDN. |
| `local-only` | Use only `/assets`. |

## 10. Events

ThreeJSON can bind scene events from JSON, or an application can create and manage the event runtime directly.

```js
import { bindSceneEventRuntime, disposeSceneEventRuntime } from "threejson/core";

const eventRuntime = bindSceneEventRuntime(runtime.scene, {
  camera: runtime.camera,
  renderer: runtime.renderer,
  controls: runtime.controls
});

disposeSceneEventRuntime(runtime.scene);
```

Low-level script helpers:

```js
import { parseEventScript, runEventScript } from "threejson/core";
```

Most applications should not call low-level script APIs directly unless they are implementing an editor, player, or custom interaction system.

## 11. Domains And Extensions

The main entry registers built-ins:

```js
import { createJsonScene } from "threejson";
```

If you import only from `threejson/core`, register domains explicitly:

```js
import "threejson/builtins/register";
import { createJsonScene } from "threejson/core";
```

On-demand domains:

```js
import "threejson/domains/device";
import "threejson/domains/nature";
```

Extension example:

```js
import "threejson/extensions/particle-nebula";
```

Domain JSON commonly uses:

```json
{
  "threeJsonId": "cabinet-1",
  "objType": "domain",
  "domain": "device.cabinet",
  "position": { "x": 0, "y": 0, "z": 0 },
  "businessInfo": {
    "label": "A01"
  }
}
```

## 12. Texture Sampling And Cache

Texture defaults can be configured before deployment:

```js
import {
  configureTextureDefaultsForDeploy,
  configureTextureUrlCacheForDeploy
} from "threejson/core";

configureTextureDefaultsForDeploy({
  quality: "balanced",
  anisotropy: 4
});

configureTextureUrlCacheForDeploy({
  enabled: true
});
```

Material records may also contain sampling fields. See [JSON Format](./json-format.md#materials-and-textures).

## 13. Logging

```js
import { configureLogger } from "threejson/core";

configureLogger({
  debug: true,
  prefix: "[ThreeJSON]"
});
```

Debugging checklist:

- If loading fails, check resource URLs first, especially on GitHub Pages.
- If an object cannot be queried, make sure it has a stable `threeJsonId`.
- If mutation has no visible effect, check whether the field supports incremental sync; otherwise redeploy.
- Application code should depend on public package entries, not repository source paths.
