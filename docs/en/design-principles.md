[中文](../zh/design-principles.md) | [English](./design-principles.md)

# ThreeJSON Design Principles (Contributor & Upstream Reference)

## Default zero cognitive load

Optional capabilities that are not used should not require configuration switches or initialization rituals. Upstream only needs to load the modules it actually needs (for example, L3 Patch uses the `threejson/patch` subpath rather than the default full bundle).

## Canonical source of truth and runtime overlay (precise meaning of “JSON is king”)

“JSON is king” refers to the **canonical descriptor**: when persisting, reloading, and interacting with declarative core APIs (such as `descriptorSync`, L3 Patch), the descriptions in `userData.objJson` and the corresponding entries in `worldInfo` are authoritative. This does not conflict with the **runtime overlay**: game loops, physics, Mixer, and scripts may modify `THREE.Object3D` directly; the two need not be equal on every frame in time.

- **Game / high-frequency paths**: It is acceptable to maintain only runtime state for extended periods. Before re-entering a core flow that depends on “descriptor as source of truth,” the host should call `reconcileTransformToDescriptor` (or an equivalent batch commit); otherwise paths that rely on `objJson` may read stale values. See the contract table in [`docs/scope.md`](./scope.md).
- **Declarative animation**: JSON `animations` remains the configuration source of truth; glTF asset animations are handled by the `AnimationMixer` pipeline, coordinated via `animationMode` when coexisting with declarative animation.

## Optional, non-invasive

- **Capabilities are separable**: Physics, JSON Patch, plugins, and similar features ship as independent modules or under `extensions/`; the core main entry aggregates only a stable subset. `extensions/` aligns with the npm optional-peer mental model: reference implementations maintained in-repo, semver may diverge from core, avoiding binding a specific engine into the default package.
- **Predictable behavior**: When not imported and not registered, runtime paths match historical versions, with no implicit side effects.

## Core vs extensions boundary

The following principles determine whether a new capability belongs in **core**, **`extensions/`**, or the **host**; they apply to any requirement (not limited to a particular controller type or gameplay mode). They complement the “explicitly out of core” items in [`docs/scope.md`](./scope.md)—those list typical **infrastructure / product-layer** concerns (private-network sync, ECS frameworks, production-grade editor UI, anti-cheat, etc.); this section provides **general criteria**.

### When putting in core, usually all of the following should hold

| Criterion | Meaning |
|------|------|
| **Declarative assembly** | Expressible via standard / user-friendly JSON, `objType`, or a stable runtime descriptor, and created and updated uniformly by the load chain. |
| **Cross-domain generic** | Does not depend on industry-specific naming, proprietary meshes, or proprietary workflows (e.g. refName conventions that apply only to a particular port floor). |
| **No heavy dependencies** | Does not mandate WASM, large binaries, or optional peers; works by default with only Three.js + core. |
| **Thin wrapper over Three.js conventions** | Aligns with tutorial-style Three.js usage (controllers, camera, lights, frame loop); avoids rebuilding a game engine or ECS inside core. |
| **Off by default** | Consistent with “default zero cognitive load”: when unconfigured, existing behavior is unchanged; new fields are optional, with no new required fields. |

Typical core capabilities: viewport `camera` / `renderer`, scene-viewing-related `controls` types (e.g. orbit, first-person roam input), generic lights and `renderLoop`, assembling the scene graph and object identity from JSON, and core APIs that interact with descriptors (`descriptorSync`, L3 Patch subpath, etc.).

### When putting in extensions or the host, usually any one of the following suffices

| Criterion | Meaning |
|------|------|
| **Swappable backend** | Multiple implementations coexist (e.g. different physics engines); core keeps only a **stable interface** (contract + graceful degradation); concrete engines register under `extensions/`. |
| **Heavy dependency or large footprint** | WASM, specialized libraries, or reference implementations that should not be tightly semver-bound to core. |
| **Business semantics** | Strongly tied to a specific project, domain, or scene asset naming (e.g. snap-to-floor for one business floor only, integration with alert rules). |
| **Gameplay and infrastructure** | Weapons, damage, matchmaking, anti-cheat, signature verification, etc.; or items already listed in [`docs/scope.md`](./scope.md) such as private-network sync and productized ECS. |
| **Integration pages / product UI** | In-repo demo pages, editor shell layers; treated as examples or products, not default library API. |

