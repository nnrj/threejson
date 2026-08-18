# @threejson/host-kit

Framework-agnostic scene-host runtime shared by ThreeJSON's `editor`/`player`/`shower`/`threebox`
apps: settings schemas & stores, AI turn orchestration, scene file IO, i18n, and viewport helpers.
Plain ESM — no React or other UI framework dependency, so it can be used from vanilla HTML/JS
(`<script type="module">`, unbundled), or wrapped by a framework layer such as
[`@threejson/react`](../react/README.md).

Ported from [`tools/scene-host/shared/`](../../tools/scene-host/shared/) in the main ThreeJSON
repo. `tools/scene-host` itself is unchanged and does not yet depend on this package (see
`tests/architectureDependencies.test.mjs`) — it remains the stable, production baseline until a
deliberate later migration.

## Install

```bash
npm install @threejson/host-kit threejson three
```

`threejson` and `three` are peer dependencies — bring your own compatible versions.

## Usage

Every module is reached via its own subpath, matching the file layout (no single barrel export —
`js/` alone has ~30 focused, independently-importable modules):

```js
import { sceneHostAssetUrl, resolveSceneHostUrl } from "@threejson/host-kit/js/sceneHostPaths.js";
import { EDITOR_SETTINGS_DEFAULTS } from "@threejson/host-kit/js/editorSettingsSchema.js";
import { t, initHostI18n } from "@threejson/host-kit/i18n/index.js";
```

## Mesh export

`js/meshExport.js` holds the third-party model export catalog (GLB / GLTF / OBJ / STL / PLY / USDZ)
and the `exportMesh` → Blob → download plumbing, extracted because the editor, shower, threebox and
player each carried their own copy of exactly that. Only the format-picker dialog stays in the app.

```js
import { MESH_EXPORT_FORMATS, exportSceneMeshToFile } from "@threejson/host-kit/js/meshExport.js";

const { fileName, warnings } = await exportSceneMeshToFile(scene, {
  format: "glb", renderer, fileNameStem: "my-scene"
});
```

Warnings are **returned rather than shown** — the app decides whether they warrant a dialog, a
toast, or nothing. Use `buildMeshExport` instead if you want the Blob without downloading it.

A ready-made format-picker dialog for React lives in
[`@threejson/react-ui`](../react-ui/README.md).

## Authoring views (friendly ⇄ standard)

`js/scenePayloadViews.js` converts a scene document between its two authoring views. Use it rather
than calling the engine directly — both directions have a trap that is easy to get wrong:

```js
import { toStandardScenePayload, toFriendlyScenePayload } from "@threejson/host-kit/js/scenePayloadViews.js";
```

`normalizeScenePayload()` returns a normalisation *record* (`sourcePayload`, `compatPayload`,
`friendlyMap`, …), not a scene document — the canonical payload is its `.payload` field. Exporting
the record instead produces a file roughly 20× larger that no longer loads as a scene. Going the
other way, the friendly view needs the document's `friendlyMap`, which may sit at the root or under
`worldInfo`; miss it and the author's names are lost. Both helpers clone their input.

## Scene tree

`js/sceneTreeModel.js` turns a live `Object3D` graph into a plain tree a UI can render. It exists
because a loaded scene's graph contains far more than the author's content — transform gizmos,
box-edge highlights, grid/axes helpers, the engine's native-scene wrapper — and listing those in an
outliner is a bug. The exclusion rules are fiddly enough that each app would otherwise reimplement a
different subset.

```js
import { buildSceneTreeModel, findObjectInScene } from "@threejson/host-kit/js/sceneTreeModel.js";
```

Nodes carry `{ uuid, threeJsonId, name, type, visible, children, object }`. Identity is
`userData.objJson.threeJsonId` (stable, authored) with `uuid` as the session-local fallback — an
object may legitimately have no authored id, in which case it is not addressable by command-layer
ops. Editor-owned gizmos are instances rather than types, so pass them via `extraRuntimeObjects`.

A React renderer for this model ships as `SceneTreePanel` in
[`@threejson/react-ui`](../react-ui/README.md).

Conversational scene-authoring persistence is not a host utility. It lives in the unbranded
[`@threejson/scene-agent-kit`](../scene-agent-kit/README.md); React bindings live in
[`@threejson/react-scene-agent`](../react-scene-agent/README.md). Host applications inject their own
database name, so community and commercial products cannot accidentally share browser state.

## Locales under Node / SSR

English labels are bundled as ES modules; other locales are JSON files fetched at runtime. Node
cannot `fetch()` a `file:` URL, so `loadHostLocaleCatalog` falls back to reading them from disk —
without it, a server-side render of a non-English locale would silently produce English strings.
The `node:` imports for that path are constructed at runtime so bundlers never pull them into a
browser build, where the branch is unreachable.

## Asset resolution differs from tools/scene-host

The original `sceneHostPaths.js` resolved paths relative to the monorepo's own repo root (it
assumed a sibling `assets/` folder always exists a fixed number of directories up). A standalone
npm install has no such folder, so this package's `sceneHostAssetUrl`/`resolveSceneHostUrl` resolve
against the published [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets) CDN by
default instead. Call `setHostAssetsBase(url)` to point at a self-hosted mirror or a bundled local
copy (e.g. `"/assets"`) instead.

This is intentionally independent of `threejson/core`'s own asset-base state
(`setAssetsBaseUrl`/`getAssetsBaseUrl`) — that state drives the *engine's* per-texture/model loading
(with its own local-first-then-CDN candidate fallback), a different concern from resolving a single
definitive URL for host-level assets (template manifests, sample scenes, settings templates).

## What's deliberately different from the tools/scene-host original

A handful of defaults referenced monorepo-only paths (the `examples/` folder, `assets/` at a fixed
relative depth) that don't exist for a standalone package — see `editorSettingsSchema.js`'s
docblock. Everything else is a faithful port; see `tests/hostKitSmoke.test.mjs` at the repo root for
the coverage that pins this down.

## Status

Alpha. Package boundaries and exports may still change before a stable 0.1.0 release.

Consumed by all four apps under `apps/` (scene-player, scene-shower, threebox, scene-editor) and by
`@threejson/player-kit` / `editor-kit` / `react` / `react-ui`. `tools/scene-host` deliberately stays
on its own copy: it is simultaneously the production baseline and the reference these apps are being
written against, so it does not migrate until the apps can replace it outright.
