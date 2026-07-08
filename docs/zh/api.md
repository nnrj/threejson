[中文](./api.md) | [English](../en/api.md)

# 核心 API

[中文](./api.md) | [English](../en/api.md)

本页只列出调用者常用且相对通用的 API。机房、机柜、设备状态等业务专用方法不在本手册重点范围内，但业务域调度入口仍会在本文说明。

## 运行时日志（`core/util/logger.js`）

库内代码应使用 `log.warn` / `log.error` / `log.debug`，不要直接调用 `console.log` 或 `console.warn`。默认级别为 **warn**（`debug` / `info` 默认不输出）。

```js
import { configureLogger, isDebugEnabled, log } from "threejson/core";
// 或相对路径：import { log } from "../core/util/logger.js";

configureLogger({ level: "warn" });
configureLogger({ debug: true });
```

浏览器调试：URL 加 `?threejson_debug=1`，或 `localStorage.setItem("threejson.debug", "1")`。盘点脚本：`npm run audit:console`；门禁：`npm run lint:console`。

## `core/handler/sceneRuntimeHandler.js`

导入路径：

```js
import { createSceneRuntime } from "../core/handler/sceneRuntimeHandler.js";
```

### `createSceneRuntime(options)`

根据 runtime 配置创建场景运行时。它会统一创建：

- `scene`
- `camera`
- `renderer`
- `controls`
- `lights`
- `renderLoop`

`options` 除必填的 `canvas` 与 `config` 外，还支持：

- `composer`：传入 `EffectComposer`，交给内部 `createRenderLoop()` 使用。
- `beforeFrame` / `beforeRender` / `afterRender`：帧循环钩子（透传给 `frameLoopHandler`）。

```js
const sceneRuntime = createSceneRuntime({
  canvas: document.getElementById("canvasContainer"),
  config: sceneConfig
});
```

返回对象包含：

- `scene`：创建后的 `THREE.Scene`。
- `camera`：创建后的 `THREE.PerspectiveCamera`。
- `renderer`：创建后的 `THREE.WebGLRenderer`。
- `controls`：创建后的视口控制器（`OrbitControls` 或 firstPerson 适配器，见 `controls.type`）；当 `controls.enabled === false` 时为 `null`。适配器均实现 `update()` / `dispose()`，并带 `threeJsonControlsKind`（`orbit` | `firstPerson`）。
- `renderLoop`：底层帧循环对象。
- `start()`：启动统一帧循环。
- `stop()`：停止统一帧循环。
- `resize(size)`：调整 renderer、camera 和 composer 尺寸。
- `setComposer(composer)`：运行时创建后绑定 `EffectComposer`。
- `dispose()`：停止循环并释放 controls、renderer。

## `core/handler/frameLoopHandler.js`

导入路径：

```js
import { createRenderLoop } from "../core/handler/frameLoopHandler.js";
```

### `createRenderLoop(options)`

创建统一帧循环。通常不需要直接调用，优先使用 `createSceneRuntime()`。当页面需要自定义 scene/camera/renderer 创建方式时，可以直接使用它。

支持能力：

- `requestAnimationFrame` 调度。
- `lowFps` / `fps` 低帧率渲染。
- `updateSceneAnimations(scene)`。
- `controls.update()`。
- `renderer.render(scene, camera)` 或 `composer.render()`。
- `autoResize` / `firstAutoResize`。
- `beforeFrame`、`beforeRender`、`afterRender` 钩子。

```js
const renderLoop = createRenderLoop({
  scene,
  camera,
  renderer,
  controls,
  composer,
  config: {
    autoResize: true,
    firstAutoResize: true,
    fps: 60,
    lowFps: false
  }
});

renderLoop.start();
```

## `core/handler/animationHandler.js`

导入路径：

```js
import { updateSceneAnimations } from "../core/handler/animationHandler.js";
```

### `updateSceneAnimations(scene, deltaSeconds?, options?)`

更新场景内由 JSON `animations` 声明的持续动画，并调用 `TWEEN.update()`。通常由 `frameLoopHandler` 自动调用，不需要页面直接调用。

`options.maxDeltaSeconds`：限制单帧动画步长上限（默认约 `0.1`），可避免切换后台标签页后因帧间隔过大导致旋转突变。

当前支持：

```js
animations: [
  { type: "rotate", axis: "y", speed: 0.6 }
]
```

`speed` 单位为弧度/秒。`axis` 支持 `x`、`y`、`z`，也兼容 `rotationX`、`rotationY`、`rotationZ`。

## 门域 API（`domains/door`）

```js
import { door } from "threejson";
```

### `door.openOrCloseDoor(currObj)`

根据门模型 JSON 中的 `doorType` 执行开关门 tween（业务语义动画，非通用 JSON 动画系统）。

### 门开关 ELM（`door.toggle`）

与设备面板不同，**所有** `isDoorDescriptor` 的门（含扁平 `objType: "door"`）在场景 `bindSceneEvents` 时默认绑定 **`dblclick` → `door.toggle`**，除非：

- 写了 `doorToggleTrigger: "none"`（不绑定），或
- 写了 `doorToggleTrigger: "click"`（单击触发），或
- 同 record 已显式配置 `events.dblclick` / `events.click`（显式 JSON 优先，不再派生）。

机柜 deploy 根（`objType: "domain"`, `domain: "device.cabinet"`）**不会**绑定门 toggle；机柜壳体双击也不再由宿主硬编码开门。含机柜的场景通过 `device.cabinet` 的 `peerDomains: ["device", "door"]` 在 bind 时 invoke `door.bindSceneEvents`。

`door.toggle` 执行后会 dispatch 文档事件 **`threejson:door-toggled`**（`door.DOOR_TOGGLED_EVENT`），供 room-show 等页面同步运维按钮文案。

| 字段 | 取值 | 默认 |
|------|------|------|
| `doorToggleTrigger` | `dblclick` \| `click` \| `none` | `dblclick` |

实现：[`domains/door/doorEventActions.js`](../../domains/door/doorEventActions.js)、[`doorTriggerResolver.js`](../../domains/door/doorTriggerResolver.js)。objType 能力由 door 域自行 `registerObjTypeEventCapabilities("door", …)`，**不在** core `objTypeEventCapabilities` 种子表。

### `door.impactHole(model, scene)` / `door.resetWall(door, scene)`

门-墙 CSG 挖洞（实验能力）。实现位于 door 域；底层使用 core 的 `impactCheck` 与 [`holeSceneOps`](./handler/holeSceneOps.js)（`subtractMeshHole`、`resetHolesByOriginHole`、`deployHoleReplacement`）。

## `core/handler/sceneLoadHandler.js`

导入路径：

```js
import {
  createJsonScene,
  createJsonSceneFit,
  createJsonSceneFromInputFit,
  createJsonSceneSimple,
  deployJsonScene,
  deployJsonSceneSimple,
  cancelActiveDeployScheduler,
  resolveDeploySchedulerConfig
} from "../core/index.js";
```

### 场景入口对照

| API | 返回 | 背景 / native 嵌入 | objectList 部署 |
|-----|------|-------------------|-----------------|
| `createJsonScene` | `Promise<runtime>` | 异步 HDR / 全景 / 立方体；支持 `sceneInfoList` 嵌入 | 受 `sceneConfig.deployScheduler` 控制，默认同帧 immediate |
| `createJsonSceneFit` | `Promise<runtime>` | 同 `createJsonScene` | 同左；预设 `autoFillLights` + `autoFillCamera` + `autoFitCamera`（`options` 可覆盖） |
| `createJsonSceneFromInputFit` | `Promise<runtime>` | 同左 | 同 `createJsonSceneFromInput`，并 spread Fit 预设 |
| `createJsonSceneSimple` | `runtime`（同步） | 仅纯色 `background`；跳过 native 嵌入（`strict` 可抛错） | 始终 immediate，不 await async job |
| `deployJsonScene` | `Promise<runtime>` | 同 `createJsonScene` | 同左 |
| `deployJsonSceneSimple` | `runtime` | 同 `createJsonSceneSimple` | 始终 immediate，不 await async job |

**Fit 入口说明：** `createJsonSceneFit` / `createJsonSceneFromInputFit` 不等于「全自动加载」或仅 `autoFitCamera`；仅为演示/工具链预设补光、补相机与部署后取景。引擎默认仍由 `createJsonScene` + `mergeRuntimeDefaultOptions` 决定。

### `createJsonSceneFit(payload, options?)` / `createJsonSceneFromInputFit(input, options?)`

薄包装：在调用 `createJsonScene` / `createJsonSceneFromInput` 前合并 `CREATE_JSON_SCENE_FIT_DEFAULTS`（`autoFillLights`、`autoFillCamera`、`autoFitCamera`、`autoFitCameraMode: "positionAndTarget"`）。`options` 中显式字段覆盖预设；JSON 内 `sceneConfig.runtimeDefaults` / `worldInfo.runtimeDefaults` 仍按既有优先级参与合并。

切换场景或销毁 runtime 时建议调用 `cancelActiveDeployScheduler()`，取消进行中的分帧 / 时间槽部署。

### `createJsonScene(payload, options?)`

