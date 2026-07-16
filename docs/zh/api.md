[中文](./api.md) | [English](../en/api.md)

# ThreeJSON API 文档

本文面向在应用中集成 ThreeJSON 的开发者。这里的示例假设你已经通过 npm、CDN import map 或构建工具引入了 ThreeJSON。

用户项目应使用公开导入入口：

```js
import { createJsonScene } from "threejson";
import { deployJsonObjectAsync } from "threejson/core";
import { applyObjectPartial } from "threejson/runtime-mutation";
```

不要引用仓库内部相对路径，例如 `../core/index.js`、`./handler/xxx.js`。这些路径属于源码组织方式，不是应用层契约。

## 1. 导入入口

| 入口 | 用途 |
| --- | --- |
| `threejson` | 推荐主入口。注册内置 domain，并重新导出 core 公共 API。 |
| `threejson/core` | 纯 core 公共 API。适合只使用运行时、加载、导出、变更能力。 |
| `threejson/builtins` 或 `threejson/builtins/register` | 只注册内置 domain，不额外书写业务代码。 |
| `threejson/domains/<name>` | 按需加载某个 domain，例如 `threejson/domains/device`。 |
| `threejson/extensions/<name>` | 按需加载扩展。 |
| `threejson/runtime-mutation` | 对已部署对象做增量修改。主入口和 core 也会导出这些 API。 |
| `threejson/patch` | JSON 描述符补丁工具。 |
| `threejson/patch-core` | 更底层的补丁执行工具。 |

主入口示例：

```js
import { createJsonScene, sceneToFriendlyJson } from "threejson";
```

core 入口示例：

```js
import {
  createJsonScene,
  deployJsonObjectAsync,
  getObjectByThreeJsonId
} from "threejson/core";
```

## 2. 创建场景

### `createJsonScene(payload, options)`

最常用的加载 API。它会根据 JSON 创建 Three.js `Scene`、`Camera`、`WebGLRenderer`、控制器、灯光、对象、事件运行时和渲染循环。

```js
import { createJsonScene } from "threejson";

const runtime = await createJsonScene(sceneJson, {
  canvas: document.querySelector("#stage"),
  resetScene: true,
  assetsBaseMode: "cdn-first"
});

runtime.start();
```

常用 `options`：

| 字段 | 说明 |
| --- | --- |
| `canvas` | 用于创建 `WebGLRenderer` 的 `HTMLCanvasElement`。 |
| `resetScene` | 重新加载时是否清理旧场景对象。 |
| `assetsBase` | 资源基址，例如 `/assets` 或 CDN 地址。 |
| `assetsBaseMode` | 资源解析策略，常用 `base-first`、`cdn-first`、`local-first`。 |
| `onProgress` / `onDeployProgress` | 接收加载或部署进度。 |
| `onWarning` | 接收非致命警告。 |
| `beforeFrame` / `beforeRender` / `afterRender` | 挂接渲染循环。 |

返回的 `runtime` 常用字段：

| 字段 | 说明 |
| --- | --- |
| `scene` | Three.js `Scene`。 |
| `camera` | 当前相机。 |
| `renderer` | `WebGLRenderer`。 |
| `controls` | 当前控制器，通常是 OrbitControls 或兼容控制器。 |
| `renderLoop` | 渲染循环对象。 |
| `start()` | 启动渲染循环。 |
| `stop()` | 停止渲染循环。 |
| `resize(size?)` | 调整渲染尺寸。 |
| `dispose()` | 清理控制器、渲染器、背景、事件和对象资源。 |

页面销毁时必须调用 `dispose()`：

```js
window.addEventListener("beforeunload", () => runtime.dispose());
```

### `createJsonSceneFit(payload, options)`

与 `createJsonScene` 类似，但默认启用更适合示例和播放器的尺寸适配配置。

```js
import { createJsonSceneFit } from "threejson/core";

const runtime = await createJsonSceneFit(sceneJson, { canvas });
runtime.start();
```

### `createJsonSceneFromInput(input, options)`

接受对象、JSON 字符串、Blob、ArrayBuffer 或 ThreeJSON 归档输入，适合“打开文件/打开归档”场景。普通 JSON URL 请先由应用 `fetch()` 后再传入对象或文本。

