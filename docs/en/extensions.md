[中文](../zh/extensions.md) | [English](./extensions.md)

# Optional Extensions and `extensions/`

[中文](../zh/extensions.md) | [English](./extensions.md)

This page is for **host application developers** building on ThreeJSON: how to wire bundled [`extensions/`](../../extensions/) reference implementations and how to author **custom extensions** (physics, charts, ground snap, particle providers, and other cross-cutting runtime capabilities).

- **Declarative business objects** (cabinets, doors, port models) belong in [Business domains and `domains/`](./domains.md)—do not mix with extensions.
- JSON field details: [JSON Format Guide · Optional extension config](./json-format.md#optional-extension-config-extensions). APIs: [Core API · PluginHost / onSceneReady](./api.md#corepluginpluginhostjs).

## Extension vs domain

| | **extension** | **domain** |
|---|---------------|------------|
| Typical capability | Physics, FPS ground snap, chart bridges, particle backends | Business composites, industry JSON dispatch |
| JSON entry | `sceneConfig.extensions[id]`, per-object `extensions[id]` | `objType: "domain"`, `domainModelList` |
| Auto-loaded by core | **No** (host import + bootstrap) | Built-ins registered via `import "threejson"` |
| Third-party CLI | **None** (see “Custom extensions” below) | ✅ `threejson add-domain` |

Terminology: [Glossary · Architecture and layers](./glossary.md#architecture-and-layers).

## Architecture essentials

1. **Not auto-loaded**: `core/index.js` and `import { createJsonScene } from "threejson"` do **not** import `extensions/`. Without import/register, behavior matches core-only ([Design principles · Predictable behavior](./design-principles.md)).
2. **npm subpaths**: after `npm install threejson`, import on demand, e.g. `threejson/extensions/physics-rapier/bootstrapFromScene.js`. Bundled reference code ≠ enabled by default.
3. **Heavy deps as optional peers**: e.g. `@dimforge/rapier3d-compat`, `echarts`—install in **your app**; see root [`package.json`](../../package.json) `peerDependenciesMeta`.
4. **Core defines JSON containers only**: merges `extensions` maps, provides `PluginHost` and registries; does **not** parse plugin-specific field semantics ([`core/util/extensionsUtil.js`](../../core/util/extensionsUtil.js)).

## JSON container conventions

### Scene-level

`sceneConfig.extensions["<extensionId>"]` — global switches and parameters (gravity, enabled flags, etc.).

Friendly JSON may use `worldInfo.extensions`; normalization merges into `sceneConfig.extensions` (on the same id, **`sceneConfig` wins over `worldInfo`**).

Standard JSON may also put top-level `"extensions"` beside `objectList`; it is merged into `sceneConfig.extensions`.

### Object-level

On the same `objectList[]` / `boxModelList[]` record:

```json
"extensions": {
  "physics-rapier": {
    "rigidBody": "dynamic",
    "collider": { "type": "box" }
  }
}
```

Config on a record implicitly binds that object (interpreted by the extension bootstrap).

### Sample JSON

- Physics / Rapier: [`assets/json/tutorial/track-04/04-02-plugin-physics.json`](../../assets/json/tutorial/track-04/04-02-plugin-physics.json)
- FPS walk: [`04-03-fps-walk.json`](../../assets/json/tutorial/track-04/04-03-fps-walk.json)

## Host integration (three steps)

Extensions are **not** bootstrapped inside `createJsonScene`; the host mounts them after deploy completes.

1. **import** extension modules (and WASM / third-party libs such as `RAPIER`).
2. Create a **`pluginHost`** (recommended) and pass it to `createJsonScene(..., { pluginHost })`.
3. In **`onSceneReady(ctx)`**, read `ctx.scene` / `ctx.sceneJson` / `ctx.pluginHost`, then call `bootstrapXxxFromScene` or `pluginHost.register(...)`.

### Minimal example (PluginHost + onSceneReady)

```js
import { createJsonScene } from "threejson";
import { createPluginHost } from "threejson/core";

const pluginHost = createPluginHost();

await createJsonScene(payload, {
  canvas,
  pluginHost,
  async onSceneReady(ctx) {
    // e.g. await bootstrapPhysicsRapierFromScene({ ...ctx, pluginHost, RAPIER });
  }
});
```

Common `onSceneReady` fields: [api.md · onSceneReady](./api.md#corehandlersceneloadhandlerjs--onsceneready).

Reading extension blocks from JSON:

```js
import {
  resolveSceneExtensions,
  readExtensionConfig
} from "threejson/core";

const sceneConfig = ctx.sceneJson?.sceneConfig ?? {};
const worldInfo = ctx.sceneJson?.worldInfo ?? {};
const sceneExt = resolveSceneExtensions(sceneConfig, worldInfo)["my-extension-id"];

const objJson = mesh.userData.objJson;
const perObject = readExtensionConfig(objJson, "my-extension-id");
```

Lifecycle bus: [Scene load lifecycle](./scene-load-lifecycle.md).

### Rapier physics (bundled reference)

```js
import RAPIER from "@dimforge/rapier3d-compat";
import { bootstrapPhysicsRapierFromScene } from "threejson/extensions/physics-rapier/bootstrapFromScene.js";

await RAPIER.init();

await createJsonScene(payload, {
  canvas,
  pluginHost,
  async onSceneReady(ctx) {
    await bootstrapPhysicsRapierFromScene({
      scene: ctx.scene,
      sceneJson: ctx.sceneJson,
      pluginHost,
      RAPIER
    });
  }
});
```

API and field semantics: [`extensions/physics-rapier/README.md`](../../extensions/physics-rapier/README.md).

### Particle provider (registry path)

When `PluginHost` is not needed, register at page entry:

```js
import "threejson/extensions/particle-nebula"; // registers provider: "nebula"
```

Particle emitter JSON may set `provider: "nebula"`. Custom providers use `registerParticleEmitterProvider(id, deployer)` (see [`extensions/particle-nebula/`](../../extensions/particle-nebula/index.js) stub).

## Bundled reference implementations

Directory overview: [`extensions/README.md`](../../extensions/README.md).

| extension id | directory | bootstrap / entry | demo |
|--------------|-----------|-------------------|------|
| `physics-rapier` | `extensions/physics-rapier/` | `bootstrapPhysicsRapierFromScene` | [04-02-plugin-physics.html](../../examples/html-demo/track-04-interaction/04-02-plugin-physics.html) |
| (demo) simple-gravity | `extensions/simple-gravity/` | `createSimpleGravityPlugin` + `pluginHost.register` | same page, “simple gravity” tab |
| `fps-walk` | `extensions/fps-walk/` | `bootstrapFirstPersonExtensionsFromScene` | [04-03-fps-walk.html](../../examples/html-demo/track-04-interaction/04-03-fps-walk.html) |
| Rapier first-person | `physics-rapier/firstPersonBridge.js` | `bootstrapRapierFirstPersonFromScene` | [04-05-fps-rapier-collision.html](../../examples/html-demo/track-04-interaction/04-05-fps-rapier-collision.html) |
| `stat-echarts` | `extensions/stat-echarts/` | `bootstrapFromScene` (with stat domain) | Track 6 `06-04-stat-chart-echarts.html` |
| `nebula` (provider) | `extensions/particle-nebula/` | `registerParticleEmitterProvider` | see api / json-format particle section |

Tutorial index: [tutorial.md · Track 4](./tutorial.md).

**Moved into core (not extensions)**: interactive `css3dPanel` ([json-format](./json-format.md)), `sceneConfig.extensions.assetLibrary` texture cache, `sceneConfig.extensions.nativeGeometries`, etc.—handled in the load pipeline.

## Writing a custom extension

Create modules in **your application repo** (do not edit `node_modules/threejson`):

1. Pick an **extension id** (unique string; avoid colliding with built-in ids).
2. Implement **`bootstrapYourExtensionFromScene(ctx)`** (or `pluginHost.register` on load).
3. Author JSON under `sceneConfig.extensions["your-id"]` and/or per-object `extensions["your-id"]`.
4. Import in the app entry and call bootstrap from `onSceneReady`.

You may copy examples from [`extensions/`](../../extensions/) into e.g. `src/threejson-extensions/` and change `../../core/` imports to `threejson/core`.

### Other core registration hooks

| mechanism | use when |
|-----------|----------|
| `createPluginHost().register` | frame hooks (`beforePhysics`, `afterRender`, …) |
| `registerParticleEmitterProvider` | particle `provider` field |
| `registerControlsType` | new `controls.type` |
| `registerObjTypeDeployer` | new `objType` deploy (closer to domain territory; see [design-principles](./design-principles.md)) |

### Standalone npm package

Publish `@acme/threejson-extension-foo` and bootstrap from the host app. There is **no** domain-style `add-extension` CLI or `threejson.extensions.mjs` convention yet; see [lab/third-party-extension-adoption-memo.md](../../lab/third-party-extension-adoption-memo.md).

## Related docs

- [JSON · extensions fields](./json-format.md#optional-extension-config-extensions)
- [Core API · PluginHost / extensionsUtil](./api.md#corepluginpluginhostjs)
- [Scope · PluginHost and extensions/](./scope.md)
- [Design principles · Core vs extensions](./design-principles.md)
- [Business domains (contrast)](./domains.md)
- Lab draft (complementary): [extension-json.md](../../lab/extension-json.md)
