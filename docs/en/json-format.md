[中文](../zh/json-format.md) | [English](./json-format.md)

# JSON Format Guide

[中文](../zh/json-format.md) | [English](./json-format.md)

ThreeJSON now explicitly supports two parallel input shapes:

- Human-friendly JSON: `sceneConfig + typed lists + friendlyMap`
- Standard JSON: `sceneConfig + objectList + top-level metadata (including threeJsonId)`

Neither is “better” than the other—they differ only in authoring experience. Whichever you use, the unified load entry normalizes to a standard `objectList`, then dispatches by `objType` in phases.

Most object records include `name`, `objType`, `geometry`, `position`, `rotation`, `scale`, and `material`.

## Friendly JSON

Recommended for human authors, business JSON editing, and large scenes maintained by hand.

```json
{
  "version": "next",
  "name": "friendly-scene",
  "threeJsonId": "friendly-scene-doc-id",
  "friendlyMap": {
    "wallList": {
      "objType": "wall",
      "defaults": {
        "material": {
          "type": "standard"
        }
      }
    }
  },
  "sceneConfig": {
    "scene": { "background": "#222222" },
    "camera": { "fov": 60, "position": { "x": 230, "y": 180, "z": 260 } },
    "renderer": { "antialias": true, "ratioRate": 1 },
    "controls": { "enableDamping": true, "target": { "x": 0, "y": 40, "z": 0 } },
    "lights": [
      { "type": "ambient", "color": "#ffffff", "intensity": 0.45 }
    ],
    "renderLoop": { "autoResize": true, "firstAutoResize": true }
  },
  "worldInfo": {
    "boxModelList": [
      {
        "name": "main-box",
        "objType": "box",
        "geometry": { "width": 80, "height": 80, "depth": 80 },
        "position": { "x": -70, "y": 40, "z": 0 },
        "material": { "type": "standard", "color": "#409eff" }
      }
    ],
    "wallList": [
      {
        "name": "custom-wall",
        "geometry": { "width": 60, "height": 90, "depth": 20 },
        "position": { "x": 60, "y": 45, "z": 0 },
        "material": { "color": "#67c23a" }
      }
    ],
    "infoPanelList": [
      {
        "text": "hello friendly json",
        "type": "text",
        "panelBoxType": "sprite"
      }
    ]
  }
}
```

### `sceneConfig.scene`: `background` and `environment`

`sceneConfig.scene` (and fields peeled from `objType: "scene"` in standard `objectList`) supports:

- **Solid color (legacy-compatible)**: `"background": "#222222"` or any string parseable by `THREE.Color`.
- **Explicit solid-color object**: `{ "type": "color", "value": "#222222" }`.
- **Equirectangular panorama (LDR)**: `{ "type": "equirect", "url": "sky.jpg", "path": "", "resourcePath": "", "crossOrigin": "anonymous", "colorSpace": "srgb" }`  
  `path` / `resourcePath` / `crossOrigin` match `nativeObjectLoader` semantics; `colorSpace` is optional—LDR textures default to sRGB handling.
- **Cube sky**: `type: "cube"`  
  - **`layout` omitted or `"faces"`**: `"urls": [px, nx, py, ny, pz, nz]` — six entries in order **+X -X +Y -Y +Z -Z** (same as `THREE.CubeTextureLoader`).  
  - **`layout": "cross-h"`** (or `cross-horizontal`): a single **4×3 grid** horizontal cross; face layout (`o` = empty, `+Y` etc. = face name):

```
  o  +Y  o  o
 -X +Z +X -Z
  o  -Y  o  o
```

  - **`layout": "strip-h"`**: one row of **6** equal-width faces, order **+X -X +Y -Y +Z -Z**.  
  - **`layout": "strip-v"`**: one column of **6** equal-height faces, same order (top to bottom).

- **IBL environment map (HDR + PMREM)**: `"environment": { "type": "equirect-hdr", "url": "env.hdr", "path": "", "resourcePath": "" }`  
  Requires a **`WebGLRenderer`** (`createJsonScene` with `canvas`, or `createSceneRuntime` / `createSceneRuntimeAsync`). Without a renderer (headless deploy with only `THREE.Scene`), loading is skipped with `console.warn`. Implementation uses `RGBELoader` (`three/examples/jsm`) and `PMREMGenerator` (exported from the main `three` package).

If both `worldInfo.sceneInfoList` (embedded native `Scene`) and the declarative fields above exist: **when `background` / `environment` appear in `sceneConfig.scene`, they override** the corresponding properties extracted from the native Scene. To keep texture backgrounds from the native scene, do not write these keys in JSON.

**Runtime API**: `createSceneRuntime` synchronously handles only **string / `type:color`** backgrounds; for `equirect` / `cube` / `environment`, use **`createSceneRuntimeAsync`** (`await`) so resources load after the renderer is ready. `dispose()` releases textures and PMREM managed by this module.

### Default grouped lists

- runtime: `sceneConfig`
- main objects: `boxModelList`, `sphereModelList`, `groupList`
- overlays / labels: `lineList`, `infoPanelList`, `audioList`
- effects: `heatList`, `windList`, `shaderSurfaceList`
- imports: `externalModelList`, `objModelList`
- business domains: `domainModelList`
- mixed escape hatch: `modelList` / `objectList`

### Which lists may omit per-item `objType`

- Usually omit: `sphereModelList`, `groupList`, `lineList`, `infoPanelList`, `heatList`, `windList`, `shaderSurfaceList`, `audioList`, `externalModelList`, `objModelList`, `domainModelList`
- Usually still explicit: `boxModelList`, `modelList`, `objectList`

Notes:

- `boxModelList` is overloaded—it may be a plain box, inferred as sphere/cylinder from geometry, or recognized as a domain object—so do not promise it “naturally omits `objType`”.
- `modelList` / `objectList` in friendly JSON are mixed lists; per-item `objType` is usually required for readability and control.
- Page UI, alarm demos, and other business data (e.g. `alarmList`, `leftPanelShow`) **must not** go in scene JSON; configure them in the host page or via runtime API.

### `assetLibrary` and `lib://` texture references

Scene-level asset library, filled into `assetRegistry` at deploy time; material slots reference texture URLs via **`lib://{threeJsonId}`**. Read order matches [`sceneLoadHandler`](../../core/handler/sceneLoadHandler.js): top-level **`assetLibrary`** first, else **`worldInfo.assetLibrary`**.

```json
{
  "worldInfo": {
    "assetLibrary": [
      {
        "threeJsonId": "tex-wood-floor",
        "assetKind": "texture",
        "name": "Wood floor",
        "url": "/assets/textures/building/floor/wood_floor.webp"
      }
    ],
    "boxModelList": [
      {
        "name": "floor",
        "objType": "box",
        "material": {
          "type": "standard",
          "textureUrl": "lib://tex-wood-floor"
        }
      }
    ]
  }
}
```


| Field | Description |
|------|------|
| `threeJsonId` | Unique id in the library (`lib://` suffix); legacy field `id` is also accepted |
| `assetKind` | `texture` / `geometryPreset` / `materialPreset` / `shaderSource` (all participate in deploy-time resolution) |
| `name` | Optional; `lib://{name}` matches the **first** texture with that name when id lookup misses |
| `url` / `textureUrl` / `src` | Texture path for texture entries (equivalent; any one non-empty field suffices) |

In material JSON, **`textureUrl`** may be a normal path or `lib://tex-wood-floor`; resolution is done by [`resolveTextureSource`](../../core/util/resolveTextureSource.js). A string **`map`** is **not** treated as a URL. On library miss: `console.warn` and no texture.

**Optional `textureUrl` cache (Phase 4, default off)**: set `sceneConfig.extensions.assetLibrary.textureUrlCache: true` to cache static **image** textures by resolved URL after first load; later hits return `texture.clone()` so each mesh can keep its own `textureRepeat`. `video` / `gif` are excluded. Cleared on `resetScene` deploy with `assetRegistry`.

For `ShaderMaterial`, `vertexShader` / `fragmentShader` may be inline GLSL strings or `lib://` references to `assetKind: "shaderSource"` entries. In current sync native path, `shaderSource` URL entries are not fetched; use inline `source`/`code`/`text`/`value` for deterministic deploy.

The editor can maintain `assetLibrary` in the **Asset manager** sub-tab; the material tree **lib** dropdown lists only `assetKind: texture` entries.

### `descriptorBinding` (descriptor ↔ object transform sync)

Optional. On an **already loaded** scene, lightly syncs objects with `userData.objJson` to descriptor **`position` / `rotation` / `scale`** (Tier 1). **Off by default**: no watch loop runs unless `worldInfo.descriptorBinding` or per-item `descriptorBinding` is configured.

Call from the page once `scene` and `worldInfo` are ready (import from `../../core/index.js` or `../../core/handler/sceneDescriptorBinding.js`):

```js
import { startDescriptorBinding } from "../../core/index.js";
const handle = startDescriptorBinding(scene, worldInfo);
// …on scene unload: handle.stop();
```

**Config location**: `worldInfo.descriptorBinding` (object). **Per-descriptor** optional `descriptorBinding`: `true`, `false`, or `{ "enabled": true }`.

**Whether binding is enabled for an object** (high to low; first match wins):

1. `descriptorBinding` on that object’s descriptor (if present).
2. Whether `descriptorBinding.byId` contains the object’s `threeJsonId` key (boolean value).
3. Whether `descriptorBinding.byIds` string array contains that `threeJsonId` (means enabled).
4. Whether `descriptorBinding.byName` contains the name key (see below) with a boolean value.
5. Whether `descriptorBinding.byNames` string array contains that name (means enabled).
6. `descriptorBinding.enabled` global boolean (`true` applies to objects **not already disabled** above that have `objJson`; for whitelist-only, combine with `byId` / `byIds` / `byName` / `byNames`).
7. Otherwise disabled.

**Name key**: `Object3D.name` first, else descriptor `name` (`refName` is not resolved, to avoid overlapping id rules).

**Common `worldInfo.descriptorBinding` fields**:

| Field | Description |
|------|------|
| `enabled` | Global default for binding (default `false`: unless opened by `byId` / `byIds` / `byName` / `byNames` or per-item `descriptorBinding`). |
| `byId` / `byIds` / `byName` / `byNames` | See priority above. |
| `objectToJsonFromTransform` | Write object transform back to descriptor; default `true`. |
| `jsonToObjectFromTransform` | Apply descriptor transform to object; default `true`. When both are `true`, signatures from previous and current frames distinguish “JSON only”, “object only”, or conflict; conflicts resolved by `transformConflictResolution` (`"object"` default, or `"json"`). |
| `objectToJsonIntervalMs` | When &gt; 0, throttle sync to that interval (ms); `0` follows `requestAnimationFrame` (still only enabled objects). |
| `fullRebuildDebounceMs` | Default debounce for `scheduleDescriptorBindingRebuild` (ms). |
| **Hybrid (programmatic)** | When editing `Object3D` at high frequency in editor/scripts, call `descriptorSync.scheduleThrottledReconcileTransform(object, { delayMs })` to debounce writes back to `objJson` (different layer from `objectToJsonIntervalMs` above, which throttles the binding loop frame rate). |

**Tier 3 (full object rebuild)**: only for objects that can be recreated from the **same** descriptor via `deployMesh` or `createGroup`; disposes old geometry/material, **expensive**, and not all `objType` values are covered. Triggered by `scheduleDescriptorBindingRebuild(scene, descriptorOrId, { debounceMs })`; or call `redeployObject`.

