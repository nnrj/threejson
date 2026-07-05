# ThreeJSON tools and host applications

[Caller guide](./README.md) | [JSON format](../json-format.md) (core contract) | [Tools README](../../tools/README.md)

This document describes **host applications** built on ThreeJSON core (scene editor, player, demo pages) and **`sysConfig`** conventions. Core callers only need [`json-format.md`](../json-format.md) and [`api.md`](../api.md); this does not replace core docs.

Planned: root `scene-editor.html` / `scene-player.html` may move under [`tools/`](../../tools/); contracts stay the same.

## Ecosystem overview

| Component | Path | Notes |
|-----------|------|-------|
| Scene editor | [`scene-editor.html`](../../scene-editor.html) | Edit, save, AI, command layer |
| Scene player | [`scene-player.html`](../../scene-player.html) | Playlists, inspection tours |
| Editor commands | [`tools/common/editor-single/command/`](../../tools/common/editor-single/command/) | `editor.*` commands for HTML hosts |
| Business demos | [`room-show.html`](../../room-show.html), [`port-show.html`](../../port-show.html), etc. | Machine room / port dashboards |
| External agent / MCP | [`tools/threejson-agent/`](../../tools/threejson-agent/README.md), [`mcp-cursor.md`](../mcp-cursor.md) | Does not depend on page `sysConfig` |

## `sceneConfig` vs `sysConfig`

| | `sceneConfig` | `sysConfig` |
|---|---------------|-------------|
| Layer | Inside scene JSON (`payload.sceneConfig`) | Inline object per HTML page |
| Read by core? | **Yes** (`normalizeScenePayload` → `createJsonScene`) | **No** |
| Persistence | Saved/exported with scene | Session-level; `jsonData` is in-memory full payload |

### Merge contract (when tools load a scene)

For **portable** settings (any canvas host can use):

1. **`sceneConfig` is the contract superset** — third parties can rely on JSON alone.
2. **`sysConfig` mirrors a subset** — runtime values after settings sync; **do not delete** existing fields.
3. **Priority**:

```
Explicit sceneConfig / JSON fields
  → (when missing) sysConfig / editorSettings / playerSettings
  → createJsonScene options / runtimeDefaults / engine defaults
```

4. **Viewport integration**: `canvasWidth` / `canvasHeight` may live in JSON; tools track container size in `sysConfig` and inject **only when JSON omits them**. At runtime `autoResize: true` follows canvas DOM size (tool `windowResize` also calls `renderLoop.resize`).

Implementation: `buildEditorRuntimeConfig` / `buildPlayerRuntimeConfig` (`scene-editor.html`, `scene-player.html`).

**Canonical `objectList` only** (no top-level `sceneConfig`): do not inject a `sceneConfig` object; pass render settings via **`createJsonScene` options**.

### Settings vs JSON: A / B / C (priority semantics)

| Type | Behavior | Examples |
|------|----------|----------|
| **A. Fallback** | JSON wins when present | antialias, FPS, `controls.autoRotate` (label: “may be overridden by scene JSON”) |
| **B. Load policy** | `createJsonScene` options | `autoFillLights`, `autoFitCamera` (auto/off/prompt) |
| **C. Explicit override** | Separate checkbox + hint | `deployAutoFitOverrideExplicitCamera`, `overrideSceneRenderLoop` (overrides JSON fps/lowFps) |

Note: `earlyRenderWhileLoading` is a host UX switch (default on); controls whether renderLoop starts during load without changing persisted JSON.

Do not add a “replace JSON” checkbox for every `sceneConfig` field. Future category toggles: [`lab/sysconfig-sceneconfig-settings-memo.md`](../../lab/sysconfig-sceneconfig-settings-memo.md) (**not implemented in this release**).

### Config ownership: A / B / C (config semantics)

> To avoid confusion with the previous table’s priority A/B/C, this table defines **where config belongs**: JSON vs load policy vs host session.

| Class | Name | When it applies | Typical carrier | Should persist in scene JSON by default? |
|-------|------|-----------------|-----------------|------------------------------------------|
| **A** | Deploy/render chain | `normalizeScenePayload` → `createJsonScene` | `sceneConfig.*` | **Yes** |
| **B** | Load policy | `createJsonScene(payload, options)` | `editorSettings` / `playerSettings` → options | **No** (unless author writes `runtimeDefaults`) |
| **C** | Host session / methods | Page runtime | `sysConfig`, DOM events, `renderLoop.resize()` | **No** |

#### Two commonly confused items

| Item | Class | Notes |
|------|-------|-------|
| `sceneConfig.helpers.grid/axes` | A | In-scene `GridHelper`/`AxesHelper`; savable |
| `editorSettings.editing.showGridHelper` (editor-only grid) | C | Editor reference grid; not scene content; not in JSON |

#### `canvasWidth` / `canvasHeight` boundary

- As JSON/`sceneConfig` fields: **initial viewport hint** (A).
- At runtime: size follows `autoResize` + host resize path (C).
- Scenes need not always write `canvasWidth/Height`; host container may supply defaults.

### Tool-only (`sysConfig`)

Not required in `sceneConfig`: `jsonData`, `sceneLocked`, `dragLocked`, `meshObjects`, `meshList`, `initFlags`, `callFlags`, `progressFlag`, `clickHighLightFlag`, `optimizeJson`, etc.

### `sysConfig.jsonData` and save

- Editor `sceneToJson` merge base is `sysConfig.jsonData` (see [`api.md`](../api.md)).
- Persistence details: [`lab/scene-canonical-collect-roadmap.md`](../../lab/scene-canonical-collect-roadmap.md).

## Editor / player highlights

- **Settings storage**: editor `localStorage` + [`assets/json/other/scene-editor/setting.json`](../../assets/json/other/scene-editor/setting.json) template; player similar.
- **Load pipeline**: `sysConfig.jsonData` → `build*ScenePayload()` → `createJsonScene`.
- **Scene management UI**: reads/writes `payload.sceneConfig` (including `helpers.grid/axes.visible`, `controls.autoRotate`, etc.); “apply to canvas” triggers reload.

## Related documents

| Document | Notes |
|----------|-------|
| [`editor-selection.md`](../editor-selection.md) | Outline vs post-process highlight |
| [`json-templates/README.md`](../json-templates/README.md) | Hand-authored scene templates |
| [`demos.md`](./demos.md) | Demo index |
| [`tutorial.md`](./tutorial.md) | Lessons t05-03 / t05-04 |
| [`tools/common/editor-single/README.md`](../../tools/common/editor-single/README.md) | `editor.*` command wiring |
| [`lab/sysConfig-vs-sceneConfig-assessment.md`](../../lab/sysConfig-vs-sceneConfig-assessment.md) | Full assessment and field map |

## Boundary with core docs

- **Scene semantics** (camera, lights, background, helpers, deployScheduler) → write `sceneConfig`; see [`json-format.md`](../json-format.md).
- **Page UI** (alarm lists, sidebar toggles, etc.) → not in scene JSON; see [`lab/standard-json-shape-proposal.md`](../../lab/standard-json-shape-proposal.md) §10b.