JSON container conventions for `extensions/` are in [`docs/extensions.md`](./extensions.md) and [`lab/extension-json.md`](../../lab/extension-json.md).

### Modular ≠ should split

A capability **can** be split into an extension does not mean it **should** be externalized by default. If it is “cross-project generic scene viewing / input / assembly,” placing it in core reduces duplicate wheel-reinvention in hosts; if it is “heavy engine or strong business logic,” externalize it to keep the default package stable. Core does **not** aim to become a full game engine; it **should** make common, declaratively assemblable runtime capabilities first-class citizens in JSON.

### Do not lock down extensions

The boundary does not mean hosts may only use types already implemented in core. The following escape hatches should remain long-term:

- **`controls.enabled: false`** (or equivalent): do not create the library’s controller; the host fully owns input.
- **Scene graph only**: e.g. `createJsonScene` without a canvas, or deploy content only; camera and controllers built by the host.
- **Frame hooks and plugins**: `beforeFrame` / `afterRender`, `PluginHost`, `sceneConfig.extensions`, for layering physics, gameplay, and custom logic.
- **Extensible registries** (as needed): e.g. a registry for `controls.type` allowing extension packages or the host to register new types rather than a fixed enum.

When extensions are not imported and not registered, behavior must match historical versions (see “Predictable behavior” in the previous section).

## Object registry and “descriptor ↔ scene” sync

- **`objectRegistry`**: positioned as **index + lifecycle** (`threeJsonId` / `uuid` / `name` / `refName`, etc.), not a “god object” carrying all business commands. Imperative transforms, Mixer, etc. go through dedicated entry points such as `sceneRuntimeApi`.
- **Bidirectional sync**: Three.js has no built-in binding for arbitrary full JSON ↔ `Object3D` state. Full real-time monitoring is costly and should be off by default; use **tiered** approaches (lightweight transform-level sync, whitelist + throttling, explicit rebuild) and document costs clearly. Implementation details are in `worldInfo.descriptorBinding` and related notes in [`sceneDescriptorBinding.js`](../../core/handler/sceneDescriptorBinding.js).

## core source layout: builder / handler / runtime (ideal reference, not mandatory)

Under `core/builder/`, `core/handler/`, and `core/runtime/` the repo reflects **historical evolution**, not a strict separation of duties. The table below is a **soft guideline** for reading code and placing **new** modules—not an architecture law. Existing layout violations are not bugs; **no** large-scale move is required by this document alone.

| Directory | Ideal role | Typical contents |
|-----------|------------|------------------|
| **`builder/`** | **Create** `Object3D` from JSON / descriptors and **first deploy** (incl. async textures, external models) | `createMesh`, `deployMesh`, `infoPanelBuilder`, `loadExternalModel` |
| **`runtime/`** | Changes **after** the scene is loaded and objects are registered | `objectMutation` (`threejson/runtime-mutation`), `sceneObjectCommands`, visibility/patch/redeploy APIs |
| **`handler/`** | **Orchestration and cross-cutting**: full-scene load/save, registry, domain dispatch, frame loop, import/export | `sceneLoadHandler`, `objectRegistry`, `businessDomainRegistry`, `frameLoopHandler` |

Notes:

- **`handler` is not** a DOM event handler; it is the **scene engine / pipeline**. Some post-load APIs still live under `handler/` historically (e.g. `infoPanelRuntime.js`).
- **`builder` and `runtime` need not pair 1:1** (there is no requirement for a full `modelRuntime.js` mirror of `modelBuilder.js`).
- The **composition root** remains in handler (e.g. `sceneLoadHandler` imports both builder and `runtime/deployScheduler`), consistent with [BUSINESS_DOMAINS.md](../../core/BUSINESS_DOMAINS.md).

