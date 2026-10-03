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

SDF builders prepare their own glyphs concurrently. Only explicitly configured `sceneConfig.textFont.preloadCharacters` starts a separate warmup, which is awaited before object deployment; a fire-and-forget duplicate warmup could otherwise finish after the first video frame. Synchronous loaders use texture labels and start no SDF font requests.

Deployment progress `done === total` counts objects, not ready fonts/textures. Video timelines await those resources before rendering their first frame. SDF preparation is cancellable and uses a 15-second watchdog because Troika's callback-only API does not report all font/worker failures. `createJsonScene(payload, { textLoadTimeoutMs })` lets the host extend the deadline or disable it with `0`/`Infinity`. If preparation fails or times out, local canvas text preserves the authored ID, transforms, color and approximate world-space text size, reports `TEXT_SDF_FALLBACK`, and leaves the original SDF JSON intact for retry. Outline/curvature and exact font metrics may differ in the fallback. Cancellation/disposal does not create fallback objects.

Scene-wide font defaults survive normalization; per-text Unicode font sources are isolated between scenes. Bare ESM pages using SDF text need `troika-three-text` in their import map. `fflate` is unrelated and needed only by `.tjz` archive APIs.
