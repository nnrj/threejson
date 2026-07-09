# Business Domains and `domainModelList`

[中文](./BUSINESS_DOMAINS_ZH.md) | [English](./BUSINESS_DOMAINS.md)

Callers who want a quick understanding of `domains/`, `domainModelList`, and how to create a custom business domain should read [../docs/en/domains.md](../docs/en/domains.md) first. This document leans toward implementation contracts and internal design notes.

**Documentation layering**: `core/` and `domains/` are the library; any host (single-object demos, RoomShow, the scene editor, etc.) is an equal consumer. This document does not describe "editor-only" required APIs — see each application's own docs for host UI.

Scene JSON's `worldInfo` can use **`domainModelList`** to uniformly describe "which business domain, using which capability" to create content, without writing a separate branch per business type in the host.

## Composition Root and the core→domains dependency

- **Business logic** (`sceneLoadHandler`, `businessDomainModelDispatch`) does **not** `import` concrete domains such as `domains/port`; it only dispatches via **`record.domain` + `getDomain(id)`**.
- **core does not import domains**; built-in domains are injected in [`builtins/register.js`](../builtins/register.js) (manifest: [`builtins/builtinDomainManifest.generated.js`](../builtins/builtinDomainManifest.generated.js), `npm run generate:business-domain-manifest`).
- **Mesh deployment**: [`deployMeshWithDomains`](../core/handler/businessDomainRegistry.js) / `deployMeshListWithDomains` — legacy mappings (e.g. `dockCrane`) **always** go through `resolveDomainModel`; `tryComposeBoxModel` only runs when `sceneConfig.enableComposeBoxModel === true`, otherwise it falls back to `deployMesh`.
- **Friendly lists**: `boxModelList` and `sphereModelList` are retained; **`meshList`** is also supported (`objType` must be `box` or `sphere`). Port composites should be written as **`domainModelList`** (`objType: "domain"`, `domain`, `handler`).

## Architectural principles (the ThreeJSON contract)

**JSON is king**
Authoritative data comes from the scene JSON. `core/` and `domains/` act as the parsing and rendering pipeline: they **only parse and render based on JSON** (plus declarative parameters passed by the caller); the parsing layer is never treated as a place to rewrite authoritative JSON. When scene semantics need to change, prefer, in order: **pass in new or revised JSON and reload**; or express visibility/state through JSON properties; or dispatch business logic through **`invokeDomainModel` / `applyDomainModelsFromWorldInfo`**, explicitly specifying **`domain` + `handler`** (and record fields such as `items` / `options`), and these fields should be traceable back to JSON or upstream config wherever possible. Pages and demo code should avoid scattering hardcoded business flows (e.g. bypassing the dispatcher to directly import a domain implementation and hardcode a sequence of domain-specific steps).

**Domain autonomy**
Each `domains/*` evolves independently; no domain should require changes to `core/` just because it "resembles another domain." `core/` only provides business-agnostic general capabilities; domain authors decide whether to use them. The standard way for a caller to reach a specific business capability remains: **pass the business type (`domain`) and `handler` through the business manager** ([`businessDomains`](../core/handler/businessDomainRegistry.js) + [`invokeDomainModel`](../core/handler/businessDomainModelDispatch.js)). Business-specific read-only parsing, stats helpers, etc. live on each `domains/*/index.js`'s **`api`**, and are **not** stacked as separate exports of `core/index.js`.

**Two sentences, externally**
Either **bring JSON** (load / reload); or **declare which `domain` should run which `handler`** (executed by the dispatcher). "Quietly mutating the scene" outside these two paths should not become the norm.

## When to `invoke` / `apply` vs. `businessDomains.<id>`

| Does the caller **know the business domain ahead of time**? | Recommended approach |
| ------------------------------ | ---------- |
| **No** (a generic loader, parsing `domainModelList`) | **`applyDomainModelsFromWorldInfo`** / **`invokeDomainModel`**, with `domain` coming from JSON. |
| **Yes** (e.g. RoomShow only cares about cabinets, PortShow only cares about ports, an integrator has already chosen `box`/`wall`) | **`businessDomains.<id>`**'s `api`, such as **`deployCabinet`**, **`createCabinetJson`** / **`createCabinet`**, **`createPortStatistics`**, **`deployWall`**. |