Long-term cleanup ideas and audit notes: [`lab/core-layering-memo.md`](../../lab/core-layering-memo.md) (**not a release commitment**).

## Standard JSON and user-friendly JSON (peer entry points)

**Standard JSON** and **user-friendly JSON** are two **equally valid** external shapes—not a “new replaces old” relationship.

- **Standard JSON**: expresses the whole scene via **`objectList` + a small amount of top-level metadata**, with **`objType`** for unified dispatch; uniform structure, better suited to programmatic processing, pipeline tools, and **AI generation**, etc.
- **User-friendly JSON**: split, named, and grouped for human habits (e.g. common layouts with `sceneConfig`, `worldInfo`); easier to read, hand-write, and edit locally. **Its fields and organization are not legacy or transitional formats.**

Inside **core**, user-friendly JSON is **translated / normalized** to the standard shape on the load chain, then parsed and assembled by the same pipeline; which to use is a team and scenario choice. Field descriptions and examples are in [`docs/json-format.md`](./json-format.md).

## Security and untrusted input (placeholder, not current implementation)

- Anti-cheat, signature verification, filtering untrusted patches, etc. are **separate topics**; if provided in the future, they should be an **explicitly enabled** optional layer, off by default.
- JSON Patch or scene fragments received from the network: **validation and source authentication are the host’s or middleware’s responsibility**; ThreeJSON does not by default apply arbitrary patches without a whitelist.

## Relationship to Three.js

ThreeJSON aims to absorb the repetitive work of “describing Three.js scenes with JSON”; it does not replace the Three.js rendering pipeline, nor does it bind a specific game architecture (such as a full ECS) in core.

Align with conventions rather than reinvent: per-frame hooks, transforms, post-processing `EffectComposer`, native `AnimationMixer`, etc. should prefer tutorial-style Three.js usage; ThreeJSON provides stable identity, scene-graph assembly from JSON, and optional write-back and extension mount points.

## Dependency direction: core / domains / host

The following constraints describe **who may import whom** and responsibility boundaries. They complement the Composition Root notes in [`core/BUSINESS_DOMAINS.md`](../../core/BUSINESS_DOMAINS.md).

1. **One-way dependencies**: `domains → core`; `host (scene editor, RoomShow, etc.) → core + domains`. **Forbidden**: `core → domains` (importing concrete domain modules inside core), `domains → host`.
2. **Core can and should** host cross-domain generic capabilities (load, export, edit state machine, registry, mutation). Prefer **generic mechanism + registration hooks** over hard-coding a `domain` name in core.
3. **Do not put one application’s interaction details in core** (modal copy, drill-in gestures, editor settings); those stay in the host; core exposes neutral APIs only (e.g. `assertSceneExportable`, `exportDeployRootDescriptor`).
4. **Dispatch contract**: core scheduling recognizes only JSON `domain` + `handler` and registries; business differences extend in `api` hooks in `domains/*/index.js`.
5. **Persistence shape**: authoritative load records are **instance-only** `persistSource` (one per deploy root); core does not uniformly rewrite into `items[]` bundles.
6. **Editor vs snapshot**: runtime source of truth is Scene + `userData`; persistence exit is `sceneToJson`; core need not know the host concept of “editor.”
7. **Visual constants** (colors, opacity, etc.): **core** centralizes only defaults used inside core source in [`core/theme/runtimeVisualDefaults.js`](../../core/theme/runtimeVisualDefaults.js); **domains** each maintain a palette for domain-native visuals (cabinet shell, door panel, etc.); the **host** may import exported constants from core and domains but must not place host- or domain-specific constants in core. When one domain **composes or delegates to another** (e.g. cabinet uses stat for capacity bars, port reuses stat bar styling), code that creates or configures those dependent-domain objects **should deliberately import and apply constants from the dependency’s palette** for visual consistency; explicit custom colors may still override defaults. What is forbidden is unrelated cross-domain palette imports and `core → domains` reverse dependencies.

Domain extension and JSON shapes are detailed in [`docs/domains.md`](./domains.md).
