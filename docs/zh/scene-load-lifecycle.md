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

1. **`preloadSceneTextFonts(sceneConfig, objectList)`** — 按需懒加载 `troika-three-text`，只有显式指定 `sceneConfig.textFont.preloadCharacters` 才额外预热，并等待完成。每条 SDF 文字自身已会准备字形，不再重复发起未等待的后台预热，避免“文字布局完成、字形图集尚未生成”的空白首帧。
2. **逐条 `createTextAsync`** — 各文字并行准备字形，时间线在首帧前等待就绪。字体或 worker 不可用时使用本地 Canvas 文字兜底，并记录 `TEXT_SDF_FALLBACK` 警告；取消或销毁不会再创建兜底对象。

同步路径（`createJsonSceneSimple`、`deployJsonSceneSimple`）使用 texture 文字，不发起无用的 SDF 字体请求。

部署进度 `done === total` 仅表示对象装配结束，不表示字体、纹理和首帧就绪。Troika 的回调式 API 对部分字体/worker 故障不返回失败，因此 SDF 准备默认使用 **15 秒可取消的等待期限**。宿主可通过 `createJsonScene(payload, { textLoadTimeoutMs })` 调整，`0` / `Infinity` 表示关闭期限。兜底保留 ID、变换、颜色和近似世界尺寸，不修改原始 SDF JSON，后续加载仍可重试原字体；轮廓、曲率和精确字体度量可能不同。场景级 `textFont` 在规范化过程中保留，各文字的 Unicode 字体来源互不污染。

**宿主 import map**：裸 ESM 页面若加载 SDF 文字，只需为该能力配置 `troika-three-text`；`fflate` 与文字无关，仅供 `.tjz` 归档 API 使用。见 [quick-start.md](./quick-start.md) / [en/quick-start.md](../en/quick-start.md)。

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

1. **`preloadSceneTextFonts(sceneConfig, objectList)`** — lazy-loads SDF support only as needed. Only explicit `textFont.preloadCharacters` triggers an extra, awaited warmup; individual text builders already prepare their glyphs.
2. **`createTextAsync` per record** — starts concurrent, cancellable glyph preparation. Video timelines await readiness. Font/worker failures use local canvas text and report `TEXT_SDF_FALLBACK`, without changing the authored SDF descriptor. The host can configure `textLoadTimeoutMs` (default 15000; 0/Infinity disables the deadline).

Sync paths (`createJsonSceneSimple`, `deployJsonSceneSimple`) render texture labels and do not start SDF font requests.

**Host import map**: bare-ESM pages that load SDF text need only `troika-three-text`; `fflate` is unrelated and is used only by `.tjz` archive APIs. See [quick-start.md](./quick-start.md) / [en/quick-start.md](../en/quick-start.md).

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
