[中文](./scene-load-lifecycle.md) | [English](../en/scene-load-lifecycle.md)

# 场景加载生命周期 / Scene load lifecycle

[中文](#场景加载生命周期) | [English](#scene-load-lifecycle)

---

## 场景加载生命周期

`createJsonScene` 及相关入口的统一可选生命周期总线。

### 原则

- **零钩子** — `createJsonScene(payload, { canvas })` 行为与未接入钩子时一致。
- **扁平 options** — `onRuntimeReady`、`onSceneReady`、`onDeployProgress`、`afterRender` 仍有效。
- **单一 ctx** — 加载/拆卸钩子接收 `SceneLifecycleContext`；帧钩子接收 `FrameContext`。

### 加载阶段（`load:*`）

| 阶段 | 时机 |
|------|------|
| `load:beforeNormalize` | 归一化 payload 之前 |
| `load:afterNormalize` | 归一化之后 |
| `load:beforeRuntime` | 创建 runtime 之前 |
| `load:onRuntimeReady` | runtime 就绪，部署对象之前 |
| `load:beforeDeploy` | 对象部署之前 |
| `load:onDeployProgress` | 部署进度（节流） |
| `load:afterDeploy` | 部署完成之后 |
| `load:afterCameraFit` | 自动取景之后 |
| `load:onAssetsReady` | **预留（Reserved）** — phase 已在 core 定义，**尚未 emit**；gate 外资源任务全部完成后再实现（见 [lab/scene-load-gate-memo.md](../../lab/scene-load-gate-memo.md)） |
| `load:onSceneReady` | 场景可交互（默认在 postLoad intro **await 完成**后 emit；`excludeFromLoadWait: true` 时不等待 intro；CSS3D bootstrap 优先级 0，用户钩子 100） |

### `sceneConfig.intro`（postLoad）

若 JSON 配置 `sceneConfig.intro.postLoad`，core 在 **`afterCameraFit` 与 `onSceneReady` 之间**于 canvas 父容器上展示 DOM 片头。默认 **`await` 完成**后再 emit `onSceneReady`；`postLoad.excludeFromLoadWait: true` 时 intro 后台播放，不阻塞 load gate。`blockInteraction` 控制 overlay 是否挡指针（默认 `true`；`excludeFromLoadWait: true` 且未写时默认 `false`，点击穿透场景）。无配置时不创建 overlay。详见 [json-format.md](./json-format.md#sceneconfigintro-可选加载完成后片头)。

### 部署内部（文字字体）

在 `deployIntoTarget`（异步 `createJsonScene` / `deployJsonScene`）内，runtime 就绪后、**`runCanonicalObjectDeploy` 之前**：

1. **`preloadSceneTextFonts(sceneConfig, objectList)`** — 仅当 `sceneNeedsSdfText()` 为真（至少一条 `objType: "text"` 且 `mode: "sdf"` 或默认）时执行；经 `loadSdfTextModule()` 懒加载 `troika-three-text`，并按 `sceneConfig.textFont.preloadCharacters` 与各条 `content` 预热字形。无 SDF 文字时为 no-op。
2. **逐条 `createText`** — 在 text 部署阶段调用；可能返回 `Promise`（`void Promise.resolve(createText(...))`）。SDF / mesh 加载或构建失败时降级为 `texture`，不阻塞整场景。

同步路径（`createJsonSceneSimple`、`deployJsonSceneSimple`）在同步 deploy 前 `void preloadSceneTextFonts(...)`（fire-and-forget）。

**宿主 import map**：裸 ESM 页面若加载 SDF 文字，需在 import map 中配置 `troika-three-text` + `fflate`；见 [quick-start.md](./quick-start.md) / [en/quick-start.md](../en/quick-start.md)。

### 示例

```javascript
await createJsonScene(payload, {
  canvas,
  async onRuntimeReady(ctx) {
    ctx.runtime.renderLoop?.start();
  },
  async onSceneReady(ctx) {
    await bootstrapExtensions(ctx);
  },
  onDeployProgress(ctx) {
    const { done, total } = ctx.deploy;
    updateBar(done / total);
  }
});
```

### 插件

```javascript
const pluginHost = createPluginHost();
pluginHost.register({ name: "rapier", beforePhysics(ctx) { /* ... */ } });
await createJsonScene(payload, { canvas, pluginHost });
```

### 同步路径

`createJsonSceneSimple` / `createJsonSceneFromObjectRecord` 发出同步安全阶段（`afterNormalize`、`onRuntimeReady`）。若异步钩子返回 `Promise`，会打警告。

---

## Scene load lifecycle

Unified optional lifecycle bus for `createJsonScene` and related entry points.

### Principles

- **Zero hooks** — `createJsonScene(payload, { canvas })` behaves as before.
- **Flat options** — `onRuntimeReady`, `onSceneReady`, `onDeployProgress`, `afterRender` remain valid.
- **Single ctx** — load/teardown hooks receive `SceneLifecycleContext`; frame hooks receive `FrameContext`.

### Load phases (`load:*`)

| Phase | When |
|-------|------|
| `load:beforeNormalize` | Before payload normalize |
| `load:afterNormalize` | After normalize |
| `load:beforeRuntime` | Before runtime creation |
| `load:onRuntimeReady` | Runtime ready, before deploy |
| `load:beforeDeploy` | Before object deploy |
| `load:onDeployProgress` | Deploy progress (throttled) |
| `load:afterDeploy` | After deploy |
| `load:afterCameraFit` | After auto-fit camera |
| `load:onAssetsReady` | **Reserved** — phase is defined in core but **not emitted yet**; to run after all out-of-gate asset tasks complete (see [lab/scene-load-gate-memo.md](../../lab/scene-load-gate-memo.md)) |
| `load:onSceneReady` | Scene interactive (by default **after** postLoad intro await; skipped when `excludeFromLoadWait: true`; CSS3D bootstrap priority 0, user hooks 100) |

### `sceneConfig.intro` (postLoad)

When `sceneConfig.intro.postLoad` is set, core shows a DOM splash on the canvas parent **between `afterCameraFit` and `onSceneReady`**. By default it **awaits** intro before emitting `onSceneReady`; with `postLoad.excludeFromLoadWait: true`, intro plays in the background without blocking the load gate. `blockInteraction` controls overlay pointer capture (default `true`; when `excludeFromLoadWait: true` and omitted, defaults to `false` so clicks reach the scene). No overlay when unset. See [json-format.md](./json-format.md#sceneconfigintro-可选加载完成后片头) (Chinese section; English: [en/json-format.md](../en/json-format.md)).

### Deploy internals (text fonts)

Inside `deployIntoTarget` (async `createJsonScene` / `deployJsonScene`), after runtime is ready and **before** `runCanonicalObjectDeploy`:

1. **`preloadSceneTextFonts(sceneConfig, objectList)`** — runs only when `sceneNeedsSdfText()` is true (at least one `objType: "text"` with `mode: "sdf"` or default). Lazy-loads `troika-three-text` via `loadSdfTextModule()` and warms glyphs from `sceneConfig.textFont.preloadCharacters` and per-record `content`. No-op when the scene has no SDF text.
2. **`createText` per record** — invoked during the text deploy phase; may return a `Promise` (`void Promise.resolve(createText(...))`). SDF / mesh load or build failure falls back to `texture` without blocking the rest of the scene.

Sync paths (`createJsonSceneSimple`, `deployJsonSceneSimple`) call `void preloadSceneTextFonts(...)` (fire-and-forget) before synchronous deploy.

**Host import map**: bare-ESM pages that load SDF text need `troika-three-text` + `fflate` in the import map; see [quick-start.md](./quick-start.md) / [en/quick-start.md](../en/quick-start.md).

### Example

```javascript
await createJsonScene(payload, {
  canvas,
  async onRuntimeReady(ctx) {
    ctx.runtime.renderLoop?.start();
  },
  async onSceneReady(ctx) {
    await bootstrapExtensions(ctx);
  },
  onDeployProgress(ctx) {
    const { done, total } = ctx.deploy;
    updateBar(done / total);
  }
});
```

### Plugins

```javascript
const pluginHost = createPluginHost();
pluginHost.register({ name: "rapier", beforePhysics(ctx) { /* ... */ } });
await createJsonScene(payload, { canvas, pluginHost });
```

### Sync paths

`createJsonSceneSimple` / `createJsonSceneFromObjectRecord` emit sync-safe phases (`afterNormalize`, `onRuntimeReady`). Async hooks log a warning if they return a Promise.