Both paths go through the same manifest; `invoke` suits JSON-driven flows, and `api` suits imperative calls from an integration layer that has "already chosen a domain."

## `create*Json` / `create*` / `deploy*` (in-domain conventions)

Consistent with **`createMesh` / `deployMesh`** in [`modelBuilder.js`](../core/builder/modelBuilder.js): **`deploy*`** = **`scene.add(create*(…))`**.

| Layer | Responsibility |
| ------ | ------ |
| **`create*Json`** | Pure data. Optionally an **object** or a **JSON string**; falls back to the domain's default template. Cabinets produce **group JSON for `createGroup`**; port composites produce **group JSON from the port factory**; box/wall/glass produce **mesh descriptor objects for `createMesh`**. |
| **`create*`** | **`createGroup` / `createMesh`**: usually returns a **`THREE.Object3D`** (a **`Group`** for cabinets / port composites; **Mesh / InstancedMesh** for primitives). Implementation-wise, **`create* === f(create*Json(…))`** — the assembly logic is not duplicated. |
| **`deploy*`** | `const obj = create*(...); if (obj) scene.add(obj);` (or an equivalent async/side-effect deployment, see below) |

### Enforced API naming at registration

[`validateDomainDescriptor`](../core/handler/businessDomainRegistry.js) (`registerDomain` / `initBusinessDomains`) requires:

- **`api.create${PascalCase(leaf)}`**, **`api.deploy${PascalCase(leaf)}`** — `leaf` is the last segment of the dotted `id` (e.g. `weather.rain` → `createRain`); missing either **throws**.
- **`api.create${PascalCase(leaf)}Json`** — missing this only **`console.warn`**s.
- Dotted **sub-domains** (e.g. `weather.rain`) must be registered with the full qualified `id`; `getDomain("rain")` returns `null` when a `*.rain` sub-domain exists. Short root-domain ids (e.g. `port`) are unaffected.
- **`resolveDomainModel`** or **`domainHandlers`** — if neither is present, **`console.warn`**.

Unit tests: [`tests/businessDomainManifest.test.mjs`](../tests/businessDomainManifest.test.mjs), [`tests/nestedDomainRegistry.test.mjs`](../tests/nestedDomainRegistry.test.mjs). The built-in manifest includes root domains plus sub-domains (e.g. `weather.rain`).

### `create*` / `deploy*` semantic exceptions (still satisfy the registration naming rules)

| `id` | Notes |
|------|------|
| **nativeThree** | `createNativeThree` returns a load descriptor (including `modelPath`), not an Object3D; the mesh is added to the scene **asynchronously** by `deployNativeThree` / the loader. |
| **sceneHighlight** | `createSceneHighlight` / `deploySceneHighlight` deploy a composer / pass and often return `null`; they need `ctx.composer` etc. |
| **weather** | `createWeather` returns a points record; `deployWeather` is **async** (`createPoints`). Wind strips use extension APIs such as `deployWindStrip`. |
| **weather.rain** | `createRain` / `deployRain`; particle presets, delegated to `weatherFactory`. |
| **weather.wind** | `createWind` / `deployWind`; wind strips, delegated to `deployWindStrip`. |
| **weather.particle** | A namespace intermediate node; has no `create`/`deploy`; cannot be dispatched via `invoke`. |

**composeBoxModel** (port): still returns a **`THREE.Group`**, i.e. **`createPort(boxModel)`** (internally **`createPortJson`** → **`createGroup`**), consistent with the `tryComposeBoxModel` contract.

## Interaction and scene changes (illustrative)

For example, a machine room / port statistics view: the ideal path is to **update or switch JSON and reload uniformly**, or **declare the domain records to run in `worldInfo.domainModelList`** (or another JSON field) and then `apply`. An integration layer on a fixed-semantics page such as RoomShow / PortShow can call **`businessDomains.device.cabinet.show*Stats`** (single cabinet) or **`businessDomains.port.createPortStatistics`** directly — this is still the same domain contract.