根据完整 JSON 载荷创建统一 runtime / scene，并自动部署其中的对象层。

支持两种并列输入：

- 人类友好 JSON：`sceneConfig` + `worldInfo.*List` + 可选 `friendlyMap`
- 标准 JSON：顶层 `threeJsonId` + `sceneConfig`（主 viewport）+ `objectList`（全部可部署 objType）；全写在 `objectList` 仍为合法子集

友好 JSON 的默认分组包括：

- `boxModelList`、`sphereModelList`、`groupList`
- `lineList`、`infoPanelList`
- `heatList`、`windList`
- `externalModelList`、`objModelList`
- `domainModelList`
- 混合逃生口：`modelList` / `objectList`

统一入口会先把友好 JSON 或标准 JSON 都规范化为标准 `objectList`，再按 `objType` 分阶段处理：

- runtime：`scene`、`camera`、`renderer`、`controls`、`light`、`renderLoop`
- 普通对象：`box`、`sphere`、`cylinder`、`cone`、`ring`、`torus`、`capsule`、`group`、`line`、`infoPanel`、`text`、`heatMap`、`wind`
- 特殊入口：`externalModel`、`domain`

`options.renderLoopUserPolicy`（可选）用于控制 `renderLoop.fps` / `renderLoop.lowFps` 的宿主策略合并：

- `fps`：宿主默认 FPS（非法值回退到 `60`）。
- `lowFps`：宿主默认低帧率模式开关。
- `overrideSceneRenderLoop`：`true` 时显式覆盖场景 JSON 的 `fps/lowFps`；`false` 时按「场景 JSON 优先，缺失项回退宿主设置」合并。

