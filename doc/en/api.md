# Core API

[中文](../api.md) | [English](./api.md)

This page lists only APIs that callers commonly use and that are relatively general-purpose. Business-specific methods for data centers, racks, device status, and similar domains are not the focus of this manual, but business-domain dispatch entry points are still documented here.

## Runtime logging (`core/util/logger.js`)

Use `log.warn` / `log.error` / `log.debug` inside the library; do not call `console.log` or `console.warn` directly. Default level is **warn** (`debug` / `info` are silent unless enabled).

```js
import { configureLogger, isDebugEnabled, log } from "threejson/core";

configureLogger({ level: "warn" });
configureLogger({ debug: true });
```

Browser debug: add `?threejson_debug=1` to the URL, or `localStorage.setItem("threejson.debug", "1")`. Audit: `npm run audit:console`; gate: `npm run lint:console`.

## `core/handler/sceneRuntimeHandler.js`

Import path:

```js
import { createSceneRuntime } from "../../core/handler/sceneRuntimeHandler.js";
```

### `createSceneRuntime(options)`

Creates a scene runtime from runtime configuration. It uniformly creates:

- `scene`
- `camera`
- `renderer`
- `controls`
- `lights`
- `renderLoop`

In addition to the required `canvas` and `config`, `options` also supports:

- `composer`: pass an `EffectComposer` for internal `createRenderLoop()` to use.
- `beforeFrame` / `beforeRender` / `afterRender`: frame-loop hooks (forwarded to `frameLoopHandler`).

```js
const sceneRuntime = createSceneRuntime({
  canvas: document.getElementById("canvasContainer"),
  config: sceneConfig
});
```

The returned object includes:

- `scene`: the created `THREE.Scene`.
- `camera`: the created `THREE.PerspectiveCamera`.
- `renderer`: the created `THREE.WebGLRenderer`.
- `controls`: the created viewport controller (`OrbitControls` or a firstPerson adapter; see `controls.type`); `null` when `controls.enabled === false`. Adapters implement `update()` / `dispose()` and expose `threeJsonControlsKind` (`orbit` | `firstPerson`).
- `renderLoop`: the underlying frame-loop object.
- `start()`: starts the unified frame loop.
- `stop()`: stops the unified frame loop.
- `resize(size)`: resizes renderer, camera, and composer.
- `setComposer(composer)`: binds an `EffectComposer` after runtime creation.
- `dispose()`: stops the loop and releases controls and renderer.

## `core/handler/frameLoopHandler.js`

Import path:

```js
import { createRenderLoop } from "../../core/handler/frameLoopHandler.js";
```

### `createRenderLoop(options)`

Creates a unified frame loop. Usually you do not need to call this directly; prefer `createSceneRuntime()`. Use it directly when the page needs a custom scene/camera/renderer creation path.

Supported capabilities:

- `requestAnimationFrame` scheduling.
- `lowFps` / `fps` low-frame-rate rendering.
- `updateSceneAnimations(scene)`.
- `controls.update()`.
- `renderer.render(scene, camera)` or `composer.render()`.
- `autoResize` / `firstAutoResize`.
- `beforeFrame`, `beforeRender`, `afterRender` hooks.

```js
const renderLoop = createRenderLoop({
  scene,
  camera,
  renderer,
  controls,
  composer,
  config: {
    autoResize: true,
    firstAutoResize: true,
    fps: 60,
    lowFps: false
  }
});

renderLoop.start();
```

## `core/handler/animationHandler.js`

Import path:

```js
import { updateSceneAnimations } from "../../core/handler/animationHandler.js";
```

### `updateSceneAnimations(scene, deltaSeconds?, options?)`

Updates continuous animations declared by JSON `animations` in the scene, and calls `TWEEN.update()`. Usually called automatically by `frameLoopHandler`; pages do not need to call it directly.

`options.maxDeltaSeconds`: caps the per-frame animation step (default about `0.1`), avoiding rotation jumps after returning from a background tab when the frame interval is very large.

Currently supported:

```js
animations: [
  { type: "rotate", axis: "y", speed: 0.6 }
]
```

`speed` is in radians per second. `axis` supports `x`, `y`, `z`, and also `rotationX`, `rotationY`, `rotationZ`.

## Door domain API (`domains/door`)

```js
import { door } from "threejson";
```

### `door.openOrCloseDoor(currObj)`

Runs open/close door tweens according to `doorType` in the door model JSON (business-semantics animation, not the generic JSON animation system).

### Door toggle ELM (`door.toggle`)

Unlike device panels, **all** `isDoorDescriptor` doors (including flat `objType: "door"`) get **`dblclick` → `door.toggle`** at scene `bindSceneEvents` unless:

- `doorToggleTrigger: "none"` (no bind),
- `doorToggleTrigger: "click"` (single-click trigger), or
- the same record already has explicit `events.dblclick` / `events.click` (explicit JSON wins; no derived bind).

Cabinet deploy roots (`objType: "domain"`, `domain: "device.cabinet"`) are **not** bound for door toggle; cabinet shell double-click no longer opens doors via host code. Scenes with cabinets invoke `door.bindSceneEvents` through `device.cabinet` `peerDomains: ["device", "door"]`.

After `door.toggle`, a document event **`threejson:door-toggled`** (`door.DOOR_TOGGLED_EVENT`) is dispatched for pages such as room-show to sync operation button labels.

| Field | Values | Default |
|-------|--------|---------|
| `doorToggleTrigger` | `dblclick` \| `click` \| `none` | `dblclick` |

Implementation: [`domains/door/doorEventActions.js`](../domains/door/doorEventActions.js), [`doorTriggerResolver.js`](../domains/door/doorTriggerResolver.js). objType capabilities are registered by the door domain via `registerObjTypeEventCapabilities("door", …)` — **not** in the core `objTypeEventCapabilities` seed table.

### `door.impactHole(model, scene)` / `door.resetWall(door, scene)`

Door–wall CSG hole cutting (experimental). Implementation lives in the door domain; the low level uses core `impactCheck` and [`holeSceneOps`](../../core/handler/holeSceneOps.js) (`subtractMeshHole`, `resetHolesByOriginHole`, `deployHoleReplacement`).

## `core/handler/sceneLoadHandler.js`

Import path:

```js
import {
  createJsonScene,
  createJsonSceneFit,
  createJsonSceneFromInputFit,
  createJsonSceneSimple,
  deployJsonScene,
  deployJsonSceneSimple,
  cancelActiveDeployScheduler,
  resolveDeploySchedulerConfig
} from "../../core/index.js";
```

### Scene entry comparison

| API | Returns | Background / native embed | objectList deploy |
|-----|---------|---------------------------|-------------------|
| `createJsonScene` | `Promise<runtime>` | Async HDR / panorama / cube; supports `sceneInfoList` embed | Controlled by `sceneConfig.deployScheduler`; default same-frame immediate |
| `createJsonSceneFit` | `Promise<runtime>` | Same as `createJsonScene` | Same; presets `autoFillLights` + `autoFillCamera` + `autoFitCamera` (`options` can override) |
| `createJsonSceneFromInputFit` | `Promise<runtime>` | Same as above | Same as `createJsonSceneFromInput`, with Fit presets spread in |
| `createJsonSceneSimple` | `runtime` (sync) | Solid-color `background` only; skips native embed (`strict` can throw) | Always immediate; does not await async jobs |
| `deployJsonScene` | `Promise<runtime>` | Same as `createJsonScene` | Same as left |
| `deployJsonSceneSimple` | `runtime` | Same as `createJsonSceneSimple` | Always immediate; does not await async jobs |

**Fit entry note:** `createJsonSceneFit` / `createJsonSceneFromInputFit` are not “fully automatic loading” or `autoFitCamera` only; they are demo/toolchain presets for fill lights, fill camera, and post-deploy framing. Engine defaults are still determined by `createJsonScene` + `mergeRuntimeDefaultOptions`.

