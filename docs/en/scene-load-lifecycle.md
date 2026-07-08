[中文](../zh/scene-load-lifecycle.md) | [English](./scene-load-lifecycle.md)

# Scene Load Lifecycle

`createJsonScene` and related APIs expose an optional lifecycle bus for hosts and tools.

## Principles

- Zero hooks: `createJsonScene(payload, { canvas })` behaves the same when no hooks are registered.
- Flat options: `onRuntimeReady`, `onSceneReady`, `onDeployProgress`, and `afterRender` still work.
- Single context: load and teardown hooks receive `SceneLifecycleContext`; frame hooks receive `FrameContext`.

## Load Phases

| Phase | Timing |
|-------|--------|
| `load:beforeNormalize` | Before payload normalization. |
| `load:afterNormalize` | After payload normalization. |
| `load:beforeRuntime` | Before runtime creation. |
| `load:onRuntimeReady` | Runtime is ready, before object deployment. |
| `load:beforeDeploy` | Before object deployment. |
| `load:onDeployProgress` | Throttled deployment progress. |
| `load:afterDeploy` | After deployment completes. |
| `load:afterCameraFit` | After automatic camera fitting. |
| `load:onAssetsReady` | Reserved; defined in core but not emitted yet. |
| `load:onSceneReady` | Scene is interactive. |

## `sceneConfig.intro`

When `sceneConfig.intro.postLoad` is configured, core displays a DOM intro overlay between `afterCameraFit` and `onSceneReady`. By default it waits for the intro to finish before emitting `onSceneReady`. Set `excludeFromLoadWait: true` to let the intro run in the background.

## Text Font Deployment

Before canonical object deployment, `preloadSceneTextFonts(sceneConfig, objectList)` preloads SDF text fonts only when the scene needs them. Without SDF text, it is a no-op. Bare ESM pages that use SDF text should configure `troika-three-text` and `fflate` in the import map.
