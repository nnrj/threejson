[中文](../zh/domains.md) | [English](./domains.md)

# Business Domains and `domains/`

This page explains what business domains are in ThreeJSON, when to use them, and how to create your own domain.

If you only want to render ordinary boxes, spheres, groups, or external models from JSON, start with the [JSON Format Guide](./json-format.md) and the [Core API](./api.md). If you want to package business-specific behavior as reusable runtime capabilities, or drive those capabilities through friendly JSON `worldInfo.domainModelList` or standard `objType: "domain"` records, then `domains/` is the part to look at.

There is also an implementation-oriented note under [`../core/BUSINESS_DOMAINS.md`](../../core/BUSINESS_DOMAINS.md). This page is the caller-facing entry point; the file under `core/` is more about internal conventions and design constraints.

## Documentation layering (library vs apps)

`core/` and `domains/` are the **library**. Any host app—a minimal page that renders one box, a demo, RoomShow, or a scene editor—is a **consumer on equal footing**.

- This page, [domain-scaffold.md](./domain-scaffold.md), and [BUSINESS_DOMAINS.md](../../core/BUSINESS_DOMAINS.md) describe **library contracts** for integrators and generic loaders.
- **Dependency direction** (core may change; no reverse imports; host UX stays in hosts) is in [design-principles.md §Dependency direction](./design-principles.md#dependency-direction-core--domains--host).
- Host-specific UI (model palettes, toolbars, undo stacks) belongs in **application docs** (for example [editor-selection.md](./editor-selection.md)), not in required domain APIs.
- Some domains expose convenience methods such as `addToScene` on `api` for `domainModelList` handlers or optional host use; absence does not block registration.

## What is a domain

A domain is a business extension module attached to ThreeJSON. Each domain is a descriptor exported from `domains/<name>/index.js`. That descriptor answers questions such as:

- What is the domain id?
- Can it turn certain `boxModel` records into richer `Object3D` instances?
- How does it respond to friendly `worldInfo.domainModelList` records or standard `objType: "domain"` records?
- Which additional APIs does it expose for direct imperative calls?

Built-in domains are registered through a manifest (still **static `import`s at runtime**; the browser does **not** scan `domains/`). Most apps only need:

```js
import { createJsonScene, door } from "threejson";
```

(In-repo HTML: map `"threejson": "/builtins/full.js"` in import map, or use split `core/index.js` + `builtins/register.js` — see [`examples/html-demo/README.md`](../../examples/html-demo/README.md).)  
Use `import "threejson/builtins/register"` only with **`threejson/core`** when you control registration order yourself.

Manifest and merge logic:

- [`../builtins/builtinDomainManifest.generated.js`](../../builtins/builtinDomainManifest.generated.js): produced before publish / in dev by **recursively** scanning `domains/**/index.js` (**do not edit by hand**); descriptor `id` should match the folder path (e.g. `domains/weather/rain` → `id: "weather.rain"`).
- [`../builtins/userDomainDescriptors.js`](../../builtins/userDomainDescriptors.js): hand-written overrides; on the **same `id`**, the user entry **wins**; ids only in the user list are **appended** at the end.
- [`../builtins/register.js`](../../builtins/register.js): merges descriptors and calls `initBusinessDomains`.

**Maintainers** run **`npm run generate:business-domain-manifest`** from the repo root after adding `domains/<name>/index.js`. **End users** who install the npm package do not run generate.

### Third-party domains (npm + CLI)

1. `npm install @acme/threejson-domain-warehouse`
2. Recommended `package.json`:

```json
{
  "threejson": {
    "domain": "./index.js",
    "domainId": "warehouse"
  }
}
```

3. In the user project: `npx threejson add-domain @acme/threejson-domain-warehouse` — writes **`threejson.domains.mjs`** (and may update **`threejson.bootstrap.mjs`**).
4. App entry:

```js
import "./threejson.bootstrap.mjs";
// or: import { createJsonScene } from "threejson"; import "./threejson.domains.mjs";
```

> **Note (`threejson@0.1.x` on npm)**: The published **`threejson` runtime package does not include the CLI** (no `bin`). To use `npx threejson add-domain`, **clone this repo** and link [`tools/threejson-cli/`](../../tools/threejson-cli/cli.mjs) locally, or hand-write **`threejson.domains.mjs`** with `registerDomain`; a CLI npm package is planned for a later release.

## When should you use a business domain

Good reasons to introduce a domain:

- You want a stable entry point for a family of business objects instead of writing custom Three.js assembly code in every page.
- You want scene JSON to declare *what should happen*, then let the runtime dispatch it, for example `domain: "nativeThree"` or `domain: "cabinet"`.
- Your page already knows which business domain it is working with and wants direct APIs through `businessDomains.<id>.*`.
- You want some `boxModelList` records to be automatically upgraded into composite objects instead of going through a plain `deployMesh()`.

Cases that usually do **not** need a dedicated domain:

- Adding a regular box, sphere, line, heatmap, or external-model JSON record.
- One-off page logic with no reuse value.

## Three common entry points

### 1. `worldInfo.domainModelList` / standard `objType: "domain"`

This is the most generic and most JSON-driven option. Authors can write domain records in friendly JSON `worldInfo.domainModelList`, or write them directly in standard `objectList` with `objType: "domain"`. The page only needs to pass the records into the dispatcher:

```js
import { applyDomainModelsFromWorldInfo } from "../core/index.js";

applyDomainModelsFromWorldInfo(scene, worldInfo, ctx);
```

A standard domain record looks like this:

```json
{
  "objType": "domain",
  "domain": "nativeThree",
  "handler": "loadFromUrl",
  "modelPath": "/assets/json/three_native.json",
  "position": { "x": 0, "y": 0.5, "z": 0 }
}
```

The friendly JSON equivalent is usually:

```json
{
  "worldInfo": {
    "domainModelList": [
      {
        "domain": "nativeThree",
        "handler": "loadFromUrl",
        "modelPath": "/assets/json/three_native.json"
      }
    ]
  }
}
```

Common fields:

| Field | Meaning |
| ------ | ------ |
| `domain` | Required. The business domain to dispatch to. |
| `handler` | Optional. The capability name inside that domain. If omitted, the domain may use `defaultHandler` or handle it inside `resolveDomainModel()`. |
| `items` | Optional. Batch input interpreted by that domain. |
| `payload` | Optional. Shorthand for a single input object. |
| `options` | Optional. Extra options. |

### 2. `invokeDomainModel(scene, record, ctx)`

This is equivalent to dispatching one single `domainModelList` record. It is useful when code wants to trigger one domain behavior ad hoc:

```js
import { invokeDomainModel } from "../core/index.js";

invokeDomainModel(scene, {
  domain: "nativeThree",
  handler: "loadFromUrl",
  modelPath: "/assets/json/three_native.json"
});
```

### 3. `businessDomains.<id>.*`

If the page already knows it is working with one specific business domain, it can call the APIs exposed by that domain directly:

```js
import { businessDomains } from "../core/index.js";

businessDomains.port.createPortStatistics(sceneJsonRoot, scene, "capacity");
```

This is more imperative than `domainModelList`, but both styles are backed by the same registered domain descriptors.

Nested subdomains use the same surface:

```js
businessDomains.weather.rain.deployRain(record, scene);
businessDomains["weather.wind"].deployWind(record, scene);
```

## Nested subdomains (qualified id)

Core supports **dot-separated qualified ids** (v1):

| Concept | Example |
|---------|---------|
| Root domain | `weather` → `domains/weather/index.js` |
| Child domain | `weather.rain` → `domains/weather/rain/index.js` |
| JSON dispatch | `{ "domain": "weather.rain", "objType": "domain", ... }` |
| API names | **Leaf segment**: `createRain` / `deployRain` (not `createWeatherRain`) |

Notes:

- **`getDomain("rain")`** returns `null` when `weather.rain` (or any `*.rain`) is registered; use the full id. Short root ids (`port`, `cabinet`) are unaffected.
- Root and child domains can coexist (`weather` + `weather.rain` / `weather.wind`). Demo: [`05-02-nested-domain.html`](../../examples/html-demo/track-05-tooling/05-02-nested-domain.html). See [`lab/nested-domain-memo.md`](../../lab/nested-domain-memo.md).

## Domain descriptor structure

The core descriptor contract is defined in [`../core/handler/businessDomainRegistry.js`](../../core/handler/businessDomainRegistry.js). `initBusinessDomains` / `registerDomain` run **`validateDomainDescriptor`**:

| Check | Level |
|-------|--------|
| `id` (string), `api` (object) | **Required** — throws if missing |
| `api.create${PascalCase(leaf)}`, `api.deploy${PascalCase(leaf)}` | **Required** — `leaf` is the last segment (`nativeThree` → `createNativeThree`; `weather.rain` → `createRain`) |
| `api.create${PascalCase(leaf)}Json` | **Recommended** — `console.warn` if missing |
| `resolveDomainModel` or `domainHandlers` | **Recommended** for deployable domains — `console.warn` if both missing |
| Namespace-only descriptor (no create/deploy) | **Allowed** — warns; not dispatchable via `invokeDomainModel` |

`PascalCase(leaf)` matches `toPascalCase` in the registry. Built-in list: [`builtinDomainManifest.generated.js`](../../builtins/builtinDomainManifest.generated.js). Contract tests: [`tests/businessDomainManifest.test.mjs`](../../tests/businessDomainManifest.test.mjs), [`tests/nestedDomainRegistry.test.mjs`](../../tests/nestedDomainRegistry.test.mjs).

A common shape looks like this:

```js
const demoDomain = {
  id: "demo",
  defaultHandler: "addToScene",
  resolveDomainModel(record, scene, ctx) {
    // Recommended: let the domain interpret the record itself
  },
  domainHandlers: {
    addToScene(record, scene, ctx) {
      // Optional: use explicit handler-to-function mapping if you prefer
    }
  },
  composeBoxModel(boxModel, ctx) {
    // Optional: convert certain boxModel records into composite Object3D objects
  },
  api: {
    createDemoJson(overrides) {
      return { objType: "box", /* ... */ ...overrides };
    },
    createDemo(overrides) {
      return createMesh(createDemoJson(overrides));
    },
    deployDemo(overrides, scene) {
      const mesh = createDemo(overrides);
      if (mesh) scene.add(mesh);
    }
  }
};
```

### `resolveDomainModel` vs `domainHandlers`

- Prefer `resolveDomainModel(record, scene, ctx)` when the domain wants full control over how records are interpreted.
- Use `domainHandlers` plus `defaultHandler` when your domain is better represented as a clean `handler -> function` table.
- Both styles work with `applyDomainModelList()`. If both exist, `resolveDomainModel()` has higher priority.

### What is `composeBoxModel`

`composeBoxModel(boxModel, ctx)` is **not** for `domainModelList`. It is for `worldInfo.boxModelList`.

When a page uses `deployMeshWithDomains()` or `deployMeshListWithDomains()` (for friendly `boxModelList`, `sphereModelList`, or `meshList` after normalization): records matching `legacyBoxObjTypes` route to `resolveDomainModel`; if `sceneConfig.enableComposeBoxModel === true`, registered domains may handle records via `composeBoxModel()`; otherwise the runtime falls back to `deployMesh()`.

**Preset thin domains** ([`domains/wall`](../../domains/wall/index.js), [`domains/glass`](../../domains/glass/index.js)): use `objType: "wall"` / `"glass"` in `boxModelList` without enabling compose (legacy mapping). Glass records may set `glassKind` (`clear` | `tinted` | `frosted`). Deployed materials use `material.type: "standard"`.

That is why some domains support both `domainModelList` and `boxModelList` extension.

## Start with the small example: `nativeThree`

[`../domains/nativeThree/index.js`](../../domains/nativeThree/index.js) is the closest thing in this repository to a pure `domainModelList` / `objType: "domain"` example. It does not implement `composeBoxModel`. It only turns domain records into loading actions for Three.js native Object / Scene JSON.

Key points:

- `id` is `nativeThree`.
- Its default handler is `loadFromUrl`.
- `resolveDomainModel()` supports:
  - `handler: "loadFromUrl"`: load external native JSON from `modelPath`.
  - `handler: "parseInline"`: parse an in-memory object graph from `record.json`, `payload.json`, or `items[0]`.

Minimal record example:

```json
{
  "objType": "domain",
  "domain": "nativeThree",
  "handler": "loadFromUrl",
  "modelPath": "/assets/json/three_native.json",
  "position": { "x": 0, "y": 0.5, "z": 0 }
}
```

If you are new to business domains, understand `nativeThree` first. It is a clean example of one entry point and one responsibility.

## Then look at the advanced example: `port`

[`../domains/port/index.js`](../../domains/port/index.js) is a mixed domain:

- It uses `composeBoxModel()` to take over certain `boxModelList` records and turn them into port composites.
- It also supports `domainModelList`, but currently that path is mostly for the statistics overlay handler `createPortStatistics`.

That means `port` is **not** the best template for the first custom domain. It is better treated as a realistic example of a more advanced domain.

### `port` through `domainModelList` (canonical)

In [`../assets/json/portShow.json`](../../assets/json/portShow.json), dock cranes and similar equipment are declared in **`domainModelList`** (`name` = slug, `label` = display text):

```json
{
  "objType": "domain",
  "domain": "port",
  "handler": "dockCrane",
  "name": "dock-crane",
  "label": "Dock Crane 1",
  "geometry": { "width": 70, "length": 90, "height": 280, "depth": 90 },
  "position": { "x": -80, "y": 2, "z": -250 },
  "businessInfo": {
    "deviceTypeCode": "crane",
    "portStatistic": true,
    "portStatMenu": "load",
    "usedLoad": 628,
    "totalLoad": 900
  }
}
```

### `port` through `boxModelList` (legacy authoring sugar)

Friendly JSON may still place `objType: "dockCrane"` under `boxModelList`; on load it normalizes to a domain record and runs through `invokeDomainModel`. Use slug **`name`** (e.g. `dock-crane`) and **`label`** (e.g. `Dock Crane 1`) — do not put display text in `name`.

### `port` stat overlay via `domainModelList`

`port` also exposes a narrower `domainModelList` entry mainly used for stat overlays:

```json
{
  "domain": "port",
  "handler": "createPortStatistics",
  "options": { "statType": "capacity" }
}
```

This usually also requires `ctx.sceneJsonRoot` or `ctx.jsonData`, because the domain needs to look back into the root JSON and inspect `worldInfo.boxModelList` plus `businessInfo` anchors.

So if you want to learn how to build your first domain, **do not copy `port` blindly**. Learn the `nativeThree` dispatch model first, then come back to `port` to understand hybrid domains.

## How to create your own domain

Here is the recommended flow.

### Step 1: decide which kind of domain you need

Decide whether your domain is mainly:

1. A `domainModelList` dispatcher.
2. A `composeBoxModel` extension for certain `boxModel` records.
3. A hybrid of both.

If you only need the first kind, start with the smallest possible domain.

### Step 2: create `domains/<name>/index.js`

This minimal skeleton is a good starting point:

```js
import { createMesh } from "../../core/builder/modelBuilder.js";

function createDemoJson(overrides = {}) {
  return {
    name: "demo-domain-box",
    objType: "box",
    geometry: { width: 80, height: 80, depth: 80 },
    position: { x: 0, y: 40, z: 0 },
    material: { type: "lambert", color: "#67c23a" },
    ...overrides
  };
}

function createDemo(overrides) {
  return createMesh(createDemoJson(overrides));
}

function deployDemo(overrides, scene) {
  const obj = createDemo(overrides);
  if (obj) {
    scene.add(obj);
  }
}

function resolveDemoDomainModel(record, scene) {
  const payload =
    (record.payload && typeof record.payload === "object" ? record.payload : null) ??
    (Array.isArray(record.items) && record.items[0] ? record.items[0] : null) ??
    {};
  deployDemo(payload, scene);
}

const demoDomain = {
  id: "demo",
  defaultHandler: "addToScene",
  resolveDomainModel: resolveDemoDomainModel,
  api: {
    createDemoJson,
    createDemo,
    deployDemo
  }
};

export default demoDomain;
```

This example highlights:

- `api` is for imperative calls.
- `resolveDomainModel()` is for `domainModelList`.
- `payload` and `items[0]` are common ways to provide record input.

### Step 3: register it in the manifest

Recommended: after `domains/demo/index.js` exists, run **`npm run generate:business-domain-manifest`** from the repo root; the script updates [`../builtins/builtinDomainManifest.generated.js`](../../builtins/builtinDomainManifest.generated.js).

If you need to override a scanned `id`, add it to `userDomainDescriptors` in [`../builtins/userDomainDescriptors.js`](../../builtins/userDomainDescriptors.js), for example:

```js
import demoDomain from "../domains/demo/index.js";

/** @type {import("../core/handler/businessDomainRegistry.js").BusinessDomainDescriptor[]} */
export const userDomainDescriptors = [demoDomain];
```

See [`../builtins/register.js`](../../builtins/register.js) for merge rules. Only after generation or user configuration will the runtime recognize `domain: "demo"`.

### Step 4: prepare JSON records

If your domain uses `domainModelList`, a minimal world fragment can look like this:

```json
{
  "threeJsonId": "domain-example",
  "worldInfo": {
    "boxModelList": [],
    "domainModelList": [
      {
        "domain": "demo",
        "payload": {
          "name": "demo-01",
          "position": { "x": 0, "y": 40, "z": 0 }
        }
      }
    ]
  }
}
```

If your domain uses `composeBoxModel`, then prepare a `boxModelList` record that your domain knows how to recognize, usually through a specific `objType`.

### Step 5: validate it in a page

The most common validation imports are:

```js
import {
  applyDomainModelsFromWorldInfo,
  invokeDomainModel,
  businessDomains
} from "../core/index.js";
```

#### Validate `domainModelList`

```js
applyDomainModelsFromWorldInfo(scene, jsonData.worldInfo, { jsonData });
```

#### Validate one ad hoc record

```js
invokeDomainModel(scene, {
  domain: "demo",
  payload: { name: "demo-02", position: { x: 120, y: 40, z: 0 } }
});
```

#### Validate imperative API calls

```js
businessDomains.demo.deployDemo({ name: "demo-03", position: { x: -120, y: 40, z: 0 } }, scene);
```

## Material maps: video and GIF (primitives / planes / OBJ `maps`)

This matches [`modelBuilder.js`](../../core/builder/modelBuilder.js) **`ensureMaterialTextureFromJson`** and OBJ **`maps`** slots:

| `textureKind` | Behavior |
| --------------- | -------- |
| omitted or **`image`** | **`TextureLoader`** for still images; `.gif` is effectively a **single frame**, not animated. |
| **`video`** | **`THREE.VideoTexture`** with **`textureUrl`** as the video URL; optional `videoMuted` / `videoLoop` / `videoAutoplay` / `videoCrossOrigin`. Cross-origin video needs CORS; mind autoplay policies on mobile. |
| **`gif`** | **`CanvasTexture`** + **gifuct-js** with rAF `needsUpdate`; **`textureUrl`** is the GIF URL; optional `gifAutoplay` (default `true`), `gifPlaybackRate` (default `1`), `gifMaxFps`. The page import map must resolve **`gifuct-js`** (see root `package.json` and sample HTML). Cross-origin GIFs need `fetch` CORS. |

---

## Practical advice for custom domains

- **`create*Json` / `create*` / `deploy*`**: registration **requires** `create${PascalCase(leaf)}` and `deploy${PascalCase(leaf)}` (last segment of a dotted id); keep the semantic layering described in [BUSINESS_DOMAINS.md](../../core/BUSINESS_DOMAINS.md), including documented **semantic exceptions**.
- Keep `index.js` focused on descriptor, `resolveDomainModel`, and `api`; move complex animation/statistics/object-ops logic into `*Handler.js`.
- Use tiered scaffolds by complexity: simple domain (1 file `index.js`), composite domain (3 files: `index.js` + `*Factory.js` + template module), composite+stats domain (4 files with `*Handler.js`).
- Keep the first version of a domain small and self-contained before growing it into a hybrid design like `port`.
- Prefer declarative records interpreted by `resolveDomainModel()` instead of spreading business-specific `if / else` logic across host apps.
- If a capability depends on root JSON, loading managers, or other runtime context, document the expected `ctx` fields clearly.
- Even if you mainly expose imperative `api`, keep a `domainModelList` entry point for JSON-driven loading and other hosts.
- For edit-time add/remove/undo in hosts, see [runtime-object-mutation-quickref.md](./runtime-object-mutation-quickref.md) and [lab/domain-runtime-mutation-contract-memo.md](../../lab/domain-runtime-mutation-contract-memo.md) (separate from domain registration).

## Related documents

- [JSON Format Guide](./json-format.md): `worldInfo`, `domainModelList`, and other object JSON formats.
- [Core API](./api.md): `applyDomainModelsFromWorldInfo()`, `invokeDomainModel()`, `businessDomains`, and related entry points.
- [Domain Scaffold Template](./domain-scaffold.md): tiered 1/3/4-file templates and the minimum contract.
- [Demo Pages](./demos.md): see [`examples/html-demo/track-03-assets/03-03-native-three-domain.html`](../../examples/html-demo/track-03-assets/03-03-native-three-domain.html) and `port-show.html` for how different domains are integrated.
- [`../core/BUSINESS_DOMAINS.md`](../../core/BUSINESS_DOMAINS.md): additional implementation-facing design notes.