```js
import { createJsonSceneFromInput } from "threejson/core";

const payload = await fetch("/assets/json/demo.json").then((res) => res.json());
const runtime = await createJsonSceneFromInput(payload, {
  canvas,
  assetsBaseMode: "cdn-first"
});
runtime.start();
```

### `createJsonSceneSimple(payload, options)`

同步简化加载路径。适合完全同步、无异步背景/模型/纹理等待的简单场景。实际业务中通常优先用 `createJsonScene`。

## 3. 只创建运行时

### `createSceneRuntime(options)`

只创建 Scene、Camera、Renderer、Controls、Lights 和 RenderLoop，不部署 ThreeJSON 对象。

```js
import { createSceneRuntime } from "threejson/core";

const runtime = createSceneRuntime({
  canvas,
  config: {
    scene: { background: "#11151b" },
    camera: { position: { x: 8, y: 6, z: 10 }, fov: 55 },
    controls: { enableDamping: true },
    lights: [{ type: "ambient", intensity: 1 }]
  }
});

runtime.start();
```

当你希望自己控制对象创建，只借用 ThreeJSON 的运行时骨架时使用它。

## 4. 部署对象

### `createJsonObject(record, options)`

根据单个对象 JSON 创建 `Object3D`，但不自动加入场景。

```js
import { createJsonObject } from "threejson/core";

const mesh = createJsonObject({
  threeJsonId: "box-1",
  objType: "box",
  geometry: { width: 2, height: 2, depth: 2 },
  material: { color: "#5470c6" }
});

scene.add(mesh);
```

### `deployJsonObject(target, record, options)`

创建对象并添加到目标。`target` 可以是 `THREE.Scene`、`THREE.Group` 或包含 `scene` 的运行时对象。

```js
import { deployJsonObjectAsync } from "threejson/core";

await deployJsonObjectAsync(runtime.scene, {
  threeJsonId: "sphere-1",
  objType: "sphere",
  geometry: { radius: 1.2, widthSegments: 32, heightSegments: 16 },
  position: { x: 3, y: 1.2, z: 0 },
  material: { type: "standard", color: "#73c0de" }
});
```

优先选择异步版本：

| API | 说明 |
| --- | --- |
| `createJsonObject(record, options)` | 创建单个对象。 |
| `createJsonObjectBatch(records, options)` | 创建对象数组。 |
| `createJsonObjectAuto(input, options)` | 自动判断单个或数组。 |
| `deployJsonObject(target, record, options)` | 同步部署单个对象。 |
| `deployJsonObjectAsync(target, record, options)` | 异步部署单个对象，适合纹理、模型等资源。 |
| `deployJsonObjectBatchAsync(target, records, options)` | 异步部署对象数组。 |
| `deployJsonObjectAutoAsync(target, input, options)` | 自动判断单个或数组并异步部署。 |

## 5. 增量修改已部署对象

运行时对象会通过 `threeJsonId` 建立索引。对象部署后，可以用 `runtime-mutation` API 修改对象和其 JSON 描述符。

```js
import { applyObjectPartial } from "threejson/runtime-mutation";

applyObjectPartial("box-1", {
  position: { x: 2, y: 1.5, z: 0 },
  material: { color: "#91cc75" }
});
```

常用 API：

| API | 说明 |
| --- | --- |
| `applyObjectPartial(threeJsonId, partial, options)` | 合并局部字段。 |
| `applyObjectPartialAsync(threeJsonId, partial, options)` | 异步局部修改，适合纹理等资源。 |
| `applyObjectChange(threeJsonId, path, value, options)` | 修改单个路径，例如 `"material.color"`。 |
| `applyObjectChangeAsync(threeJsonId, path, value, options)` | 异步路径修改。 |
| `captureObjectSnapshot(threeJsonId)` | 捕获对象快照，用于撤销等场景。 |
| `applyObjectSnapshot(threeJsonId, snapshot, options)` | 恢复快照。 |
| `getObjectField(threeJsonId, path)` | 读取对象描述符字段。 |