**静态资源基址（`options.assetsBase`，可选）**：单次加载时覆盖 `/assets/...` 路径解析根（见 [`sceneConfig.assetsBase`](./json-format.md#sceneconfigassetsbase-可选静态资源基址)）。优先级高于 `sceneConfig.assetsBase` 与全局 `setAssetsBaseUrl()`。克隆仓库 demo 常用 `assetsBase: "/assets"`；npm 用户省略时走默认 CDN。

### `deployJsonScene(target, payload, options?)`

把同样的完整 JSON 部署到已有 `Scene` 或 runtime 对象上；适合页面切换场景数据后重用现有渲染容器。输入形态与 `createJsonScene()` 完全一致，也同样支持 friendly JSON 与标准 `objectList`。

### `createJsonSceneSimple(payload, options?)`

与 `createJsonScene` **入参相同**，但函数体同步返回：不 `await` 异步背景、不解析嵌入 native Three JSON。`externalModel`、音频、SDF 文字（降级 texture）等仍可能在返回后继续异步加载。

### `deployJsonSceneSimple(target, payload, options?)`

与 `deployJsonScene` 相同约束的同步部署子集。

- `options.strict === true`：遇到需异步背景或 native 嵌入时 **抛错**，而非跳过并 `console.warn`。
- `options.onSceneReady`：若返回 `Promise`，仅告警，不等待（完整异步 bootstrap 请用 `createJsonScene`）。

## 静态资源（`core/util/assetsBase.js`）

纹理、模型、字体与内置 domain 默认 URL 的**公共基址**模块。自 `threejson/core` 导出（主入口 `threejson` re-export）。

| 符号 | 说明 |
|------|------|
| `ASSETS_PACKAGE_VERSION` | 与 jsDelivr `@threejson/assets` 锁定版本（当前 `"1.0.0"`） |
| `DEFAULT_CDN_ASSETS_BASE` | 默认 CDN 根 URL |
| `LOCAL_ASSETS_BASE` | 本地静态映射常量 `"/assets"` |
| `setAssetsBaseUrl(url)` / `getAssetsBaseUrl()` | 应用级切换基址 |
| `assetUrl(relativePath)` | 拼接 `textures/...` 等相对段 |
| `resolvePublicAssetUrl(url)` | 将 `/assets/...` 重写为当前 base；https 原样 |
| `resolveAssetsBaseFromLoad(payload, options)` | 读取 `options.assetsBase` 或 `sceneConfig.assetsBase` |
| `applyAssetsBaseForLoad(payload, options)` | 加载链内部使用；返回 restore 函数 |

**优先级（低 → 高）：** `DEFAULT_CDN_ASSETS_BASE` → `setAssetsBaseUrl()` → `sceneConfig.assetsBase` → `createJsonScene({ assetsBase })`。

npm 用户通常无需安装 [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets) 即可通过 CDN 加载；也可 `npm install @threejson/assets` 后将 `node_modules/@threejson/assets` 映射为静态目录并 `setAssetsBaseUrl(...)`。

```js
import {
  createJsonScene,
  LOCAL_ASSETS_BASE,
  setAssetsBaseUrl
} from "threejson/core";

setAssetsBaseUrl(LOCAL_ASSETS_BASE);

await createJsonScene(payload, {
  canvas,
  assetsBase: "/assets"
});
```

发布与 CDN 说明见 [`lab/assets-online-hosting-memo.md`](../../lab/assets-online-hosting-memo.md)。

### `sceneConfig.deployScheduler`（可选）

在 `sceneConfig` 上配置对象部署节奏（仅 `createJsonScene` / `deployJsonScene` 路径生效）：

```json
{
  "deployScheduler": {
    "enabled": true,
    "policy": "frameBudget",
    "maxJobsPerFrame": 12,
    "maxFrameMs": 8
  }
}
```

- 省略、`enabled: false` 或 `mode: "immediate"`：**同帧**部署全部 object（默认）。
- `enabled: true` 或 `mode: "scheduled"`：分阶段（2 → 3 → 4）排队；默认 `policy: "frameBudget"`（每帧条数 + 毫秒预算）。
- `policy: "timeslot"`：兼容展厅 `flowControl` 思路，用 `fluxMs` / `density` 控制 `setTimeout` 槽位间隔。
- `maxInFlightAsync`：限制 phase 3（`externalmodel`）同时进行的加载数（默认 4）。
- `retry`：仅 async 加载失败时重试（`maxAttempts`、`backoffMs`）。
- 单条记录可写 `deployScheduler: { "mode": "immediate" }` 在 scheduled 场景中插队立即部署。

### `sceneConfig.intro`（可选，postLoad 片头）

`createJsonScene` / `deployJsonScene` 在 **`afterCameraFit` 之后、`onSceneReady` 之前** 于 canvas 父节点展示 DOM 片头（`postLoad.slides`：image / text、`durationMs`、`skipOnClick`、`blockInteraction`、`excludeFromLoadWait`）。默认关闭。

- **`excludeFromLoadWait: true`**：不阻塞 `createJsonScene` Promise 与 `onSceneReady`（适合版权闪屏与 `#loadingMask` 并存）。
- **`blockInteraction`**：默认 `true`（全屏挡指针）；**`excludeFromLoadWait: true` 且未写本字段时默认 `false`**（overlay `pointer-events: none`，点击穿透场景；`skipOnClick: true` 时仅 slide 内容区可点跳过）。

挂载：`options.canvas` 父元素或 `options.introRoot`。导出：`normalizeIntroConfig`、`isIntroExcludedFromLoadWait`、`runPostLoadIntro`、`runScenePostLoadIntroIfConfigured`（`core/index.js`）。**`createJsonSceneSimple`**：warn 并跳过。详见 [json-format.md#sceneConfig.intro](./json-format.md#sceneconfigintro-可选加载完成后片头)。

### `sceneConfig.infoPanel`（可选）

控制 `type: "html"` 信息面板 **html2canvas** 纹理生成的并行上限（与 `deployScheduler` 独立）。`createJsonScene` / `deployJsonScene` 加载时生效；省略时默认 **`maxInFlightAsync: 4`**。

```json
{
  "infoPanel": {
    "maxInFlightAsync": 6
  }
}
```

- `options.onDeployProgress({ done, total, phase, id })`：仅在 `scheduled` 模式下，每完成一条 object deploy 回调一次；`createJsonScene` 的 Promise 在 **scheduled 同步队列 + phase3 异步池** 完成后 resolve。

低层 API（自定义编排）：`buildDeployJobs`、`runDeployJobs`（burst 并 await async job）、`runDeployJobsImmediate`（burst 不 await，sync 子集路径）、`runDeployJobsScheduled`（分帧并 await）、`resolveDeploySchedulerConfig`（均从 `core/index.js` 导出）。

## 单对象 API（Object / Batch / Auto）

导入路径：

```js
import {
  createJsonObject,
  createJsonObjectBatch,
  createJsonObjectAuto,
  deployJsonObject,
  deployJsonObjectAsync,
  deployJsonObjectBatch,
  deployJsonObjectBatchAsync,
  deployJsonObjectAuto,
  deployJsonObjectAutoAsync
} from "../core/index.js";
```

### 命名约定

- 默认最短名（如 `createJsonObject`）= **单条 record**。
- `Batch` 后缀 = **数组入参 / 数组返回**。
- `Auto` 后缀 = 自动按入参形态（object / array）分流到单条或批量。
- 异步命名顺序保持：`Object -> Auto -> Async`（如 `deployJsonObjectAutoAsync`）。

### create vs deploy 能力

| objType | `createJsonObject` | `deployJsonObject(Async)` |
|--------|---------------------|---------------------------|
| `box/group/line/sprite/points/...` | 支持（返回 `Object3D \| null`） | 支持 |
| `externalModel/skinned/audio/domain` | 不支持（返回 `null`） | 支持 |
| `scene/camera/renderer/controls/renderLoop` | 不受理 | 不受理 |

### target 形态

`deploy*` 系列的 `target` 支持：

- `THREE.Scene`
- `THREE.Object3D`
- `{ scene: THREE.Scene }`

### 模式限制

- `objectLoadHandler` 系列仅支持 `record`（纯 `objType` 记录）。
- 若传入 `options.mode !== "record"` 会抛 `E_OBJECT_MODE_MISMATCH`。
- 层级子树在 payload 内用 **`subScene[]`** 表达（见 [JSON 配置手册](./json-format.md#subscene-嵌套层级对象)）。

### 最小示例

```js
// 1) 单条（默认）
const mesh = createJsonObject({ objType: "box", geometry: { width: 1, height: 1, depth: 1 } });
await deployJsonObjectAsync(scene, { objType: "box", geometry: { width: 1, height: 1, depth: 1 } });

// 2) Batch
const list = createJsonObjectBatch([{ objType: "box" }, { objType: "sphere" }]);
deployJsonObjectBatch(scene, [{ objType: "box" }, { objType: "sphere" }]);

// 3) Auto（入参可能是单条或数组时）
const maybeMany = createJsonObjectAuto(inputJson);
await deployJsonObjectAutoAsync(scene, inputJson);
```

### 错误码约定（实现建议）

- `E_OBJECT_RECORD_INVALID`：对象记录不合法（缺失/非法 `objType`）。
- `E_OBJECT_MODE_MISMATCH`：`mode` 与输入形态不匹配。

### `.tjz` entry 推荐调用（当前策略）

```js
import {
  createJsonSceneFromArchive,
  deployJsonSceneFromArchive,
  inspectJsonSceneArchiveEntry
} from "../core/index.js";

// 1) .tjz entry = 完整场景 payload
const runtime = await createJsonSceneFromArchive(tjzBytesOrUrl, {
  canvas,
  missingAssetPolicy: "warn"
});

// 2) .tjz entry = 单对象 record（objType）
const scene = existingRuntime.scene;
await deployJsonSceneFromArchive(scene, tjzRecordEntryBytesOrUrl, {
  objectEntryMode: "append", // "append" | "replace"
  missingAssetPolicy: "warn"
});

// 3) 只检查 entry 类型（scene/object），不做部署
const info = await inspectJsonSceneArchiveEntry(tjzBytesOrUrl);
console.log(info.entryKind); // "scene" | "object" | "unknown"
```

说明：

- 当前版本 `.tjz` entry 支持：`full scene payload`、`object record`。
- payload 内的嵌套层级使用 **`subScene[]`**（见 [JSON 配置手册](./json-format.md#subscene-嵌套层级对象)）。

## 导出 API（scene/object/archive）

导入路径：

```js
import {
  sceneToJson,
  sceneToStandardJson,
  sceneToStandardJsonSimple,
  sceneToFriendlyJson,
  rebuildStandardJson,
  rebuildFriendlyJson,
  collectObjectListFromScene,
  exportJsonScene,
  exportJsonSceneText,
  sceneToNativeJson,
  exportJsonObject,
  exportJsonObjectBatch,
  exportJsonObjectByType,
  exportJsonObjectByTypeList,
  packJsonSceneArchive,
  packJsonObjectArchive,
  packJsonObjectBatchArchive
} from "../core/index.js";
```

### `sceneToJson(scene, options?)`（主 API）

从运行中 `THREE.Scene` 反扫场景描述 JSON。

- `options.format`：`"standard"`（默认）| `"friendly"`。
- `options.mode`：`"read"`（默认）| `"rebuild"`（首期 rebuild 与 read 相同）。
- `options.scanDepth`：`"deployRoots"`（默认）| `"registryRoots"` | `"traverse"`。
- `options.basePayload`：merge 基座；fresh 未扫到的 `threeJsonId` 保留 base 条目（`merge: true` 时）。**编辑器**默认经 `resolveEditorMergeBase()` 取当前 `sysConfig.jsonData`（不用会话 `autoSnapshot`）。
- `options.merge`：默认 `true`；`false` 时仅输出 fresh 列表。编辑器全场景载入/恢复后首拍用 `merge: false`。
- `options.embedNative`：默认 `false`；`true` 时用 `sceneToNativeJson` 写入 `worldInfo.sceneInfoList`。
- `options.runtimeTarget`：含 `scene`、`camera` 等，用于注入 `sceneConfig`。
- `options.friendlyMap`：仅 `sceneToFriendlyJson` / `format: "friendly"` 时使用。

别名：`sceneToStandardJson`（async）、`sceneToStandardJsonSimple`（同步子集）、`sceneToFriendlyJson`、`rebuildStandardJson`、`rebuildFriendlyJson`、`collectObjectListFromScene`。

产出**标准 JSON（方案 B）**：`{ threeJsonId, objectList, sceneConfig, assetLibrary?, extensions?, saveMeta }`（含顶层 `sceneConfig` 时 `isCanonicalScenePayload` 为 false，属预期）。主 viewport 的 `camera`/`light`/`controls` 写入 `sceneConfig` 并带 `jsonOrigin: "config"`；`objectList` 中额外 deploy 实例带 `jsonOrigin: "list"`。详见 [`lab/standard-json-shape-proposal.md`](../../lab/standard-json-shape-proposal.md)。

### `sceneToNativeJson(scene, options?)`

Three.js `Object3D.toJSON()` 的项目封装。与 `sceneToJson` **正交**：用于原生 `sceneInfoList`、应急降级保存，**不**参与日常 objectList 主路径。

### `exportJsonScene(targetOrPayload, options?)`

`sceneToJson` 的**薄封装**（保留符号，不 deprecated）。runtime 目标（`scene.isScene`）时全量转发 `options` 至 `sceneToJson`。

- `options.format`：`"standard"`（默认）| `"friendly"` | `"three-native"`。
- `includeSceneInfoList`：等价 `embedNative: true`。
- `includeRuntimeRecords`：默认 `true`，为 `false` 时不注入 `scene/camera/renderer/controls/light/renderLoop` 运行时记录。
- payload-only 分支（非 runtime）：`friendly` 走 `convertFriendlyJsonToStandardJson` → `convertStandardJsonToFriendlyJson`；`standard` 仅转 standard。
- `three-native` 语义：调用 Three.js 原生导出 JSON（或消费已有 native JSON）并包成 `nativeThree.parseInline` 可识别外壳。

### `exportJsonObject(target, id, options?)`

- 单对象导出为标准 `record`（`{ objType, ... }`）。
- 选择器：`options.by = "threeJsonId" | "uuid"`（默认 `threeJsonId`）。
- 批量可用 `exportJsonObjectBatch`；按类型导出可用 `exportJsonObjectByType` / `exportJsonObjectByTypeList`。

### `.tjz` 导出

- `packJsonSceneArchive(targetOrPayload, options?)`：完整场景打包为 `.tjz`。
- `packJsonObjectArchive(target, id, options?)`：单对象 record 打包为 `.tjz`。
- `packJsonObjectBatchArchive(target, ids, options?)`：批量对象打包。
- `manifest.entryKind`：导出时会自动写入（scene/object）；导入时可优先用于 entry 类型判断。

`assetPolicy` 规则：

- `preserve`（默认）：保留 JSON 内资源引用，不抽取到 `assets/`。
- `tryPack`：尝试将可解析资源改写为 `pack://assets/...` 并写入 zip（含 `data:` 纹理、`events.*.script` / `scriptUrl` 中的 `lib://` 与外链 URL——后者需开启「抓取外链」；**默认 `assetPolicy: preserve` 关闭**）。
- 当 `format === "three-native"` 时，打包**不会**执行纹理/模型抽取；原生 JSON 内容原样进入 `scene.json`。

## Mesh 导出 API（3D 交换格式）

与 JSON / `.tjz` **并列**的独立入口，不扩展 `exportJsonScene` 的 `format` 枚举。

```js
import { exportMesh, exportMeshObject } from "../core/index.js";
```

### `exportMesh(target, options?)`

从运行中场景或选中子树导出 GLB/GLTF/OBJ/STL/PLY/USDZ（FBX 需可选依赖 `@comfyorg/fbx-exporter-three`）。

- `options.format`：`"glb"`（默认）| `"gltf"` | `"obj"` | `"stl"` | `"ply"` | `"usdz"` | `"fbx"`
- `options.scope`：`"scene"`（默认）| `"selection"` | `"object"`（配合 `object3D`）
- `options.selectedObject3D`：`scope: "selection"` 时传入
- `options.shouldSkipObject`：默认 `shouldSkipSceneExportNode`
- `options.externalModelPolicy`：`"include"`（默认）| `"omitHeavy"`
- `options.renderer`：传入当前 `WebGLRenderer` 以便 GLTF/USDZ 编码贴图
- `options.outputType`：`"arraybuffer"`（默认）| `"string"`

返回 `{ format, data, mimeType, extension, fileNameHint, warnings, omittedExternalModels, stats }`。core **不写磁盘**；浏览器侧用 `Blob` + 下载。

### `exportMeshObject(target, id, options?)`

按 `threeJsonId` / `uuid` 导出单个 deploy 根（镜像 `exportJsonObject` 定位语义）。

## Mesh 导入 API（3D 交换格式）

与 JSON 部署管线共用 `objType: "externalModel"`；编辑器本地文件通过 blob URL 引用，不反向依赖 `scene-editor.html`。

```js
import {
  importMeshBlob,
  importMeshFromArrayBuffer,
  buildExternalModelImportRecord,
  parseMeshArrayBufferToObject3D
} from "../core/index.js";
```

### 支持格式（与导出对称）

`glb` | `gltf` | `obj` | `stl` | `ply` | `usdz` | `fbx`（`usd` 视为 `usdz` 别名）

JSON 运行时：`modelFileType` + `modelPath`（URL / blob / data）经 `loadExternalModel` / `loadExternalModelAsync` 分发。未知类型抛出 `E_EXTERNAL_MODEL_UNSUPPORTED`。

### `importMeshBlob(blob, options?)`

浏览器侧将 `File`/`Blob` 转为可部署的 `externalModel` 记录（`modelPath` 为 `blob:` URL）。返回 `{ record, format, objectUrl, revokeObjectUrl }`。

### `importMeshFromArrayBuffer(buffer, options?)`

直接解析二进制/文本缓冲为 `Object3D`（测试与自定义管线用）。

### `buildExternalModelImportRecord(options)`

由 `fileName` / `modelPath` / `modelFileType` 构建标准 `externalModel` 描述符，并补全 `threeJsonId`。

## 业务域调度 API

这些 API 都可从 `../core/index.js` 导入；它们负责把人类友好 JSON 里的 `worldInfo.domainModelList`，或标准 JSON 里的 `objType: "domain"` 记录交给已注册的业务域处理。更完整的业务域概念、descriptor 结构和创建步骤见 [业务域与 `domains/`](./domains.md)。

导入路径：

```js
import {
  applyDomainModelsFromWorldInfo,
  applyDomainModelList,
  invokeDomainModel,
  deployMeshWithDomains,
  deployMeshListWithDomains,
  businessDomains
} from "../core/index.js";
```

### `applyDomainModelsFromWorldInfo(scene, worldInfo, ctx?)`

从 `worldInfo.domainModelList` 读取记录并逐条调度。

- 适合页面拿到整份 world JSON 后统一执行。
- 每条记录至少需要 `domain` 字段。
- `ctx` 会原样传给 domain，适合放 `jsonData`、`sceneJsonRoot`、`loadingManager` 等运行时上下文。

```js
applyDomainModelsFromWorldInfo(scene, jsonData.worldInfo, { jsonData });
```

### `applyDomainModelList(scene, domainModelList, ctx?)`

直接对一个数组执行同样的调度逻辑，适合页面拼接临时 domain 记录后再统一执行。

```js
applyDomainModelList(scene, [
  { domain: "nativeThree", handler: "loadFromUrl", modelPath: "/assets/json/three_native.json" }
]);
```

### `invokeDomainModel(scene, record, ctx?)`

单条记录的便捷入口，等价于 `applyDomainModelList(scene, [record], ctx)`。

```js
invokeDomainModel(scene, {
  domain: "nativeThree",
  handler: "loadFromUrl",
  modelPath: "/assets/json/three_native.json"
});
```

### `businessDomains`

按业务域 id 暴露各 domain 自己声明的 `api`。适合页面已经明确知道要操作哪个 domain 时直接命令式调用。

```js
businessDomains.port.createPortStatistics(sceneJsonRoot, scene, "capacity");
```

如果访问了不存在的 `businessDomains.<id>`，返回值会是 `undefined`。

### `deployMeshWithDomains(scene, meshRecord, ctx?)`

部署单条 mesh 描述符（来自友好 JSON 的 `boxModelList`、`sphereModelList`、`meshList` 规范化结果，或 canonical `objectList`）。执行顺序：

1. 若命中 `legacyBoxObjTypes`（如 `dockCrane`、`wall`、`glass`），走 `domain.resolveDomainModel`。
2. 若 `sceneConfig.enableComposeBoxModel === true`，尝试各 domain 的 `composeBoxModel()`。
3. 否则对 `objType` 为 `box` / `sphere` 等 primitive 调用 `deployMesh()`。

`createJsonScene` 对 `objType: "domain"` 的记录另走 `invokeDomainModel`。

### `deployMeshListWithDomains(scene, meshList, ctx?)`

批量版 `deployMeshWithDomains()`。加载友好场景时，比手写遍历 `deployMesh()` 更合适。

## `core/builder/modelBuilder.js`

导入路径：

```js
import {
  createMesh,
  deployMesh,
  createBox,
  deployBox,
  createSphere,
  createGroup,
  createLine,
  createLine2,
  createWind,
  createHeatmap,
  createHeatmapVolume,
  createCylinder,
  createCone,
  createRing,
  createTorus,
  createCapsule,
  loadExternalModel
} from "../core/builder/modelBuilder.js";
```

### `createMesh(json)`

根据 JSON 创建 ThreeJS 对象但不加入场景。

- `json.objType === "sphere"` 时创建球体。
- `json.objType === "cylinder" | "cone" | "ring" | "torus" | "capsule"` 时创建对应基础几何体。
- 旧 `boxType` 以及 `geometry.type === "SphereGeometry" | "CylinderGeometry" | ...` 仍兼容读取。
- 其他情况默认按盒子创建。
- 返回值通常是 `THREE.Mesh`，带门动画或 CSG 时可能返回处理后的对象。

### `deployMesh(json, scene)`

调用 `createMesh(json)` 并把返回对象加入 `scene`。这是最推荐的单物体入口。

```js
deployMesh(boxJson, scene);
deployMesh(sphereJson, scene);
```

### `createBox(json)` / `deployBox(json, scene)`

盒子专用入口。若 JSON 带 `material.textureUrl` 或 `materials`，会先加载纹理再创建材质。

注意：当前 `deployBox()` 参数是单个盒子 JSON，不是数组。批量部署时调用者应自行遍历。

```js
boxModelList.forEach((boxJson) => deployBox(boxJson, scene));
```

### `createSphere(json)`

球体专用入口。标准写法是 `objType: "sphere"`；旧 `boxType: "sphere"` 仍兼容。

### `createCylinder(json)` / `createCone(json)` / `createRing(json)` / `createTorus(json)` / `createCapsule(json)`

新增的基础几何体快捷入口；内部都走单材质 primitive 构建链，可直接配合 `deployMesh()` 使用。

### `createGroup(groupJson)`

根据 `groupJson` 的变换/名称等字段创建**空壳** `THREE.Group`。**不会**在此函数内 deploy 子对象。应通过统一加载链（`createJsonScene`、`deployGroupDescriptor`、`deployObjectRecord` 且 `objType: "group"`）读取 **`subScene[]`** 并递归挂子节点。

group 记录上的旧字段 **`boxModelList` / `subGroup`** 仅在归一化阶段迁移为 `subScene`；新 JSON 请直接写 `subScene`。

```js
const group = createGroup(groupJson);
scene.add(group);
// 若需带子节点，请用 deployGroupDescriptor(scene, groupJson) 等统一入口。
```

### `createLine(lineJson)`

创建普通 `THREE.Line`。多数浏览器/WebGL 实现不会真正支持 `linewidth`。

### `createLine2(lineJson)`

创建支持线宽的 `Line2`。当 JSON 中存在 `material.linewidth`，建议使用此方法。

```js
scene.add(createLine2(lineJson));
```

### `createWind(windJson, scene)`

创建带纹理的动态平面，主要用于流动箭头、气流、水流等效果。若页面使用 `createSceneRuntime()` 或 `createRenderLoop()`，统一循环会通过 `animationHandler` 调用 `TWEEN.update()`；旧式手写循环才需要调用者自行执行 `TWEEN.update()`。

### `createHeatmap(heatJson, scene)`

平面热力：**仅**创建带热力纹理的 `PlaneGeometry`。**不读取** `geometry.depth`（若 JSON 中存在亦忽略）。

### `createHeatmapVolume(heatJson, scene)`

三维体热力：当 `geometry.depth` 为有限正数时用 `createHeatmapVolumeMesh`。**否则**等价于调用 `createHeatmap(heatJson, scene)`（退化平面）。

色谱默认：`createHeatmap` 使用 `HEATMAP_LEGACY_COLOR_STOPS`（零点浅底）；`createHeatmapVolume` 传入体量专用 `HEATMAP_LEGACY_COLOR_STOPS_VOLUME`（零点须暗以满足 raymarch 的 `dens=max(rgb)`）。

### 场景高亮（OutlinePass，三通道）

高亮域：`domains/sceneHighlight`，三通道为：

- `info`（白）— 信息选中
- `locate`（黄）— 定位/告警已处理
- `alarm`（红）— 告警

常见用法有两种：

1. 仅部署 pass（JSON / deploy）：用 domain `createSceneHighlightPassJson()` + core pass 部署链。
2. 页面直接初始化 bundle + controller：用 `sceneHighlight.createPageHighlightSetup(scene, camera, { composer, channelOptions, resolveOptions })`。

`createPageHighlightSetup()` 返回：

- `bundle`（domain bundle）
- `controller`（交互 controller，提供 `setInfoHighlight` / `addLocateObjects` / `addAlarmObjects` 等）
- `infoPass` / `locatePass` / `alarmPass`（各通道 OutlinePass）

注意：编辑器 **描边** 为 `THREE.BoxHelper`，由页面侧 `createBoxEdgeHelper()` 控制，不属于高亮（OutlinePass）的一部分。
- 拾取辅助（`meshPick.js`）：`isDescendantOf`、`isHitOnTransformControlsHelper`。

### `loadExternalModel(externalModel, scene)`

统一外部模型入口（推荐）：

- 标准入口是 `objType: "externalModel"`。
- 在友好 JSON 里，通常通过 `worldInfo.externalModelList` 或 `worldInfo.objModelList` 输入，再由 friendly 归一化层补成标准记录。
- 优先读取 `modelFileType`；若缺失，再按 `modelPath` 扩展名判断。
- 仍然无法判断时直接解析失败，不再静默回退为 OBJ。
- `obj`：使用 OBJLoader；当存在 `mtlPath` 时会先加载 MTL 再加载 OBJ。若未显式提供 `mtlPath`，会尝试从 `.obj` 内容里的 `mtllib` 自动推导同目录 `.mtl`。
- `gltf` / `glb`：使用 GLTFLoader（含 Draco）。
- `three` / `threejson` / `object`：走 Three.js `ObjectLoader`。
- `mtl` 当前不作为独立可见模型类型，仅作为 `obj` 的材质依赖。

OBJ 贴图解析顺序：

1. 优先保留 MTL 已声明的贴图槽位。
2. 若 OBJ JSON 提供 `maps`，补齐缺失槽位。
3. 若未提供 `maps`，尝试从同目录 `maps/` 文件夹按约定命名加载（可用 `mapsFolderFallback` 控制：`"map"` 默认仅 diffuse、`"full"` 全槽位、`"off"` 关闭）。
4. 最后回退到历史字段 `material.textureUrl` / `material.map`。

## `core/builder/textBuilder.js`

导入路径：`../core/builder/textBuilder.js`（亦从 `../core/index.js` 导出）。

### `createText(parent, record, ctx?)` / `createTextAsync(parent, record, ctx?)` / `deployText(parent, record, ctx?)`

部署 **`objType: "text"`** 场景文字。`mode` 支持 `sdf`（默认）、`texture`、`mesh`（见 [JSON 配置手册 § text](./json-format.md#text场景内文字)）。

- **`createTextAsync`**：完整 async 路径；`sdf` / `mesh` / `texture`，含 troika 懒加载与降级。
- **`createText`**：sync 子集；仅稳定同步完成 `texture`；`sdf` / `mesh` **同步降级为 texture**（warn）。
- **`deployText`**：调用 sync 版 `createText`（与 `createJsonSceneSimple` 路径一致）。

async 场景加载链（`createJsonScene` 等）内部使用 `createTextAsync` 并 await。

### `preloadSceneTextFonts(sceneConfig, objectList?)`

场景含 SDF 文字时，在 deploy 前预热字形（内部同样懒加载 troika）。无 SDF 文字时为 no-op。

### `sceneNeedsSdfText(sceneConfig, objectList?)`

判断场景是否需要 troika（供宿主页面决定是否配置 import map）。

## `core/builder/infoPanelBuilder.js`

导入路径：

```js
import {
  deployInfoPanel,
  deployBoxInfoPanel,
  deploySpriteInfoPanel,
  deployPlaneInfoPanel,
  createInfoPanelDescriptor,
  normalizeInfoPanelDescriptor
} from "../core/builder/infoPanelBuilder.js";
```

### 解析管线

1. `normalizeInfoPanelDescriptor(infoPanel)` — 补齐默认值（载体 `panelBoxType`、内容 `type` 等）。
2. `createInfoPanelDescriptor(text, position, options)` — 由文本与坐标快捷拼装描述符（**不入场景**）。
3. `resolveInfoPanelTexture(descriptor)` — 按 `type` 生成/加载纹理（`Promise<THREE.Texture>`）。
4. `buildInfoPanelObject(descriptor, texture)` — 按 `panelBoxType` 构建 Mesh 或 Sprite（**不入场景**）。
5. `deployInfoPanel(scene, infoPanel)` — 上述步骤合并并 `scene.add`（**推荐主入口**）。

### `deployInfoPanel(scene, infoPanel)`

根据 `infoPanel.panelBoxType` 自动选择载体：

- `panelBoxType: "box"`：盒体面板（可有 `panelDepth`、`textFace: full`）。
- `panelBoxType: "sprite"`：精灵面板，始终面向相机。
- `panelBoxType: "plane"`：固定朝向平面（+Z 贴图；`panel.material.side` 可选 `front`/`back`/`double`）。
- 在友好 JSON 的 `infoPanelList` 中可省略 per-item `objType`。
- 旧 `boxType` 仍兼容。

**使用场景**（详见 [信息面板专题](./info-panels.md)）：

- 场景加载：`worldInfo.infoPanelList` 由 `createJsonScene` 自动 deploy。
- 动态刷新：业务菜单切换时使用 [`applyInfoPanelList`](#corehandlerinfopanelruntimejs) 或 `updateInfoPanel`。
- 点击弹出：宿主页读取物体上的嵌套 `infoPanel`，更新 `panel.position` 后调用本方法。
- 常驻标牌：省略 `dismissTrigger`（等同 `none`），面板不会被 core 自动关闭；见 [事件机制 § infoPanel dismissTrigger](./event-mechanism.md)。

`infoPanel.type` 支持：

- `text`：普通文本，由 canvas 绘制纹理。
- `html`：通过 `html2canvas` 将 HTML 转成纹理。
- `img`：加载图片作为纹理。

### `createInfoPanelDescriptor(text, position, options)`

拼装完整 infoPanel JSON 描述符，供嵌入 `infoPanelList` 或传给 `deployInfoPanel`；不创建 Three.js 对象。

### `deployBoxInfoPanel` / `deploySpriteInfoPanel` / `deployPlaneInfoPanel`

强制 `panelBoxType` 为 `box`、`sprite` 或 `plane` 后 deploy。

**运行时更新**已有面板请使用 [`infoPanelRuntime`](#corehandlerinfopanelruntimejs) 的 `updateInfoPanel` / `updateInfoPanelContent`（按 `threeJsonId`），勿再使用已删除的 builder `update*InfoPanel`。

## `core/handler/boxModelListCoalescer.js`

```js
import { coalesceBoxModelList } from "../core/handler/boxModelListCoalescer.js";
```

### `coalesceBoxModelList(boxModelList)`

合并 `instanceCode` / `mergeCode` 的盒体 JSON 预处理。

## `core/handler/csgBrushOps.js`

```js
import {
  createBrushFromMesh,
  evaluateMeshBoolean
} from "../core/handler/csgBrushOps.js";
```

### `evaluateMeshBoolean(masterMesh, slaveMesh, operation?)`

对两个 Mesh 做 CSG 布尔运算。`operation` 支持 `union` / `subtract` / `intersect` / `difference`，以及别名 `add` / `sub` / `inter` / `diff`。JSON 的 `holes`、`joins`、`inters` 由 `modelBuilder` 在构建时调用。

## `core/handler/modelHandler.js`

导入路径：

```js
import {
  checkModelType,
  impactCheck,
  impactHandler,
  clearImpactCheck
} from "../core/handler/modelHandler.js";
```

### `checkModelType(model, type)`

判断对象的 `userData.objJson` 是否匹配指定 `objType`。

### `impactCheck` / `impactHandler` / `clearImpactCheck`

编辑器 AABB 碰撞检测与辅助线管理，见下文各小节。

## `core/handler/objectObjType.js`

按 `objType` 索引（`objectRegistry` + `objTypeIndex`）查询与批量操作，取代原 modelHandler 的 traverse 型 API。

```js
import {
  getThreeJsonIdsByObjType,
  getObjectsByObjType,
  getObjJsonListByObjType,
  setObjectsVisibleByObjType,
  destroyObjectsByObjType,
  transObjectsByObjType
} from "threejson";
```

| API | 说明 |
|-----|------|
| `getObjectsByObjType(scene, objType, options?)` | 返回 `Object3D[]`；可选 `{ root }` 限制子树 |
| `getObjJsonListByObjType(scene, objType, options?)` | 返回 descriptor 列表 |
| `setObjectsVisibleByObjType(scene, objType, visible)` | 按类型显隐（registry 命中对象） |
| `destroyObjectsByObjType(scene, objType)` | 按类型销毁（`removeObjectByThreeJsonIdCore`） |
| `transObjectsByObjType(scene, objType, opacity)` | 按类型设置透明度 |

对象须已 `registerObject` 且含 `threeJsonId` 才会进入索引。

## `core/handler/objectDomain.js`

按 canonical domain 部署根（`objType: "domain"` + `domain`）索引查询。页面批量显隐仍优先用 `name`；本 API 供工具/编辑器按 domain id 筛选。

```js
import {
  getThreeJsonIdsByDomain,
  getObjectsByDomain,
  getObjJsonListByDomain
} from "threejson";
```

| API | 说明 |
|-----|------|
| `getObjectsByDomain(scene, domainId, options?)` | 如 `getObjectsByDomain(scene, "device.cabinet")`；可选 `{ root }` 限制子树 |
| `getObjJsonListByDomain(scene, domainId, options?)` | 返回 descriptor 列表 |
| `getThreeJsonIdsByDomain(domainId)` | 返回 indexed `threeJsonId[]` |

仅 `objType === "domain"` 且 `domain` 非空的 deploy 根会入索引（扁平 `objType: "door"` 等不在此列）。

## `core/handler/infoPanelRuntime.js`

```js
import {
  setInfoPanelVisibleByThreeJsonId,
  updateInfoPanel,
  updateInfoPanelContent,
  applyInfoPanelList,
  hideInfoPanelsByNames
} from "threejson";
```

| API | 说明 |
|-----|------|
| `setInfoPanelVisibleByThreeJsonId(id, visible)` | 按 `threeJsonId` 显隐 |
| `updateInfoPanel(id, partial, { scene })` | **核心**：按 id 查 registry，合并 partial，原地 mutation 或载体不兼容时 redeploy |
| `updateInfoPanelContent(id, partial, { scene })` | 薄封装：仅内容字段 partial，内部委托 `updateInfoPanel` |
| `applyInfoPanelList(scene, list)` | 有 id 则 `updateInfoPanel`，无则 `deployInfoPanel` |
| `hideInfoPanelsByNames(names, visible)` | 按 `name` 批量显隐 |

设备面板域 API 见下文 [`domains/device`](#domainsdevice-设备面板) 与 [`devicePanelRuntime.js`](../../domains/device/devicePanelRuntime.js)。

## `domains/device` — 设备面板

设备 record（UPS、空调、机柜等 domain 条目）可通过三种方式绑定信息面板。运行时 **`devicePanelRef`** 为所绑定面板的 **`threeJsonId`** 唯一真源；deploy 后写入 `userData.objJson.devicePanelRef`。

```js
import {
  resolveDevicePanelBinding,
  resolveDevicePanelRef,
  resolveDevicePanelRefFromRoot,
  showDevicePanel,
  hideDevicePanel,
  bindDevicePanelTriggers,
  handleDevicePanelDblClick
} from "threejson"; // 或 businessDomains.device.*
```

### 三种定义方式（优先级 **ref > info > infoPanel**）

| 优先级 | 条件 | 行为 |
|--------|------|------|
| **1** | `devicePanelRef` 非空 | 引用已有面板的 `threeJsonId`；**不** subScene deploy 内嵌面板 |
| **2** | 无 ref，有 `info` 简写 | 生成 sprite 面板，默认 id `${device.threeJsonId}__infoPanel`，**回填 `devicePanelRef`** |
| **3** | 无 ref、无 info，有 `infoPanel` | 完整 descriptor，**回填 `devicePanelRef`**，subScene deploy |

方式 2/3 生成的面板 `name` 为 **`devicePanel`**（批量显隐键）；通用 `infoPanelList` 条目用 **`name: "infoPanel"`**；机柜门编号（`buildCabinetNumPanel`）用 **`name: "cabNumPanel"`**。

### `devicePanelRef` 写错：**仅 warn，不 fallback**

只要 JSON 上 **`devicePanelRef` 为非空字符串**，resolver **只走方式 1**，同 record 上的 `info` / `infoPanel` **一律忽略**。

若 ref 在 registry 中不存在：控制台 **`[device] devicePanelRef not found: …`** 告警；**不会** fallback 到同 record 的内嵌 `infoPanel` / `info`，**不会**自动 subScene deploy 内嵌面板。`showDevicePanel` 按 ref 查找，未命中则失败；请修正 ref 或 **删除 `devicePanelRef`** 以启用方式 2/3。

### 运行时 API

| API | 说明 |
|-----|------|
| `resolveDevicePanelBinding(record)` | 解析绑定；返回 `{ devicePanelRef, mode?, panelDescriptor? }` |
| `resolveDevicePanelRef(record)` | 读 `devicePanelRef` 或 binding 结果 |
| `resolveDevicePanelRefFromRoot(idOrRoot)` | 从设备根对象解析面板 id |
| `showDevicePanel` / `hideDevicePanel` | → `setInfoPanelVisibleByThreeJsonId(devicePanelRef, …)` |
| `updateDevicePanelContent` | → `updateInfoPanelContent` |
| `bindDevicePanelTriggers(scene, deviceRoot, options?)` | 低层兼容 API；新场景优先用 JSON 触发字段 + 事件机制派生 action |
| `bindDevicePanelKeyboardTriggers(scene, options?)` | 按 JSON 键盘字段绑定 keydown |
| `handleDevicePanelDblClick(scene, deviceRoot, options?)` | 低层兼容 API；双击设备面板显隐推荐交给 `panelShowTrigger` / `panelHideTrigger` |
| `resolveDevicePanelHostRoot(node)` | 从点击节点解析 device 域根或面板 host |
| `ensureDevicePanelDeployed(scene, hostRoot)` | 回填 `devicePanelRef` 并按需 deploy 内嵌面板 |

### 触发字段（写在设备 record 上）

**显式 opt-in**：仅当 record **写了** `panelShowTrigger` 和/或 `panelHideTrigger` 时，场景加载后才会派生 ELM 绑定；有 `infoPanel` 但未写上述字段 → **不**自动绑定 hover/mouseleave。

内嵌 `infoPanel.visible` 控制 **deploy 初始显隐**（与 [`infoPanelBuilder`](../../../core/builder/infoPanelBuilder.js) 一致：省略或 `true` → 显示；显式 `false` → 隐藏）。交互显隐由 trigger / `dismissTrigger` 负责；device 域 **不**派生 `object.ready` 改 visible。

| 字段 | 取值 | 默认（仅当字段省略时的解析回退；**不**触发自动绑定） |
|------|------|------|
| `panelShowTrigger` | `hover` \| `click` \| `dblclick` \| `none` | `hover` |
| `panelHideTrigger` | `mouseleave` \| `click` \| `dblclick` \| `panel.click` \| `panel.dblclick` \| `none` | `mouseleave` |
| `panelHideDelayMs` | number（hide=mouseleave 时） | `200` |
| `devicePanelKeyboardTrigger` | string（如 `"p"`、`"Escape"`，匹配 `keydown` 的 `event.key`，不区分大小写） | — |

`none` 表示该方向 **不绑定** 指针触发（显示/隐藏仅由宿主 API 或 JSON `visible` 控制）。`hover` / `mouseleave` 由 device 映射到 ELM 的 `pointerover` / `pointerout`；`panel.click` / `panel.dblclick` 表示点击面板自身隐藏。若内嵌 `infoPanel` 已显式配置 `dismissTrigger`，则 `dismissTrigger` 优先，避免重复绑定。内嵌面板在 **lazy deploy**（首次 show/toggle 才创建）时，`panelHideTrigger: panel.*` 会在 deploy 后补绑。

键盘触发由 **`bindDevicePanelKeyboardTriggers(scene, options?)`** 统一注册：扫描场景中配置了 `devicePanelKeyboardTrigger` 的设备 record，按下匹配键时 toggle 对应面板。

实现：[`domains/device/devicePanelResolver.js`](../../domains/device/devicePanelResolver.js)、[`devicePanelRuntime.js`](../../domains/device/devicePanelRuntime.js)、[`devicePanelActions.js`](../../domains/device/devicePanelActions.js)。

### `transModelByType(scene, type, opacity)`

批量设置指定类型模型透明度。

### `checkModelType(model, type)`

判断对象是否为指定 `objType`。

## `core/handler/objectRegistry.js`

导入路径：

```js
import {
  getObjectByThreeJsonId,
  getObjectByUuid,
  getObjectByRefName,
  getObjectsByName,
  rebuildObjectRegistryFromScene,
  setUserDataObjJson
} from "../core/handler/objectRegistry.js";
```

### `getObjectByThreeJsonId(id)`

按 `threeJsonId` 取回单个运行时对象。适合跨会话、最稳定的对象引用方式。

### `getObjectByUuid(uuid)`

按 Three.js 当前会话 `uuid` 取回单个对象。适合调试或临时引用，不适合作为持久 ID。

### `getObjectByRefName(refName)`

按 `refName` / `runtimeRef` / `ref` 取回单个对象。适合把场景对象当成“可编程对象名”来用。

### `getObjectsByName(name)`

按 `Object3D.name` 查找对象数组。由于 `name` 不保证唯一，因此返回数组而不是单值。

### `resolveObjectDisplayLabel(descriptor, options?)`

```js
import { resolveObjectDisplayLabel, resolveObjectDisplayLabelFromObject } from "threejson";
```

返回对象或场景描述符的**展示文案**：`label → name → threeJsonId → options.fallback`（默认 `"未命名"`）。**不参与** `getObjectsByName` 或显隐 API。

### 对象显隐（`core/handler/objectVisibility.js`）

```js
import {
  setObjectVisibleByThreeJsonId,
  setObjectsVisibleByName,
  setObjectsVisibleByNames,
  setObjectsVisibleByCustomBucket,
  setObjectsVisibleByCustomBuckets
} from "threejson";
```

- `setObjectsVisibleByName(name, visible, options?)` — 精确匹配 descriptor `name`，返回命中数量；默认 `applyToSubtree: true`（子树内带 `objJson` 的节点一并切换），传 `{ applyToSubtree: false }` 仅切换 registry 命中的根对象
- `setObjectsVisibleByNames(names, visible, options?)` — 多个 `name` 批量切换，选项同上
- 展示文案请读 `label`（`resolveObjectDisplayLabel`），不参与上述查询

### `rebuildObjectRegistryFromScene(scene, options?)`

从当前场景重新扫描并重建对象注册表。适合在外部手动插入对象、或怀疑注册表状态与场景不同步时做兜底刷新。

### `setUserDataObjJson(object, objJson)`

将描述符写入 `object.userData.objJson`，并**保留** `userData` 上其它键（避免覆盖如 `holeData` 等扩展字段）。

## `core/handler/objectDescriptorAttach.js`

- `setUserDataObjJson(object, objJson)`：写入 `userData.objJson` 并保留其它 `userData` 键。
- `attachDescriptorToObject(object, descriptor)`：在尚无 `objJson` 时挂载描述符引用。

（`objectRegistry.js` 仍 **re-export** 以上符号以保持兼容；新代码可直接从本模块导入。）

## `core/runtime/eventMechanism`

场景事件绑定与 EventScript 执行。完整用法与 DSL 语法见 [事件机制与 EventScript](./event-mechanism.md)。

### 导入示例

```js
import {
  bindSceneEventRuntime,
  disposeSceneEventRuntime,
  createEventListenerManager,
  createCoreBindingExecutor,
  parseEventScript,
  runEventScript,
  bindEventsFromScene,
  resolveEventScriptSource,
  resolveEventTarget,
  registerObjTypeEventCapabilities,
  PLATFORM_EVENT_NAMES
} from "threejson/core";
```

### `bindSceneEventRuntime(scene, ctx?)`

场景 load 且 `rebuildObjectRegistryFromScene` 之后调用。扫描 `userData.objJson.events`，注册 binding，并在存在 `scene.ready` 绑定时 dispatch 一次。

`ctx` 常用字段：`sceneJsonRoot`、`sceneToken`、`host`（ELM DOM 拾取）、`coreBindingExecutor`、`mutationOptions`。

返回 `{ sceneToken, manager, bindingIds, rebind(), dispose() }`。

### `createEventListenerManager(options?)`

- `options.host.canvas` / `document`：惰性挂载平台 DOM 监听。
- `options.host.resolvePickThreeJsonId(eventName, nativeEvent)`：canvas 点击拾取 `threeJsonId`（**无拾取则不 dispatch**）。
- `options.coreBindingExecutor`：默认 `createCoreBindingExecutor({ sceneConfig })`。

### `manager.dispatchPlatformEvent(threeJsonId, eventName, ctx?)`

手动触发平台事件。`ctx` 可含 `object`、`scene`、`sceneRuntime`、`nativeEvent`。

### `parseEventScript(source)` / `runEventScript(source, dispatchCtx, options?)`

解析或执行 EventScript DSL（测试、编辑器预览）。`dispatchCtx` 至少需 `object` 与 `threeJsonId`。

### `resolveEventTarget(token)`

按 `threeJsonId` → `refName` → `name` 解析单个 `Object3D`（供脚本 `$('token')` 与宿主 raycast 共用语义）。

## `core/handler/sceneRuntimeApi.js`

- `applyTransform(object, patch)`：`patch` 可含 `position` / `rotation` / `scale` / `visible` 子集，写入 `Object3D`。

## `core/handler/descriptorSync.js`

- `patchObjectDescriptor(object, partial, options?)`：浅合并到 `userData.objJson`，默认 `markDescriptorBindingJsonDirty`。
- `reconcileTransformToDescriptor(object, options?)`：从对象写回 `position` / `rotation` / `scale` 到描述符（与 box 系字段一致）。
- `scheduleThrottledReconcileTransform(object, { delayMs?, markBindingDirty? })`：Hybrid — 防抖合并 Object→JSON 写回（毫秒级，默认 `delayMs` 约 48）。
- `cancelThrottledReconcileTransform(object)`：取消待执行的防抖写回。

## `threejson/runtime-mutation`（`core/runtime/objectMutation/index.js`）

按 `threeJsonId` 对**已注册对象**做运行时变更（对象与 `userData.objJson` 同步）。也可从 `core/index.js` 聚合导入同名 API。

### 导入示例

```js
import {
  applyObjectChange,
  applyObjectChangeAsync,
  applyObjectPartial,
  applyObjectPartialAsync,
  captureObjectSnapshot,
  applyObjectSnapshot,
  applyObjectSnapshotAsync
} from "threejson/runtime-mutation";
```

### `applyObjectChange(threeJsonId, path, value, options?)`

对单一路径写值，默认 strict（中间键不存在即失败）。

| 选项 | 说明 |
|------|------|
| `createMissing?: boolean` | `true` 时允许自动创建中间对象链（默认 `false`） |
| `markBindingDirty?: boolean` | 默认 `true`，会触发 `markDescriptorBindingJsonDirty` |
| `scene?: Scene` + `autoRedeploy?: boolean` | 当变更被判定 `needsRedeploy=true` 时可自动调用 `redeployObject` |

返回值（同步）：

```js
{
  ok: boolean,
  error: string | null,
  threeJsonId: string,
  object3D: Object3D | null,
  descriptor: object | null,
  needsRedeploy: boolean,
  path: string,
  kind: "transform" | "name" | "visible" | "materialTexture" | "materialColor" | "material" | "structural" | "generic"
}
```

### `applyObjectChangeAsync(threeJsonId, path, value, options?)`

与 `applyObjectChange` 相同语义，但 `awaitTextures: true`，等待贴图下载完成后再返回。

### `applyObjectPartial(threeJsonId, partial, options?)`

浅合并顶层字段（如 `position` / `name` / `visible` / `material`），并立即同步对象。

- 同步版：发起贴图加载但不等待返回
- `applyObjectPartialAsync`：等待贴图加载完成后返回

### `captureObjectSnapshot(threeJsonId)`

返回该对象 `objJson` 的深拷贝（用于撤销栈或临时保护），找不到对象时返回 `null`。

### `applyObjectSnapshot(threeJsonId, snapshot, options?)`

把快照整段恢复为当前对象的 `userData.objJson`，并同步到 `Object3D`。

- 同步版：不等待贴图
- `applyObjectSnapshotAsync`：等待贴图完成

### `needsRedeploy` 语义

以下结构级字段变更会标记 `needsRedeploy: true`：

- `objType` / `boxType` / `geometry`
- `subScene` / `boxModelList` / `subGroup`（group 内 legacy 字段变更时通常需 redeploy）
- `joins` / `inters` / `holes`

典型用法：

```js
const res = applyObjectChange(id, "geometry.type", "sphere");
if (res.needsRedeploy) {
  redeployObject(scene, id);
}
```

## 运行时结构命令（`core/runtime/sceneObjectCommands.js`）

对场景做**增删**（非改属性）。详见 [runtime-object-commands.md](./runtime-object-commands.md)。

```js
import {
  addObjectFromDescriptor,
  addObjectFromDescriptorAsync,
  removeObjectById
} from "../core/index.js";
```

| API | 说明 |
|-----|------|
| `addObjectFromDescriptor(scene, descriptor, options?)` | 同步部署；慢类型可能 `needsAsync: true` |
| `addObjectFromDescriptorAsync(scene, descriptor, options?)` | 等待异步部署完成 |
| `removeObjectById(scene, threeJsonId, options?)` | 返回 `removedDescriptor`、`removedParentThreeJsonId`；可选 `captureSubtree` |

`options.parent`：`Scene` | `Object3D` | 父 `threeJsonId` 字符串。重复 id 拒绝。默认保护 camera/renderer 等，可用 `allowProtectedRemoval: true` 覆盖。

## `threejson/patch-core`（`core/handler/jsonPatchApplyCore.js`）

纯 JSON 上的白名单 Patch，**不**触发描述符绑定脏标记；适合单测或在上游自行处理 `markDescriptorBindingJsonDirty` 时使用。

- `applyJsonPatchToJsonDocument(doc, patch, options?)`

## `threejson/patch`（`core/handler/jsonPatchDescriptor.js`）

按需 `import { applyJsonPatchToObjectDescriptor } from "threejson/patch"`。对 `userData.objJson` 应用 RFC 6902 操作数组（支持 `add` / `replace` / `remove`），默认 **path 白名单** 见源码 `DEFAULT_ALLOWED_PREFIXES`。

## `core/handler/animationMixerRegistry.js`

- `tryRegisterGltfAnimationMixers(root, gltf, descriptor?)`：若 `gltf.animations` 非空则创建 `AnimationMixer` 并注册；**有 `animationGraph` 时走状态机**，否则 play all clips。
- `updateRegisteredAnimationMixers(scene, deltaSeconds?)`：由渲染循环在声明式动画之后调用（跳过状态机根节点）。
- `unregisterAnimationMixerForRoot(root)`：释放。

## `core/handler/animationStateMachine.js`

- `setAnimationParameter(rootOrThreeJsonId, name, value)`：设置 `animationGraph.parameters` 运行时值。
- `fireAnimationEvent(rootOrThreeJsonId, eventName)`：触发 `when.event` 条件（如自定义事件；内置 `clipFinished` 由引擎检测）。
- `updateAnimationStateMachines(scene, deltaSeconds)`：评估 transitions 并 `mixer.update`（帧循环在 `updateRegisteredAnimationMixers` 之前调用）。
- `getAnimationStateMachine(root)` / `isAnimationStateMachineRoot(root)`：查询。

## `core/cache/textureUrlCache.js`

- `configureTextureUrlCacheForDeploy(normalized)`：读取 `sceneConfig.extensions.assetLibrary.textureUrlCache`（默认关）。
- `isTextureUrlCacheEnabled()` / `clearTextureUrlCache()`。

## `core/util/textureSampling.js`

贴图采样合并（A/G/S/C）与 deploy 上下文：

- `configureTextureDefaultsForDeploy(normalized)`：读取 `sceneConfig.textureDefaults` 与 `sceneConfig.textureQuality`。
- `parseTextureQuality(value)`：解析档位 `0`–`3` 或 `off`/`low`/`medium`/`high`。
- `resolveTextureProps(profileName, record, ctx?)` / `applyTexturePropsFromRecord(texture, profileName, record, ctx?)`：合并并应用到 `THREE.Texture`。
- `syncTexturePropsToMap(map, record, profileName, ctx?)`：对已加载贴图热同步。
- `resolveEffectiveTextureSummary(profileName, record, ctx?)`：编辑器「当前生效」摘要。
- `getDeployTextureContext()`：当前 deploy 的 G/S 默认值。

## `core/builder/particle/particleProviderRegistry.js`

- `registerParticleEmitterProvider(providerId, deployer)`：extensions 注册第三方粒子适配器。
- `deployParticleEmitter` 在 `provider` 命中时走扩展；否则 `deployParticleEmitterCore`。

## `extensions/particle-nebula/`

- 示例：`import "threejson/extensions/particle-nebula"` + JSON `provider: "nebula"`。

## `core/plugin/pluginHost.js`

- `createPluginHost()`：返回 `register` / `init` / `dispose` / `beforeFrame` / `beforeRender` / `afterRender` / `beforePhysics` / `afterPhysics`。

## `core/handler/sceneLoadHandler.js` · `onSceneReady`

`createJsonScene(payload, options)` 在场景部署完成后可调用 `options.onSceneReady(ctx)`：

| 字段 | 说明 |
|------|------|
| `scene` / `camera` / `renderer` / `controls` / `renderLoop` | 与 runtime 一致 |
| `sceneJson` | 友好/兼容形态 `compatPayload` |
| `payload` | 标准 `objectList` 形态 |
| `worldInfo` / `sceneConfig` | 归一化后的配置 |
| `pluginHost` | 可选，由宿主传入 `options.pluginHost` |

用于扩展 bootstrap（如 Rapier）读取 JSON `extensions`，见 **[extensions.md](./extensions.md)** 与 [`lab/extension-json.md`](../../lab/extension-json.md)。

## `core/util/spatialQuery.js`

几何级查询（**非**物理引擎）。可从 `core/index.js` 导入。

| API | 用途 |
|-----|------|
| `setBox3FromObject` / `box3IntersectsBox3` | AABB |
| `collectObjectsWithObjJson` / `findAabbIntersections` | 与 `userData.objJson` 物体的粗相交 |
| `raycastScene` / `ndcToRay` | 射线拾取 |
| `computeMeshCenterRestYOnAabbFloor` | 按地板顶面估算物体中心 Y（简易重力等） |

`modelHandler.impactCheck` 内部使用 `findAabbIntersections`。

## `core/util/meshPick.js`

可选 `three-mesh-bvh` 加速拾取（**默认关闭**）：

- `shouldUseMeshBvhPick(sceneConfig, objJson)`
- `applyMeshBvhPickToScene(root, { sceneMeshBvh })`
- `raycastSceneWithPick({ useMeshBvh, scene, ... })`（异步）

开关见 [JSON 配置手册](./json-format.md) 中 `pick.meshBvh` / `pick.precision: "bvh"`。

## `core/util/extensionsUtil.js`

| API | 用途 |
|-----|------|
| `mergeExtensionMaps` | 合并场景/物体 `extensions` |
| `readExtensionConfig(record, extensionId)` | 读取物体扩展块 |
| `resolveSceneExtensions(sceneConfig, worldInfo)` | 场景级扩展 |

## sceneDescriptorBinding

实现文件：`core/handler/sceneDescriptorBinding.js`。

可选：**描述符变换**与 **Object3D** 的轻量双向同步（仅 `position` / `rotation` / `scale`）。默认不运行；需在 `worldInfo.descriptorBinding` 中配置并调用 `startDescriptorBinding(scene, worldInfo)`。完整字段、优先级与限制见 [JSON 配置手册](./json-format.md) 中的 **`descriptorBinding`** 小节。

- `startDescriptorBinding(scene, worldInfo?, options?)`：返回 `{ stop, flush }`。
- `markDescriptorBindingJsonDirty(id | descriptor)`：下一帧从 JSON 推变换到对象。
- `scheduleDescriptorBindingRebuild(scene, id | descriptor, { debounceMs? })`：实验性整对象重建（成本高）。
- `redeployObject(scene, descriptorOrId)`：立即按描述符重建（含 `subScene` 变更的 group / mesh 等）。
- `readDescriptorBindingConfig` / `isDescriptorBindingEnabled`：供测试或自定义调度复用。

与 `modelBuilder` 配套：`applyBoxModelTransformToObject3D`、`syncBoxModelTransformFromObject3D`。

导入路径：`../core/handler/sceneDescriptorBinding.js`（或 `../core/index.js` 聚合导出）。

## `core/util/textureUtils.js`

导入路径示例：`../core/util/textureUtils.js`。

### `createStrTextureMultiline(textureInfo)`

创建多行文字 canvas 纹理。信息面板内部会调用它，调用者一般不需要直接使用。

```js
{
  str: "Hello",
  width: 128,
  height: 64,
  fillStyle: "#ffffff",
  font: "16px Microsoft YaHei",
  textBaseline: "top"
}
```

## `core/cache/loading.js` 与 `core/handler/resourceReclaimer.js`

### `loadingManager`

项目统一的 ThreeJS `LoadingManager`，被部分纹理加载器使用。

### `openOrCloseProgressManager(flag)` / `checkComplete()`

用于控制和查询加载进度状态。当前 UI 展示逻辑较轻，适合作为后续页面进度条的接入点。

### `trackDisposableResource(resource)` / `disposeTrackedResources()`

资源追踪与统一释放工具。若直接使用引擎内部创建对象，很多资源会自动被追踪；如果调用者自己创建大量 ThreeJS 对象，也可以主动调用 `trackDisposableResource()`。

### `disposeTrackedSceneResources(scene)`

组合 API：先执行 `trackSceneResources(scene)`，再执行 `disposeTrackedResources()`。适合“一次性扫描并释放当前场景子树资源”的场景。

### `disposeByThreeJsonId(scene, threeJsonId, options?)` / `detachByThreeJsonId(...)`

按 `threeJsonId` 从场景删除对象。内部与命令层 `removeObjectById` 共用 [`core/handler/objectDeleteById.js`](../../core/handler/objectDeleteById.js) 的 `removeObjectByThreeJsonIdCore`，语义一致（含受保护对象拦截、`removedDescriptor`、`captureSubtree` 等）。

与 `removeObjectById` 的差异：回收路径**不会**调用 `markDescriptorBindingJsonDirty`；编辑/命令场景请使用 `removeObjectById`。

| 选项 | 说明 |
|------|------|
| `allowProtectedRemoval` | 为 `true` 时允许删除受保护运行时对象 |
| `detachOnly` / `disposeResources: false` | 仅 detach + unregister，不 dispose GPU 资源 |
| `captureSubtree` | 为 `true` 时返回子树内其它对象的 descriptor 快照 |

## 常见注意事项

- 大多数创建方法不做深度校验，JSON 字段缺失时会使用默认值或直接返回。
- `deploy*` 方法会直接 `scene.add()`；`create*` 方法只返回对象。
- 多数对象会把原始 JSON 写到 `userData.objJson`（与 `userData` 上其它键并存；构造路径见 `setUserDataObjJson`）。
- 纹理、OBJ、GLTF 加载是异步的；如果后续逻辑依赖加载完成，需要自行监听或轮询。
- HTML 信息面板依赖 `html2canvas`，复杂 DOM 或跨域图片可能导致截图失败。