**Other API**: `markDescriptorBindingJsonDirty(id)` forces JSON → object transform on the next frame. See [Core API](./api.md#sceneDescriptorBinding).

## Object identity and naming

| Field | Uniqueness | Role |
|------|--------|------|
| `threeJsonId` | unique | Persistent primary key |
| `refName` | unique optional | Programmatic alias |
| `name` | **repeatable** | Batch identification key; `Object3D.name`; `getObjectsVisibleByName` **exact full-string match** |
| `label` | repeatable | Display text (**objects and scene root** may both have it) |
| `customBucket` | repeatable | Layered batching (coexists with `name`) |
| `businessInfo` | user-defined | Passed through with `objJson`; core **does not parse or write** |
| `sourceObjType` | core metadata | Written by core only on `enableDefaultModel` fallback with original `objType`; **do not hand-write** |

**Display chain** (UI / logs only): `label → name → threeJsonId → "Unnamed"`. Batch APIs **only use `name`**, not `label`.

Kebab-case like `room-wall`, `air-conditioning` is a migration/docs convention only; core **does not** validate format or parse hierarchical suffixes.

**Parent/child same name**: `getObjectsByName` / visibility APIs hit **all** matching names (including parent/child); core does not filter; use different `label` values for display.

**Scene root**: use `label` for title display; `roomName` is deprecated—use `label`.

Page batch visibility: `setObjectsVisibleByName` / `setObjectsVisibleByNames` (see [api.md](./api.md)).

## friendlyMap

`friendlyMap` is optional config declaring a bounded mapping of “custom list field → standard `objType` + default fields”. Arbitrary script-style transforms are not supported.

```json
{
  "friendlyMap": {
    "glassList": {
      "objType": "glass",
      "defaults": {
        "material": {
          "type": "standard",
          "transparent": true,
          "opacity": 0.25
        }
      }
    }
  }
}
```

Rules:

- Without `friendlyMap`, built-in default mapping applies.
- With `friendlyMap`, entries are merged onto defaults; same list name overrides.
- `defaults` only fill missing values; explicit per-record fields win.
- Custom lists default-read from `worldInfo.<listName>`.
- **`friendlyMap` is unrelated to object `name`**: list keys do not participate in `getObjectsByName` or batch visibility.

## Standard JSON

Recommended for program-generated, AI-generated, editor save/snapshot, and external API alignment.

**Editor partial merge vs snapshots (two mechanisms)**

| Mechanism | Storage | Purpose |
|------|------|------|
| Session `autoSnapshot` | Tab session / `recovery` (global single slot) | On close without save, startup dialog “Restore from snapshot” |
| `scene-snapshots` | IndexedDB, bucketed by document `threeJsonId` | “Recent scenes”, `openRecentSceneById` |
| `sceneToJson` merge base | In-memory `sysConfig.jsonData` | Incremental export of same scene keeps reverse-scanned `objectList` entries untouched |

`autoSnapshot` **does not** participate in `sceneToJson`’s `basePayload` (avoids cross-scene `objectList` merge after switching scenes). First capture after full load/restore uses `merge: false`.

**Recommended default shape (plan B)**: main viewport runtime in `sceneConfig`, deployable content in `objectList`. They are parallel with different semantics; any core-supported `objType` (including `camera`/`light`) may live only in `objectList` (full-list orchestration remains valid).

```json
{
  "version": "next",
  "name": "scene-name",
  "threeJsonId": "scene-doc-uuid-or-stable-id",
  "canvasWidth": 1920,
  "canvasHeight": 1080,
  "assetLibrary": [],
  "extensions": {},
  "sceneConfig": {
    "scene": { "background": "#222222" },
    "camera": {
      "fov": 60,
      "jsonOrigin": "config",
      "position": { "x": 230, "y": 180, "z": 260 }
    },
    "controls": { "target": { "x": 0, "y": 40, "z": 0 }, "jsonOrigin": "config" },
    "lights": [
      { "type": "ambient", "color": "#ffffff", "intensity": 0.45, "jsonOrigin": "config" }
    ],
    "renderLoop": { "autoResize": true, "firstAutoResize": true }
  },
  "objectList": [
    { "objType": "box", "name": "floor", "geometry": { "width": 260, "height": 8, "depth": 180 } },
    { "objType": "line", "name": "path-line", "points": [] },
    { "objType": "externalModel", "modelPath": "/assets/model/gltf/a.gltf", "modelFileType": "gltf" },
    { "objType": "domain", "domain": "nativeThree", "handler": "loadFromUrl", "modelPath": "/assets/json/three_native.json" }
  ],
  "saveMeta": { "exportMode": "standard_primary" }
}
```

Notes:

- **Document identity**: top-level **`threeJsonId`** (no `worldId`).
- **`sceneConfig`**: global / main viewport (camera, lights, controls, etc.); **preferred** at load for main viewport.
- **Camera `type`**: default `perspective` (`fov` + `aspect`); `orthographic` / `ortho` supports `left`/`right`/`top`/`bottom`/`zoom` (if bounds are omitted, frustum is derived from canvas ratio).
- **Camera `lookAt`**: `camera.lookAt: { x, y, z }` sets initial orientation for perspective or orthographic cameras; when both `lookAt` and rotation are present, `lookAt` takes precedence.
- **`objectList`**: all deployable `objType` values; may include extra camera/light instances.
- **`jsonOrigin`** (`"config"` | `"list"`): on `camera`/`light`/`controls`, for scene↔JSON round-trip placement only; load uses physical location and auto-corrects.
- Duplicate across channels (same `threeJsonId` or `name`): **remove `objectList` side**, keep `sceneConfig`.
- `canvasWidth` / `canvasHeight`, `assetLibrary`, `extensions`, `saveMeta` are top-level metadata.
- Legacy demos with everything in `objectList` remain valid; see tutorial `00-04-standard-objectlist.json`.

## `objectList` dispatch rules

Whether input is friendly or standard JSON, the unified load entry eventually processes the standard `objectList` in these phases:

1. runtime: `scene`, `camera`, `renderer`, `controls`, `light`, `renderLoop`
2. ordinary objects: `box`, `sphere`, `cylinder`, `cone`, `ring`, `torus`, `capsule`, `group`, `line`, `infoPanel`, `text`, `heatMap`, `wind`, `plane`, `shapePlane`, `bufferMesh`, `irregularPlane`, `shapeExtrude`, `irregularGeometry`, `points`, `shaderSurface`, `sprite`, `tube`, `instanced`, `audio`, **`native`**
3. external models: `externalModel`, `skinned` (skinned glTF; semantics differ from `externalModel`)
4. business domains: `domain`

### `objType: "native"` (general Three.js object)

This section describes a **single `objectList` record** creating a runtime object via **ObjectLoader** (flat Mesh or `children` hierarchy). **Whole-scene** Three.js JSON uses [`domain: "nativeThree"`](#minimal-standard-snippet-domain--nativethree) or **`sceneInfoList`** (embedded `Scene.toJSON()`), which is different from this section.

core has **no ThreeJSON geometry allowlist**: whether creation succeeds depends on **ObjectLoader + current Three.js version**. The `objType` string **does not** participate in Three.js type inference (e.g. `torusKnot` is only a record label); host `threeType` is inferred from `geometry.type` and related fields. Implementation notes: [`lab/native-object-dispatch-memo.md`](../../lab/native-object-dispatch-memo.md).

| Field | Description |
|------|------|
| `parseMode` | `auto` (default): dedicated parser → native → last-resort fallback; `native`: native only; `default`: dedicated parser only |
| `threeType` | e.g. `Mesh`, `Group`; may be written with explicit `objType: "native"`; otherwise usually inferred from `geometry.type` |
| `nativeShapeHeuristic` | Optional; when true, guess `BoxGeometry` from width/height/depth; **default false** |
| `geometry` / `material` | Passed to ObjectLoader; `material.textureUrl` attaches texture after parse |

#### Usage A (recommended): unknown `objType` + `parseMode: "auto"` inference

When core has **no** dedicated parser for a geometry, you may use any semantic name in `objType` (e.g. `torusKnot`, `latheVase`) as long as `geometry.type` is a Geometry ObjectLoader supports; with **`parseMode: "auto"`** (default) the load chain deploys via native.

```json
{
  "objType": "torusKnot",
  "name": "native-torus-knot",
  "geometry": {
    "type": "TorusKnotGeometry",
    "radius": 4,
    "tube": 1.1,
    "tubularSegments": 128,
    "radialSegments": 16,
    "p": 2,
    "q": 3
  },
  "material": {
    "type": "MeshStandardMaterial",
    "color": "#e76f51",
    "metalness": 0.35,
    "roughness": 0.45
  },
  "position": { "x": -18, "y": 8, "z": 0 }
}
```

Full demo: [01-06-native-object-dispatch.html](../../examples/html-demo/track-01-geometry/01-06-native-object-dispatch.html) (data: `assets/json/tutorial/track-01/01-06-native-objects.json`).

#### Usage B: explicit `objType: "native"` + ObjectLoader hierarchy

Use when you need **ObjectLoader native `children` recursion** (multi-Mesh assembly, not ThreeJSON `subScene`). **For everyday grouping use `objType: "group"` + `subScene[]`** (see [subScene nesting](#subscene-nesting-hierarchical-objects)); do not mix with native `children`.

```json
{
  "objType": "native",
  "name": "native-lamp-group",
  "threeType": "Group",
  "position": { "x": 0, "y": 0, "z": -22 },
  "children": [
    {
      "threeType": "Mesh",
      "name": "lamp-pole",
      "geometry": {
        "type": "CylinderGeometry",
        "radiusTop": 0.12,
        "radiusBottom": 0.18,
        "height": 10,
        "radialSegments": 20
      },
      "material": { "type": "MeshStandardMaterial", "color": "#555555" },
      "position": { "y": 5 }
    },
    {
      "threeType": "Mesh",
      "name": "lamp-shade",
      "geometry": {
        "type": "SphereGeometry",
        "radius": 1.8,
        "widthSegments": 24,
        "heightSegments": 16,
        "phiStart": 0,
        "phiLength": 3.141592653589793,
        "thetaStart": 0,
        "thetaLength": 1.5707963267948966
      },
      "material": {
        "type": "MeshStandardMaterial",
        "color": "#fcbf49",
        "emissive": "#664400",
        "emissiveIntensity": 0.35
      },
      "position": { "y": 10.5 }
    }
  ]
}
```

#### Usage C: known `objType` + `parseMode: "native"` force

Skip dedicated parsers like `box` and force ObjectLoader:

```json
{
  "objType": "box",
  "name": "native-via-parseMode",
  "parseMode": "native",
  "threeType": "Mesh",
  "geometry": { "type": "BoxGeometry", "width": 4, "height": 4, "depth": 4 },
  "material": { "type": "MeshStandardMaterial", "color": "#9b5de5" },
  "position": { "x": 0, "y": 2.5, "z": 18 }
}
```

If native still cannot create the object and `sceneConfig.enableDefaultModel` is off, the object is skipped with a console warning (see [`sceneConfig` optional switches](#sceneconfig-optional-switches)).

---

Use these controlled values for official core `objType`; legacy business-flavored values (e.g. `dockCrane`, `deviceCamera`, `tempeSensor`) are no longer core `objType`—friendly normalization turns them into `domain` records or keeps them in business fields.

For page batch visibility use descriptor **`name`** (repeatable) with `setObjectsVisibleByName` / `setObjectsVisibleByNames`; use **`label`** for display text. `businessInfo` is a user-defined slot; core does not parse its inner fields.

### `objType: "controls"` (viewport controller)

When `type` is omitted or `orbit`, behavior matches history (`OrbitControls`). `type: "firstPerson"` enables first-person roaming (`PointerLockControls` + WASD). `type: "fly"` enables `FlyControls` (hold mouse to look + WASD/QE movement).

| Field | `orbit` | `firstPerson` | `fly` | Notes |
|------|---------|---------------|-------|------|
| `type` | optional, `orbit` | `firstPerson` | `fly` | defaults to `orbit` |
| `enabled` | ✓ | ✓ | ✓ | when `false`, no controller is created |
| `target`, `enableDamping`, `minDistance`, etc. | ✓ | — | — | orbit only |
| `moveSpeed` | — | ✓ | ✓ (alias of `movementSpeed`) | firstPerson default `4`; fly default `10` |
| `movementSpeed` | — | — | ✓ | fly translation speed |
| `rollSpeed` | — | — | ✓ | fly roll speed, default `0.5` |
| `dragToLook` | — | — | ✓ | fly requires mouse-hold look by default |
| `eyeHeight` | — | ✓ | — | default `1.6`; eye height for simple ground snap |
| `lookSensitivity` | — | ✓ | — | default `0.001`; look sensitivity (radians per pixel) |
| `lookSmoothing` | — | ✓ | — | default `0` (off); `>0` enables smoothed look |
| `lookSmoothTime` | — | ✓ | — | default `0.06` (seconds); smooth look time constant |
| `lookPitchLimit` | — | ✓ | — | default `1.396` (~80°); symmetric pitch limit (radians) |
| `minPolarAngle` / `maxPolarAngle` | — | ✓ | — | optional; Three.js `PointerLockControls` polar angles; override `lookPitchLimit` when set |
| `maxLookDelta` | — | ✓ | — | default `120`; per-frame mouse delta soft cap (pixels) |
| `pointerLock` | — | ✓ | — | default `true`; click canvas to lock pointer |
| `floorSnap` | — | ✓ | — | default `true`; downward ray ground snap |
| `keys` | — | ✓ | — | `forward` / `back` / `left` / `right` (`KeyboardEvent.code`) |
| `collision` | — | ✓ | — | see table below; `provider: "rapier"` requires Rapier on page and `bootstrapFirstPersonExtensionsFromScene` |

Optional `collision` fields (`firstPerson`):

| Field | Description |
|------|------|
| `enabled` | default `true` (fps-walk extension still usable without provider) |
| `provider` | `"rapier"`: Rapier CharacterController + capsule; default or with `fps-walk` extension uses `floorMeshRef` ground snap |
| `capsuleRadius` | Rapier capsule radius, default `0.35` |
| `capsuleHalfHeight` | Rapier capsule half-height, default `0.75` |
| `snapToGround` | Rapier `enableSnapToGround`, default `0.45` |
| `playerRefName` | Rig refName skipped when Rapier scans static colliders, default `player` |

Friendly JSON: `worldInfo.orbitControls` merges as orbit; `sceneConfig.controls` or `worldInfo.controls` may set `type`.

### `sceneConfig.renderLoop` (frame loop)

Optional fields: `autoResize`, `firstAutoResize`, `fps`, `lowFps`, `renderMode`.

- `renderMode` (optional, default `"auto"`): when a post-processing `composer` exists, use `composer.render()`; `"rendererOnly"` forces `renderer.render()` (screenshots/recording, etc.).

### `sceneConfig.textFont` (default text font)

Applies to `objType: "text"` with `mode: "sdf"`; per-record `sdf` block may override.

| Field | Default | Description |
|------|------|------|
| `fontUrl` | `null` | Primary font URL; when unset, Roboto + Unicode fallback (per-character lazy load, not whole library) |
| `unicodeFontsUrl` | `null` | Fallback index CDN root URL |
| `fontStyle` / `fontWeight` | `normal` | troika fallback font selection |
| `preloadCharacters` | `""` | Pre-warm SDF after scene load |

### `sceneConfig.helpers` (Grid / Axes helpers)

Semi-runtime scene settings; grid/axes are not part of the mesh export tree. After deploy, objects attach directly under **`THREE.Scene`** root (flat scene graph).

```json
{
  "sceneConfig": {
    "helpers": {
      "grid": { "visible": true, "size": 100, "divisions": 20 },
      "axes": { "visible": true, "size": 50 }
    }
  }
}
```

- **Sugar**: `sceneConfig.gridHelper` / `worldInfo.gridHelper`, `sceneConfig.axesHelper` / `worldInfo.axesHelper` normalize to `helpers.*`; when coexisting with `helpers.grid` / `helpers.axes`, **helpers wins**.
- `grid`: `size`, `divisions`, `colorCenterLine`, `colorGrid`, `visible`, `position`, `rotation` → runtime `objType: "gridHelper"`, bucket **`system:assist`**
- `axes`: `size`, `visible`, `position`, `rotation` → `objType: "axesHelper"`, bucket **`system:assist`**
- When `visible: false`, grid/axes are **not mounted** (historical behavior).
- v1: one grid and one axes; example: `assets/json/tutorial/track-01/01-05-helpers-irregular.json`.

### `boxHelper` (optional decoration bound to threeJsonId)

**Optional**; omit for no boxHelper. When declared, creates a `THREE.BoxHelper` in the scene (rendered in show/editor, **does not depend on composer**), bucket **`system:assist`**, excluded from default world export.

**Unrelated to editor selection outline**: edit-mode `createBoxEdgeHelper` is UI feedback, **not** written to JSON, **not** this deploy path.

**Declaration (one or both):**

1. **Inline** (on any content record with `threeJsonId`):

```json
{
  "objType": "box",
  "threeJsonId": "tj-wall-1",
  "boxHelper": { "visible": true, "color": "#E59520" }
}
```

runtime `threeJsonId`: `${hostThreeJsonId}@boxHelper`

2. **Standalone record** (`objectList` / after friendly JSON normalization):

```json
{
  "objType": "boxHelper",
  "threeJsonId": "bh-group-1",
  "targetThreeJsonIds": ["tj-wall-1", "tj-door-1"],
  "visible": true,
  "color": "#E59520"
}
```

Single-value `targetThreeJsonId` is also accepted (normalized to array). Multiple targets expand to multiple BoxHelpers; runtime id: `${record.threeJsonId}@${targetId}`.

- `visible: false`: **still created and registered**, `helper.visible = false` (same as box/mesh content objects).
- Missing target: warn + skip.
- Same target may be referenced by multiple boxHelper records.
- **Deploy timing**: after content objectList deploy and `rebuildObjectRegistryFromScene` (two-phase, analogous to OutlinePass target resolution).
- Example: `assets/json/tutorial/track-01/01-05-box-helper.json`.

**Deprecated**: ~~`sceneConfig.helpers.boxHelper`~~ (historical misplacement; core no longer normalizes).

Standard JSON may write top-level **`extensions`** (alongside `objectList`); normalization merges into `sceneConfig.extensions` (see `assets/json/tutorial/track-04/04-03-fps-walk.json`).

Viewport `camera` optional **`attachTo`** (`refName` string): attach camera to player Rig; WASD moves the Rig (see `assets/json/tutorial/track-04/04-04-fps-player-rig.json`).

### `sceneConfig.threeRevision` (optional)

Declares target Three.js **revision** (integer, or `"184"` / `"r184"`). Used for compat routing; when unset, uses runtime `THREE.REVISION`, then ThreeJSON major version (currently **184**). **Officially supported r179–r184**; lower revisions warn with no behavior guarantee. See [`three-compat.md`](./three-compat.md).

Friendly and standard JSON may set `sceneConfig.threeRevision`; also `worldInfo.threeRevision` (lower priority than `sceneConfig`).

### `sceneConfig.assetsBase` (optional, static asset base URL)

Controls the HTTP root used when built-in domain defaults and scene JSON paths with the **`/assets/...` prefix** (e.g. `textureUrl`, `modelPath`) are resolved at load time. Full `https://` / `data:` URLs are unchanged.

**After `npm install threejson`**, when nothing overrides it, the engine tries the active base first and then falls back to jsDelivr [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets) (version pinned in runtime `ASSETS_PACKAGE_VERSION`, currently aligned with `@1.0.0`). Example:

`https://cdn.jsdelivr.net/npm/@threejson/assets@1.0.0/textures/device/cabinet/cabinet_left_door.png`

**Merge priority (low → high):** `createJsonScene(..., { assetsBase })` → `sceneConfig.assetsBase` → global `setAssetsBaseUrl()` → active-base-first CDN fallback.

When cloning the repo and serving from the root, demos usually pass `assetsBase: "/assets"` or call `setAssetsBaseUrl("/assets")`, matching the [`assets/`](../../assets/) directory. JSON may keep `/assets/textures/...`; the loader now tries the local base first and falls back to CDN if needed.

```json
{
  "sceneConfig": {
    "assetsBase": "/assets"
  }
}
```

For self-hosted or private deployments, use a full origin, e.g. `https://static.example.com/threejson-assets`.

See [Static assets API in `api.md`](./api.md#static-assets-coreutilassetsbasejs) and [`lab/assets-online-hosting-memo.md`](../../lab/assets-online-hosting-memo.md).

### `sceneConfig.deployScheduler` (optional, large-scene frame-spread deploy)

Controls deploy pacing of **`objectList` content objects** (phase 2→3→4) in `createJsonScene` / `deployJsonScene`; runtime (camera, lights, etc.) still configures synchronously.

| Field | Description |
|------|------|
| `enabled` | `true` or with `mode: "scheduled"` enables queue; `false` or omitted → **immediate** (historical behavior) |
| `mode` | `"immediate"` (default) \| `"scheduled"`; `mode` overrides `enabled` |
| `policy` | scheduled only: `"frameBudget"` (default, per-frame count + ms budget) \| `"timeslot"` (`setTimeout` slots, compatible with showroom `flowControl`) |
| `maxJobsPerFrame` | frameBudget: max deploy jobs per frame (default 12) |
| `maxFrameMs` | frameBudget: per-frame deploy time cap in ms (default 8) |
| `fluxMs` | timeslot: slot interval ms (default 10) |
| `density` | timeslot: increment slot every `density` records (default 10) |

Example (frame-spread load of many boxes; phase 2 still completes before externalModel):

```json
{
  "sceneConfig": {
    "deployScheduler": {
      "enabled": true,
      "policy": "frameBudget",
      "maxJobsPerFrame": 8,
      "maxFrameMs": 6
    }
  }
}
```

Showroom-style timeslot (equivalent to legacy `flowControl` + `flowControlFlux` / `flowControlDensity`):

```json
{
  "sceneConfig": {
    "deployScheduler": {
      "mode": "scheduled",
      "policy": "timeslot",
      "fluxMs": 10,
      "density": 10
    }
  }
}
```

- **`createJsonSceneSimple`**: always immediate; ignores `deployScheduler`.
- Host should call `cancelActiveDeployScheduler()` when switching scenes (player/editor wired).
- Optional progress: `createJsonScene(..., { onDeployProgress({ done, total, phase, id }) })` — one callback per completed deploy job in scheduled mode.
- **`maxInFlightAsync`** (default 4): phase 3 (`externalmodel`) concurrent load cap.
- **`retry`**: `{ maxAttempts, backoffMs }`, retries phase 3 async load failures only.
- **Per-record `record.deployScheduler`**: shallow-merged with scene config; `mode: "immediate"` on a record **cuts in synchronously** in a scheduled scene (before same-phase timeslot/frameBudget queue).

### `sceneConfig.intro` (optional, post-load splash)

In **`createJsonScene` / `deployJsonScene`**, shows a DOM splash (logo / text) on the canvas parent **after `afterCameraFit` and before `onSceneReady`**. **Off by default**; no config means zero behavior change. Coexists with page `#loadingMask`: loading tracks assets/deploy; intro is the splash. For brief credit flashes, use **`excludeFromLoadWait: true`** so `#loadingMask` can hide after deploy while intro plays in the background; when **`blockInteraction`** is omitted in that case, it defaults to **`false`** (clicks pass through to the scene).

Phase 1 supports **`postLoad` only**; `preLoad` is planned for a later release.

| Field | Description |
|-------|-------------|
| `enabled` | `true` to enable (requires valid `postLoad.slides`) |
| `backgroundColor` | Overlay background (default dark; use `transparent` for credit flashes) |
| `postLoad.slides[]` | Sequential slides: `image` (`url` + `durationMs`) or `text` (`content` + `durationMs`) |
| `postLoad.fadeInMs` / `fadeOutMs` | Fade timing (defaults 300 / 600 ms) |
| `postLoad.skipOnClick` | Click to skip (default `true`). With `blockInteraction: true`, click **full overlay**; with `false`, only **slide content** skips |
| `postLoad.blockInteraction` | When `true`, full-screen overlay captures pointer events; `false` sets overlay `pointer-events: none` so clicks reach the scene (`skipOnClick: true` then skips only via **slide content**). **Default `true`**; when **`excludeFromLoadWait: true` and this field is omitted**, defaults to **`false`** |
| `postLoad.excludeFromLoadWait` | When `true`, intro does **not** block the `createJsonScene` / `deployJsonScene` Promise or `onSceneReady` (plays in background; default **`false`**) |

Mount root: parent of `options.canvas`, or `options.introRoot`.

**`createJsonSceneSimple` / `deployJsonSceneSimple`**: **warn and skip** intro (async path required).

Examples:

- Tutorial splash (await + block interaction): [`00-08-scene-intro.json`](../../assets/json/tutorial/track-00/00-08-scene-intro.json)
- Credit flash (`excludeFromLoadWait`): [`portShow.json`](../../assets/json/portShow.json) (`sceneConfig.intro`), [`04-05-fps-rapier-collision.json`](../../assets/json/tutorial/track-04/04-05-fps-rapier-collision.json)

### `sceneConfig.infoPanel` (optional, HTML info panel concurrency)

Controls parallel **html2canvas** jobs for `type: "html"` info panels (global queue; unrelated to `deployScheduler`). Read before deploy on `createJsonScene` / `deployJsonScene`; direct `deployInfoPanel` calls reuse the last scene load config (default **4** if none).

| Field | Description |
|-------|-------------|
| `maxInFlightAsync` | Parallel html2canvas tasks (default **4**, minimum 1) |

```json
{
  "sceneConfig": {
    "infoPanel": {
      "maxInFlightAsync": 6
    }
  }
}
```

### `createJsonSceneSimple` capability boundary

`createJsonSceneSimple` is intentionally a **synchronous immediate deploy** subset. It skips or degrades features that require async preparation. Use it for “sync-safe subsets” (basic geometry, common materials, static scene layout).

Current boundary:

- Fully synchronous: runtime records (`scene`/`camera`/`controls`/`lights`/`renderLoop`) and ordinary object deploy.
- Skipped in sync path: `nativeSceneEntry/nativeSceneList`, async background/environment pipelines (HDR/panorama).
- Prefer `createJsonScene` (async) when:
  - The scene depends on async bootstrap/register stages (for example, parts of jsm registration chains or async shader-source assembly).
  - You need deterministic behavior across environments without race timing.

Design principle: sync paths should not introduce fire-and-forget async side effects, to avoid nondeterministic outcomes for the same JSON.

### `sceneConfig.runtimeDefaults` (optional, override engine defaults at load)

Controls default lights, camera, background, etc. injected **after normalization, before deploy** in `createJsonScene` / `deployJsonScene`. Field names match load API options (e.g. `autoFillLights`, `autoFillCamera`, `autoFitCamera`, `autoFitCameraMode`, `fillLightsWhenExplicitEmpty`, `autoFillSceneBackground`, `extentInclude`, etc.).

**Merge priority (low → high):** engine built-in defaults → `worldInfo.runtimeDefaults` → `sceneConfig.runtimeDefaults` → host `createJsonScene(..., options)`.

**Relationship with `lights` (no need to duplicate switches):**

- No `runtimeDefaults` and **no** `lights` key: engine default `autoFillLights=true`, auto-fills declarative lights.
- Non-empty `lights`: always use JSON lights, regardless of `runtimeDefaults`.
- Explicit `lights: []`: no fill by default; fill only when JSON or options set `fillLightsWhenExplicitEmpty: true`.

Write `runtimeDefaults` only when you need **different from engine defaults** (e.g. deliberately black scene: `autoFillLights: false`, or `autoFitCamera: true`). Optional `worldInfo.runtimeDefaults`; same-name fields in `sceneConfig` win.

Optional resource policy in `runtimeDefaults.resourcePolicy`:

- `resourcePolicy.enabled` (default `true`): enable default automatic resource reclamation.
  - `true`: dispose on scene reset/destroy via default chain.
  - `false`: remove/unload objects only, no active resource dispose (useful for debug comparison).

```json
{
  "sceneConfig": {
    "runtimeDefaults": {
      "autoFillCamera": true,
      "autoFitCamera": true,
      "autoFitCameraMode": "positionAndTarget",
      "resourcePolicy": {
        "enabled": true
      }
    }
  }
}
```

### `sceneConfig` optional switches

- `enableComposeBoxModel` (default `false`): when `true`, `deployMeshWithDomains` tries each domain’s `composeBoxModel()` **after legacy mapping**. Preset `objType` values (e.g. `wall`, `glass`) still recognized via **`legacyBoxObjTypes`** when default off.
- `enableDefaultModel` (default `false`): when `true`, unrecognized `objType` renders as default object (`objType: "default"`) with console warning citing `threeJsonId` / `uuid`.
  - On fallback core writes **`sourceObjType`** (original `objType` string); **do not hand-write**; stripped on export for non-default objects.
  - Friendly JSON: template descriptor in `worldInfo.defaultModel` (or `sceneConfig.defaultModel`).
  - Standard JSON / `objModelList`: may provide `objType: "default"` template entry (extracted at load, not deployed as ordinary scene object).
  - Without template: built-in red 1×1×1 cube.

### Preset objType (`wall`, `glass`, etc.)

Thin domains in `boxModelList` / `meshList` may use **`objType: "wall"`**, **`objType: "glass"`**, **`objType: "floor"`** directly (no `domainModelList`). Domain merges default geometry/material, then deploys as core `box` + `material.type: "standard"`.

- **glass**: optional **`glassKind`** (glass domain only): `clear` | `tinted` | `frosted`.
- **floor**: batch id via descriptor **`name: "room-floor"`** (repeatable); display via **`label`**; material **`standard`** (may include `textureUrl`).
- **`material.type`**: Three.js material class only (`standard` / `lambert` / `phong` / `basic`, etc.)—**do not** use `wall` / `glass` / `floor` as material types.
- Page batch visibility: descriptor **`name`** (e.g. `room-wall`, `room-ceiling`) with `setObjectsVisibleByName` / `setObjectsVisibleByNames`; do not filter by ad-hoc `objType` (e.g. `container`, `ground`).

### `plane` (textured / solid plane)

Maps to `THREE.Mesh` + `PlaneGeometry`. Friendly JSON: **`worldInfo.planeList`**.

- `geometry.width` / `geometry.height`
- `material`: `color`, `textureUrl` / `map`, `transparent`, `opacity`, `side` (`double` | `front` | `back`)
- Optional **`motion: "scrollUv"`** + `speed`: texture UV scroll (same animation class as `wind`, without wind-field semantics)
- Flowing wind strips still prefer **`objType: "wind"`**

### `shapePlane` / `irregularPlane` (irregular plane)

- **`shapePlane`**: `Shape` + `ShapeGeometry`; `worldInfo.shapePlaneList`
- **`irregularPlane`** facade: `planeKind` — `shape` (default) | `mesh` | `rect` (forwards to `plane`)
- `shape.contour`: [[x,y], ...] (Shape local XY); optional `shape.holes`
- **`parallelTo`**: `xy` | `xz` | `yz` (default `xy`); if JSON contains **`rotation` key**, use rotation only
- **`shapeValidation.selfIntersect`**: `reject` (default) | `warn` | `off`

### `bufferMesh` (arbitrary triangle mesh)

`worldInfo.bufferMeshList`. `geometry.positions`, `geometry.indices` (optional); vertex/triangle counts have **core hard caps**—entire object skipped when exceeded.

### `shapeExtrude` / `irregularGeometry` (irregular solid)

- **`shapeExtrude`**: `ExtrudeGeometry`; `worldInfo.shapeExtrudeList`
- **`irregularGeometry`** facade: `geometryKind` — `shapeExtrude` (default) | `mesh`
- `extrude.depth`, `bevelEnabled`, etc.; contour same as `shapePlane`

### `line` topology `topology`

On `objType: "line"`, optional **`topology`** (or `lineTopology`):

| Value | Three.js |
|----|----------|
| omitted / `"line"` | `Line` polyline |
| `"lineSegments"` | `LineSegments` |
| `"lineLoop"` | `LineLoop` |

`material.linewidth` uses `Line2` wide lines only for `topology: "line"`; other topologies fall back to 1px lines.

### `points` (point cloud / particles)

Maps to Three.js **`THREE.Points`** + `PointsMaterial`. Friendly JSON: **`worldInfo.particleList`** (per-item `objType` may be omitted).

- **Positions**: `positions: [[x,y,z], ...]` or `{x,y,z}` object arrays; else `count` + `bounds` (or `geometry` as bounding box) random fill.
- Optional **`colors`**: per-vertex or cycled.
- **`material`**: `size`, `sizeAttenuation`, `color`, `transparent`, `opacity`, `map` / `textureUrl`, `blending` (`normal` | `additive` | `subtractive` | `multiply`), `depthWrite`.
- Optional **`motion`** (phase 2; may combine as array):
  - **`drift`** / shorthand **`rise`** / **`fall`**: update vertex positions each frame; `speed`, `direction` (`{x,y,z}`), `wrap` (default `true`, loop within `bounds`)
  - **`scrollUv`**: point sprite texture UV scroll (needs `material.map`); `speed` same semantics as wind
  - **`twinkle`**: flicker; `speed`, `minOpacity` / `maxOpacity` (or `mode: "size"` + `minSize` / `maxSize`)
- Single-point markers: tiny **`sphere`** or `points` with `count: 1`.
- Large flowing textured sheets: **`wind`** or later `plane` / domain—not `points`.

```json
{
  "name": "starry-sky",
  "objType": "points",
  "count": 1500,
  "bounds": { "width": 400, "height": 120, "depth": 400 },
  "position": { "x": 0, "y": 80, "z": 0 },
  "material": {
    "color": "#ffffff",
    "size": 3,
    "sizeAttenuation": true,
    "transparent": true,
    "opacity": 0.85,
    "blending": "additive"
  }
}
```

### `particleEmitter` (unified emitter entry)

From Phase 2, core provides a unified `objType: "particleEmitter"` entry. A single builder handles both modes:

- `simulation: "cpu"`: default path on top of `THREE.Points` + `PointsMaterial` with `pointsMotion`.
- `simulation: "gpuCompute"`: uses `GPUComputationRenderer` to update a position texture on GPU, then renders via `Points` + `ShaderMaterial`; warns and falls back to `cpu` when WebGL2 is unavailable or init fails.

```json
{
  "objType": "particleEmitter",
  "name": "rain-emitter",
  "simulation": "cpu",
  "count": 4000,
  "bounds": { "width": 120, "height": 80, "depth": 120 },
  "emitter": {
    "velocity": { "x": 0, "y": -1.2, "z": 0 },
    "speed": 3.5,
    "wrap": true
  },
  "material": {
    "color": "#b8d8ff",
    "size": 1.5,
    "transparent": true,
    "opacity": 0.85,
    "blending": "additive"
  }
}
```

When `simulation: "gpuCompute"`, an optional `compute` block is supported:

| Field | Description |
|------|------|
| `textureSize` / `textureWidth` + `textureHeight` | Compute texture dimensions (default: power-of-two from `count`) |
| `velocity` / `speed` | Force-field velocity (defaults from `emitter.velocity` / `emitter.speed`) |
| `fragmentShader` | Optional custom position compute GLSL (default built-in drift + wrap) |
| `uniforms` | Extra uniforms injected into the compute shader |

`domains/weather` rain/snow/sparkles/embers deploy through the same `particleEmitterBuilder` internally (external JSON remains handler-compatible).

**Third-party particles (extensions)**: core defaults to `simulation: cpu|gpuCompute`. For `provider: "nebula"` etc., import `threejson/extensions/particle-nebula` on the page; unknown providers warn and fall back to core. Extension authors use `registerParticleEmitterProvider(id, deployer)` (see `extensions/particle-nebula/` stub).

Animated example (`motion` as array may combine drift + twinkle):

```json
{
  "name": "rain-drift",
  "count": 600,
  "bounds": { "width": 180, "height": 60, "depth": 180 },
  "position": { "x": 0, "y": 55, "z": 0 },
  "motion": {
    "type": "drift",
    "speed": 14,
    "direction": { "x": 0, "y": -1, "z": 0 },
    "wrap": true
  },
  "material": {
    "color": "#88bbff",
    "size": 2.5,
    "transparent": true,
    "opacity": 0.85,
    "blending": "additive",
    "depthWrite": false
  }
}
```

### `domain: "weather"` (weather particle presets)

**`weather`** domain expands `domainModelList` entries via core **`createPoints`**. `handler`: **`rain`** | **`snow`** | **`sparkles`** | **`embers`** (`embers` includes texture `scrollUv`). Override `count`, `position`, `bounds`, `material`, etc. on the domain record.

```json
{
  "objType": "domain",
  "domain": "weather",
  "handler": "snow",
  "position": { "x": -30, "y": 50, "z": 20 },
  "count": 300
}
```

**Nested subdomains (dotted id)**: also **`domain: "weather.rain"`** or **`"weather.wind"`** (full path required; `domain: "rain"` invalid). Wind strips on subdomains still use handlers like `coldWind`. Example JSON: [`assets/json/tutorial/track-05/05-02-nested-domain.json`](../../assets/json/tutorial/track-05/05-02-nested-domain.json).

See [domains.md](./domains.md).

### `shaderSurface` (core generic shader surface)

Core provides **`shaderPresetRegistry`** + **`shaderMotion`** + **`objType: shaderSurface`**. JSON **does not embed** `vertexShader` / `fragmentShader` (default path)—only **`shaderPreset`** and serializable **`uniforms`**. Friendly JSON: **`worldInfo.shaderSurfaceList`** (per-item `objType` may be omitted).

```json
{
  "name": "demo-solid-marker",
  "objType": "shaderSurface",
  "shaderPreset": "solidColor",
  "surface": "plane",
  "geometry": { "width": 8, "height": 8 },
  "uniforms": { "color": "#e17055", "opacity": 0.85 }
}
```

**Sky / water and other business semantics** are not built into core lists; **`domains/nature`** subdomains (`nature.sky`, `nature.water`) register presets at startup via `registerShaderPreset` + `resolveDomainModel`, scheduled through **`worldInfo.domainModelList`** (same as nested domains like `weather.rain`). See [lab/shader-preset-architecture.md](../../lab/shader-preset-architecture.md).

**`domain: "nature.sky"`**

- **Static handlers**: `atmosphere` (`day`) | `sunset` (`dusk`) | `dawn` (`sunrise`) | `noon` (`midday`) | `night` (`midnight`)
- **Dynamic handler**: `cycle` (`dynamic` / `dayNight`) — keyframe interpolation + optional auto cycle
- Static optional `uniforms` overrides; dynamic fields:

| Field | Description | Default |
|------|------|------|
| `timeOfDay` | 0–24 hours | `12` |
| `autoCycle` | Auto-advance time | `false` |
| `cycleDuration` | Seconds for full 24h cycle | `600` |
| `syncBackground` | Sync solid `scene.background` to horizon color | `false` |
| `keyframes` | Override built-in keyframe array | Built-in 7 points |

```json
{
  "domain": "nature.sky",
  "handler": "cycle",
  "timeOfDay": 6,
  "autoCycle": true,
  "cycleDuration": 300,
  "syncBackground": false,
  "geometry": { "radius": 3500 }
}
```

**`domain: "nature.water"`** — `handler`: **`ocean`** | **`flow`**.

**Fidelity `quality`** (record-level or `uniforms.quality`): `low` | `medium` (default) | `high` | `ultra`. Higher tiers add vertex/fragment work; `ultra` additionally renders the scene to a reflection RT each frame—highest GPU cost. Tune mesh density and reflection map size with `geometry.widthSegments` / `mirrorResolution`.

| Tier | Effect summary | Relative cost |
|------|----------|----------|
| `low` | Dual sine waves + simple foam | Lowest |
| `medium` | Gerstner + Fresnel + procedural normals + fake sky-gradient reflection | Low |
| `high` | More wave layers and normal detail | Medium |
| `ultra` | `high` + planar reflection RT (similar to Three.js Water) | Highest |

Optional: `geometry.width` / `height`, `uniforms.waveSpeed` / `waveHeight` / `waterColor`, `sunDirection`, `horizonColor` / `zenithColor` (fake sky colors), `mirrorResolution` (`ultra` only), etc.

```json
{
  "domainModelList": [
    {
      "domain": "nature.sky",
      "handler": "sunset",
      "geometry": { "radius": 3500 }
    },
    {
      "domain": "nature.water",
      "handler": "ocean",
      "quality": "high",
      "geometry": { "width": 420, "height": 420 },
      "position": { "x": 0, "y": -1, "z": 0 },
      "uniforms": {
        "waveSpeed": 1.4,
        "waveHeight": 0.4,
        "sunDirection": [0.65, 0.12, 0.25],
        "horizonColor": "#ff8c42",
        "zenithColor": "#2a1a4a"
      }
    }
  ]
}
```

**Relationship with `windList`**: default wind strips remain texture + UV scroll (`planeScrollMotion`); shader wind strips are Phase 4 optional—not enabled in this list by default.

Example JSON: [`assets/json/tutorial/track-02/02-07-shader-sky-water.json`](../../assets/json/tutorial/track-02/02-07-shader-sky-water.json).

### `sprite` (icon / marker)

Maps to **`THREE.Sprite`** + `SpriteMaterial`. Friendly JSON: **`worldInfo.spriteList`** (per-item `objType` may be omitted).

- vs **`infoPanel`**: `sprite` for textured icons/markers; `infoPanel` for text/HTML/image panels (may use `panelBoxType: "sprite"` carrier).
- **`material.map`** / `textureUrl` / `url`: texture URL; solid `material.color` when no texture.
- **`material.size`** or **`scale`**: display size.

### `text` (in-scene text)

Maps to **`objType: "text"`** with three render **`mode`** values:

| mode | Implementation | Typical use |
|------|------|----------|
| `sdf` (default) | `troika-three-text` SDF | Crisp labels, multilingual, scalable |
| `texture` | Canvas → Plane / Sprite | Offline/CSP fallback, very high update frequency |
| `mesh` | `TextGeometry` extrusion | Few 3D titles (needs `mesh.fontJsonUrl`) |

vs **`infoPanel`**: `text` is pure text (no required backing panel); `infoPanel` is an info board with panel geometry (box/sprite + optional html).

**Shared fields**: `content`, `fontFamily`, `fontSize` (world units), `color`, `align` (`left`/`center`/`right`), `anchor` (`{x,y}` 0..1), `maxWidth`, `lineHeight`, `billboard`, `position` / `rotation` / `scale`.

**`sceneConfig.textFont`** (scene default; per-object `sdf` may override):

| Field | Default | Description |
|------|------|------|
| `fontUrl` | `null` | Primary `.woff`/`.ttf` URL (online or local); when unset, Roboto + Unicode fallback (lazy-load Noto per character, **not whole-library download**) |
| `unicodeFontsUrl` | `null` | unicode-font-resolver index CDN root; may self-host on intranet |
| `fontStyle` / `fontWeight` | `normal` | Affects fallback font selection |
| `preloadCharacters` | `""` | Pre-warm glyph SDF after scene load |

**`sdf` block**: `fontUrl`, `unicodeFontsUrl`, `outlineWidth`, `outlineColor`, `fillOpacity`, `curveRadius`, `gpuAccelerateSDF`.

**`texture` block**: `canvasWidth`/`canvasHeight`, `padding`, `backgroundColor`, `devicePixelRatio`, `textStyle` (same as infoPanel), `doubleSided`, `renderOrder`.

**`mesh` block**: `fontJsonUrl` (required), `depth`, `bevelEnabled`, `bevelThickness`, `bevelSize`.

**troika lazy-load**: SDF mode uses `troika-three-text`, which is **lazy-loaded** when the scene contains `objType: "text"` with `mode: "sdf"` (or default). Tutorial pages that need SDF text should include `troika-three-text` + `fflate` in the page import map (see [Track 7](./tutorial.md#track-7--scene-text-objtype-text)); other pages omit them and rely on lazy load.

```json
{
  "name": "floor-label",
  "objType": "text",
  "content": "B2 Server Room",
  "mode": "sdf",
  "fontSize": 0.25,
  "color": "#e8eaed",
  "align": "center",
  "anchor": { "x": 0.5, "y": 0.5 },
  "billboard": true,
  "position": { "x": 0, "y": 2, "z": 0 }
}
```

Example JSON: [`07-01-text-modes.json`](../../assets/json/tutorial/track-07/07-01-text-modes.json) (sdf/texture), [`07-02-text-mesh.json`](../../assets/json/tutorial/track-07/07-02-text-mesh.json) (mesh). Tutorial: [Track 7](./tutorial.md#track-7--scene-text-objtype-text).

### `tube` (pipe path)

Maps to **`THREE.Mesh` + `TubeGeometry`**. Friendly JSON: **`worldInfo.tubeList`**.

- **`path`** (or `curve`): `type: "catmullRom"` (default) | `"line"`, `points` as `{x,y,z}` or `[x,y,z]` arrays, at least 2 points; optional `closed`, `tension`.
- **`geometry.radius`**, `tubularSegments`, `radialSegments`.
- **`material`**: same as basic meshes (`standard` / `basic`, etc.). When `material.side` is omitted, default **`double`** (avoids single-sided culling showing half the pipe wall due to Frenet frame twist); use explicit `"side": "front"` for outer shell only.

```json
{
  "name": "pipe-a",
  "objType": "tube",
  "path": {
    "type": "catmullRom",
    "points": [
      { "x": 0, "y": 10, "z": 0 },
      { "x": 40, "y": 30, "z": 0 },
      { "x": 80, "y": 10, "z": 20 }
    ]
  },
  "geometry": { "radius": 3, "tubularSegments": 48 },
  "material": { "type": "standard", "color": "#67c23a" }
}
```

### `instanced` (explicit InstancedMesh)

Maps to **`THREE.InstancedMesh`**. Friendly JSON: **`worldInfo.instancedList`**.

- Each record needs **`transforms`** array (each item with `position` / `rotation` / `scale`), plus box **`geometry`** + **`material`** (same as `box`).
- **`boxModelList` + `instanceCode`** may still merge via `coalesceBoxModelList` into `instance: true` `box` entries (`objType` stays `box`); `instanced` explicitly declares instanced meshes in standard `objectList`.

### `skinned` (skinned character)

Semantic **`objType: "skinned"`**; loading still uses glTF/GLB (same loader as **`externalModel`**, but keeps `userData.objJson.objType === "skinned"` for business distinction). Friendly JSON: **`worldInfo.skinnedList`**.

- **`modelPath`**, optional **`modelFileType`** (`gltf` / `glb`).
- Optional **`attachTo`**: only `"camera"` uses first-person viewmodel (parented to `scene`, follows camera each frame); omitted or other values add as ordinary model. Under viewmodel, `position` / `rotation` / `scale` are **camera-local**. Do not configure `extensions.physics-rapier` on viewmodels.
- Optional **`applyTransform`** (default when omitted: `true`): when `true`, apply JSON `position` / `rotation` / `scale`; when `false`, keep glTF file transforms.
- Optional **`viewModelFit`** (default `true` when `attachTo: "camera"`): scale by bounding box; skinned models scale each `SkinnedMesh` individually without bbox centering.
- Optional **`viewModelMaxSize`**: target max edge length with `viewModelFit` (default `1`).
- **Orientation**: Three.js camera faces **-Z**; Sketchfab / Unity-style FPS weapon glTF often faces **+Z**; with `attachTo: "camera"`, if the muzzle points at you, add **`rotationY: 3.141592653589793`** in `rotation`; **do not** also negate `position.x` (after Y flip, use positive offset e.g. `0.15`). Example: `assets/json/tutorial/track-04/04-05-fps-rapier-collision.json`.
- glTF textures reference `images[].uri` in file (e.g. `textures/*.png`); loader resolves relative to `.gltf` directory—**no** separate `textures` directory scan needed.
- Static complex models without animation: still use **`externalModelList`**.

## `audio`

Based on Three.js `AudioListener` / `Audio` / `PositionalAudio` and `AudioLoader` (main `three` package). Load entry deploys content objects after camera config and injects `camera` / `renderer` into `deployCanonicalRecord` context for lazy single listener on camera.

Standard `objectList` example:

```json
{
  "objType": "audio",
  "name": "dock-bell",
  "mode": "positional",
  "audioUrl": "/assets/audio/bell.ogg",
  "position": { "x": 10, "y": 2, "z": 0 },
  "volume": 0.8,
  "loop": false,
  "autoplay": false,
  "refDistance": 1,
  "rolloffFactor": 1,
  "maxDistance": 10000,
  "distanceModel": "inverse"
}
```

- **`mode`**: `positional` (default, spatialized, under `scene`) or `ambient` (non-spatialized, under main camera, suitable for BGM).
- **`audioUrl`**: audio URL; generic **`url`** also accepted.
- **`volume`** / **`gain`**: volume (equivalent; either suffices).
- **`loop`**, **`playbackRate`**: playback parameters.
- **`autoplay`**: when `true`, calls `play()` after buffer ready; subject to browser autoplay policy—failures are silently ignored. Host may call **`resumeThreeJsonAudioContextFromCamera(camera)`** on user gesture to resume `AudioContext`.
- **Spatialization**: optional `refDistance`, `rolloffFactor`, `maxDistance`, `distanceModel` (`linear` / `inverse` / `exponential`), and cone attenuation `coneInnerAngle` / `coneOuterAngle` / `coneOuterGain` (matches Three.js `setDirectionalCone`, radians).

Friendly JSON may maintain multiple records in `worldInfo.audioList` (or top level depending on `friendlyMap` `scope`); list items may omit `objType` (defaults to `audio`). On redeploy, ambient tracks with ThreeJSON markers are removed from camera first; disposing scene subtree calls `stop` / `disconnect` on `Audio` / `PositionalAudio`.

## `externalModel`

Third-party models uniformly use:

```json
{
  "objType": "externalModel",
  "modelPath": "/assets/model/gltf/threejson_unlit_pyramid.gltf",
  "modelFileType": "gltf"
}
```

Type detection order:

1. Prefer `modelFileType`
2. Else infer from `modelPath` extension
3. Else parse fails

`modelFileType` may be `obj`, `gltf`, `glb`, `three`, `threejson`, `object`.

glTF/GLB applies JSON `position` / `rotation` / `scale` by default (`applyTransform` omitted or `true`); `applyTransform: false` keeps file transforms. Optional **`attachTo: "camera"`** for viewmodel (camera-local transforms); optional **`viewModelFit`** / **`viewModelMaxSize`** (same as `skinned`). Texture paths resolved from glTF `uri`—no extra `textures` directory config.

## `domain`

Domain records uniformly use:

```json
{
  "objType": "domain",
  "domain": "nativeThree",
  "handler": "loadFromUrl",
  "modelPath": "/assets/json/three_native.json"
}
```

Notes:

- `objType: "domain"` enters the business domain system
- `domain` points to a concrete domain id
- `handler` remains the domain internal entry function or subtype name
- `items`, `payload`, `options` remain available; meaning defined by each domain

For domain details, descriptor structure, registration, and extension steps, see [Business domains and `domains/`](./domains.md).

## Common fields

```js
{
  name: "object-name",
  refName: "mainPump",
  threeJsonId: "tj_xxx",
  objType: "box",
  visible: true,
  geometry: {},
  position: { x: 0, y: 0, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: {}
}
```

- `name`: Three.js object name; retrieve via `scene.getObjectByName()`.
- `refName`: optional runtime reference name; use when you need stable access “like a hand-written Three.js variable”.
- `threeJsonId`: optional persistent object id; missing values auto-filled before load when entry calls `ensureThreeJsonIdsOnScenePayload()`.
- `objType`: core dispatch field; also written to `userData.objJson.objType`; use with `modelHandler` for batch query, hide, delete.
- `visible`: visibility; some material creation reads this field.
- `position`: position; units per caller scene convention.
- `rotation`: rotation in radians.
- `scale`: scale.

## Runtime object lookup

ThreeJSON provides a lightweight runtime object registry. For objects created via `core/` builders or external model load entry, import from `core/index.js`:

```js
import {
  getObjectByThreeJsonId,
  getObjectByUuid,
  getObjectByRefName,
  getObjectsByName
} from "../../core/index.js";
```

Recommended order:

- `getObjectByThreeJsonId(id)`: cross-session, most stable.
- `getObjectByRefName(refName)`: hand-coded naming.
- `getObjectsByName(name)`: convenience; `name` not guaranteed unique—returns array.
- `getObjectByUuid(uuid)`: current-session debug or temporary reference.

## Runtime bucket classification (systemBucket / customBucket)

Under **flat scene graph**, all registrable `Object3D` instances attach directly to `THREE.Scene` (or archive container); core uses **bucket indexes** for classification and batch query—**no** physical managed sub-roots (`baseRoot` / `overlayRoot`, etc.).

### systemBucket (runtime only, not written to objJson)

Inferred at `registerObject` from `objJson` + deploy context; same `threeJsonId` may have **multiple tags**:

| tag | Typical objType / source |
|-----|---------------------|
| `objects` | ordinary content objects |
| `domain` | `domain` (often coexists with `objects`) |
| `models` | `externalModel`, `skinned`, etc. (often coexists with `objects`) |
| `native-record` | `native` / `parseMode: native` |
| `native-scene` | embedded ObjectLoader Scene root |
| `environment` | `light`, `camera` |
| `assist` | `gridHelper`, `axesHelper`, `boxHelper` |
| `temp` | runtime spawn (`isRuntimeSpawn`) |

**Not bucketed**: OrbitControls, Renderer, RenderLoop, Pass, scene background/fog, and other pure runtime split items.

Query API (import from `core/index.js`):

```js
import {
  getObjectsInSystemBucket,
  getObjectsInCustomBucket,
  hasSystemBucketTag,
  shouldIncludeThreeJsonIdInDefaultWorldExport
} from "../../core/index.js";

const meshes = getObjectsInSystemBucket("objects");
const layerA = getObjectsInCustomBucket("layer-a");
```

Default world export excludes `assist`, `environment`, `temp`, `native-scene` (see `shouldIncludeThreeJsonIdInDefaultWorldExport`).

### customBucket (optional, written to JSON)

User-defined layering; **does not** create virtual `Object3D`—index only.

**Per-object local declaration** (highest priority):

```json
{
  "objType": "box",
  "threeJsonId": "tj-wall-1",
  "customBucket": "layer-a",
  "name": "wall-1"
}
```

**Global mapping** (`sceneConfig.customBuckets` or normalized equivalent):

```json
{
  "sceneConfig": {
    "customBuckets": {
      "layer-a": ["tj-wall-1", "tj-floor-1"],
      "ui-overlay": ["tj-label-1"]
    }
  }
}
```

Rules:

- Per-record `customBucket` **overrides** global mapping for same id.
- Names must not use `system:` prefix; recommend `[a-zA-Z0-9_-]+`.
- **`friendlyMap` does not** auto-map to customBucket; friendly JSON normalizes to standard `objectList` first; buckets assigned at deploy.

## Spatial query (core util, not physics engine)

`core/util/spatialQuery.js` provides geometry-level queries—**no** rigid bodies or collision response. Physics drop, etc.: see `extensions/` + `PluginHost`.

```js
import {
  setBox3FromObject,
  findAabbIntersections,
  raycastScene,
  ndcToRay
} from "../../core/index.js";
```

| API | Purpose |
|-----|------|
| `setBox3FromObject` / `box3IntersectsBox3` | AABB bounding boxes |
| `collectObjectsWithObjJson` / `findAabbIntersections` | coarse intersection with objects having `userData.objJson` (no Helper added) |
| `raycastScene` / `ndcToRay` | mouse pick ray |

Business door openings etc. may still use `modelHandler.impactCheck` (internally `findAabbIntersections`); may coexist with Rapier plugin.

### Optional precision picking (`three-mesh-bvh`, off by default)

`core/util/meshPick.js`: opt-in BVH build on Mesh for faster rays.

| Switch | Meaning |
|------|------|
| `sceneConfig.pick.meshBvh: true` | Meshes with `objJson` in scene participate in BVH picking |
| Object `pick.precision: "bvh"` | that object only |

`raycastScene` (standard `Raycaster`) still available. Unrelated to CSG hole-cutting `three-bvh-csg`.

### Optional extension config `extensions`

Scene-level: `sceneConfig.extensions["<extensionId>"]`; object-level: **`extensions`** on the same model record. `worldInfo.extensions` merges into `sceneConfig.extensions` on normalization.

core **passes through** plugin-specific fields without parsing; host calls extension bootstrap in `createJsonScene(..., { onSceneReady })`. Full wiring guide: **[extensions.md](./extensions.md)**; container draft: [`lab/extension-json.md`](../../lab/extension-json.md); example JSON: [`assets/json/tutorial/track-04/04-02-plugin-physics.json`](../../assets/json/tutorial/track-04/04-02-plugin-physics.json).

## Declarative animations

Object JSON may include an `animations` field. The unified frame loop parses and updates these automatically.

```js
{
  name: "rotating-box",
  objType: "box",
  geometry: { width: 80, height: 80, depth: 80 },
  position: { x: 0, y: 40, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: { type: "standard", color: "#409eff" },
  animations: [
    { type: "rotate", axis: "y", speed: 0.6 }
  ]
}
```

Currently supported:

- `type: "rotate"`: continuous rotation.
- `axis`: `x`, `y`, `z`; also accepts `rotationX`, `rotationY`, `rotationZ`.
- `speed`: radians per second.
- `enabled: false`: disable single animation entry.

### `animationMode` (optional)

Coexistence with glTF **`AnimationMixer`** (when clips exist and are registered) and declarative **`animations`** above:

| Value | Behavior |
|------|------|
| **Omitted** or **`both`** | Declarative animations and `AnimationMixer` **both** update (legacy JSON compatible). Combining `rotate` with glTF skeletal animation may stack and be hard to debug; new scenes should set mode explicitly. |
| **`mixer`** | Drive registered `AnimationMixer` **only**; **skip** declarative `rotate` (other declarative types if added later follow docs). |
| **`basic`** | Declarative built-ins **only** (currently mainly `rotate`); **no** `mixer.update` on object root. If Mixer still registered, docs recommend unregister or avoid this mode. |

> **Do not** use literal `json` as a mode name—it confuses with “whole scene JSON”.

### `animationGraph` (optional, glTF animation state machine)

Enabled **only** when a record includes **`animationGraph`**; **without** a graph, legacy behavior remains (register Mixer and **play all clips**). Applies to glTF-loaded `externalModel` / `skinned` records.

| Field | Description |
|------|------|
| `defaultState` | Initial state; must exist in `states` |
| `parameters` | Runtime parameter defaults (`type`: `float` / `bool`) |
| `states` | State name → `{ clips: [{ name, loop?, speed? }], speed? }` |
| `transitions` | `{ from, to, when, crossFade? }`; `from: "*"` matches any current state |
| `when.param` | `eq` / `ne` / `gt` / `gte` / `lt` / `lte` |
| `when.event` | Built-in `clipFinished` when a non-looping clip ends |

**Runtime API** (`threejson/core`): `setAnimationParameter(rootOrThreeJsonId, name, value)`, `fireAnimationEvent(rootOrThreeJsonId, eventName)`.

Tutorial: `assets/json/tutorial/track-03/03-06-animation-graph.json`

## Box

Boxes are parsed by `deployMesh()` or `deployBox()`. `material.type` uses Three.js material classes (`standard`, `lambert`, `phong`, `basic`, etc.). Wall/glass preset semantics use **`objType: "wall"`** / **`objType: "glass"`** (domain `legacyBoxObjTypes`)—not `material.type`.

Glass records may include **`glassKind`**: `clear` | `tinted` | `frosted`.

```js
{
  name: "blue-box",
  objType: "box",
  geometry: { width: 100, height: 80, depth: 60 },
  position: { x: 0, y: 40, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: {
    type: "standard",
    color: "#409eff",
    transparent: false,
    opacity: 1
  }
}
```

### Textured box

```js
{
  name: "room-floor",
  label: "Main floor",
  objType: "floor",
  geometry: { width: 300, height: 8, depth: 300 },
  position: { x: 0, y: -4, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: {
    type: "standard",
    color: "#ffffff",
    metalness: 0.05,
    roughness: 0.85,
    textureUrl: "/assets/textures/building/floor/wood_floor.webp",
    textureRepeat: { x: 2, y: 2 }
  }
}
```

### Six-face materials

When each face of a box needs a different material, use a `materials` array. Order matches Three.js BoxGeometry faces.

```js
{
  name: "six-face-box",
  geometry: { width: 100, height: 100, depth: 100 },
  position: { x: 0, y: 50, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  materials: [
    { type: "standard", color: "#f56c6c" },
    { type: "standard", color: "#67c23a" },
    { type: "standard", color: "#409eff" },
    { type: "standard", color: "#e6a23c" },
    { type: "standard", color: "#909399" },
    { type: "standard", color: "#ffffff" }
  ]
}
```

## Sphere

Spheres also use `deployMesh()`. Standard form: `objType: "sphere"`; legacy `boxType: "sphere"` still reads.

```js
{
  name: "earth",
  objType: "sphere",
  geometry: { radius: 50, widthSegments: 32, heightSegments: 16 },
  position: { x: 160, y: 80, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: {
    type: "standard",
    color: "#00ffcc",
    textureUrl: "/assets/textures/environment/nature/planet/earth.png"
  }
}
```

## Other basic primitives

Besides box and sphere, `deployMesh()` / `createMesh()` supports these single-material primitives:

- `objType: "cylinder"`: `THREE.CylinderGeometry`
- `objType: "cone"`: `THREE.ConeGeometry`
- `objType: "ring"`: `THREE.RingGeometry`
- `objType: "torus"`: `THREE.TorusGeometry`
- `objType: "capsule"`: `THREE.CapsuleGeometry`

Legacy `boxType` and `geometry.type` still read for compatibility; prefer `objType` in standard form.

Minimal example:

```js
{
  name: "demo-cylinder",
  objType: "cylinder",
  geometry: {
    radiusTop: 20,
    radiusBottom: 20,
    height: 80,
    radialSegments: 32
  },
  position: { x: 0, y: 40, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: {
    type: "standard",
    color: "#409eff",
    metalness: 0.1,
    roughness: 0.65
  }
}
```

Common fields per geometry:

- `cylinder`: `radiusTop`, `radiusBottom`, `height`, `radialSegments`, `heightSegments`, `openEnded`
- `cone`: `radius`, `height`, `radialSegments`, `heightSegments`, `openEnded`
- `ring`: `innerRadius`, `outerRadius`, `thetaSegments`, `phiSegments`
- `torus`: `radius`, `tube`, `radialSegments`, `tubularSegments`
- `capsule`: `radius`, `length`, `capSegments`, `radialSegments`

## subScene nesting (hierarchical objects)

ThreeJSON expresses deploy subtrees under a parent descriptor with **`subScene[]`** (internal canonical form: **nested**). This is **not** the same as Three.js native JSON **`children`** (`objType: "native"` / ObjectLoader) or runtime `Object3D.children`.

### Authoring rules

- **Groups and nestable containers**: child objects go in **`subScene`**. **Do not** use `boxModelList` / `subGroup` / `infoPanelList` on group records—deploy **does not read** those on groups. Legacy JSON with those fields inside groups migrates to `subScene` via `migrateGroupDescriptorToSubScene` during normalization.
- **Root-level `worldInfo.boxModelList`** etc.: unchanged semantics—scene-root boxes, floors, thin domains—not group-internal fields.
- **Empty group**: omit `subScene` or `subScene: []` creates empty `THREE.Group` (no visible child mesh; usable as pure transform container or placeholder).
- **`pickThroughRaycast`** (optional, default `false`): on **subScene parent / deploy container** records (`group`, `domain`, etc.). When `true`, ELM canvas raycast may skip non-interactive shell meshes **within that container's descendants** and hit sibling bindings; it does **not** pierce outside the container to bindings behind it. Affects ELM event picking only—not rendering or physics. See [Event mechanism § 1.3.2](./event-mechanism.md#132-elm-射线拾取与-pickthroughraycast).

### Load and export

| Capability | Description |
|------|------|
| **Load input** | nested `subScene`, flat `parentThreeJsonId`, or top-level `subSceneList` block; normalized to nested then deploy |
| **Export layout** | `subSceneLayout`: `nested` (core default) \| `flat` \| `subSceneList` |
| **Normalize policy** | `sceneJson.subSceneNormalizePolicy`: `warn` (default, orphans to root, duplicate id first wins) \| `strict` (throw) |

More implementation detail: [`lab/subscene-memo.md`](../../lab/subscene-memo.md).

```json
{
  "name": "nested-group",
  "objType": "group",
  "threeJsonId": "grp-demo",
  "position": { "x": 0, "y": 0, "z": 0 },
  "subScene": [
    {
      "name": "child-box",
      "objType": "box",
      "geometry": { "width": 50, "height": 50, "depth": 50 },
      "material": { "type": "standard", "color": "#67c23a" }
    },
    {
      "name": "child-subgroup",
      "objType": "group",
      "subScene": [
        {
          "name": "grandchild-sphere",
          "objType": "sphere",
          "geometry": { "radius": 20 },
          "material": { "type": "standard", "color": "#409eff" }
        }
      ]
    }
  ]
}
```

## Group

Groups are created by `createGroup()` as empty `THREE.Group` shells; via **`createJsonScene` / `deployObjectRecord`** unified load chain, **`subScene`** is read and children deployed recursively. If you only call `createGroup()` + manual `scene.add(group)`, deploy children yourself.

```js
{
  name: "simple-group",
  objType: "group",
  position: { x: 0, y: 0, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  subScene: [
    {
      name: "group-box-a",
      objType: "box",
      geometry: { width: 50, height: 50, depth: 50 },
      position: { x: -40, y: 25, z: 0 },
      rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
      scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
      material: { type: "standard", color: "#67c23a" }
    },
    {
      name: "group-box-b",
      objType: "box",
      geometry: { width: 40, height: 70, depth: 40 },
      position: { x: 35, y: 35, z: 20 },
      material: { type: "standard", color: "#e6a23c" }
    }
  ]
}
```

**Compatibility**: when legacy examples wrote `boxModelList` / `subGroup` **inside group records**, rely on normalization migration before load, or hand-convert to `subScene` as above. Tutorial reference: [`assets/json/tutorial/track-01/01-01-group-line-panel.json`](../../assets/json/tutorial/track-01/01-01-group-line-panel.json).

## Line

Ordinary lines use `createLine()`; wide lines use `createLine2()`. `LineBasicMaterial` line width is not supported in most WebGL environments—use `createLine2()` when you need width.

```js
{
  name: "path-line",
  objType: "line",
  material: {
    color: "#1AD4D4",
    opacity: 0.85,
    transparent: true,
    linewidth: 4
  },
  points: [
    { x: -120, y: 5, z: -80 },
    { x: 0, y: 5, z: 80 },
    { x: 120, y: 5, z: -80 }
  ]
}
```

## infoPanel

Full selection guide, per-type examples, and demo index: **[Info panels guide](./info-panels.md)**.

Info panels are created by `deployInfoPanel(scene, infoPanel)`. Carrier field `panelBoxType`: `box` or `sprite`; `sprite` always faces camera. Legacy `boxType` still reads. `type`: `text`, `html`, or `img`.

**Behavior fields**:

| Field | Default | Meaning |
|-------|---------|---------|
| `visible` | `true` | Skip creation when `false` |
| `fix` | *(omit)* | **`true`**: pinned; **`false`**: dismissible (default dblclick on panel); **omit**: not dismissible via panel events |
| `dismissTrigger` | *(omit)* | Advanced when `fix: false`: `click` / `dblclick` / `keydown`; ignored when `fix: true` |
| `textFace` | `single` | Box only: `single` = front face texture; `full` = same texture on all six faces |

- `type: "text"`: uses `createStrTextureMultiline`; adjust size/layout via `font` or structured `textStyle`; `backColor` is baked into the texture background.
- `type: "html"`: `text` holds HTML/CSS as-is—content fonts not rewritten; `contentScale` (or `contentScaleX/Y`) scales final texture display size.
- `type: "img"`: also supports `contentScale` (or `contentScaleX/Y`); rounded corners require alpha in the image asset unless Canvas clipping is added later.
- `borderRadius`: panel corner radius in texture logical pixels (`0` = square corners, default `0`). Same semantics as `css3dPanel`; both `sprite` and `box` carriers use texture alpha for rounded corners.

```js
{
  text: "ThreeJSON Info Panel",
  type: "text",
  objType: "infoPanel",
  panelBoxType: "sprite",
  visible: true,
  fix: true,
  color: "#ffffff",
  backColor: "#303133",
  borderRadius: 8,
  panelWidth: 16,
  panelHeight: 7,
  panelDepth: 0.2,
  transparent: true,
  opacity: 0.85,
  font: "18px Microsoft YaHei",
  textStyle: {
    fontSizePx: 22,
    autoFit: true,
    fitRatio: 0.78,
    minFontPx: 14,
    maxFontPx: 72
  },
  contentScale: 1,
  panel: {
    geometry: { width: 16, height: 7, depth: 0.2 },
    position: { x: 0, y: 14, z: 0 },
    material: { color: "#303133", transparent: true, opacity: 0.85 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  }
}
```

Common `textStyle` fields:

- `fontSizePx`, `fontFamily`
- `padding`, `lineHeight`
- `autoFit`, `fitRatio`, `minFontPx`, `maxFontPx`

**Box + text** (`panelBoxType: "box"`):

```js
{
  type: "text",
  panelBoxType: "box",
  text: "Box text panel",
  color: "#fff",
  backColor: "#409eff",
  panelWidth: 12,
  panelHeight: 6,
  panelDepth: 0.4,
  panel: { position: { x: 0, y: 8, z: 0 } }
}
```

**Sprite + HTML** (`type: "html"`, static texture—not clickable):

```js
{
  type: "html",
  panelBoxType: "sprite",
  text: "<div style='padding:8px;background:#fff'>HTML sign</div>",
  panelWidth: 18,
  panelHeight: 6,
  panel: { position: { x: 0, y: 12, z: 0 } }
}
```

## Device domain panel triggers

On **device domain records** (e.g. `domain: "device.ups"`), not standalone `infoPanelList` entries. Full API: [api.md § domains/device](./api.md#domainsdevice--device-panel).

| Field | Description |
|-------|-------------|
| `panelShowTrigger` | ELM derived only when set: `hover` / `click` / `dblclick` / `none` |
| `panelHideTrigger` | ELM derived only when set: `mouseleave` / `click` / `dblclick` / `panel.click` / `panel.dblclick` / `none` |
| `panelHideDelayMs` | Delay ms when hide=`mouseleave` |
| `infoPanel.visible` | **Initial** visibility at deploy: omit or `true` → show; `false` → hide |
| `infoPanel.dismissTrigger` | Panel self-dismiss (wins over `panelHideTrigger: panel.*`) |

When `panelShowTrigger` and `panelHideTrigger` map to the same platform event (e.g. both `dblclick`), one **`device.togglePanel`** binding is derived. Explicit `events.*` wins over derived bindings.

```json
{
  "objType": "domain",
  "domain": "device.ups",
  "panelShowTrigger": "dblclick",
  "panelHideTrigger": "dblclick",
  "infoPanel": {
    "visible": false,
    "dismissTrigger": "dblclick",
    "type": "html",
    "text": "<div>UPS</div>"
  }
}
```

## Interactive CSS3D panel css3dPanel (core)

For static signage continue using **`infoPanel`** (`type: html` uses html2canvas texture—not clickable). For **interactive DOM / iframe** use **`css3dPanel`** (core first-class capability, same level as `infoPanel`).

- Friendly list: `worldInfo.css3dPanelList[]` (symmetric with `infoPanelList`)
- Scene switch: `sceneConfig.extensions["css3d"]` — `enabled`, `pointerPolicy` (`panel` | `orbit` | `auto`)
- Load: `createJsonScene`; after deploy auto-traverses scene graph and mounts second pass when `CSS3DObject` present

`content.type`: `html` or `url` (iframe). `width` / `height`: DOM pixel size; `panelWidth`: world width in scene (scales DOM into 3D space).

```js
{
  objType: "css3dPanel",
  name: "ops-console",
  width: 320,
  height: 200,
  panelWidth: 3,
  position: { x: 0, y: 4, z: 0 },
  content: { type: "html", html: "<button>Confirm</button>" }
}
```

Implementation: [`core/builder/css3d/`](../../core/builder/css3d/).

## heatMap

- **Planar**: `createHeatmap(heatObj, scene)`. Uses only `geometry.width` / `height`; `geometry.depth` if present is **ignored**. Point data may still have `z`; grid samples in-plane only.
- **Volume**: `createHeatmapVolume(heatObj, scene)`; requires valid `geometry.depth > 0`, else falls back to planar.
- **Unified world load**: data in `worldInfo.heatList` via `createJsonScene()` / `deployJsonScene()` auto-selects by `geometry.depth`—volume when `depth > 0`, else planar.

Heat patterns generated on GPU via `DataTexture` / `Data3DTexture` (not canvas) raster, then applied to geometry.

```js
{
  geometry: { width: 300, height: 180 },
  position: { x: 0, y: 2, z: 0 },
  rotation: { rotationX: -Math.PI / 2, rotationY: 0, rotationZ: 0 },
  heatMap: [
    { x: 80, y: 80, temperature: 28 },
    { x: 180, y: 100, temperature: 35 }
  ]
}
```

## wind (dynamic plane)

Strip wind deployed by **weather domain** (`domains/weather`): `deployWindStrip` / `createWind` (core thin wrapper) creates textured `Plane`; UV scroll updated each frame by `planeScrollMotion` (same class as `points` `scrollUv`). With `createSceneRuntime()` attach `updateSceneAnimations` or equivalent frame loop.

Handler presets: `wind` | `coldWind` | `hotWind` (also `domainModelList` with `domain: "weather", handler: "coldWind"`).

```js
{
  objType: "wind",
  speed: 1,
  geometry: { width: 80, height: 180 },
  position: { x: -120, y: 90, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  material: {
    textureUrl: "/assets/textures/environment/nature/weather/wind_cold_left.png",
    textureRepeat: { x: 0.1, y: 8 },
    transparent: true,
    opacity: 0.85,
    side: "double"
  }
}
```

**Textures and UV scroll**

- [`assets/textures/environment/nature/weather/`](../../assets/textures/environment/nature/weather/) provides `wind_{cold,hot}_{left,right}.png`; chevrons align with texture **U** (horizontal). Default **U-axis scroll** (omit `scrollAxis` or use `u`). Avoid `scrollAxis: "v"` on horizontal chevron textures — motion will look weak or wrong.
- Use `scrollAxis: "v"` only when the texture pattern itself is vertical.
- **Reverse flow** priority: negative `speed` > swap to `_right` texture > adjust `rotationZ`. `speed` may be any non-zero finite value; negative reverses UV offset.
- Vertical up/down flow uses **plane rotation** + U scroll, not left/right texture choice.

## External models obj/gltf/glb/threejson

Prefer unified `objType: "externalModel"` dispatched by `loadExternalModel(externalModel, scene)`. `worldInfo.externalModelList`, `objModelList`, and legacy `objType: "gltf"` etc. remain compatible.

- `modelFileType: "obj"`: OBJLoader; optional `mtlPath` loads MTL before OBJ. When JSON omits `mtlPath`, runtime may infer same-directory `.mtl` from `mtllib` in `.obj` content.
- `modelFileType: "gltf"` / `"glb"`: GLTFLoader.
- `modelFileType: "stl"` / `"ply"` / `"fbx"` / `"usdz"` (or `"usd"`): lazy-load corresponding Three.js Loader by extension, read binary from URL / blob.
- `modelFileType: "three"` / `"threejson"` / `"object"`: Three.js `ObjectLoader` for **Object/Scene** JSON (`Object3D.toJSON()` / editor export—not deprecated `JSONLoader` geometry files).

Formats symmetric with mesh export: `glb`, `gltf`, `obj`, `stl`, `ply`, `usdz`, `fbx`. Unknown `modelFileType` throws `E_EXTERNAL_MODEL_UNSUPPORTED`—no longer misroutes to OBJLoader.
- `mtl` in current implementation is dependency material for `obj` only—not rendered as standalone visible model.

OBJ texture priority:

1. Textures declared in `.mtl` (e.g. `map_Kd`, `norm`, `map_bump`).
2. Explicit `maps` on OBJ record.
3. When no `maps`, fallback from sibling `maps/` folder next to OBJ or MTL by naming convention (scope via `mapsFolderFallback`, below).
4. Legacy `material.textureUrl` / `material.map` ( `map` slot fallback only).
5. On `maps` slot objects: **`textureKind: "video"`** (and `videoMuted` / `videoLoop`, etc.) or **`textureKind: "gif"`** (and `gifAutoplay` / `gifPlaybackRate` / `gifMaxFps`)—same as box/sphere/plane primitives; see [domains.md](./domains.md) and [BUSINESS_DOMAINS.md](../../core/BUSINESS_DOMAINS.md). When `textureKind` omitted or `image`, `.gif` URLs load as static (first frame only); animation requires explicit `gif`.

```js
{
  objType: "externalModel",
  modelFileType: "obj",
  modelPath: "/assets/model/obj/medium_cargo_ship/medium_cargo_ship.obj",
  mtlPath: "/assets/model/obj/medium_cargo_ship/medium_cargo_ship.mtl",
  position: { x: 0, y: 0, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
}
```

### Minimal standard snippet: `objectList` pointing to glTF

```json
{
  "objectList": [
    {
      "objType": "externalModel",
      "modelFileType": "gltf",
      "modelPath": "/assets/model/gltf/threejson_unlit_pyramid.gltf",
      "position": { "x": 0, "y": 12, "z": 0 },
      "scale": { "scaleX": 24, "scaleY": 24, "scaleZ": 24 }
    }
  ]
}
```

Full working example: [03-01-external-gltf.html](../../examples/html-demo/track-03-assets/03-01-external-gltf.html) and `assets/json/tutorial/track-03/03-01-external-gltf.json`.

### OBJ explicit `maps`

Prefer OBJ textures at record top level—not inside `material`—to distinguish from legacy `material.textureUrl`:

```js
{
  objType: "externalModel",
  modelFileType: "obj",
  modelPath: "/assets/model/obj/crane/crane.obj",
  mtlPath: "/assets/model/obj/crane/crane.mtl",
  mapsBasePath: "/assets/model/obj/crane/maps/",
  maps: {
    map: "baseColor.png",
    normalMap: "normal.png",
    roughnessMap: "roughness.png",
    metalnessMap: "metalness.png",
    alphaMap: {
      url: "alpha.png",
      repeat: { x: 1, y: 1 },
      offset: { x: 0, y: 0 }
    }
  }
}
```

Notes:

- `mapsBasePath` optional; relative paths in `maps` resolve against it. Default: relative to `modelPath` directory.
- `maps` supports: `map`, `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap`, `emissiveMap`, `bumpMap`, `alphaMap`, `specularMap`.
- Each slot: string or object; common object fields: `url`, `repeat`, `offset`, `rotation`, `center`, `colorSpace`.
- When MTL already provides a slot, JSON `maps` does not override—only fills missing slots.

### OBJ sibling `maps/` fallback

When OBJ record has no `maps`, runtime tries textures from `maps/` folder next to OBJ or MTL.

**`mapsFolderFallback`** (optional, on OBJ / `externalModel` record top level, or inside `material`) controls sibling `maps/` step only—not MTL textures, explicit `maps`, or `material.textureUrl`:

| Value | Meaning |
|----|------|
| `"map"` | **Default** (omitted field same): fallback diffuse / `map` slot in `maps/` only |
| `"full"` | Fallback all 9 texture slots in `maps/` (see table below) |
| `"off"` | Disable sibling `maps/` fallback |

```json
{
  "modelPath": "/assets/model/obj/maps_fallback/alpaca.obj",
  "material": { "color": "#2F3133" },
  "mapsFolderFallback": "off"
}
```

Browsers cannot reliably enumerate directories; fallback uses fixed naming. With `mapsFolderFallback: "full"` (or explicit `"full"` when all slots needed):

- `map`: `map.*`, `baseColor.*`, `albedo.*`, `diffuse.*`, `color.*`
- `normalMap`: `normalMap.*`, `normal.*`
- `roughnessMap`: `roughnessMap.*`, `roughness.*`
- `metalnessMap`: `metalnessMap.*`, `metalness.*`, `metallic.*`
- `aoMap`: `aoMap.*`, `ao.*`, `ambientOcclusion.*`
- `emissiveMap`: `emissiveMap.*`, `emissive.*`, `emission.*`
- `bumpMap`: `bumpMap.*`, `bump.*`, `height.*`
- `alphaMap`: `alphaMap.*`, `alpha.*`, `opacity.*`
- `specularMap`: `specularMap.*`, `specular.*`

Extensions tried: `png`, `jpg`, `jpeg`, `webp`, `bmp`.

Example:

```text
/assets/model/obj/crane/
  crane.obj
  crane.mtl
  maps/
    baseColor.png
    normal.png
    roughness.png
```

### Minimal standard snippet: `objectList` pointing to native JSON

Examples use site-root paths so project-root pages and `examples/html-demo/` pages share the same assets.

```json
{
  "objectList": [
    {
      "objType": "externalModel",
      "modelFileType": "three",
      "modelPath": "/assets/json/three_native.json",
      "position": { "x": 0, "y": 0.5, "z": 0 }
    }
  ]
}
```

### Minimal standard snippet: `domain` + `nativeThree`

Unlike [`objType: "native"`](#objtype-native-general-threejs-object) (**single** ObjectLoader record), this domain loads **whole** Three.js Object/Scene JSON (URL or inline).

Works with `applyDomainModelsFromWorldInfo(scene, worldInfo)`. Domain overview, registration, custom extension examples: [Business domains and `domains/`](./domains.md); implementation constraints: [BUSINESS_DOMAINS.md](../../core/BUSINESS_DOMAINS.md). Below: **`loadFromUrl`**; editor “Load native JSON” also uses **`handler: "parseInline"`** with inline object graph in same-domain `record.json` (no `modelPath`).

```json
{
  "objectList": [
    {
      "objType": "domain",
      "domain": "nativeThree",
      "handler": "loadFromUrl",
      "modelPath": "/assets/json/three_native.json",
      "position": { "x": 0, "y": 0.5, "z": 0 }
    }
  ]
}
```

Full working examples: [03-03-native-three-domain.html](../../examples/html-demo/track-03-assets/03-03-native-three-domain.html), [03-03-native-three-domain.json](../../assets/json/tutorial/track-03/03-03-native-three-domain.json) (subgraph **`assets/json/three_native.json`** stored separately to demo “orchestration JSON” vs “native subgraph JSON” split).

## CSG: union, intersection, holes

Box and sphere support `joins`, `inters`, and `holes` arrays; boolean ops via `three-bvh-csg`.

```js
{
  name: "wall-with-hole",
  objType: "wall",
  geometry: { width: 220, height: 120, depth: 20 },
  position: { x: 0, y: 60, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: { type: "standard", color: "#dcdfe6" },
  holes: [
    {
      geometry: { width: 80, height: 60, depth: 30 },
      position: { x: 0, y: 60, z: 0 },
      rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
      scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
      material: { type: "standard", color: "#ffffff" }
    }
  ]
}
```

CSG is costlier than plain geometry—use only when boolean ops are truly needed.

## Box list coalescing: `instanceCode` / `mergeCode`

For scenes with many repeated boxes, call `coalesceBoxModelList(boxModelList)` first to merge legacy JSON entries sharing codes into compact structure:

- Boxes sharing `instanceCode` aggregate into one `instance: true` record with `transforms` array → `InstancedMesh`.
- Boxes sharing `mergeCode` aggregate into one `merge: true` record with `geometryArr`, `materialArr`, `transforms`, etc. → geometry merge.

Minimal example:

```js
[
  {
    objType: "rackUnit",
    instanceCode: "rack-shell",
    geometry: { width: 40, height: 8, depth: 30 },
    position: { x: -30, y: 4, z: 0 },
    material: { type: "standard", color: "#409eff" }
  },
  {
    objType: "rackUnit",
    instanceCode: "rack-shell",
    geometry: { width: 40, height: 8, depth: 30 },
    position: { x: 30, y: 4, z: 0 },
    material: { type: "standard", color: "#409eff" }
  }
]
```

After coalescing, one instanced record remains; `createJsonScene` applies this automatically via `normalizeScenePayload` when loading friendly JSON (business demos such as `room-show.html` and `port-show.html` should not call it again at page level).

## Out of scope for current JSON mainline

These capabilities are not unsupported by Three.js—they are **deliberately not first-class ThreeJSON JSON schema** today (or only partially supported):

- **Skeletal animation advanced**: `animationGraph` state machine and runtime API support glTF clip switching; morph target state machines are still out of scope
- **GPU particle engines** (dedicated emitter libraries beyond `THREE.Points`)
- **More curves/surfaces**: `ExtrudeGeometry`, `LatheGeometry`, `ShapeGeometry`, NURBS, etc.
- **Unified mainline support for `FBX`, `STL`, `PLY`, `DAE`**, and more formats
- **Pure CSS3D scene / replacing WebGL main renderer**: not supported; interactive DOM via core **`css3dPanel`** (dual pass, vs static `infoPanel` textures)

Current recommendations:

- Static complex models: `externalModelList` or `nativeThree`; for “character/rig” semantics use **`skinnedList`**.
- Pipe paths: prefer **`tubeList`**; large textured sheets use **`plane`** / **`wind`**.
- Point clouds / simple particles: **`particleList`** (`THREE.Points`).