部分字段可以直接同步到 Three.js 对象，例如 `position`、`rotation`、`scale`、`visible`、常见材质字段。会改变几何、模型结构或对象类型的修改通常需要重新部署。可传入：

```js
applyObjectPartial("box-1", patch, {
  scene: runtime.scene,
  autoRedeploy: true
});
```

## 6. 添加和删除场景对象

```js
import {
  addObjectFromDescriptor,
  addObjectFromDescriptorAsync,
  removeObjectById
} from "threejson/core";

await addObjectFromDescriptorAsync(runtime.scene, {
  threeJsonId: "box-2",
  objType: "box",
  geometry: { width: 1, height: 1, depth: 1 },
  position: { x: -3, y: 0.5, z: 0 },
  material: { color: "#fac858" }
});

removeObjectById(runtime.scene, "box-2");
```

这些 API 会维护 ThreeJSON 对象索引和描述符绑定，比直接 `scene.add()` / `scene.remove()` 更适合编辑器、播放器和交互应用。

## 7. 查询对象

```js
import {
  getObjectByThreeJsonId,
  getObjectByUuid,
  getObjectByRefName,
  getObjectsByName,
  resolveObjectDisplayLabel
} from "threejson/core";

const box = getObjectByThreeJsonId("box-1");
const label = resolveObjectDisplayLabel(box?.userData?.objJson);
```

常用查询：

| API | 说明 |
| --- | --- |
| `getObjectByThreeJsonId(id)` | 按 ThreeJSON 稳定 ID 查找。 |
| `getObjectByUuid(uuid)` | 按 Three.js UUID 查找。 |
| `getObjectByRefName(refName)` | 按 `refName` 查找。 |
| `getObjectsByName(name)` | 按 Three.js `name` 查找多个对象。 |
| `rebuildObjectRegistryFromScene(scene)` | 从场景重建索引。 |

可见性 API：

```js
import { setObjectVisibleByThreeJsonId } from "threejson/core";

setObjectVisibleByThreeJsonId("box-1", false);
```

## 8. JSON 格式转换与导出

ThreeJSON 支持标准 JSON 和友好 JSON 的互转。

```js
import {
  sceneToStandardJson,
  sceneToFriendlyJson,
  rebuildStandardJson,
  rebuildFriendlyJson,
  normalizeScenePayload,
  buildFriendlyScenePayloadFromCanonical
} from "threejson/core";

const standardFromScene = await sceneToStandardJson(runtime.scene);
const friendlyFromScene = await sceneToFriendlyJson(runtime.scene);

const normalized = normalizeScenePayload(inputPayload);
const friendlyFromPayload = buildFriendlyScenePayloadFromCanonical(
  inputPayload,
  normalized
);
```

常用 API：

| API | 说明 |
| --- | --- |
| `sceneToJson(scene)` | 从当前场景导出 JSON。 |
| `sceneToStandardJson(scene)` | 从当前场景导出标准 `objectList` 格式。 |
| `sceneToFriendlyJson(scene)` | 从当前场景导出 `worldInfo` 友好格式。 |
| `rebuildStandardJson(scene)` | 从当前场景重新构建标准 JSON。 |
| `rebuildFriendlyJson(scene)` | 从当前场景重新构建友好 JSON。 |
| `normalizeScenePayload(payload)` | 将输入 payload 归一化为加载器使用的标准结构。 |
| `buildFriendlyScenePayloadFromCanonical(source, canonical)` | 把标准结构整理为友好 JSON。 |
| `collectObjectListFromScene(scene)` | 从场景收集对象记录。 |

三方模型导出：

```js
import { exportMesh, SUPPORTED_MESH_FORMATS } from "threejson/core";

const result = await exportMesh(runtime.scene, { format: "glb" });
const blob = result.data;
```

支持格式以 `SUPPORTED_MESH_FORMATS` 为准。导出器通常需要浏览器环境和对应 Three.js exporter 能力。GLB/GLTF/USDZ 导出前会准备仍在异步加载的在线纹理；无法跨域读取或解码的纹理默认仅从导出副本中省略，并通过 `result.warnings` 报告，不会修改实时场景。传入 `textureFailurePolicy: "error"` 可改为严格失败。