### `createJsonSceneFit(payload, options?)` / `createJsonSceneFromInputFit(input, options?)`

Thin wrappers: merge `CREATE_JSON_SCENE_FIT_DEFAULTS` (`autoFillLights`, `autoFillCamera`, `autoFitCamera`, `autoFitCameraMode: "positionAndTarget"`) before calling `createJsonScene` / `createJsonSceneFromInput`. Explicit fields in `options` override presets; `sceneConfig.runtimeDefaults` / `worldInfo.runtimeDefaults` in JSON still merge with existing priority.

When switching scenes or disposing a runtime, call `cancelActiveDeployScheduler()` to cancel in-progress frame-budget / timeslot deployment.

### `createJsonScene(payload, options?)`

Creates a unified runtime / scene from a full JSON payload and automatically deploys its object layer.

Supports two parallel input shapes:

- Human-friendly JSON: `sceneConfig` + `worldInfo.*List` + optional `friendlyMap`
- Standard JSON: top-level `threeJsonId` + `sceneConfig` (main viewport) + `objectList` (all deployable `objType`s); putting everything in `objectList` is still a valid subset

Default friendly JSON groups include:

- `boxModelList`, `sphereModelList`, `groupList`
- `lineList`, `infoPanelList`
- `heatList`, `windList`
- `externalModelList`, `objModelList`
- `domainModelList`
- mixed escape hatch: `modelList` / `objectList`

The unified entry normalizes friendly or standard JSON into a standard `objectList`, then processes by `objType` in phases:

- runtime: `scene`, `camera`, `renderer`, `controls`, `light`, `renderLoop`
- ordinary objects: `box`, `sphere`, `cylinder`, `cone`, `ring`, `torus`, `capsule`, `group`, `line`, `infoPanel`, `text`, `heatMap`, `wind`
- special entries: `externalModel`, `domain`

`options.renderLoopUserPolicy` (optional) controls host-policy merge for `renderLoop.fps` / `renderLoop.lowFps`:

- `fps`: host default FPS (invalid values fall back to `60`).
- `lowFps`: host default low-FPS mode switch.
- `overrideSceneRenderLoop`: when `true`, explicitly overrides scene JSON `fps/lowFps`; when `false`, merges with “scene JSON first, missing items fall back to host settings”.