## JSON entry shape

Each record is a plain object with these common fields:

| Field | Notes |
| ------ | ------ |
| `domain` | **Required**. Matches the `id` exported by a [`domains/*/index.js`](./cabinet/index.js) descriptor (e.g. `cabinet`, `port`). |
| `handler` | **Optional**. The capability to call. When omitted, it falls back to each domain's `defaultHandler` or an internal `resolveDomainModel` convention (e.g. the cabinet domain defaults to `createCabinet`). |
| `items` | **Optional**. Interpreted by the domain, usually an array of objects (e.g. multiple cabinet configs). |
| `payload` | **Optional**. Shorthand for a single record; equivalent to `items: [payload]` in the cabinet domain. |
| `options` | **Optional**. Additional options (e.g. animation/style parameters for stats-type APIs). |

### Materials and remote textures (box / sphere / mesh descriptors)

Texture-related JSON field conventions for boxes, spheres, `heatList`/`wind` planes, `objModelList` (OBJ), etc. in the scene:

- **Prefer `textureUrl`**: on a material's `textureUrl`, provide a requestable `http(s)`, `data:`, absolute path, or a relative path starting with `./`/`../`. Relative paths are relative to **the current page's origin**. The AI pipeline and tooling also target `**/textureUrl` when writing.
- **`textureKind` (texture source type)**: omitted or **`image`** goes through **`TextureLoader`** (a static image; `.gif` in `image` mode is still only the **first frame as a static image**, not decoded as multi-frame animation). **`video`** goes through **`THREE.VideoTexture`**, still using **`textureUrl`** as the video address; optional **`videoMuted`** (default `true`, to allow autoplay), **`videoLoop`** (default `true`), **`videoAutoplay`** (default `true`), **`videoCrossOrigin`** / **`crossOrigin`** (cross-origin video needs server-side CORS). **`gif`** goes through **`CanvasTexture`** + gifuct-js decoding, still using **`textureUrl`**; optional **`gifAutoplay`** (default `true`), **`gifPlaybackRate`** (default `1`), **`gifMaxFps`** (optional cap). **OBJ `maps` slots** can carry the same **`textureKind: "video"`** / **`gif`** fields on the corresponding map object.
- **`map` string**: if it is a recognizable URL as above, `modelBuilder` converts it to a `THREE.Texture` via `TextureLoader` in `image` mode; if it is not a recognizable URL, it is still ignored as "not a texture," to avoid an invalid placeholder object causing a runtime error. **Do not put non-URL strings in `map` pretending to be a texture path.**
- **Stat bar labels (cabinet / port operational overlays)**: display text goes on the mesh descriptor's **`businessInfo.statLabel`** (optional **`statKind`**). `deployGroupDescriptor` / subScene only pass serializable fields; **`THREE.Texture` is generated by each domain after deployment**, based on `userData.objJson.businessInfo.statLabel`, and assigned to **`mesh.material.map`** — do not pre-attach a runtime `material.map` on the JSON descriptor.
- **Generic stat domain (`stat.bar` / `stat.grid` / `stat.panel`)**: runs **in parallel** with cabinet/port business overlays; use `objType` values like **`statBar` / `statGrid` / `statPanel`**, to avoid conflicting with `capacity|bear|rackSpace` teardown. JSON: `domainModelList` + `domain: "stat.bar"`, etc. See tutorial Track 6.
- **stat.chart + extensions/stat-echarts**: 2D charts use a CSS3D panel + the optional peer **`echarts`**; the implementation is not in core.
- **CORS**: when cross-origin images come from another site, the image server must return CORS headers allowing the current origin (typically `Access-Control-Allow-Origin`). In this project, **`objModelList`/`nativeThree`** records can pass `crossOrigin` when parsed (see `loadThreeNativeObjectJsonFromUrl`, `parseThreeNativeObjectJsonAndAdd` in [`nativeObjectLoader.js`](../core/builder/nativeObjectLoader.js)). Texture loading can also go through the LoadingManager mounted via `setModelLoadingManager`.
- **`merge`** geometry and **`joins`/`inters`/`holes`**: `materialArr` and each CSG sub-block also apply the same `textureUrl` / resolvable-URL `map` string handling as a six-face box (see `ensureMaterialTextureFromJson`).
- **Native Three `ObjectLoader` JSON** offline export: `embedPortableImageUrlsIntoThreeExportJson` only attempts to replace `images[].url` values that are **`http(s)` / `//` / `blob:`** (typically unusable once detached from the original site) with a **data URL** matching the cloned scene's in-memory texture; **the original URL is kept if the fetch fails**, no placeholder transparent PNG is written. Relative paths, `data:`, etc. are left unchanged. Video / explicit GIF animated textures generally cannot go through this "static Image inlining" path, so the exported JSON still uses a URL for them.
- **`gifuct-js`** (explicit `textureKind: "gif"`)**: browser example pages need to declare **`gifuct-js`** in the import map (matching the version in the repo root `package.json`'s `dependencies`; example HTML resolves the bare specifier via `https://esm.sh/gifuct-js@…`).

**Security**: `handler` is only ever resolved against already-registered `domainHandlers` keys, or handled by a domain's internal `resolveDomainModel` branches; arbitrary strings are never executed as code.

## Core API (generic dispatch only)

- `applyDomainModelsFromWorldInfo(scene, worldInfo, ctx?)`: reads `worldInfo.domainModelList` and dispatches it.
- `applyDomainModelList(scene, domainModelList, ctx?)`: dispatches an array directly.
- `invokeDomainModel(scene, record, ctx?)`: convenience entry point for a single record; internally equivalent to an `applyDomainModelList` call with a length-1 array.
- `businessDomains`: access each domain's `api` by domain id (see [`businessDomainRegistry.js`](../core/handler/businessDomainRegistry.js)).

The above are exported from [`core/index.js`](../core/index.js). An unknown `domain` / unsupported `handler` triggers a `console.warn`.

**Examples of domain `api`** (called via `businessDomains.cabinet` / `businessDomains.port`, implemented only in `domains/`):

- **device.cabinet**: **`createCabinetJson`** / **`createCabinet`** / **`deployCabinet`**; stats views use the single-cabinet API: `showCapacityStats` / `showLoadStats` / `showRackSpaceStats` / `clearCabinetStatView`.
- **port**: **`createPortJson`** / **`createPort`** / **`deployPort`**; `countPortStatisticsAnchors`, `createPortStatistics` — see [`domains/port`](./port/index.js).
- **stat** (sub-domains **`stat.bar`** / **`stat.grid`** / **`stat.panel`** / **`stat.chart`**): **`createBar`** / **`deployBar`**, etc. (named after the leaf segment); see [`domains/stat`](./stat/index.js) and [`extensions/stat-echarts`](../extensions/stat-echarts/README.md).
- **box** / **wall** / **glass**: **`createBoxJson`** (and **`createWallJson`**, **`createGlassJson`**) + **`create*`** + **`deploy*`**; `addToScene` remains a convenience wrapper. In `domainModelList`, when `handler` is omitted it defaults to **`addToScene`**, dispatched by `resolveDomainModel`.

**Additional name/label convention**: cabinets uniformly use `name: "cabinet"` (for `getObjectsByName` / bulk show/hide), with differentiating text placed in `label` (e.g. "Cabinet 13"). `threeJsonId` remains the persistent primary key; `refName` is an optional programmatic alias.

### The device domain — the `devicePanelRef` binding contract

When a device record (UPS, air conditioning, cabinet, etc.) is bound to an info panel, the runtime **`devicePanelRef`** = the **`threeJsonId`** of the bound panel (the single source of truth; for methods 2/3 it is written back into `objJson` after deployment).

**Three methods (priority: ref > info > infoPanel)**:

1. **`devicePanelRef` is non-empty** — references an existing panel id; no subScene-deployed embedded panel.
2. **No ref, has an `info` shorthand** — generates a sprite panel, with id defaulting to `${device.threeJsonId}__infoPanel`, and writes it back to `devicePanelRef`.
3. **No ref, no info, has `infoPanel`** — a full descriptor, written back to `devicePanelRef`.

**A wrong `devicePanelRef` only warns, it does not fall back.** As soon as a non-empty `devicePanelRef` is present, the resolver **only takes method 1**, and any `info` / `infoPanel` on the same record is **always ignored**. If the ref does not exist in the registry, `[device] devicePanelRef not found: …` is logged; it will **not** fall back to an embedded `infoPanel`, and will **not** auto-deploy an embedded panel. Fix the ref or remove `devicePanelRef` to enable methods 2/3.

API: `businessDomains.device.resolveDevicePanelRef`, `showDevicePanel`, `bindDevicePanelTriggers`, etc. See [docs/en/api.md § domains/device](../docs/en/api.md#domainsdevice-设备面板).

## Registering a new business domain

1. In `domains/<name>/index.js`, export a default descriptor: `id`, `api`, and **`resolveDomainModel(record, scene, ctx)`** and/or **`domainHandlers`**, **`defaultHandler`** (see the JSDoc in [`businessDomainRegistry.js`](../core/handler/businessDomainRegistry.js)).
2. From the repo root, run **`npm run generate:business-domain-manifest`** to update [`builtins/builtinDomainManifest.generated.js`](../builtins/builtinDomainManifest.generated.js) (do not hand-edit).
3. Optionally, override the same `id` or add a domain in [`builtins/userDomainDescriptors.js`](../builtins/userDomainDescriptors.js); the default app uses **`import { ... } from 'threejson'`** (or `./builtins/full.js` within the repo). When using only `threejson/core`, you need **`import 'threejson/builtins/register'`**.

## Relationship with `boxModelList` / the port domain

Port composites should be written under **`worldInfo.domainModelList`** (`handler`: `dockCrane` | `rtgCrane` | `portLampPost` | `berthShip`). Matching `objType` names under `boxModelList` are just friendly-authoring sugar; the normalizer rewrites them into `domain` records.

**The port domain's `domainModelList`** (outside the box pipeline) currently supports:

| `handler` | Notes |
| ----------- | ------ |
| `createPortStatistics` | Overlays throughput/load/yard bars based on the root JSON's `worldInfo.boxModelList` and anchor `businessInfo` (naming matches the cabinet stats: `options.statType` is `capacity` \| `bear` \| `rackSpace`). |

When calling **`invokeDomainModel` / `applyDomainModelList`** with **`handler: 'createPortStatistics'`**, you must pass **`ctx`**, including **`sceneJsonRoot`** (or **`jsonData`**): the complete scene root object (matching `createPortStatistics`'s first argument). After dispatch returns, the number of successfully overlaid anchors can be read from **`ctx.lastPortStatCount`** (written by the port domain). If the integration layer has already chosen the port domain, you can also call **`businessDomains.port.createPortStatistics(sceneJsonRoot, scene, statType)`** directly; its **return value** is the number of successfully overlaid anchors (matching the value written to `ctx.lastPortStatCount`).

**Note**: the port domain's **`resolveDomainModel` requires an explicit `handler: 'createPortStatistics'`**; it does not run stats by default just because `domain: 'port'` is present, to avoid confusion with entries that are only business markers.

## Compatibility and hardcoding

- Several **host applications** in this repo (e.g. RoomShow, PortShow, the scene player/editor) have switched to **`worldInfo.domainModelList`** (`domain: 'cabinet'`) and no longer use **`worldInfo.cabinetList`**. Any backend interfaces still using the old field need to be migrated in step.
- **In code**, it is still possible to bypass JSON and call `businessDomains.<id>.<method>(...)` directly.

## Runtime mutation contract (phase two, separate from the registration API)

Editing hosts (any application) that need unified add/remove/update/undo should see [lab/domain-runtime-mutation-contract-memo.md](../lab/domain-runtime-mutation-contract-memo.md) and [docs/en/runtime-object-mutation-quickref.md](../docs/en/runtime-object-mutation-quickref.md). This is **not** yet part of `validateDomainDescriptor`.

**Audit gap (note)**: see [lab/domain-runtime-mutation-contract-memo.md](../lab/domain-runtime-mutation-contract-memo.md) § domains still needing improvement.