## 9. 资源路径

```js
import {
  setAssetsBaseUrl,
  setAssetsBaseMode,
  assetUrl,
  DEFAULT_CDN_ASSETS_BASE
} from "threejson/core";

setAssetsBaseUrl("/assets");
setAssetsBaseMode("base-first");

const url = assetUrl("textures/environment/skybox/port360.webp");
```

常用字段和 API：

| 名称 | 说明 |
| --- | --- |
| `assetsBase` | 当前加载任务的资源基址。可放在 `createJsonScene` options 或 `sceneConfig`。 |
| `assetsBaseMode` | 资源查找策略。 |
| `setAssetsBaseUrl(url)` | 设置全局资源基址。 |
| `setAssetsBaseMode(mode)` | 设置全局资源模式。 |
| `assetUrl(path)` | 根据当前资源基址拼出资源 URL。 |
| `resolvePublicAssetUrl(url)` | 解析 JSON 中的公开资源路径。 |
| `DEFAULT_CDN_ASSETS_BASE` | `@threejson/assets` 的默认 CDN 基址。 |

可用模式：

| 模式 | 说明 |
| --- | --- |
| `base-first` | 优先使用当前 `assetsBase`。 |
| `cdn-first` | 优先使用 `@threejson/assets` CDN。 |
| `local-first` | 优先使用 `/assets`。 |
| `base-only` | 只使用当前 `assetsBase`。 |
| `cdn-only` | 只使用 CDN。 |
| `local-only` | 只使用 `/assets`。 |

## 10. 事件机制

ThreeJSON 可以从 JSON 绑定场景事件，也可以由应用手动触发事件管理器。

```js
import { bindSceneEventRuntime, disposeSceneEventRuntime } from "threejson/core";

const eventRuntime = bindSceneEventRuntime(runtime.scene, {
  camera: runtime.camera,
  renderer: runtime.renderer,
  controls: runtime.controls
});

// 页面销毁时
disposeSceneEventRuntime(runtime.scene);
```

事件 JSON 写法见 [JSON 配置](./json-format.md#事件与脚本)。

低层脚本工具：

```js
import { parseEventScript, runEventScript } from "threejson/core";
```

应用一般不需要直接调用低层脚本 API，除非你在写编辑器、播放器或自定义交互系统。

## 11. domain 与扩展

内置主入口会注册 `builtins`：

```js
import { createJsonScene } from "threejson";
```

如果你只从 `threejson/core` 导入，又需要某个 domain，请显式导入注册模块：

```js
import "threejson/builtins/register";
import { createJsonScene } from "threejson/core";
```

按需 domain：

```js
import "threejson/domains/device";
import "threejson/domains/nature";
```

扩展示例：

```js
import "threejson/extensions/particle-nebula";
```

domain JSON 通常使用：

```json
{
  "threeJsonId": "cabinet-1",
  "objType": "domain",
  "domain": "device.cabinet",
  "position": { "x": 0, "y": 0, "z": 0 },
  "businessInfo": {
    "label": "A01"
  }
}
```

## 12. 纹理采样与缓存

纹理默认值可在加载前配置：

```js
import {
  configureTextureDefaultsForDeploy,
  configureTextureUrlCacheForDeploy
} from "threejson/core";

configureTextureDefaultsForDeploy({
  quality: "balanced",
  anisotropy: 4
});

configureTextureUrlCacheForDeploy({
  enabled: true
});
```

对象材质中也可以写入采样字段，详见 [JSON 配置](./json-format.md#材质与纹理)。

## 13. 日志与调试

```js
import { configureLogger } from "threejson/core";

configureLogger({
  debug: true,
  prefix: "[ThreeJSON]"
});
```

调试建议：

- 加载失败先检查资源 URL，特别是 GitHub Pages 的项目路径。
- 对象无法查询时，确认 JSON 中存在稳定的 `threeJsonId`。
- 修改对象后没有变化时，确认该字段是否支持增量同步；必要时使用 `autoRedeploy`。
- 用户侧代码优先依赖公开入口，不依赖源码目录结构。