**Static asset base (`options.assetsBase`, optional)**: per-load override for resolving `/assets/...` paths (see [`sceneConfig.assetsBase`](./json-format.md#sceneconfigassetsbase-optional-static-asset-base-url)). Takes priority over `sceneConfig.assetsBase` and global `setAssetsBaseUrl()`. Cloned-repo demos often use `assetsBase: "/assets"`; npm users omit it to use the default CDN.

### `deployJsonScene(target, payload, options?)`

Deploys the same full JSON onto an existing `Scene` or runtime object; suitable when the page switches scene data and reuses the existing render container. Input shape is identical to `createJsonScene()`, and friendly JSON and standard `objectList` are both supported.

### `createJsonSceneSimple(payload, options?)`

**Same arguments** as `createJsonScene`, but the function body returns synchronously: does not `await` async backgrounds or parse embedded native Three JSON. `externalModel`, audio, SDF text (degraded to texture), etc. may still load asynchronously after return.

### `deployJsonSceneSimple(target, payload, options?)`

Synchronous deploy subset with the same constraints as `deployJsonScene`.

- `options.strict === true`: **throws** when async background or native embed is required, instead of skipping with `console.warn`.
- `options.onSceneReady`: if it returns a `Promise`, only warns and does not wait (use `createJsonScene` for full async bootstrap).

## Static assets (`core/util/assetsBase.js`)

Public base URL module for textures, models, fonts, and built-in domain defaults. Exported from `threejson/core` (re-exported from main entry `threejson`).

| Symbol | Description |
|--------|-------------|
| `ASSETS_PACKAGE_VERSION` | Locked `@threejson/assets` version for jsDelivr (currently `"1.0.0"`) |
| `DEFAULT_CDN_ASSETS_BASE` | Default CDN root URL |
| `LOCAL_ASSETS_BASE` | Local static mount constant `"/assets"` |
| `setAssetsBaseUrl(url)` / `getAssetsBaseUrl()` | App-level base switch |
| `assetUrl(relativePath)` | Join segments like `textures/...` |
| `resolvePublicAssetUrl(url)` | Rewrite `/assets/...` against active base; https unchanged |
| `resolveAssetsBaseFromLoad(payload, options)` | Read `options.assetsBase` or `sceneConfig.assetsBase` |
| `applyAssetsBaseForLoad(payload, options)` | Used in load pipeline; returns restore function |

**Priority (low → high):** `DEFAULT_CDN_ASSETS_BASE` → `setAssetsBaseUrl()` → `sceneConfig.assetsBase` → `createJsonScene({ assetsBase })`.

npm users usually do not need to install [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets) for CDN loading; alternatively install it and serve `node_modules/@threejson/assets` as static files with `setAssetsBaseUrl(...)`.

```js
import {
  createJsonScene,
  LOCAL_ASSETS_BASE,
  setAssetsBaseUrl
} from "threejson/core";

setAssetsBaseUrl(LOCAL_ASSETS_BASE);

await createJsonScene(payload, {
  canvas,
  assetsBase: "/assets"
});
```

Publishing and CDN notes: [`lab/assets-online-hosting-memo.md`](../../lab/assets-online-hosting-memo.md).

### `sceneConfig.deployScheduler` (optional)

Configure object deployment pacing on `sceneConfig` (only on `createJsonScene` / `deployJsonScene` paths):

```json
{
  "deployScheduler": {
    "enabled": true,
    "policy": "frameBudget",
    "maxJobsPerFrame": 12,
    "maxFrameMs": 8
  }
}
```

- Omitted, `enabled: false`, or `mode: "immediate"`: deploy all objects **in the same frame** (default).
- `enabled: true` or `mode: "scheduled"`: queue in phases (2 → 3 → 4); default `policy: "frameBudget"` (per-frame count + millisecond budget).
- `policy: "timeslot"`: compatible with showroom `flowControl` style; uses `fluxMs` / `density` to control `setTimeout` slot intervals.
- `maxInFlightAsync`: limits concurrent phase 3 (`externalmodel`) loads (default 4).
- `retry`: retries only on async load failure (`maxAttempts`, `backoffMs`).
- A single record can write `deployScheduler: { "mode": "immediate" }` to jump the queue and deploy immediately in a scheduled scene.

### `sceneConfig.intro` (optional, Phase 1: postLoad only)

After all objects are deployed, a **DOM overlay** can show image/text slides around `onSceneReady`. By default intro is **awaited** before `onSceneReady`; set `postLoad.excludeFromLoadWait: true` to play intro in the background without blocking `createJsonScene` or the page `#loadingMask`. **`blockInteraction`** defaults to `true` (full-screen pointer capture); when **`excludeFromLoadWait: true` and omitted**, it defaults to **`false`** (`pointer-events: none` on the overlay; with `skipOnClick: true`, only slide content is clickable to skip).

```json
{
  "intro": {
    "enabled": true,
    "backgroundColor": "transparent",
    "postLoad": {
      "excludeFromLoadWait": true,
      "skipOnClick": true,
      "slides": [
        { "type": "text", "content": "Model attribution…", "durationMs": 2000 }
      ]
    }
  }
}
```

- Omitted or `enabled: false`: no intro; `onSceneReady` runs immediately after deploy.
- `createJsonSceneSimple` / `deployJsonSceneSimple`: intro is **skipped** with a console warning.
- Coexists with page `#loadingMask`; use `excludeFromLoadWait` for brief credit flashes alongside persistent `#hint` (see `portShow.json`, `04-05-fps-rapier-collision.json`).
- Phase 2 (not yet): `preLoad`, `showDeployProgress`, `skipOnKey`, editor/player skip setting.

See also [json-format.md](./json-format.md) and [scene-load-lifecycle.md](../scene-load-lifecycle.md).

### `sceneConfig.infoPanel` (optional)

Limits parallel **html2canvas** jobs for `type: "html"` info panels (independent of `deployScheduler`). Applied on `createJsonScene` / `deployJsonScene` load; defaults to **`maxInFlightAsync: 4`** when omitted.

```json
{
  "infoPanel": {
    "maxInFlightAsync": 6
  }
}
```

- `options.onDeployProgress({ done, total, phase, id })`: in `scheduled` mode only, called once per completed object deploy; the `createJsonScene` Promise resolves after **scheduled sync queue + phase3 async pool** complete.

Low-level APIs (custom orchestration): `buildDeployJobs`, `runDeployJobs` (burst and await async jobs), `runDeployJobsImmediate` (burst without await; sync subset paths), `runDeployJobsScheduled` (spread across frames and await), `resolveDeploySchedulerConfig` (all exported from `core/index.js`).

## Single-object API (Object / Batch / Auto)

Import path:

```js
import {
  createJsonObject,
  createJsonObjectBatch,
  createJsonObjectAuto,
  deployJsonObject,
  deployJsonObjectAsync,
  deployJsonObjectBatch,
  deployJsonObjectBatchAsync,
  deployJsonObjectAuto,
  deployJsonObjectAutoAsync
} from "../../core/index.js";
```

### Naming convention

- Default shortest name (e.g. `createJsonObject`) = **single record**.
- `Batch` suffix = **array in / array out**.
- `Auto` suffix = auto-dispatch by input shape (object / array) to single or batch.
- Async naming order: `Object -> Auto -> Async` (e.g. `deployJsonObjectAutoAsync`).

### create vs deploy capabilities

| objType | `createJsonObject` | `deployJsonObject(Async)` |
|--------|---------------------|---------------------------|
| `box/group/line/sprite/points/...` | Supported (returns `Object3D \| null`) | Supported |
| `externalModel/skinned/audio/domain` | Not supported (returns `null`) | Supported |
| `scene/camera/renderer/controls/renderLoop` | Not handled | Not handled |

### target shape

`deploy*` series `target` supports:

- `THREE.Scene`
- `THREE.Object3D`
- `{ scene: THREE.Scene }`

### Mode restrictions

- `objectLoadHandler` series supports `record` (pure `objType` records) only.
- Passing `options.mode !== "record"` throws `E_OBJECT_MODE_MISMATCH`.
- Hierarchical subtrees in the payload use **`subScene[]`** (see [JSON configuration guide](../json-format.md#subscene-嵌套层级对象)).

### Minimal examples

```js
// 1) Single (default)
const mesh = createJsonObject({ objType: "box", geometry: { width: 1, height: 1, depth: 1 } });
await deployJsonObjectAsync(scene, { objType: "box", geometry: { width: 1, height: 1, depth: 1 } });

// 2) Batch
const list = createJsonObjectBatch([{ objType: "box" }, { objType: "sphere" }]);
deployJsonObjectBatch(scene, [{ objType: "box" }, { objType: "sphere" }]);

// 3) Auto (input may be single or array)
const maybeMany = createJsonObjectAuto(inputJson);
await deployJsonObjectAutoAsync(scene, inputJson);
```

### Error code convention (implementation guidance)

- `E_OBJECT_RECORD_INVALID`: invalid object record (missing / invalid `objType`).
- `E_OBJECT_MODE_MISMATCH`: `mode` does not match input shape.

### `.tjz` entry recommended calls (current policy)

```js
import {
  createJsonSceneFromArchive,
  deployJsonSceneFromArchive,
  inspectJsonSceneArchiveEntry
} from "../../core/index.js";

// 1) .tjz entry = full scene payload
const runtime = await createJsonSceneFromArchive(tjzBytesOrUrl, {
  canvas,
  missingAssetPolicy: "warn"
});

// 2) .tjz entry = single object record (objType)
const scene = existingRuntime.scene;
await deployJsonSceneFromArchive(scene, tjzRecordEntryBytesOrUrl, {
  objectEntryMode: "append", // "append" | "replace"
  missingAssetPolicy: "warn"
});

// 3) Inspect entry type (scene/object) only, no deploy
const info = await inspectJsonSceneArchiveEntry(tjzBytesOrUrl);
console.log(info.entryKind); // "scene" | "object" | "unknown"
```

Notes:

- Current `.tjz` entry support: `full scene payload`, `object record`.
- Nested hierarchy in the payload uses **`subScene[]`** (see [JSON configuration guide](../json-format.md#subscene-嵌套层级对象)).

## Export API (scene / object / archive)

Import path:

```js
import {
  sceneToJson,
  sceneToStandardJson,
  sceneToStandardJsonSimple,
  sceneToFriendlyJson,
  rebuildStandardJson,
  rebuildFriendlyJson,
  collectObjectListFromScene,
  exportJsonScene,
  exportJsonSceneText,
  sceneToNativeJson,
  exportJsonObject,
  exportJsonObjectBatch,
  exportJsonObjectByType,
  exportJsonObjectByTypeList,
  packJsonSceneArchive,
  packJsonObjectArchive,
  packJsonObjectBatchArchive
} from "../../core/index.js";
```

### `sceneToJson(scene, options?)` (primary API)

Reverse-scans a running `THREE.Scene` into scene descriptor JSON.

- `options.format`: `"standard"` (default) | `"friendly"`.
- `options.mode`: `"read"` (default) | `"rebuild"` (initial rebuild same as read).
- `options.scanDepth`: `"deployRoots"` (default) | `"registryRoots"` | `"traverse"`.
- `options.basePayload`: merge base; `threeJsonId` entries not seen in fresh scan are kept from base (when `merge: true`). **Editor** defaults to current `sysConfig.jsonData` via `resolveEditorMergeBase()` (not session `autoSnapshot`).
- `options.merge`: default `true`; when `false`, outputs fresh list only. Editor uses `merge: false` for first snapshot after full scene load/restore.
- `options.embedNative`: default `false`; when `true`, writes `worldInfo.sceneInfoList` via `sceneToNativeJson`.
- `options.runtimeTarget`: includes `scene`, `camera`, etc., for injecting `sceneConfig`.
- `options.friendlyMap`: used only by `sceneToFriendlyJson` / `format: "friendly"`.

Aliases: `sceneToStandardJson` (async), `sceneToStandardJsonSimple` (sync subset), `sceneToFriendlyJson`, `rebuildStandardJson`, `rebuildFriendlyJson`, `collectObjectListFromScene`.

Produces **standard JSON (scheme B)**: `{ threeJsonId, objectList, sceneConfig, assetLibrary?, extensions?, saveMeta }` (`isCanonicalScenePayload` is false when top-level `sceneConfig` is present — expected). Main viewport `camera`/`light`/`controls` go into `sceneConfig` with `jsonOrigin: "config"`; extra deploy instances in `objectList` carry `jsonOrigin: "list"`. See [`lab/standard-json-shape-proposal.md`](../../lab/standard-json-shape-proposal.md).

### `sceneToNativeJson(scene, options?)`

Project wrapper around Three.js `Object3D.toJSON()`. **Orthogonal** to `sceneToJson`: for native `sceneInfoList`, emergency fallback saves — **not** the daily objectList primary path.

### `exportJsonScene(targetOrPayload, options?)`

**Thin wrapper** around `sceneToJson` (symbol retained, not deprecated). For runtime targets (`scene.isScene`), forwards all `options` to `sceneToJson`.

- `options.format`: `"standard"` (default) | `"friendly"` | `"three-native"`.
- `includeSceneInfoList`: equivalent to `embedNative: true`.
- `includeRuntimeRecords`: default `true`; when `false`, does not inject runtime records for `scene/camera/renderer/controls/light/renderLoop`.
- Payload-only branch (non-runtime): `friendly` goes `convertFriendlyJsonToStandardJson` → `convertStandardJsonToFriendlyJson`; `standard` converts to standard only.
- `three-native` semantics: calls Three.js native export JSON (or consumes existing native JSON) and wraps it in a shell recognizable by `nativeThree.parseInline`.

### `exportJsonObject(target, id, options?)`

- Exports a single object as a standard `record` (`{ objType, ... }`).
- Selector: `options.by = "threeJsonId" | "uuid"` (default `threeJsonId`).
- Batch: `exportJsonObjectBatch`; by type: `exportJsonObjectByType` / `exportJsonObjectByTypeList`.

### `.tjz` export

- `packJsonSceneArchive(targetOrPayload, options?)`: packs a full scene into `.tjz`.
- `packJsonObjectArchive(target, id, options?)`: packs a single object record into `.tjz`.
- `packJsonObjectBatchArchive(target, ids, options?)`: batch object pack.
- `manifest.entryKind`: written automatically on export (scene/object); import can use it for entry type detection.

`assetPolicy` rules:

- `preserve` (default): keeps resource references in JSON, does not extract to `assets/`.
- `tryPack`: attempts to rewrite resolvable assets to `pack://assets/...` and write into zip (includes `data:` textures, `lib://` in `events.*.script` / `scriptUrl`, and external URLs when fetch is enabled; **default `assetPolicy: preserve` is off**).
- When `format === "three-native"`, packing does **not** extract textures/models; native JSON content enters `scene.json` as-is.

## Mesh export API (3D exchange formats)

Independent entry **parallel** to JSON / `.tjz`; does not extend `exportJsonScene` `format` enum.

```js
import { exportMesh, exportMeshObject } from "../../core/index.js";
```

### `exportMesh(target, options?)`

Exports GLB/GLTF/OBJ/STL/PLY/USDZ from a running scene or selected subtree (FBX requires optional dependency `@comfyorg/fbx-exporter-three`).

- `options.format`: `"glb"` (default) | `"gltf"` | `"obj"` | `"stl"` | `"ply"` | `"usdz"` | `"fbx"`
- `options.scope`: `"scene"` (default) | `"selection"` | `"object"` (with `object3D`)
- `options.selectedObject3D`: pass when `scope: "selection"`
- `options.shouldSkipObject`: default `shouldSkipSceneExportNode`
- `options.externalModelPolicy`: `"include"` (default) | `"omitHeavy"`
- `options.renderer`: pass current `WebGLRenderer` for GLTF/USDZ texture encoding
- `options.outputType`: `"arraybuffer"` (default) | `"string"`

Returns `{ format, data, mimeType, extension, fileNameHint, warnings, omittedExternalModels, stats }`. core does **not** write disk; browser side uses `Blob` + download.

### `exportMeshObject(target, id, options?)`

Exports a single deploy root by `threeJsonId` / `uuid` (mirrors `exportJsonObject` lookup semantics).

## Mesh import API (3D exchange formats)

Shares JSON deploy pipeline via `objType: "externalModel"`; editor local files use blob URLs and do not reverse-depend on `scene-editor.html`.

```js
import {
  importMeshBlob,
  importMeshFromArrayBuffer,
  buildExternalModelImportRecord,
  parseMeshArrayBufferToObject3D
} from "../../core/index.js";
```

### Supported formats (symmetric with export)

`glb` | `gltf` | `obj` | `stl` | `ply` | `usdz` | `fbx` (`usd` treated as `usdz` alias)

JSON runtime: `modelFileType` + `modelPath` (URL / blob / data) dispatched via `loadExternalModel` / `loadExternalModelAsync`. Unknown types throw `E_EXTERNAL_MODEL_UNSUPPORTED`.

### `importMeshBlob(blob, options?)`

Browser-side: converts `File`/`Blob` to a deployable `externalModel` record (`modelPath` is a `blob:` URL). Returns `{ record, format, objectUrl, revokeObjectUrl }`.

### `importMeshFromArrayBuffer(buffer, options?)`

Parses binary/text buffer directly to `Object3D` (tests and custom pipelines).

### `buildExternalModelImportRecord(options)`

Builds a standard `externalModel` descriptor from `fileName` / `modelPath` / `modelFileType`, and fills in `threeJsonId`.

## Business domain dispatch API

All of these can be imported from `../../core/index.js`; they route `worldInfo.domainModelList` from human-friendly JSON, or `objType: "domain"` records from standard JSON, to registered business domains. For full domain concepts, descriptor structure, and creation steps, see [Business domains and `domains/`](../domains.md).

Import path:

```js
import {
  applyDomainModelsFromWorldInfo,
  applyDomainModelList,
  invokeDomainModel,
  deployMeshWithDomains,
  deployMeshListWithDomains,
  businessDomains
} from "../../core/index.js";
```

### `applyDomainModelsFromWorldInfo(scene, worldInfo, ctx?)`

Reads records from `worldInfo.domainModelList` and dispatches them one by one.

- Suitable when the page has the full world JSON and runs dispatch uniformly.
- Each record needs at least a `domain` field.
- `ctx` is passed through to the domain; use it for `jsonData`, `sceneJsonRoot`, `loadingManager`, and other runtime context.

```js
applyDomainModelsFromWorldInfo(scene, jsonData.worldInfo, { jsonData });
```

### `applyDomainModelList(scene, domainModelList, ctx?)`

Runs the same dispatch logic on an array directly; suitable when the page assembles temporary domain records and runs them uniformly.

```js
applyDomainModelList(scene, [
  { domain: "nativeThree", handler: "loadFromUrl", modelPath: "/assets/json/three_native.json" }
]);
```

### `invokeDomainModel(scene, record, ctx?)`

Convenience entry for a single record; equivalent to `applyDomainModelList(scene, [record], ctx)`.

```js
invokeDomainModel(scene, {
  domain: "nativeThree",
  handler: "loadFromUrl",
  modelPath: "/assets/json/three_native.json"
});
```

### `businessDomains`

Exposes each domain’s declared `api` by business domain id. Suitable for imperative calls when the page already knows which domain to operate on.

```js
businessDomains.port.createPortStatistics(sceneJsonRoot, scene, "capacity");
```

Accessing a non-existent `businessDomains.<id>` returns `undefined`.

### `deployMeshWithDomains(scene, meshRecord, ctx?)`

Deploys a single mesh descriptor (from friendly JSON `boxModelList`, `sphereModelList`, `meshList` normalization, or canonical `objectList`). Execution order:

1. If `legacyBoxObjTypes` match (e.g. `dockCrane`, `wall`, `glass`), use `domain.resolveDomainModel`.
2. If `sceneConfig.enableComposeBoxModel === true`, try each domain’s `composeBoxModel()`.
3. Otherwise call `deployMesh()` for primitives with `objType` `box` / `sphere`, etc.

`createJsonScene` routes `objType: "domain"` records through `invokeDomainModel` separately.

### `deployMeshListWithDomains(scene, meshList, ctx?)`

Batch version of `deployMeshWithDomains()`. Prefer this over hand-written `deployMesh()` loops when loading friendly scenes.

## `core/builder/modelBuilder.js`

Import path:

```js
import {
  createMesh,
  deployMesh,
  createBox,
  deployBox,
  createSphere,
  createGroup,
  createLine,
  createLine2,
  createWind,
  createHeatmap,
  createHeatmapVolume,
  createCylinder,
  createCone,
  createRing,
  createTorus,
  createCapsule,
  loadExternalModel
} from "../../core/builder/modelBuilder.js";
```

### `createMesh(json)`

Creates a ThreeJS object from JSON without adding it to the scene.

- When `json.objType === "sphere"`, creates a sphere.
- When `json.objType === "cylinder" | "cone" | "ring" | "torus" | "capsule"`, creates the corresponding primitive.
- Legacy `boxType` and `geometry.type === "SphereGeometry" | "CylinderGeometry" | ...` remain compatible.
- Otherwise defaults to a box.
- Return value is usually `THREE.Mesh`; door animation or CSG may return a processed object.

### `deployMesh(json, scene)`

Calls `createMesh(json)` and adds the result to `scene`. This is the recommended single-object entry.

```js
deployMesh(boxJson, scene);
deployMesh(sphereJson, scene);
```

### `createBox(json)` / `deployBox(json, scene)`

Box-specific entry. If JSON has `material.textureUrl` or `materials`, textures are loaded before material creation.

Note: current `deployBox()` takes a single box JSON, not an array. Callers batch-deploy by iterating.

```js
boxModelList.forEach((boxJson) => deployBox(boxJson, scene));
```

### `createSphere(json)`

Sphere-specific entry. Standard form is `objType: "sphere"`; legacy `boxType: "sphere"` remains compatible.

### `createCylinder(json)` / `createCone(json)` / `createRing(json)` / `createTorus(json)` / `createCapsule(json)`

New primitive shortcuts; all use the single-material primitive build chain and work with `deployMesh()` directly.

### `createGroup(groupJson)`

Creates an **empty shell** `THREE.Group` from `groupJson` transform/name fields. **Does not** deploy children inside this function. Use the unified load chain (`createJsonScene`, `deployGroupDescriptor`, `deployObjectRecord` with `objType: "group"`) to read **`subScene[]`** and attach children recursively.

Legacy **`boxModelList` / `subGroup`** on group records are migrated to `subScene` only at normalization; new JSON should write `subScene` directly.

```js
const group = createGroup(groupJson);
scene.add(group);
// For children, use deployGroupDescriptor(scene, groupJson) or other unified entries.
```

### `createLine(lineJson)`

Creates a plain `THREE.Line`. Most browsers/WebGL implementations do not truly support `linewidth`.

### `createLine2(lineJson)`

Creates a `Line2` with line width support. Prefer this when JSON has `material.linewidth`.

```js
scene.add(createLine2(lineJson));
```

### `createWind(windJson, scene)`

Creates a textured animated plane, mainly for flow arrows, airflow, water flow, etc. If the page uses `createSceneRuntime()` or `createRenderLoop()`, the unified loop calls `TWEEN.update()` via `animationHandler`; legacy hand-written loops require the caller to run `TWEEN.update()`.

### `createHeatmap(heatJson, scene)`

Planar heatmap: **only** creates `PlaneGeometry` with a heat texture. **Does not read** `geometry.depth` (ignored if present in JSON).

### `createHeatmapVolume(heatJson, scene)`

Volumetric heatmap: uses `createHeatmapVolumeMesh` when `geometry.depth` is a finite positive number. **Otherwise** equivalent to `createHeatmap(heatJson, scene)` (degrades to plane).

Default color ramps: `createHeatmap` uses `HEATMAP_LEGACY_COLOR_STOPS` (light base at zero); `createHeatmapVolume` passes volume-specific `HEATMAP_LEGACY_COLOR_STOPS_VOLUME` (zero must be dark for raymarch `dens=max(rgb)`).

### Scene highlight (OutlinePass, three channels)

Highlight domain: `domains/sceneHighlight`, three channels:

- `info` (white) — information selection
- `locate` (yellow) — locate / alarm handled
- `alarm` (red) — alarm

Two common patterns:

1. Deploy pass only (JSON / deploy): domain `createSceneHighlightPassJson()` + core pass deploy chain.
2. Page initializes bundle + controller directly: `sceneHighlight.createPageHighlightSetup(scene, camera, { composer, channelOptions, resolveOptions })`.

`createPageHighlightSetup()` returns:

- `bundle` (domain bundle)
- `controller` (interaction controller with `setInfoHighlight` / `addLocateObjects` / `addAlarmObjects`, etc.)
- `infoPass` / `locatePass` / `alarmPass` (per-channel OutlinePass)

Note: editor **outline** uses `THREE.BoxHelper`, controlled by page-side `createBoxEdgeHelper()` — not part of highlight (OutlinePass).
- Pick helpers (`meshPick.js`): `isDescendantOf`, `isHitOnTransformControlsHelper`.

### `loadExternalModel(externalModel, scene)`

Unified external model entry (recommended):

- Standard entry is `objType: "externalModel"`.
- In friendly JSON, usually via `worldInfo.externalModelList` or `worldInfo.objModelList`, normalized to standard records by the friendly layer.
- Reads `modelFileType` first; if missing, infers from `modelPath` extension.
- Still cannot determine type → parse fails; no silent fallback to OBJ.
- `obj`: uses OBJLoader; when `mtlPath` exists, loads MTL then OBJ. If `mtlPath` is omitted, tries to derive same-directory `.mtl` from `mtllib` in `.obj` content.
- `gltf` / `glb`: uses GLTFLoader (with Draco).
- `three` / `threejson` / `object`: uses Three.js `ObjectLoader`.
- `mtl` is not a standalone visible model type; only a material dependency for `obj`.

OBJ texture resolution order:

1. Prefer slots already declared in MTL.
2. If OBJ JSON provides `maps`, fill missing slots.
3. If no `maps`, try loading from same-directory `maps/` folder by convention (`mapsFolderFallback`: `"map"` default diffuse only, `"full"` all slots, `"off"` disabled).
4. Finally fall back to legacy `material.textureUrl` / `material.map`.

## `core/builder/textBuilder.js`

Import path: `../../core/builder/textBuilder.js` (also exported from `../../core/index.js`).

### `createText(parent, record, ctx?)` / `createTextAsync(parent, record, ctx?)` / `deployText(parent, record, ctx?)`

Deploys in-scene text with **`objType: "text"`**. `mode` supports `sdf` (default), `texture`, `mesh` (see [JSON configuration guide § text](../json-format.md#text场景内文字)).

- **`createTextAsync`**: full async path for sdf / mesh / texture with lazy troika load and fallbacks.
- **`createText`**: sync subset; stable `texture` only; `sdf` / `mesh` **degrade synchronously to texture** (warn).
- **`deployText`**: calls sync `createText` (aligned with `createJsonSceneSimple` paths).

Async scene load (`createJsonScene`, etc.) uses `createTextAsync` internally and awaits it.

### `preloadSceneTextFonts(sceneConfig, objectList?)`

Pre-warms glyphs before deploy when the scene has SDF text (also lazy-loads troika internally). No-op when there is no SDF text.

### `sceneNeedsSdfText(sceneConfig, objectList?)`

Whether the scene needs troika (for host pages deciding import map configuration).

## `core/builder/infoPanelBuilder.js`

Import path:

```js
import {
  deployInfoPanel,
  deployBoxInfoPanel,
  deploySpriteInfoPanel,
  deployPlaneInfoPanel,
  createInfoPanelDescriptor,
  normalizeInfoPanelDescriptor
} from "../../core/builder/infoPanelBuilder.js";
```

### Parse pipeline

1. `normalizeInfoPanelDescriptor(infoPanel)` — fill defaults (`panelBoxType`, `type`, etc.).
2. `createInfoPanelDescriptor(text, position, options)` — shorthand descriptor (**no scene.add**).
3. `resolveInfoPanelTexture(descriptor)` — build/load texture by `type` (`Promise<THREE.Texture>`).
4. `buildInfoPanelObject(descriptor, texture)` — build Mesh or Sprite by `panelBoxType` (**no scene.add**).
5. `deployInfoPanel(scene, infoPanel)` — full pipeline + `scene.add` (**recommended entry**).

### `deployInfoPanel(scene, infoPanel)`

Chooses carrier by `infoPanel.panelBoxType`:

- `panelBoxType: "box"`: box panel (`panelDepth`, optional `textFace: "full"`).
- `panelBoxType: "sprite"`: sprite panel, always faces the camera.
- `panelBoxType: "plane"`: fixed-orientation plane (+Z textured; optional `panel.material.side`).
- In friendly JSON `infoPanelList`, per-item `objType` can be omitted.
- Legacy `boxType` remains compatible.

**Usage patterns** (see [Info panels guide](./info-panels.md)):

- Scene load: `worldInfo.infoPanelList` deployed by `createJsonScene`.
- Menu refresh: use [`applyInfoPanelList`](#corehandlerinfopanelruntimejs) or `updateInfoPanel`.
- Click-to-show: host reads nested `infoPanel` on object, updates `panel.position`, then calls this API.
- Persistent signs: omit `dismissTrigger` (same as `none`); panels are not auto-dismissed by core. See [event-mechanism § infoPanel dismissTrigger](./event-mechanism.md).

`infoPanel.type` supports:

- `text`: plain text, texture drawn on canvas.
- `html`: converts HTML to texture via `html2canvas`.
- `img`: loads an image as texture.

### `deployBoxInfoPanel` / `deploySpriteInfoPanel` / `deployPlaneInfoPanel`

Force carrier type then deploy.

For **runtime updates** of existing panels, use [`infoPanelRuntime`](#corehandlerinfopanelruntimejs) `updateInfoPanel` / `updateInfoPanelContent` (by `threeJsonId`). Builder `update*InfoPanel` APIs have been removed.

### `createInfoPanelDescriptor(text, position, options)`

Build infoPanel JSON descriptor; no Three.js object.

## `core/handler/boxModelListCoalescer.js`

```js
import { coalesceBoxModelList } from "../core/handler/boxModelListCoalescer.js";
```

### `coalesceBoxModelList(boxModelList)`

Light preprocessing on a box list:

- Boxes sharing `instanceCode` aggregate into one `instance: true` record.
- Boxes sharing `mergeCode` aggregate into one `merge: true` record.

## `core/handler/csgBrushOps.js`

```js
import {
  createBrushFromMesh,
  evaluateMeshBoolean
} from "../core/handler/csgBrushOps.js";
```

### `evaluateMeshBoolean(masterMesh, slaveMesh, operation?)`

CSG boolean on two meshes. `operation`: `union` / `subtract` / `intersect` / `difference`, or aliases `add` / `sub` / `inter` / `diff`. JSON `holes` / `joins` / `inters` are applied via `modelBuilder`.

## `core/handler/modelHandler.js`

Import path:

```js
import {
  checkModelType,
  impactCheck,
  impactHandler,
  clearImpactCheck
} from "../../core/handler/modelHandler.js";
```

### `checkModelType(model, type)`

Whether the object is the given `objType`.

### `impactCheck` / `impactHandler` / `clearImpactCheck`

Editor AABB collision queries and helper lifecycle.

## `core/handler/objectObjType.js`

ObjType-indexed query and batch ops via `objectRegistry` + `objTypeIndex` (replaces removed traverse APIs).

```js
import {
  getObjectsByObjType,
  setObjectsVisibleByObjType,
  destroyObjectsByObjType,
  transObjectsByObjType
} from "threejson";
```

## `core/handler/objectDomain.js`

Query canonical domain deploy roots (`objType: "domain"` + `domain`) via `domainIndex`. Page batch visibility should still prefer `name`; use this API for tools/editors filtering by domain id.

```js
import {
  getThreeJsonIdsByDomain,
  getObjectsByDomain,
  getObjJsonListByDomain
} from "threejson";
```

| API | Description |
|-----|-------------|
| `getObjectsByDomain(scene, domainId, options?)` | e.g. `getObjectsByDomain(scene, "device.cabinet")`; optional `{ root }` subtree scope |
| `getObjJsonListByDomain(scene, domainId, options?)` | Returns descriptor list |
| `getThreeJsonIdsByDomain(domainId)` | Indexed `threeJsonId[]` |

Only deploy roots with `objType === "domain"` and non-empty `domain` are indexed (flat records like `objType: "door"` are excluded).

## `core/handler/infoPanelRuntime.js`

```js
import {
  setInfoPanelVisibleByThreeJsonId,
  updateInfoPanel,
  updateInfoPanelContent,
  applyInfoPanelList,
  hideInfoPanelsByNames
} from "threejson";
```

| API | Description |
|-----|-------------|
| `setInfoPanelVisibleByThreeJsonId(id, visible)` | Visibility by `threeJsonId` |
| `updateInfoPanel(id, partial, { scene })` | **Core**: registry lookup, merge partial, in-place mutation or redeploy on carrier mismatch |
| `updateInfoPanelContent(id, partial, { scene })` | Thin wrapper: content-only partial, delegates to `updateInfoPanel` |
| `applyInfoPanelList(scene, list)` | `updateInfoPanel` if registered, else `deployInfoPanel` |
| `hideInfoPanelsByNames(names, visible)` | Batch visibility by `name` |

## `domains/device` — device panel

Device records (UPS, AC, cabinet domain entries) bind info panels in three ways. At runtime **`devicePanelRef`** is the bound panel’s **`threeJsonId`** (single source of truth; filled back into `objJson` after deploy for modes 2/3).

```js
import {
  resolveDevicePanelBinding,
  resolveDevicePanelRef,
  resolveDevicePanelRefFromRoot,
  showDevicePanel,
  hideDevicePanel,
  bindDevicePanelTriggers,
  handleDevicePanelDblClick
} from "threejson";
```

### Three binding modes (priority **ref > info > infoPanel**)

| Priority | Condition | Behavior |
|----------|-----------|----------|
| **1** | non-empty `devicePanelRef` | Reference an existing panel id; **no** subScene deploy of inline panel |
| **2** | no ref, has `info` shorthand | Generate sprite panel; default id `${device.threeJsonId}__infoPanel`; **fill `devicePanelRef`** |
| **3** | no ref, no info, has `infoPanel` | Full descriptor; **fill `devicePanelRef`**; subScene deploy |

Panels from modes 2/3 use **`name: "devicePanel"`** for batch visibility; generic `infoPanelList` entries use **`name: "infoPanel"`**; cabinet door number labels (`buildCabinetNumPanel`) use **`name: "cabNumPanel"`**.

### Invalid `devicePanelRef`: **warn only, no fallback**

If **`devicePanelRef` is a non-empty string**, the resolver uses **mode 1 only**; `info` / `infoPanel` on the same record are **ignored**.

If the ref is missing from the registry: console **`[device] devicePanelRef not found: …`**; **no** fallback to inline `infoPanel` / `info`; **no** automatic subScene deploy. `showDevicePanel` looks up by ref and fails if not found. Fix the ref or **remove `devicePanelRef`** to enable modes 2/3.

### Runtime API

| API | Description |
|-----|-------------|
| `resolveDevicePanelBinding(record)` | Resolve binding; returns `{ devicePanelRef, mode?, panelDescriptor? }` |
| `resolveDevicePanelRef(record)` | Read `devicePanelRef` or binding result |
| `resolveDevicePanelRefFromRoot(idOrRoot)` | Resolve panel id from device root |
| `showDevicePanel` / `hideDevicePanel` | → `setInfoPanelVisibleByThreeJsonId(devicePanelRef, …)` |
| `updateDevicePanelContent` | → `updateInfoPanelContent` |
| `bindDevicePanelTriggers(scene, deviceRoot, options?)` | Low-level compatibility API; prefer JSON trigger fields + event-derived actions for new scenes |
| `bindDevicePanelKeyboardTriggers(scene, options?)` | Keyboard triggers from JSON |
| `handleDevicePanelDblClick(scene, deviceRoot, options?)` | Low-level compatibility API; prefer `panelShowTrigger` / `panelHideTrigger` for device panel dblclick behavior |
| `resolveDevicePanelHostRoot(node)` | Resolve device domain root or panel host from picked node |
| `ensureDevicePanelDeployed(scene, hostRoot)` | Backfill `devicePanelRef` and deploy inline panel if missing |

### Trigger fields (on device record)

**Explicit opt-in**: ELM bindings are derived only when the record **sets** `panelShowTrigger` and/or `panelHideTrigger`. Inline `infoPanel` without those fields does **not** auto-bind hover/mouseleave.

Nested `infoPanel.visible` controls **initial visibility at deploy** (same as [`infoPanelBuilder`](../../core/builder/infoPanelBuilder.js): omit or `true` → show; explicit `false` → hide). Interaction uses triggers / `dismissTrigger`; device domain does **not** derive `object.ready` visibility.

| Field | Values | Default (parse fallback when omitted; does **not** auto-bind) |
|-------|--------|---------|
| `panelShowTrigger` | `hover` \| `click` \| `dblclick` \| `none` | `hover` |
| `panelHideTrigger` | `mouseleave` \| `click` \| `dblclick` \| `panel.click` \| `panel.dblclick` \| `none` | `mouseleave` |
| `panelHideDelayMs` | number (when hide=mouseleave) | `200` |
| `devicePanelKeyboardTrigger` | string (e.g. `"p"`, `"Escape"`; matched against `event.key`, case-insensitive) | — |

`none` means **no pointer trigger** for that direction (show/hide only via host API or JSON `visible`). `hover` / `mouseleave` map to ELM `pointerover` / `pointerout`; `panel.click` / `panel.dblclick` hides when the panel itself is picked. If nested `infoPanel.dismissTrigger` is set explicitly, it takes priority to avoid duplicate bindings. For **lazy deploy** (panel created on first show/toggle), `panelHideTrigger: panel.*` is wired after deploy.

Keyboard triggers use **`bindDevicePanelKeyboardTriggers(scene, options?)`**: scans the scene for records with `devicePanelKeyboardTrigger` and toggles the bound panel on keydown.

Implementation: [`domains/device/devicePanelResolver.js`](../../domains/device/devicePanelResolver.js), [`devicePanelRuntime.js`](../../domains/device/devicePanelRuntime.js), [`devicePanelActions.js`](../../domains/device/devicePanelActions.js).

## `core/handler/objectRegistry.js`

Import path:

```js
import {
  getObjectByThreeJsonId,
  getObjectByUuid,
  getObjectByRefName,
  getObjectsByName,
  rebuildObjectRegistryFromScene,
  setUserDataObjJson
} from "../../core/handler/objectRegistry.js";
```

### `getObjectByThreeJsonId(id)`

Retrieves a single runtime object by `threeJsonId`. Best for cross-session, most stable object references.

### `getObjectByUuid(uuid)`

Retrieves a single object by Three.js session `uuid`. Good for debugging or temporary refs; not for persistent IDs.

### `getObjectByRefName(refName)`

Retrieves a single object by `refName` / `runtimeRef` / `ref`. Treat scene objects as programmable names.

### `getObjectsByName(name)`

Finds objects by `Object3D.name`. Returns an array because `name` is not guaranteed unique.

### `resolveObjectDisplayLabel(descriptor, options?)`

```js
import { resolveObjectDisplayLabel, resolveObjectDisplayLabelFromObject } from "threejson";
```

Returns **display label** for an object or scene descriptor: `label → name → threeJsonId → options.fallback` (default `"未命名"`). **Not** used by `getObjectsByName` or visibility APIs.

### Object visibility (`core/handler/objectVisibility.js`)

```js
import {
  setObjectVisibleByThreeJsonId,
  setObjectsVisibleByName,
  setObjectsVisibleByNames,
  setObjectsVisibleByCustomBucket,
  setObjectsVisibleByCustomBuckets
} from "threejson";
```

- `setObjectsVisibleByName(name, visible, options?)` — exact match on descriptor `name`, returns hit count; default `applyToSubtree: true` (also toggles descendant nodes with `objJson`); pass `{ applyToSubtree: false }` to affect registry roots only
- `setObjectsVisibleByNames(names, visible, options?)` — batch toggle for multiple `name`s, same options
- For display text, read `label` (`resolveObjectDisplayLabel`); not used in the queries above

### `rebuildObjectRegistryFromScene(scene, options?)`

Re-scans the current scene and rebuilds the object registry. Use when objects were inserted externally or the registry may be out of sync.

### `setUserDataObjJson(object, objJson)`

Writes the descriptor to `object.userData.objJson` and **preserves** other `userData` keys (avoids overwriting extensions like `holeData`).

## `core/handler/objectDescriptorAttach.js`

- `setUserDataObjJson(object, objJson)`: writes `userData.objJson` and preserves other `userData` keys.
- `attachDescriptorToObject(object, descriptor)`: attaches descriptor reference when `objJson` is not yet present.

(`objectRegistry.js` still **re-exports** these symbols for compatibility; new code can import from this module directly.)

## `core/handler/sceneRuntimeApi.js`

- `applyTransform(object, patch)`: `patch` may include subsets of `position` / `rotation` / `scale` / `visible`, applied to `Object3D`.

## `core/handler/descriptorSync.js`

- `patchObjectDescriptor(object, partial, options?)`: shallow-merge into `userData.objJson`; default `markDescriptorBindingJsonDirty`.
- `reconcileTransformToDescriptor(object, options?)`: writes `position` / `rotation` / `scale` from object back to descriptor (consistent with box-style fields).
- `scheduleThrottledReconcileTransform(object, { delayMs?, markBindingDirty? })`: Hybrid — debounced Object→JSON write-back (millisecond scale, default `delayMs` about 48).
- `cancelThrottledReconcileTransform(object)`: cancels pending debounced write-back.

## `threejson/runtime-mutation` (`core/runtime/objectMutation/index.js`)

Runtime changes on **registered objects** by `threeJsonId` (object and `userData.objJson` stay in sync). Same APIs can be imported from `core/index.js`.

### Import example

```js
import {
  applyObjectChange,
  applyObjectChangeAsync,
  applyObjectPartial,
  applyObjectPartialAsync,
  captureObjectSnapshot,
  applyObjectSnapshot,
  applyObjectSnapshotAsync
} from "threejson/runtime-mutation";
```

### `applyObjectChange(threeJsonId, path, value, options?)`

Sets a single path; default strict (fails if intermediate keys are missing).

| Option | Description |
|--------|-------------|
| `createMissing?: boolean` | When `true`, allows auto-creating intermediate object chains (default `false`) |
| `markBindingDirty?: boolean` | Default `true`; triggers `markDescriptorBindingJsonDirty` |
| `scene?: Scene` + `autoRedeploy?: boolean` | When change is judged `needsRedeploy=true`, can auto-call `redeployObject` |

Return value (sync):

```js
{
  ok: boolean,
  error: string | null,
  threeJsonId: string,
  object3D: Object3D | null,
  descriptor: object | null,
  needsRedeploy: boolean,
  path: string,
  kind: "transform" | "name" | "visible" | "materialTexture" | "materialColor" | "material" | "structural" | "generic"
}
```

### `applyObjectChangeAsync(threeJsonId, path, value, options?)`

Same semantics as `applyObjectChange`, with `awaitTextures: true` — waits for texture downloads before returning.

### `applyObjectPartial(threeJsonId, partial, options?)`

Shallow-merge top-level fields (e.g. `position` / `name` / `visible` / `material`) and sync to object immediately.

- Sync version: starts texture load but does not await
- `applyObjectPartialAsync`: awaits texture load before return

### `captureObjectSnapshot(threeJsonId)`

Returns a deep copy of that object’s `objJson` (for undo stack or temporary protection); `null` if object not found.

### `applyObjectSnapshot(threeJsonId, snapshot, options?)`

Restores the snapshot as the object’s current `userData.objJson` and syncs to `Object3D`.

- Sync version: does not await textures
- `applyObjectSnapshotAsync`: awaits textures

### `needsRedeploy` semantics

Structural field changes mark `needsRedeploy: true`:

- `objType` / `boxType` / `geometry`
- `subScene` / `boxModelList` / `subGroup` (legacy group fields usually need redeploy)
- `joins` / `inters` / `holes`

Typical usage:

```js
const res = applyObjectChange(id, "geometry.type", "sphere");
if (res.needsRedeploy) {
  redeployObject(scene, id);
}
```

## Runtime structure commands (`core/runtime/sceneObjectCommands.js`)

**Add/remove** on the scene (not property edits). See [runtime-object-commands.md](../runtime-object-commands.md).

```js
import {
  addObjectFromDescriptor,
  addObjectFromDescriptorAsync,
  removeObjectById
} from "../../core/index.js";
```

| API | Description |
|-----|-------------|
| `addObjectFromDescriptor(scene, descriptor, options?)` | Sync deploy; slow types may set `needsAsync: true` |
| `addObjectFromDescriptorAsync(scene, descriptor, options?)` | Awaits async deploy |
| `removeObjectById(scene, threeJsonId, options?)` | Returns `removedDescriptor`, `removedParentThreeJsonId`; optional `captureSubtree` |

`options.parent`: `Scene` | `Object3D` | parent `threeJsonId` string. Duplicate id rejected. Protects camera/renderer etc. by default; override with `allowProtectedRemoval: true`.

## `threejson/patch-core` (`core/handler/jsonPatchApplyCore.js`)

Whitelist patch on pure JSON; does **not** trigger descriptor binding dirty marks; suitable for unit tests or when upstream handles `markDescriptorBindingJsonDirty`.

- `applyJsonPatchToJsonDocument(doc, patch, options?)`

## `threejson/patch` (`core/handler/jsonPatchDescriptor.js`)

`import { applyJsonPatchToObjectDescriptor } from "threejson/patch"` on demand. Applies RFC 6902 operation arrays to `userData.objJson` (`add` / `replace` / `remove`); default **path whitelist** in source `DEFAULT_ALLOWED_PREFIXES`.

## `core/handler/animationMixerRegistry.js`

- `tryRegisterGltfAnimationMixers(root, gltf)`: creates `AnimationMixer` and registers when `gltf.animations` is non-empty.
- `updateRegisteredAnimationMixers(scene, deltaSeconds?)`: called by render loop after declarative animations.
- `unregisterAnimationMixerForRoot(root)`: releases.

## `core/plugin/pluginHost.js`

- `createPluginHost()`: returns `register` / `init` / `dispose` / `beforeFrame` / `beforeRender` / `afterRender` / `beforePhysics` / `afterPhysics`.

## `core/handler/sceneLoadHandler.js` · `onSceneReady`

`createJsonScene(payload, options)` can call `options.onSceneReady(ctx)` after scene deploy completes:

| Field | Description |
|-------|-------------|
| `scene` / `camera` / `renderer` / `controls` / `renderLoop` | Same as runtime |
| `sceneJson` | Friendly/compat shape `compatPayload` |
| `payload` | Standard `objectList` shape |
| `worldInfo` / `sceneConfig` | Normalized configuration |
| `pluginHost` | Optional, from host `options.pluginHost` |

For extended bootstrap (e.g. Rapier) reading JSON `extensions`, see **[extensions.md](./extensions.md)** and [`lab/extension-json.md`](../../lab/extension-json.md).

## `core/util/spatialQuery.js`

Geometry-level queries (**not** a physics engine). Importable from `core/index.js`.

| API | Purpose |
|-----|---------|
| `setBox3FromObject` / `box3IntersectsBox3` | AABB |
| `collectObjectsWithObjJson` / `findAabbIntersections` | Coarse intersection with `userData.objJson` objects |
| `raycastScene` / `ndcToRay` | Ray picking |
| `computeMeshCenterRestYOnAabbFloor` | Estimate object center Y on floor top (simple gravity, etc.) |

`modelHandler.impactCheck` uses `findAabbIntersections` internally.

## `core/util/meshPick.js`

Optional `three-mesh-bvh` accelerated picking (**off by default**):

- `shouldUseMeshBvhPick(sceneConfig, objJson)`
- `applyMeshBvhPickToScene(root, { sceneMeshBvh })`
- `raycastSceneWithPick({ useMeshBvh, scene, ... })` (async)

Switches: [JSON configuration guide](../json-format.md) `pick.meshBvh` / `pick.precision: "bvh"`.

## `core/util/extensionsUtil.js`

| API | Purpose |
|-----|---------|
| `mergeExtensionMaps` | Merge scene/object `extensions` |
| `readExtensionConfig(record, extensionId)` | Read object extension block |
| `resolveSceneExtensions(sceneConfig, worldInfo)` | Scene-level extensions |

## sceneDescriptorBinding

Implementation: `core/handler/sceneDescriptorBinding.js`.

Optional: lightweight two-way sync between **descriptor transforms** and **Object3D** (`position` / `rotation` / `scale` only). Off by default; configure in `worldInfo.descriptorBinding` and call `startDescriptorBinding(scene, worldInfo)`. Full fields, priority, and limits: [JSON configuration guide](../json-format.md) **`descriptorBinding`** section.

- `startDescriptorBinding(scene, worldInfo?, options?)`: returns `{ stop, flush }`.
- `markDescriptorBindingJsonDirty(id | descriptor)`: next frame pushes transform from JSON to object.
- `scheduleDescriptorBindingRebuild(scene, id | descriptor, { debounceMs? })`: experimental full object rebuild (expensive).
- `redeployObject(scene, descriptorOrId)`: immediate rebuild from descriptor (group / mesh with `subScene` changes, etc.).
- `readDescriptorBindingConfig` / `isDescriptorBindingEnabled`: for tests or custom scheduling.

Works with `modelBuilder`: `applyBoxModelTransformToObject3D`, `syncBoxModelTransformFromObject3D`.

Import path: `../../core/handler/sceneDescriptorBinding.js` (or aggregated from `../../core/index.js`).

## `core/util/textureUtils.js`

Import example: `../../core/util/textureUtils.js`.

### `createStrTextureMultiline(textureInfo)`

Creates multiline text canvas texture. Info panels call this internally; callers rarely need it directly.

```js
{
  str: "Hello",
  width: 128,
  height: 64,
  fillStyle: "#ffffff",
  font: "16px Microsoft YaHei",
  textBaseline: "top"
}
```

## `core/cache/loading.js` and `core/handler/resourceReclaimer.js`

### `loadingManager`

Project-unified ThreeJS `LoadingManager`, used by some texture loaders.

### `openOrCloseProgressManager(flag)` / `checkComplete()`

Control and query loading progress. Current UI is light; suitable as a hook for page progress bars.

### `trackDisposableResource(resource)` / `disposeTrackedResources()`

Resource tracking and unified disposal. Many engine-internal objects are tracked automatically; callers creating many ThreeJS objects can call `trackDisposableResource()` explicitly.

### `disposeTrackedSceneResources(scene)`

Composite API: runs `trackSceneResources(scene)` then `disposeTrackedResources()`. For one-shot scan-and-release of the current scene subtree.

### `disposeByThreeJsonId(scene, threeJsonId, options?)` / `detachByThreeJsonId(...)`

Remove object from scene by `threeJsonId`. Shares [`core/handler/objectDeleteById.js`](../../core/handler/objectDeleteById.js) `removeObjectByThreeJsonIdCore` with command-layer `removeObjectById` (protected object guard, `removedDescriptor`, `captureSubtree`, etc.).

Unlike `removeObjectById`, reclaim path does **not** call `markDescriptorBindingJsonDirty`; use `removeObjectById` for edit/command flows.

| Option | Description |
|--------|-------------|
| `allowProtectedRemoval` | When `true`, allows deleting protected runtime objects |
| `detachOnly` / `disposeResources: false` | Detach + unregister only, no GPU dispose |
| `captureSubtree` | When `true`, returns descriptor snapshots for other objects in subtree |

## Common notes

- Most create methods do not deep-validate; missing JSON fields use defaults or return directly.
- `deploy*` methods call `scene.add()` directly; `create*` methods only return objects.
- Most objects store original JSON on `userData.objJson` (alongside other `userData` keys; construction path see `setUserDataObjJson`).
- Texture, OBJ, GLTF loading is async; logic that depends on load completion must listen or poll.
- HTML info panels depend on `html2canvas`; complex DOM or cross-origin images may fail screenshots.
