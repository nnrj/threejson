# JSON 配置手册

[中文](./json-format.md) | [English](./en/json-format.md)

ThreeJSON 现在明确支持两种并列输入：

- 人类友好 JSON：`sceneConfig + typed lists + friendlyMap`
- 标准 JSON：`sceneConfig + objectList + 顶层元信息（含 threeJsonId）`

二者没有先进落后之分，只是 authoring 体验不同。无论输入哪一种，统一加载入口都会先把它翻译为标准 `objectList`，再按 `objType` 分阶段解析。

多数对象记录都包含 `name`、`objType`、`geometry`、`position`、`rotation`、`scale`、`material` 这些字段。

## 人类友好 JSON

推荐给人类作者、业务 JSON 编辑和大型场景手工维护使用。

```json
{
  "version": "next",
  "name": "friendly-scene",
  "threeJsonId": "friendly-scene-doc-id",
  "friendlyMap": {
    "wallList": {
      "objType": "wall",
      "defaults": {
        "material": {
          "type": "standard"
        }
      }
    }
  },
  "sceneConfig": {
    "scene": { "background": "#222222" },
    "camera": { "fov": 60, "position": { "x": 230, "y": 180, "z": 260 } },
    "renderer": { "antialias": true, "ratioRate": 1 },
    "controls": { "enableDamping": true, "target": { "x": 0, "y": 40, "z": 0 } },
    "lights": [
      { "type": "ambient", "color": "#ffffff", "intensity": 0.45 }
    ],
    "renderLoop": { "autoResize": true, "firstAutoResize": true }
  },
  "worldInfo": {
    "boxModelList": [
      {
        "name": "main-box",
        "objType": "box",
        "geometry": { "width": 80, "height": 80, "depth": 80 },
        "position": { "x": -70, "y": 40, "z": 0 },
        "material": { "type": "standard", "color": "#409eff" }
      }
    ],
    "wallList": [
      {
        "name": "custom-wall",
        "geometry": { "width": 60, "height": 90, "depth": 20 },
        "position": { "x": 60, "y": 45, "z": 0 },
        "material": { "color": "#67c23a" }
      }
    ],
    "infoPanelList": [
      {
        "text": "hello friendly json",
        "type": "text",
        "panelBoxType": "sprite"
      }
    ]
  }
}
```

### `sceneConfig.scene`：`background` 与 `environment`

`sceneConfig.scene`（以及标准 `objectList` 里 `objType: "scene"` 剥离后的字段）支持：

- **纯色（兼容旧版）**：`"background": "#222222"` 或任意 `THREE.Color` 可解析字符串。
- **显式纯色对象**：`{ "type": "color", "value": "#222222" }`。
- **等距柱状全景（LDR）**：`{ "type": "equirect", "url": "sky.jpg", "path": "", "resourcePath": "", "crossOrigin": "anonymous", "colorSpace": "srgb" }`  
  `path` / `resourcePath` / `crossOrigin` 与 `nativeObjectLoader` 语义一致；`colorSpace` 可选，默认按 sRGB 处理 LDR 贴图。
- **立方体天空**：`type: "cube"`  
  - **`layout` 缺省或 `"faces"`**：`"urls": [px, nx, py, ny, pz, nz]` 共 6 条，顺序为 **+X -X +Y -Y +Z -Z**（与 `THREE.CubeTextureLoader` 一致）。  
  - **`layout": "cross-h"`**（或 `cross-horizontal`）：单张 **4×3 宫格** 横向 cross，面片布局如下（`o` 为空，`+Y` 等为面名）：

```
  o  +Y  o  o
 -X +Z +X -Z
  o  -Y  o  o
```

  - **`layout": "strip-h"`**：一行 **6** 个等宽面，顺序 **+X -X +Y -Y +Z -Z**。  
  - **`layout": "strip-v"`**：一列 **6** 个等高面，顺序同上（自上而下）。

- **IBL 环境贴图（HDR + PMREM）**：`"environment": { "type": "equirect-hdr", "url": "env.hdr", "path": "", "resourcePath": "" }`  
  需要 **`WebGLRenderer`**（`createJsonScene` 带 `canvas` 或 `createSceneRuntime` / `createSceneRuntimeAsync`）。无 renderer 时（仅 `THREE.Scene` 的 headless 部署）会跳过并 `console.warn`。实现使用 `RGBELoader`（`three/examples/jsm`）与 `PMREMGenerator`（`three` 主包导出）。

若同时存在 `worldInfo.sceneInfoList` 嵌套原生 `Scene` 与上述声明式字段：**`sceneConfig.scene` 中若出现 `background` / `environment` 键，则覆盖**从原生 Scene 拆出的对应属性；若希望保留原生里的贴图背景，请不要在 JSON 里再写这两个键。

**运行时 API**：`createSceneRuntime` 仅同步处理 **字符串 / `type:color`** 背景；含 `equirect` / `cube` / `environment` 时请使用 **`createSceneRuntimeAsync`**（`await`），由内部在 `renderer` 就绪后加载资源。`dispose()` 会释放本模块托管的贴图与 PMREM。

### 默认分组列表

- runtime：`sceneConfig`
- 主对象：`boxModelList`、`sphereModelList`、`groupList`
- 叠加/标注：`lineList`、`infoPanelList`、`audioList`
- 特效：`heatList`、`windList`、`shaderSurfaceList`
- 导入：`externalModelList`、`objModelList`
- 业务域：`domainModelList`
- 混合逃生口：`modelList` / `objectList`

### 哪些列表可省略 per-item `objType`

- 通常可省略：`sphereModelList`、`groupList`、`lineList`、`infoPanelList`、`heatList`、`windList`、`shaderSurfaceList`、`audioList`、`externalModelList`、`objModelList`、`domainModelList`
- 通常仍建议显式写：`boxModelList`、`modelList`、`objectList`

说明：

- `boxModelList` 仍然过载，既可能是普通盒体，也可能通过几何特征推成球体/圆柱，或被 domain 识别为业务对象，所以不要承诺它“天然免写 `objType`”。
- `modelList` / `objectList` 在友好 JSON 中属于混合列表，通常需要 per-item `objType` 才可读、可控。
- 页面 UI、告警演示等业务数据（如 `alarmList`、`leftPanelShow`）**不应**写入场景 JSON；由宿主页面配置或运行时 API 处理。

### `assetLibrary` 与 `lib://` 资源引用

场景级资源库，供 deploy 时填充 `assetRegistry`。读取顺序与 [`sceneLoadHandler`](../core/handler/sceneLoadHandler.js) 一致：优先标准顶层 **`assetLibrary`**，否则 **`worldInfo.assetLibrary`**。

| `assetKind` | 引用方式 | deploy 行为 |
|-------------|----------|-------------|
| **`texture`** | `material.textureUrl: "lib://tex-id"` | 解析 URL，各 mesh **独立** Texture 实例 |
| **`geometryPreset`** | `geometryRef: "lib://geom-id"` + 可选 `geometryOverrides` | 展开为内联 `geometry`；默认 **clone**（`sharePolicy.geometry: "shared"` 可共用实例） |
| **`materialPreset`** | `materialRef: "lib://mat-id"` + 可选 `materialOverrides` | 展开为内联 `material`；默认 **clone** |
| **`shaderSource`** | `ShaderMaterial.vertexShader/fragmentShader: "lib://shader-id"` | 仅支持库内内联 `source/code/text/value`；URL 源在 sync native 路径不会拉取 |

```json
{
  "assetLibrary": [
    {
      "threeJsonId": "geom-rounded-box",
      "assetKind": "geometryPreset",
      "geometry": {
        "type": "RoundedBoxGeometry",
        "width": 2, "height": 1, "depth": 1, "radius": 0.1, "segments": 4
      }
    },
    {
      "threeJsonId": "mat-chrome",
      "assetKind": "materialPreset",
      "material": {
        "type": "MeshStandardMaterial",
        "color": "#cccccc",
        "metalness": 0.9,
        "roughness": 0.15
      }
    },
    {
      "threeJsonId": "tex-wood-floor",
      "assetKind": "texture",
      "url": "/assets/textures/wood.webp"
    }
  ],
  "objectList": [
    {
      "objType": "pedestal",
      "geometryRef": "lib://geom-rounded-box",
      "geometryOverrides": { "width": 3 },
      "materialRef": "lib://mat-chrome",
      "sharePolicy": { "geometry": "clone", "material": "clone" }
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `threeJsonId` | 库内唯一 id（`lib://` 后缀）；可与旧字段 `id` 二选一写入 |
| `assetKind` | `texture` / `geometryPreset` / `materialPreset` / `shaderSource` |
| `name` | 可选；`lib://{name}` 在 id 未命中时匹配**首条**同名条目 |
| `url` / `textureUrl` / `src` | texture 条目的贴图路径 |

材质 JSON 中 **`textureUrl`** 可为普通路径或 `lib://tex-wood-floor`；解析由 [`resolveTextureSource`](../core/util/resolveTextureSource.js) 完成。未命中库条目时 `console.warn`。

### 纹理采样 textureQuality

贴图加载后，引擎按 **A → G → S → C** 顺序合并采样参数（显式 opt-out 时跳过 A/G/S）：

| 层 | 字段 | 说明 |
|----|------|------|
| **A** | （无 JSON） | 代码路径 preset：`ui`（Canvas/文字）与 `imageMap`（普通贴图）零配置默认 |
| **G** | `sceneConfig.textureDefaults.ui` / `.imageMap` | 场景级覆盖 A |
| **S** | `sceneConfig.textureQuality`、材质/`infoPanel` 的 `textureQuality` | 档位 `0`–`3`（也接受 `off`/`low`/`medium`/`high`）；`0` 或 `textureSampling: false` 为 opt-out |
| **C** | `generateMipmaps`、`minFilter`、`magFilter`、`anisotropy`、`colorSpace` | 显式字段，优先于 S |

导出时 opt-out 规范化为 **`textureQuality: 0`**（不再写冗余 `textureSampling: false`）。教程见 [`02-11-texture-sampling-toggle`](../assets/json/tutorial/track-02/02-11-texture-sampling-toggle.json)。

```json
{
  "sceneConfig": {
    "textureQuality": 2,
    "textureDefaults": {
      "imageMap": { "anisotropy": 4 }
    }
  },
  "objectList": [{
    "material": {
      "textureUrl": "/assets/textures/building/floor/wood_floor.webp",
      "textureQuality": 3,
      "anisotropy": 8
    }
  }]
}
```

运行时可通过 `applyObjectChange(id, "material.textureQuality", 3, { createMissing: true })` 热更新采样（见 [`objectMutation`](../core/runtime/objectMutation/index.js)）。

**可选 `textureUrl` 级缓存（Phase 4，默认关）**：在 `sceneConfig.extensions.assetLibrary` 中设 `textureUrlCache: true` 时，同 URL 的**静态 image 贴图**在首次加载后缓存；后续命中返回 `texture.clone()`（各 mesh 可独立 `textureRepeat`，避免重复网络解码）。`video` / `gif` 不参与缓存。`resetScene` deploy 时随 `assetRegistry` 一并清空。

```json
{
  "sceneConfig": {
    "extensions": {
      "assetLibrary": { "textureUrlCache": true },
      "nativeGeometries": ["RoundedBoxGeometry"]
    }
  }
}
```

jsm 几何（如 `RoundedBoxGeometry`）需在 `sceneConfig.extensions.nativeGeometries` 列出，deploy 前按需 `ObjectLoader.registerGeometry`；register 失败时 **跳过该对象**，不阻断整场景。教程见 `assets/json/tutorial/track-01/01-07-jsm-geometries.json`。

`ShaderMaterial` 可直接写 `vertexShader` / `fragmentShader`，或写成 `lib://` 指向 `assetKind: "shaderSource"` 资产。示例：

```json
{
  "assetLibrary": [
    { "threeJsonId": "shader-vs-wave", "assetKind": "shaderSource", "source": "void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}" },
    { "threeJsonId": "shader-fs-wave", "assetKind": "shaderSource", "source": "void main(){gl_FragColor=vec4(0.2,0.7,1.0,1.0);}" }
  ],
  "objectList": [
    {
      "objType": "native",
      "geometry": { "type": "PlaneGeometry", "width": 4, "height": 4 },
      "material": {
        "type": "ShaderMaterial",
        "vertexShader": "lib://shader-vs-wave",
        "fragmentShader": "lib://shader-fs-wave"
      }
    }
  ]
}
```

### `descriptorBinding`（描述符与对象变换同步）

可选。用于在**已加载**的场景上，把带 `userData.objJson` 的对象与描述符中的 **`position` / `rotation` / `scale`** 做轻量同步（Tier 1）。**默认关闭**：未配置 `worldInfo.descriptorBinding` 且各列表项也未声明 `descriptorBinding` 时，不会启动任何监视循环。

在页面中于场景与 `worldInfo` 就绪后调用（从 `../core/index.js` 或 `../core/handler/sceneDescriptorBinding.js` 导入）：

```js
import { startDescriptorBinding } from "../core/index.js";
const handle = startDescriptorBinding(scene, worldInfo);
// …卸载场景时：handle.stop();
```

**配置位置**：`worldInfo.descriptorBinding`（对象）。**单条描述符**上可选 `descriptorBinding`：`true`、`false`，或 `{ "enabled": true }`。

**是否对某对象启用**（从高到低，命中即停）：

1. 该对象对应描述符上的 `descriptorBinding`（若存在）。
2. `descriptorBinding.byId` 中是否包含该对象的 `threeJsonId` 键，值为布尔。
3. `descriptorBinding.byIds` 字符串数组是否包含该 `threeJsonId`（表示开启）。
4. `descriptorBinding.byName` 中是否包含名称键（见下），值为布尔。
5. `descriptorBinding.byNames` 字符串数组是否包含该名称（表示开启）。
6. `descriptorBinding.enabled` 全局布尔（`true` 时对**尚未被前面规则否掉**且带 `objJson` 的对象生效；仅想白名单时请配合 `byId` / `byIds` / `byName` / `byNames`）。
7. 否则关闭。

**名称键**：`Object3D.name` 优先，否则描述符的 `name`（不解析 `refName`，以免与 id 规则重叠）。

**`worldInfo.descriptorBinding` 常用字段**：

| 字段 | 说明 |
|------|------|
| `enabled` | 全局默认是否参与绑定（默认 `false` 行为：未写或为 `false` 时，除非被 `byId` / `byIds` / `byName` / `byNames` 或单条 `descriptorBinding` 打开）。 |
| `byId` / `byIds` / `byName` / `byNames` | 见上优先级。 |
| `objectToJsonFromTransform` | 是否把对象变换写回描述符，默认 `true`。 |
| `jsonToObjectFromTransform` | 是否把描述符变换应用到对象，默认 `true`。二者同时为 `true` 时，用上一帧与当前帧的签名判断是「仅 JSON 变」「仅对象变」或冲突；冲突时由 `transformConflictResolution` 决定（`"object"` 默认，或 `"json"`）。 |
| `objectToJsonIntervalMs` | 大于 0 时，按该间隔节流同步（毫秒）；`0` 表示跟随 `requestAnimationFrame`（仍只处理启用绑定的对象）。 |
| `fullRebuildDebounceMs` | 供 `scheduleDescriptorBindingRebuild` 默认防抖（毫秒）。 |
| **Hybrid（编程侧）** | 若在编辑器/脚本中高频改 `Object3D`，可调用 `descriptorSync.scheduleThrottledReconcileTransform(object, { delayMs })`，将写回 `objJson` 合并为防抖一次（与上表 `objectToJsonIntervalMs` 为不同层：后者为绑定循环帧率节流）。 |

**Tier 3（整对象重建）**：仅适用于能通过 `deployMesh` 或 `createGroup` 从**同一条**描述符再次创建的对象；会 dispose 旧几何/材质，**成本高**且并非所有 `objType` 都覆盖。由 `scheduleDescriptorBindingRebuild(scene, descriptorOrId, { debounceMs })` 触发；也可调用 `redeployObject`。

**其它 API**：`markDescriptorBindingJsonDirty(id)` 强制下一帧从 JSON 推变换到对象。详见 [核心 API](./api.md#sceneDescriptorBinding)。

## 对象身份与命名

| 字段 | 唯一性 | 职责 |
|------|--------|------|
| `threeJsonId` | 唯一 | 持久主键 |
| `refName` | 唯一可选 | 编程别名 |
| `name` | **可重复** | 批量识别键；`Object3D.name`；`getObjectsVisibleByName` **全字精确匹配** |
| `label` | 可重复 | 展示文案（**对象与场景根**均可有） |
| `customBucket` | 可重复 | 分层批量（与 `name` 并存） |
| `businessInfo` | 用户定义 | 随 `objJson` 透传；core **不解析、不写入** |
| `sourceObjType` | core 元数据 | 仅 `enableDefaultModel` 回落时由 core 写入原 `objType`；禁止手写 |

**展示链**（仅 UI / 日志）：`label → name → threeJsonId → "未命名"`。批量 API **只认 `name`**，不回退 `label`。

`room-wall`、`air-conditioning` 等 kebab-case 仅为迁移/文档约定；core **不**校验格式、**不**解析层级后缀。

**父子同名**：`getObjectsByName` / 显隐 API 会命中所有同名对象（含父子），core 不做过滤；展示可用不同 `label` 区分。

**场景根**：用 `label` 作标题展示；`roomName` 已废弃，请用 `label`。

页面批量显隐：`setObjectsVisibleByName` / `setObjectsVisibleByNames`（见 [api.md](./api.md)）。

## friendlyMap

`friendlyMap` 是可选配置，用来声明“自定义分组字段 -> 标准 `objType` + 默认字段”的有界映射，不支持任意脚本式转换。

```json
{
  "friendlyMap": {
    "glassList": {
      "objType": "glass",
      "defaults": {
        "material": {
          "type": "standard",
          "transparent": true,
          "opacity": 0.25
        }
      }
    }
  }
}
```

规则：

- 没写 `friendlyMap` 时，走内建默认映射。
- 写了 `friendlyMap` 后，会在默认映射之上追加或覆盖同名分组。
- `defaults` 只做“缺省补值”；单条记录里显式写的字段优先级更高。
- 自定义分组默认从 `worldInfo.<listName>` 读取。
- **`friendlyMap` 与对象 `name` 无关**：列表键不参与 `getObjectsByName` 或批量显隐。

## 标准 JSON

推荐给程序生成、AI 生成、编辑器保存/快照、对外接口对齐的场景。

**编辑器 partial merge 与快照（两套机制）**

| 机制 | 存储 | 用途 |
|------|------|------|
| 会话 `autoSnapshot` | tab 会话 / `recovery`（全局单槽） | 关闭页未保存时，启动弹窗「从快照恢复」 |
| `scene-snapshots` | IndexedDB，按文档 `threeJsonId` 分桶 | 「最近场景」、`openRecentSceneById` |
| `sceneToJson` merge 基座 | 内存中的 `sysConfig.jsonData` | 同场景增量导出时保留反扫未碰到的 `objectList` 条目 |

`autoSnapshot` **不参与** `sceneToJson` 的 `basePayload`（避免切换场景后跨场景合并 objectList）。全场景载入/恢复后首次捕获使用 `merge: false`。

**推荐默认外形（方案 B）**：主 viewport runtime 在 `sceneConfig`，可部署内容在 `objectList`。二者并行，语义不同；凡 core 支持的 `objType`（含 `camera`/`light`）也可只写在 `objectList`（全 list 编排仍合法）。

```json
{
  "version": "next",
  "name": "scene-name",
  "threeJsonId": "scene-doc-uuid-or-stable-id",
  "canvasWidth": 1920,
  "canvasHeight": 1080,
  "assetLibrary": [],
  "extensions": {},
  "sceneConfig": {
    "scene": { "background": "#222222" },
    "camera": {
      "fov": 60,
      "jsonOrigin": "config",
      "position": { "x": 230, "y": 180, "z": 260 }
    },
    "controls": { "target": { "x": 0, "y": 40, "z": 0 }, "jsonOrigin": "config" },
    "lights": [
      { "type": "ambient", "color": "#ffffff", "intensity": 0.45, "jsonOrigin": "config" }
    ],
    "renderLoop": { "autoResize": true, "firstAutoResize": true }
  },
  "objectList": [
    { "objType": "box", "name": "floor", "geometry": { "width": 260, "height": 8, "depth": 180 } },
    { "objType": "line", "name": "path-line", "points": [] },
    { "objType": "externalModel", "modelPath": "/assets/model/gltf/a.gltf", "modelFileType": "gltf" },
    { "objType": "domain", "domain": "nativeThree", "handler": "loadFromUrl", "modelPath": "/assets/json/three_native.json" }
  ],
  "saveMeta": { "exportMode": "standard_primary" }
}
```

说明：

- **文档身份**：顶层 **`threeJsonId`**（无 `worldId`）。
- **`sceneConfig`**：全局 / 主 viewport（相机、灯光、controls 等）；加载时 **优先** 定主视口。
- **相机 `type`**：缺省 `perspective`（`fov` + `aspect`）；`orthographic` / `ortho` 使用 `left`/`right`/`top`/`bottom`/`zoom`（未写边界时按画布尺寸推算）。
- **相机 `lookAt`**：`camera.lookAt: { x, y, z }` 可声明初始朝向（透视/正交均支持）；若同时写 rotation，`lookAt` 优先。
- **`objectList`**：全部可部署 `objType`；可有额外相机/灯光实例。
- **`jsonOrigin`**（`"config"` | `"list"`）：挂在 `camera`/`light`/`controls` 上，仅用于 scene→JSON 往返落位；加载以物理位置为准并自动修正。
- 两通道重复（同 `threeJsonId` 或 `name`）：**移除 `objectList` 侧**，保留 `sceneConfig`。
- `canvasWidth` / `canvasHeight`、`assetLibrary`、`extensions`、`saveMeta` 为顶层元信息。
- 全写在 `objectList` 的旧 demo 形态仍合法，见 tutorial `00-04-standard-objectlist.json`。

## `objectList` 分发规则

无论原始输入是友好 JSON 还是标准 JSON，统一加载入口最终都会按下面的阶段处理标准 `objectList`：

1. runtime：`scene`、`camera`、`renderer`、`controls`、`light`、`renderLoop`
2. 普通对象：`box`、`sphere`、`cylinder`、`cone`、`ring`、`torus`、`capsule`、`group`、`line`、`infoPanel`、`text`、`heatMap`、`wind`、`plane`、`shapePlane`、`bufferMesh`、`irregularPlane`、`shapeExtrude`、`irregularGeometry`、`points`、`shaderSurface`、`sprite`、`tube`、`instanced`、`audio`、**`native`**
3. 外部模型：`externalModel`、`skinned`（骨骼 glTF，语义与 `externalModel` 区分）
4. 业务域：`domain`

### `objType: "native"`（通用 Three.js 对象）

本节描述 **`objectList` 单条 record** 经 **ObjectLoader** 创建运行时对象（扁平 Mesh 或 `children` 层级）。**整图** Three.js JSON 走 [`domain: "nativeThree"`](#最小标准片段domain--nativethree) 或 **`sceneInfoList`**（嵌入 `Scene.toJSON()`），与本节不同。

core **无 ThreeJSON 几何 allowlist**：能否创建由 **ObjectLoader + 当前 Three.js 版本** 决定。`objType` 字符串本身**不参与** Three.js 类型推断（如 `torusKnot` 只是记录标签）；宿主 `threeType` 由 `geometry.type` 等字段推断。实现备忘见 [`lab/native-object-dispatch-memo.md`](../lab/native-object-dispatch-memo.md)。

| 字段 | 说明 |
|------|------|
| `parseMode` | `auto`（默认）：专用解析器 → native → 末级兜底；`native`：仅 native；`default`：仅专用解析器 |
| `threeType` | 如 `Mesh`、`Group`；显式 `objType: "native"` 时可写；否则通常由 `geometry.type` 反推 |
| `nativeShapeHeuristic` | 可选；为 true 时凭 width/height/depth 猜 `BoxGeometry`；**默认 false** |
| `geometry` / `material` | 直传 ObjectLoader；`material.textureUrl` 支持 `lib://`；`geometryRef` / `materialRef` 由 [`resolveAssetRefs`](../core/util/resolveAssetRefs.js) 展开 |
| `fallback` | jsm 几何 parse 失败时，可声明如 `"BoxGeometry"` 回退（需与 `geometry` 参数字段兼容） |

#### legacy 别名：`objType: "roundedBox"`

jsm 几何 `RoundedBoxGeometry` 提供业务友好别名；归一化阶段补全 `geometry.type`，不新增独立 builder。顶层 `width`/`height`/`depth`/`radius`/`segments` 会合并进 `geometry`。

```json
{
  "objType": "roundedBox",
  "width": 4,
  "height": 2,
  "depth": 3,
  "radius": 0.15,
  "material": { "type": "MeshStandardMaterial", "color": "#8899aa" }
}
```

#### 用法 A（推荐）：未知 `objType` + `parseMode: "auto"` 推断

当 core **没有**某几何的专用解析器时，可在 `objType` 写任意语义名（如 `torusKnot`、`latheVase`），只要 `geometry.type` 为 ObjectLoader 支持的 Geometry，加载链会在 **`parseMode: "auto"`**（默认）下走 native 部署。

```json
{
  "objType": "torusKnot",
  "name": "native-torus-knot",
  "geometry": {
    "type": "TorusKnotGeometry",
    "radius": 4,
    "tube": 1.1,
    "tubularSegments": 128,
    "radialSegments": 16,
    "p": 2,
    "q": 3
  },
  "material": {
    "type": "MeshStandardMaterial",
    "color": "#e76f51",
    "metalness": 0.35,
    "roughness": 0.45
  },
  "position": { "x": -18, "y": 8, "z": 0 }
}
```

完整演示：[01-06-native-object-dispatch.html](../examples/html-demo/track-01-geometry/01-06-native-object-dispatch.html)（数据：`assets/json/tutorial/track-01/01-06-native-objects.json`）。

#### 用法 B：显式 `objType: "native"` + ObjectLoader 层级

需要 **ObjectLoader 原生 `children` 递归**（多 Mesh 组合、不走 ThreeJSON `subScene`）时使用。**日常组合请用 `objType: "group"` + `subScene[]`**（见 [subScene 嵌套](#subscene-嵌套层级对象)），勿与 native 的 `children` 混用。

```json
{
  "objType": "native",
  "name": "native-lamp-group",
  "threeType": "Group",
  "position": { "x": 0, "y": 0, "z": -22 },
  "children": [
    {
      "threeType": "Mesh",
      "name": "lamp-pole",
      "geometry": {
        "type": "CylinderGeometry",
        "radiusTop": 0.12,
        "radiusBottom": 0.18,
        "height": 10,
        "radialSegments": 20
      },
      "material": { "type": "MeshStandardMaterial", "color": "#555555" },
      "position": { "y": 5 }
    },
    {
      "threeType": "Mesh",
      "name": "lamp-shade",
      "geometry": {
        "type": "SphereGeometry",
        "radius": 1.8,
        "widthSegments": 24,
        "heightSegments": 16,
        "phiStart": 0,
        "phiLength": 3.141592653589793,
        "thetaStart": 0,
        "thetaLength": 1.5707963267948966
      },
      "material": {
        "type": "MeshStandardMaterial",
        "color": "#fcbf49",
        "emissive": "#664400",
        "emissiveIntensity": 0.35
      },
      "position": { "y": 10.5 }
    }
  ]
}
```

#### 用法 C：已知 `objType` + `parseMode: "native"` 强制

跳过 `box` 等专用解析器，强制走 ObjectLoader：

```json
{
  "objType": "box",
  "name": "native-via-parseMode",
  "parseMode": "native",
  "threeType": "Mesh",
  "geometry": { "type": "BoxGeometry", "width": 4, "height": 4, "depth": 4 },
  "material": { "type": "MeshStandardMaterial", "color": "#9b5de5" },
  "position": { "x": 0, "y": 2.5, "z": 18 }
}
```

若 native 仍无法创建且未开启 `sceneConfig.enableDefaultModel`，对象会被跳过并打控制台警告（见 [`sceneConfig` 可选开关](#sceneconfig-可选开关)）。

---

core 官方 `objType` 建议使用这套受控值；历史业务味的值（例如 `dockCrane`、`deviceCamera`、`tempeSensor`）不再视为 core `objType`，而是由 friendly 归一化阶段转成 `domain` 记录或保存在业务字段里。

页面批量显隐请用 descriptor **`name`**（可重复）配合 `setObjectsVisibleByName` / `setObjectsVisibleByNames`；展示文案用 **`label`**。`businessInfo` 为用户自定义槽位，core 不解析其内部字段。

### `objType: "controls"`（视口控制器）

`type` 缺省或为 `orbit` 时与历史行为一致（`OrbitControls`）。`type: "firstPerson"` 启用第一人称漫游（`PointerLockControls` + WASD）。`type: "fly"` 启用 `FlyControls`（按住鼠标环顾 + WASD/QE 移动）。

| 字段 | `orbit` | `firstPerson` | `fly` | 说明 |
|------|---------|---------------|-------|------|
| `type` | 可选，`orbit` | `firstPerson` | `fly` | 未写则 `orbit` |
| `enabled` | ✓ | ✓ | ✓ | `false` 时不创建控制器 |
| `target`、`enableDamping`、`minDistance` 等 | ✓ | — | — | 仅 orbit |
| `moveSpeed` | — | ✓ | ✓（别名 `movementSpeed`） | firstPerson 默认 `4`；fly 默认 `10` |
| `movementSpeed` | — | — | ✓ | fly 移动速度 |
| `rollSpeed` | — | — | ✓ | fly 滚转，默认 `0.5` |
| `dragToLook` | — | — | ✓ | fly 按住鼠标环顾，默认 `true` |
| `eyeHeight` | — | ✓ | 默认 `1.6`；简单贴地时眼高 |
| `lookSensitivity` | — | ✓ | 默认 `0.001`；环顾灵敏度（弧度/像素） |
| `lookSmoothing` | — | ✓ | 默认 `0`（关闭）；`>0` 启用平滑环顾（关闭 PointerLockControls 内置旋转） |
| `lookSmoothTime` | — | ✓ | 默认 `0.06`（秒）；平滑环顾插值时间常数 |
| `lookPitchLimit` | — | ✓ | 默认 `1.396`（≈80°）；对称俯仰上限（弧度） |
| `minPolarAngle` / `maxPolarAngle` | — | ✓ | 可选；与 Three.js `PointerLockControls` 同语义。显式写出时覆盖 `lookPitchLimit` 推导 |
| `maxLookDelta` | — | ✓ | 默认 `120`；单帧鼠标位移软上限（像素），主要作用于平滑环顾 |
| `pointerLock` | — | ✓ | 默认 `true`；点击画布锁定指针 |
| `floorSnap` | — | ✓ | 默认 `true`；向下射线贴地 |
| `keys` | — | ✓ | `forward` / `back` / `left` / `right`（`KeyboardEvent.code`） |
| `collision` | — | ✓ | 见下表；`provider: "rapier"` 需页面加载 Rapier 并 `bootstrapFirstPersonExtensionsFromScene` |

`collision`（`firstPerson`）可选字段：

| 字段 | 说明 |
|------|------|
| `enabled` | 默认 `true`（未写 provider 时仍可用 fps-walk 扩展） |
| `provider` | `"rapier"`：Rapier CharacterController + 胶囊体；缺省或配合 `fps-walk` 扩展用 `floorMeshRef` 贴地 |
| `capsuleRadius` | Rapier 胶囊半径，默认 `0.35` |
| `capsuleHalfHeight` | Rapier 胶囊半高，默认 `0.75` |
| `snapToGround` | Rapier `enableSnapToGround`，默认 `0.45` |
| `playerRefName` | Rapier 扫描静态碰撞体时跳过的 Rig refName，默认 `player` |

友好 JSON：`worldInfo.orbitControls` 合并为 orbit；`sceneConfig.controls` 或 `worldInfo.controls` 可写 `type`。

### `sceneConfig.renderLoop`（帧循环）

可选字段：`autoResize`、`firstAutoResize`、`fps`、`lowFps`、`renderMode`。

- `renderMode`（可选，默认 `"auto"`）：有后处理 `composer` 时走 `composer.render()`；`"rendererOnly"` 强制 `renderer.render()`（截图/录制等场景可用）。

### `sceneConfig.textFont`（文字默认字体）

作用于 `objType: "text"` 且 `mode: "sdf"` 的对象；单条记录的 `sdf` 子块可覆盖。

| 字段 | 默认 | 说明 |
|------|------|------|
| `fontUrl` | `null` | 主字体直链；未配置时 Roboto + Unicode 回退（按字符懒加载，非整库） |
| `unicodeFontsUrl` | `null` | 回退索引 CDN 根 URL |
| `fontStyle` / `fontWeight` | `normal` | troika 回退字体选型 |
| `preloadCharacters` | `""` | 场景加载后预热 SDF |

### `sceneConfig.helpers`（Grid / Axes 辅助线）

半 runtime 场景设置；grid/axes 不参与 mesh 导出树。部署后对象直接挂在 **`THREE.Scene`** 根下（flat scene graph）。

```json
{
  "sceneConfig": {
    "helpers": {
      "grid": { "visible": true, "size": 100, "divisions": 20 },
      "axes": { "visible": true, "size": 50 }
    }
  }
}
```

- **语法糖**：`sceneConfig.gridHelper` / `worldInfo.gridHelper`、`sceneConfig.axesHelper` / `worldInfo.axesHelper` 归一化映射为 `helpers.*`；与 `helpers.grid` / `helpers.axes` **并存时 helpers 优先**。
- `grid`：`size`、`divisions`、`colorCenterLine`、`colorGrid`、`visible`、`position`、`rotation` → 运行时 `objType: "gridHelper"`，归入 **`system:assist`**
- `axes`：`size`、`visible`、`position`、`rotation` → `objType: "axesHelper"`，归入 **`system:assist`**
- `visible: false` 时 grid/axes **不 mount**（历史行为）。
- v1 grid/axes 各 1 个；示例见 `assets/json/tutorial/track-01/01-05-helpers-irregular.json`。

### `boxHelper`（绑定 threeJsonId 的可选装饰）

**可选**；不传则无 boxHelper。一旦声明，即为场景中的 `THREE.BoxHelper` 实例（show / editor 均渲染，**不依赖 composer**），归入 **`system:assist`**，默认 world 导出可排除。

**与编辑器选中描边无关**：编辑态 `createBoxEdgeHelper` 为 UI 反馈，**不**写入 JSON，**不**走本 deploy 路径。

**声明方式（二选一或混用）：**

1. **Inline**（写在任意带 `threeJsonId` 的内容 record 上）：

```json
{
  "objType": "box",
  "threeJsonId": "tj-wall-1",
  "boxHelper": { "visible": true, "color": "#E59520" }
}
```

runtime `threeJsonId`：`${hostThreeJsonId}@boxHelper`

2. **独立记录**（`objectList` / 友好 JSON 归一化后）：

```json
{
  "objType": "boxHelper",
  "threeJsonId": "bh-group-1",
  "targetThreeJsonIds": ["tj-wall-1", "tj-door-1"],
  "visible": true,
  "color": "#E59520"
}
```

也接受单值 `targetThreeJsonId`（归一化为数组）。多 target 时展开为多个 BoxHelper，runtime id：`${record.threeJsonId}@${targetId}`。

- `visible: false`：**仍创建并 register**，设置 `helper.visible = false`（与 box/mesh 等内容对象一致）。
- target 不存在：warn + skip。
- 同一 target 可被多条 boxHelper 记录引用。
- **Deploy 时机**：内容 objectList deploy 完成并 `rebuildObjectRegistryFromScene` 之后（二阶段，类比 OutlinePass target 解析）。
- 示例见 `assets/json/tutorial/track-01/01-05-box-helper.json`。

**已废弃**：~~`sceneConfig.helpers.boxHelper`~~（历史误放，core 不再 normalize）。

标准 JSON 可在顶层写 **`extensions`**（与 `objectList` 并列），归一化时合并进 `sceneConfig.extensions`（见 `assets/json/tutorial/track-04/04-03-fps-walk.json`）。

视口 `camera` 可选 **`attachTo`**（`refName` 字符串）：将相机挂到玩家 Rig 上，WASD 移动 Rig（见 `assets/json/tutorial/track-04/04-04-fps-player-rig.json`）。

### `sceneConfig.threeRevision`（可选）

声明场景针对的 Three.js **revision**（整数，或 `"184"` / `"r184"`）。用于 compat 路由；未声明时使用运行时 `THREE.REVISION`，再缺省则按 ThreeJSON 主版本（当前 **184**）。**正式支持 r179–r184**；更低 revision 会 warn 且不保证行为。详见 [`three-compat.md`](./three-compat.md)。

友好 JSON 与标准 JSON 均可写在 `sceneConfig.threeRevision`；也可写在 `worldInfo.threeRevision`（优先级低于 `sceneConfig`）。

### `sceneConfig.deployScheduler`（可选，大场景分帧部署）

控制 `createJsonScene` / `deployJsonScene` 在 **objectList 内容对象**（phase 2→3→4）上的部署节奏；runtime（相机、灯光等）仍同步配置，不受此项影响。

| 字段 | 说明 |
|------|------|
| `enabled` | `true` 或配合 `mode: "scheduled"` 启用队列；`false` 或未写 → **immediate**（与历史行为一致） |
| `mode` | `"immediate"`（默认）\| `"scheduled"`；`mode` 优先于 `enabled` |
| `policy` | 仅 scheduled：`"frameBudget"`（默认，每帧条数 + 毫秒预算）\| `"timeslot"`（`setTimeout` 时间槽，兼容展厅 `flowControl`） |
| `maxJobsPerFrame` | frameBudget：每帧最多执行的 deploy 条数（默认 12） |
| `maxFrameMs` | frameBudget：单帧 deploy 时间上限 ms（默认 8） |
| `fluxMs` | timeslot：槽位间隔 ms（默认 10） |
| `density` | timeslot：每 `density` 条记录递增一个槽位（默认 10） |

示例（分帧加载大量 box，仍先完成 phase 2 再进入 externalModel）：

```json
{
  "sceneConfig": {
    "deployScheduler": {
      "enabled": true,
      "policy": "frameBudget",
      "maxJobsPerFrame": 8,
      "maxFrameMs": 6
    }
  }
}
```

展厅式时间槽（等价于旧 `flowControl` + `flowControlFlux` / `flowControlDensity`）：

```json
{
  "sceneConfig": {
    "deployScheduler": {
      "mode": "scheduled",
      "policy": "timeslot",
      "fluxMs": 10,
      "density": 10
    }
  }
}
```

- **`createJsonSceneSimple`**：始终 immediate，忽略 `deployScheduler`。
- 切换场景时宿主应调用 `cancelActiveDeployScheduler()`（player/editor 已接入）。
- 可选进度：`createJsonScene(..., { onDeployProgress({ done, total, phase, id }) })`，在 scheduled 模式下每完成一条 deploy 回调一次。
- **`maxInFlightAsync`**（默认 4）：phase 3（`externalmodel`）并发加载上限。
- **`retry`**：`{ maxAttempts, backoffMs }`，仅对 phase 3 异步加载失败重试。
- **单条 `record.deployScheduler`**：与场景配置浅合并；`mode: "immediate"` 时该条在 scheduled 场景中**插队同步部署**（先于同 phase 的 timeslot/frameBudget 队列）。

### `sceneConfig.intro`（可选，加载完成后片头）

在 **`createJsonScene` / `deployJsonScene`** 中，于 `afterCameraFit` 之后、`onSceneReady` 之前展示 DOM 片头（Logo / 文字）。默认**关闭**；未写或 `enabled: false` 时零行为变化。与页面 `#loadingMask` **并存**：loading 管资源/部署进度；intro 管片头。版权闪屏等场景可设 **`excludeFromLoadWait: true`**，使 `#loadingMask` 在 deploy 完成后即可关闭，intro 后台播放；此时若未写 **`blockInteraction`**，默认 **`false`**（点击穿透场景）。

Phase 1 仅 **`postLoad`**；`preLoad` 留后续版本。

| 字段 | 说明 |
|------|------|
| `enabled` | `true` 启用（须含有效 `postLoad.slides`） |
| `backgroundColor` | overlay 背景色（默认 `#101820` 系深色；版权闪屏可用 `transparent`） |
| `postLoad.slides[]` | 串行 slide：`type: "image"`（`url` + `durationMs`）或 `"text"`（`content` + `durationMs`） |
| `postLoad.fadeInMs` / `fadeOutMs` | 淡入淡出（默认 300 / 600 ms） |
| `postLoad.skipOnClick` | 点击跳过（默认 `true`）。`blockInteraction: true` 时点击**全屏 overlay**；`blockInteraction: false` 时仅 **slide 内容区**可点跳过 |
| `postLoad.blockInteraction` | 为 `true` 时全屏 overlay 捕获指针并阻挡场景点击；`false` 时 overlay `pointer-events: none`，点击穿透到场景（`skipOnClick: true` 时仅 **slide 内容区** 可点击跳过）。**默认 `true`**；若 **`excludeFromLoadWait: true` 且未写本字段**，则默认 **`false`** |
| `postLoad.excludeFromLoadWait` | 为 `true` 时 intro **不阻塞** `createJsonScene` / `deployJsonScene` Promise 与 `onSceneReady`（后台播放；适合与 `#loadingMask` 并存的版权闪屏，默认 **`false`**） |

挂载容器：`options.canvas` 的父元素，或 `options.introRoot`。

**`createJsonSceneSimple` / `deployJsonSceneSimple`**：遇 `intro` 时 **warn 并跳过**（须 async 路径）。

示例：

- 教程片头（await + 挡交互）：[`00-08-scene-intro.json`](../assets/json/tutorial/track-00/00-08-scene-intro.json)
- 版权闪屏（`excludeFromLoadWait`）：[`portShow.json`](../assets/json/portShow.json)（`sceneConfig.intro`）、[`04-05-fps-rapier-collision.json`](../assets/json/tutorial/track-04/04-05-fps-rapier-collision.json)

### `sceneConfig.infoPanel`（可选，HTML 信息面板并发）

控制 `type: "html"` 信息面板经 **html2canvas** 生成纹理时的并行上限（全局队列，与 `deployScheduler` 无关）。在 `createJsonScene` / `deployJsonScene` 加载前由引擎读取；页面直调 `deployInfoPanel` 时沿用最近一次场景加载的配置，未加载过场景则默认 4。

| 字段 | 说明 |
|------|------|
| `maxInFlightAsync` | 并行 html2canvas 任务数（默认 **4**，最小 1） |

```json
{
  "sceneConfig": {
    "infoPanel": {
      "maxInFlightAsync": 6
    }
  }
}
```

### `createJsonSceneSimple` 能力边界

`createJsonSceneSimple` 定位是**同步立即部署**子集，会跳过或降级需要异步阶段的能力。推荐将其用于“纯同步子集”场景（基础几何、普通材质、静态对象布局）。

当前边界：

- 保持同步：`scene`/`camera`/`controls`/`lights`/`renderLoop` 与普通 `objectList` 解析。
- 会跳过：需要异步准备的 `nativeSceneEntry/nativeSceneList`、异步背景/环境贴图（HDR/全景）。
- 建议改用 `createJsonScene`（async）：
  - 依赖异步资源初始化或按需 register 的场景（例如部分 jsm 注册链路、异步 shader 资源装配等）。
  - 需要“结果稳定一致、不接受竞争时序”的生产场景。

设计原则：sync 路径不引入 fire-and-forget 异步副作用，避免同一 JSON 在不同环境下出现非确定性结果。

### `sceneConfig.runtimeDefaults`（可选，加载时覆盖引擎默认）

控制 `createJsonScene` / `deployJsonScene` 等在**归一化后、部署前**注入的默认灯光、相机、背景等策略。字段与加载 API 的 options 同名（如 `autoFillLights`、`autoFillCamera`、`autoFitCamera`、`autoFitCameraMode`、`fillLightsWhenExplicitEmpty`、`autoFillSceneBackground`、`extentInclude` 等）。

**合并优先级（低 → 高）：** 引擎内置默认 → `worldInfo.runtimeDefaults` → `sceneConfig.runtimeDefaults` → 宿主 `createJsonScene(..., options)`。

**与 `lights` 的关系（不必重复写开关）：**

- 未写 `runtimeDefaults` 且 **没有** `lights` 键：引擎默认 `autoFillLights=true`，会自动补声明式灯光。
- 已有非空 `lights`：始终使用 JSON 中的灯，与 `runtimeDefaults` 无关。
- 显式 `lights: []`：默认不补光；仅当 JSON 或 options 设 `fillLightsWhenExplicitEmpty: true` 时才补。

仅在需要**不同于引擎默认**的策略时写 `runtimeDefaults`（例如故意全黑场景写 `autoFillLights: false`，或需要 `autoFitCamera: true`）。`worldInfo.runtimeDefaults` 可选，同名字段以 `sceneConfig` 为准。

资源回收策略可选写在 `runtimeDefaults.resourcePolicy`：

- `resourcePolicy.enabled`（默认 `true`）：是否启用默认自动资源回收。
  - `true`：场景重置/销毁时按默认链路进行 dispose。
  - `false`：仅做对象移除与卸载，不主动做资源 dispose（适合调试对比）。

```json
{
  "sceneConfig": {
    "runtimeDefaults": {
      "autoFillCamera": true,
      "autoFitCamera": true,
      "autoFitCameraMode": "positionAndTarget",
      "resourcePolicy": {
        "enabled": true
      }
    }
  }
}
```

### `sceneConfig` 可选开关

- `enableComposeBoxModel`（默认 `false`）：为 `true` 时，`deployMeshWithDomains` 在 **legacy 映射之后** 尝试各 domain 的 `composeBoxModel()`。预设型 `objType`（如 `wall`、`glass`）在默认关闭时仍可通过 **`legacyBoxObjTypes`** 识别。
- `enableDefaultModel`（默认 `false`）：为 `true` 时，无法识别的 `objType` 会渲染为默认对象（`objType: "default"`），并在控制台警告且注明 `threeJsonId` / `uuid`。
  - 回落时 core 在描述符上写入 **`sourceObjType`**（原 `objType` 字符串）；**禁止手写**；非 default 对象导出时可剥离该字段。
  - 友好 JSON：在 `worldInfo.defaultModel`（或 `sceneConfig.defaultModel`）提供模板描述符。
  - 标准 JSON / `objModelList`：可提供 `objType: "default"` 的模板条目（加载时提取，不作为普通场景物体部署）。
  - 未提供模板时：使用内置红色 1×1×1 正方体。

### 预设 objType（`wall`、`glass` 等）

薄 domain 在 `boxModelList` / `meshList` 中可直接写 **`objType: "wall"`**、**`objType: "glass"`**、**`objType: "floor"`**（不必写 `domainModelList`）。由对应 domain 合并默认几何/材质后，最终以 core 的 `box` + `material.type: "standard"` 部署。

- **glass**：可选 **`glassKind`**（仅 glass 域解析）：`clear` | `tinted` | `frosted`。
- **floor**：批量识别用 descriptor **`name: "room-floor"`**（可重复）；展示用 **`label`**；材质用 **`standard`**（可带 `textureUrl`）。
- **`material.type`**：仅表示 Three.js 材质类（`standard` / `lambert` / `phong` / `basic` 等），**不要**再写 `wall` / `glass` / `floor` 作为 material 类型。
- 页面批量显隐请用 descriptor **`name`**（如 `room-wall`、`room-ceiling`），配合 `setObjectsVisibleByName` / `setObjectsVisibleByNames`；不要用自造 `objType`（如 `container`、`ground`）做筛选。

### `plane`（贴图/纯色平面）

对应 `THREE.Mesh` + `PlaneGeometry`。友好 JSON 使用 **`worldInfo.planeList`**。

- `geometry.width` / `geometry.height`
- `material`：`color`、`textureUrl` / `map`、`transparent`、`opacity`、`side`（`double` | `front` | `back`）
- 可选 **`motion: "scrollUv"`** + `speed`：贴图 UV 滚动（与 `wind` 同类动画，但无风场语义）
- 流动风场条带仍建议用 **`objType: "wind"`**

### `shapePlane` / `irregularPlane`（不规则平面）

- **`shapePlane`**：`Shape` + `ShapeGeometry`；`worldInfo.shapePlaneList`
- **`irregularPlane`** 门面：`planeKind` — `shape`（默认）| `mesh` | `rect`（转发 `plane`）
- `shape.contour`：[[x,y], ...]（Shape 本地 XY）；可选 `shape.holes`
- **`parallelTo`**：`xy` | `xz` | `yz`（默认 `xy`）；若 JSON 含 **`rotation` 键**则仅用 rotation
- **`shapeValidation.selfIntersect`**：`reject`（默认）| `warn` | `off`

### `bufferMesh`（任意三角网格）

`worldInfo.bufferMeshList`。`geometry.positions`、`geometry.indices`（可选）；顶点/三角数 **core 硬上限**，超限整对象跳过。

### `shapeExtrude` / `irregularGeometry`（不规则几何体）

- **`shapeExtrude`**：`ExtrudeGeometry`；`worldInfo.shapeExtrudeList`
- **`irregularGeometry`** 门面：`geometryKind` — `shapeExtrude`（默认）| `mesh`
- `extrude.depth`、`bevelEnabled` 等；轮廓与 `shapePlane` 相同

### `line` 拓扑 `topology`

在 `objType: "line"` 上可选 **`topology`**（或 `lineTopology`）：

| 值 | Three.js |
|----|----------|
| 缺省 / `"line"` | `Line` 折线 |
| `"lineSegments"` | `LineSegments` |
| `"lineLoop"` | `LineLoop` |

`material.linewidth` 仅对 `topology: "line"` 走 `Line2` 宽线；其它拓扑自动回退为 1px 线。

### `points`（点云 / 粒子）

对应 Three.js **`THREE.Points`** + `PointsMaterial`。友好 JSON 使用 **`worldInfo.particleList`**（可省略单条 `objType`）。

- **位置数据**：`positions: [[x,y,z], ...]` 或 `{x,y,z}` 对象数组；否则 `count` + `bounds`（或 `geometry` 作包围盒）随机填充。
- **可选** `colors`：与顶点一一对应或循环使用。
- **`material`**：`size`、`sizeAttenuation`、`color`、`transparent`、`opacity`、`map` / `textureUrl`、`blending`（`normal` | `additive` | `subtractive` | `multiply`）、`depthWrite`。
- **可选 `motion`**（阶段 2，可组合为数组）：
  - **`drift`** / 简写 **`rise`** / **`fall`**：每帧更新顶点位置；`speed`、`direction`（`{x,y,z}`）、`wrap`（默认 `true`，在 `bounds` 内循环）
  - **`scrollUv`**：点精灵贴图 UV 滚动（需 `material.map`）；`speed` 同 wind 语义
  - **`twinkle`**：闪烁；`speed`、`minOpacity` / `maxOpacity`（或 `mode: "size"` + `minSize` / `maxSize`）
- 单点标记也可用极小 **`sphere`** 或 `count: 1` 的 `points`。
- 大面积流动贴图面片仍用 **`wind`** 或后续 `plane` / domain，与 `points` 分工不同。

```json
{
  "name": "starry-sky",
  "objType": "points",
  "count": 1500,
  "bounds": { "width": 400, "height": 120, "depth": 400 },
  "position": { "x": 0, "y": 80, "z": 0 },
  "material": {
    "color": "#ffffff",
    "size": 3,
    "sizeAttenuation": true,
    "transparent": true,
    "opacity": 0.85,
    "blending": "additive"
  }
}
```

### `particleEmitter`（统一粒子发射器）

Phase 2 起引入统一入口：`objType: "particleEmitter"`。当前 core 使用同一 builder，`simulation` 支持：

- `cpu`：直接走 `THREE.Points` + `PointsMaterial`，由 `pointsMotion` 驱动 drift/twinkle 等（默认）。
- `gpuCompute`：使用 `GPUComputationRenderer` 在 GPU 上更新位置纹理，再由 `Points` + `ShaderMaterial` 采样渲染；无 WebGL2 或初始化失败时 warn 并回退 `cpu`。

```json
{
  "objType": "particleEmitter",
  "name": "rain-emitter",
  "simulation": "cpu",
  "count": 4000,
  "bounds": { "width": 120, "height": 80, "depth": 120 },
  "emitter": {
    "velocity": { "x": 0, "y": -1.2, "z": 0 },
    "speed": 3.5,
    "wrap": true
  },
  "material": {
    "color": "#b8d8ff",
    "size": 1.5,
    "transparent": true,
    "opacity": 0.85,
    "blending": "additive"
  }
}
```

`simulation: "gpuCompute"` 时可增加 `compute` 子块：

| 字段 | 说明 |
|------|------|
| `textureSize` / `textureWidth` + `textureHeight` | 计算纹理尺寸（默认按 `count` 向上取 2 的幂） |
| `velocity` / `speed` | 力场速度（缺省读 `emitter.velocity` / `emitter.speed`） |
| `fragmentShader` | 可选自定义 position compute GLSL（默认内置 drift + wrap） |
| `uniforms` | 追加到 compute shader 的自定义 uniform |

`domains/weather` 的 rain/snow/sparkles/embers 在 deploy 时内部走同一 `particleEmitterBuilder`（对外 JSON 仍兼容原 `handler` 写法）。

**第三方粒子（extensions）**：core 默认仅 `simulation: cpu|gpuCompute`。若 JSON 写 `provider: "nebula"` 等，需页面 `import "threejson/extensions/particle-nebula"` 注册适配器；未注册时 warn 并回退 core。扩展作者使用 `registerParticleEmitterProvider(id, deployer)`（见 `extensions/particle-nebula/` 骨架）。

带动画示例（`motion` 为数组时可同时 drift + twinkle）：

```json
{
  "name": "rain-drift",
  "count": 600,
  "bounds": { "width": 180, "height": 60, "depth": 180 },
  "position": { "x": 0, "y": 55, "z": 0 },
  "motion": {
    "type": "drift",
    "speed": 14,
    "direction": { "x": 0, "y": -1, "z": 0 },
    "wrap": true
  },
  "material": {
    "color": "#88bbff",
    "size": 2.5,
    "transparent": true,
    "opacity": 0.85,
    "blending": "additive",
    "depthWrite": false
  }
}
```

### `domain: "weather"`（天气粒子预设）

**`weather`** 业务域将 `domainModelList` 条目展开为 core **`createPoints`**。`handler`：**`rain`** | **`snow`** | **`sparkles`** | **`embers`**（`embers` 含贴图 `scrollUv`）。可在 domain 记录上覆盖 `count`、`position`、`bounds`、`material` 等字段。

```json
{
  "objType": "domain",
  "domain": "weather",
  "handler": "snow",
  "position": { "x": -30, "y": 50, "z": 20 },
  "count": 300
}
```

**嵌套子域（点分 id）**：亦可写 **`domain: "weather.rain"`** 或 **`"weather.wind"`**（须全路径；`domain: "rain"` 无效）。风条带在子域上仍可用 `handler: "coldWind"` 等。示例 JSON：[`assets/json/tutorial/track-05/05-02-nested-domain.json`](../assets/json/tutorial/track-05/05-02-nested-domain.json)。

详见 [domains.md](./domains.md)。

### `shaderSurface`（Core 通用 Shader 面）

Core 提供 **`shaderPresetRegistry`** + **`shaderMotion`** + **`objType: shaderSurface`** 机制。JSON **不内嵌** `vertexShader` / `fragmentShader`（默认路径），仅写 **`shaderPreset`** 与可序列化 **`uniforms`**。友好 JSON 使用 **`worldInfo.shaderSurfaceList`**（可省略单条 `objType`）。

```json
{
  "name": "demo-solid-marker",
  "objType": "shaderSurface",
  "shaderPreset": "solidColor",
  "surface": "plane",
  "geometry": { "width": 8, "height": 8 },
  "uniforms": { "color": "#e17055", "opacity": 0.85 }
}
```

**天空 / 水面等业务语义**不在 core 内建列表，而由 **`domains/nature`** 子域（`nature.sky`、`nature.water`）在启动时 `registerShaderPreset` + `resolveDomainModel`，通过 **`worldInfo.domainModelList`** 调度（与 `weather.rain` 等嵌套域相同）。详见 [lab/shader-preset-architecture.md](../lab/shader-preset-architecture.md)。

**`domain: "nature.sky"`**

- **静态 handler**：`atmosphere`（`day`）| `sunset`（`dusk`）| `dawn`（`sunrise`）| `noon`（`midday`）| `night`（`midnight`）
- **动态 handler**：`cycle`（`dynamic` / `dayNight`）— 关键帧插值 + 可选自动循环
- 静态可选 `uniforms` 覆盖；动态字段：

| 字段 | 说明 | 默认 |
|------|------|------|
| `timeOfDay` | 0–24 小时 | `12` |
| `autoCycle` | 自动推进时间 | `false` |
| `cycleDuration` | 完整 24h 循环秒数 | `600` |
| `syncBackground` | 同步纯色 `scene.background` 为地平线色 | `false` |
| `keyframes` | 覆盖内置关键帧数组 | 内置 7 点 |

```json
{
  "domain": "nature.sky",
  "handler": "cycle",
  "timeOfDay": 6,
  "autoCycle": true,
  "cycleDuration": 300,
  "syncBackground": false,
  "geometry": { "radius": 3500 }
}
```

**`domain: "nature.water"`** — `handler`：**`ocean`** \| **`flow`**。

**逼真度 `quality`**（条目级或 `uniforms.quality`）：`low` \| `medium`（默认）\| `high` \| `ultra`。档位越高，顶点/片元计算越多；`ultra` 额外每帧渲染场景到反射 RT，GPU 开销最大。可用 `geometry.widthSegments` / `mirrorResolution` 进一步调节网格密度与反射贴图尺寸。

| 档位 | 效果概要 | 相对开销 |
|------|----------|----------|
| `low` | 双正弦波 + 简单泡沫 | 最低 |
| `medium` | Gerstner + Fresnel + 程序化法线 + 天空渐变假反射 | 低 |
| `high` | 更多波浪层与法线细节 | 中 |
| `ultra` | `high` + 平面反射 RT（类似 Three.js Water） | 最高 |

可选 `geometry.width` / `height`、`uniforms.waveSpeed` / `waveHeight` / `waterColor`、`sunDirection`、`horizonColor` / `zenithColor`（假天空色）、`mirrorResolution`（仅 `ultra`）等。

```json
{
  "domainModelList": [
    {
      "domain": "nature.sky",
      "handler": "sunset",
      "geometry": { "radius": 3500 }
    },
    {
      "domain": "nature.water",
      "handler": "ocean",
      "quality": "high",
      "geometry": { "width": 420, "height": 420 },
      "position": { "x": 0, "y": -1, "z": 0 },
      "uniforms": {
        "waveSpeed": 1.4,
        "waveHeight": 0.4,
        "sunDirection": [0.65, 0.12, 0.25],
        "horizonColor": "#ff8c42",
        "zenithColor": "#2a1a4a"
      }
    }
  ]
}
```

**与 `windList` 的关系**：默认风条带仍为贴图 + UV 滚动（`planeScrollMotion`）；Shader 风条带为 Phase 4 可选，不在此列表默认启用。

示例 JSON：[`assets/json/tutorial/track-02/02-07-shader-sky-water.json`](../assets/json/tutorial/track-02/02-07-shader-sky-water.json)。

### stat 原生 3D 图表（`stat.line` / `stat.pie` / `stat.ring`）

与 **`stat.chart`（2D ECharts）** 不同，以下子域在 Three.js 场景中部署 **原生 3D 几何**（group + `subScene`）。

**文字标记 `labelMode`**（`options.labelStyle` / 单条 `items[].labelStyle` / `points[].labelStyle` / `slices[].labelStyle`）：

| `labelMode` | 说明 | import map |
|-------------|------|------------|
| `box`（默认） | 薄 box + `businessInfo.statLabel` 贴图（`stampStatLabels`） | 无额外依赖 |
| `sdf` | `objType: "text"` · troika SDF（推荐） | `troika-three-text` + `fflate` |
| `texture` | `objType: "text"` · Canvas 平面/Sprite | 无额外依赖 |
| `mesh` | `objType: "text"` · TextGeometry 挤出 | `three/examples/jsm/`（FontLoader） |

字段与 Track 7 [`objType: text`](./json-format.md#objtypetext) 对齐：`fontSize` / `fontSizePx`、`sdf` / `texture` / `mesh` 子块、`billboard`、`anchor` 等可在 `labelStyle` 内覆盖。`mesh` 需 `labelStyle.mesh.fontJsonUrl`（或 `options.labelMesh.fontJsonUrl`）。

**饼图 / 环图标签朝向**（`labelStyle.labelOrientation` 或 `options.labelOrientation`，单条 `slices[].labelOrientation` 可覆盖）：

| `labelOrientation` | 说明 |
|--------------------|------|
| `flat`（默认） | 平贴在扇区顶面（`rotationX: -π/2`，`billboard: false`） |
| `upright` | 竖立朝向相机（`billboard: true`，标签抬离顶面） |

平躺时默认 `labelGap` 为 `0.02`（贴面，避免 z-fighting）；竖立时沿用较大默认间距。

| 子域 | handler | 说明 |
|------|---------|------|
| `stat.line` | `createStatLine` | Line2 折线；`series[]` 多序列；可选 dropLine / sphere marker |
| `stat.pie` | `createStatPie` | 圆柱扇形饼图；`slices[]` ≤ **8** |
| `stat.ring` | `createStatRing` | 扇形柱 + `holes[]` CSG 内圆柱挖洞；`slices[]` ≤ **6**；页面 import map 需 **`three-bvh-csg`** |

```json
{
  "domainModelList": [
    {
      "domain": "stat.line",
      "handler": "createStatLine",
      "options": {
        "baseY": 0,
        "linewidth": 3,
        "showDropLines": true,
        "showMarkers": true,
        "labelStyle": {
          "labelMode": "sdf",
          "fontSize": 0.85,
          "billboard": true
        }
      },
      "series": [
        {
          "name": "series-a",
          "color": "#4fc3f7",
          "points": [
            { "x": -40, "y": 12, "z": 0, "label": "Q1" },
            { "x": 20, "y": 38, "z": 0 }
          ]
        }
      ]
    },
    {
      "domain": "stat.pie",
      "handler": "createStatPie",
      "options": { "radius": 36, "height": 14 },
      "slices": [
        { "value": 35, "label": "A" },
        { "value": 25, "label": "B" }
      ]
    },
    {
      "domain": "stat.ring",
      "handler": "createStatRing",
      "position": { "x": 60, "y": 0, "z": 0 },
      "options": { "outerRadius": 40, "innerRadius": 22, "height": 10 },
      "slices": [{ "value": 30, "label": "North" }]
    }
  ]
}
```

Tutorial 示例：[`06-05-stat-line.json`](../assets/json/tutorial/track-06/06-05-stat-line.json)、[`06-06-stat-pie.json`](../assets/json/tutorial/track-06/06-06-stat-pie.json)、[`06-07-stat-pie-ring.json`](../assets/json/tutorial/track-06/06-07-stat-pie-ring.json)。

### `sprite`（图标 / 标记）

对应 **`THREE.Sprite`** + `SpriteMaterial`。友好 JSON 使用 **`worldInfo.spriteList`**（可省略单条 `objType`）。

- 与 **`infoPanel`** 分工：`sprite` 用于贴图图标/标记点；`infoPanel` 用于文本/HTML/图片面板（也可选 `panelBoxType: "sprite"` 载体）。
- **`material.map`** / `textureUrl` / `url`：贴图地址；无贴图时可用纯色 `material.color`。
- **`material.size`** 或 **`scale`**：控制显示尺寸。

### `text`（场景内文字）

对应 **`objType: "text"`**，支持三种渲染 **`mode`**：

| mode | 实现 | 典型用途 |
|------|------|----------|
| `sdf`（默认） | `troika-three-text` SDF | 清晰标签、多语言、可缩放 |
| `texture` | Canvas → Plane / Sprite | 离线/CSP 兜底、超高频更新 |
| `mesh` | `TextGeometry` 挤出 | 少量立体标题（需 `mesh.fontJsonUrl`） |

与 **`infoPanel`** 分工：`text` 为纯文字实体（无强制背板）；`infoPanel` 为带面板几何的信息牌（盒体/sprite + 可选 html）。

**公共字段**：`content`、`fontFamily`、`fontSize`（world 单位）、`color`、`align`（`left`/`center`/`right`）、`anchor`（`{x,y}` 0..1）、`maxWidth`、`lineHeight`、`billboard`、`position` / `rotation` / `scale`。

**`sceneConfig.textFont`**（场景默认，per-object `sdf` 可覆盖）：

| 字段 | 默认 | 说明 |
|------|------|------|
| `fontUrl` | `null` | 主字体 `.woff`/`.ttf` 直链（在线或本地）；未配置时走 Roboto + Unicode 回退（按实际字符懒加载 Noto，**非整库下载**） |
| `unicodeFontsUrl` | `null` | unicode-font-resolver 索引 CDN 根；内网可自建 |
| `fontStyle` / `fontWeight` | `normal` | 影响回退字体选型 |
| `preloadCharacters` | `""` | 场景加载后预热字形 SDF |

**`sdf` 子块**：`fontUrl`、`unicodeFontsUrl`、`outlineWidth`、`outlineColor`、`fillOpacity`、`curveRadius`、`gpuAccelerateSDF`。

**`texture` 子块**：`canvasWidth`/`canvasHeight`、`padding`、`backgroundColor`、`devicePixelRatio`、`textStyle`（同 infoPanel）、`doubleSided`、`renderOrder`。

**`mesh` 子块**：`fontJsonUrl`（必填）、`depth`、`bevelEnabled`、`bevelThickness`、`bevelSize`。

**troika 懒加载**：`mode: "sdf"`（默认）时运行时才 `import("troika-three-text")`；场景无 SDF 文字时无需在 import map 中配置 troika。需要 SDF 文字的教程页（如 Track 7）应在 import map 中保留 `troika-three-text` + `fflate`（见 [quick-start.md](./quick-start.md)）；其余页面可省略并依赖懒加载。

```json
{
  "name": "floor-label",
  "objType": "text",
  "content": "B2 机房",
  "mode": "sdf",
  "fontSize": 0.25,
  "color": "#e8eaed",
  "align": "center",
  "anchor": { "x": 0.5, "y": 0.5 },
  "billboard": true,
  "position": { "x": 0, "y": 2, "z": 0 }
}
```

示例 JSON：[`07-01-text-modes.json`](../assets/json/tutorial/track-07/07-01-text-modes.json)（sdf/texture）、[`07-02-text-mesh.json`](../assets/json/tutorial/track-07/07-02-text-mesh.json)（mesh）。教程页见 [Track 7](./tutorial.md#track-7--场景文字objtype-text)。

### `tube`（管道路径）

对应 **`THREE.Mesh` + `TubeGeometry`**。友好 JSON 使用 **`worldInfo.tubeList`**。

- **`path`**（或 `curve`）：`type: "catmullRom"`（默认）| `"line"`，`points` 为 `{x,y,z}` 或 `[x,y,z]` 数组，至少 2 点；可选 `closed`、`tension`。
- **`geometry.radius`**、`tubularSegments`、`radialSegments`。
- **`material`**：同基础网格（`standard` / `basic` 等）。未指定 `material.side` 时默认 **`double`**（避免 Frenet 标架扭转导致单面剔除只看见半圈管壁）；需要外壳单面时可显式 `"side": "front"`。

```json
{
  "name": "pipe-a",
  "objType": "tube",
  "path": {
    "type": "catmullRom",
    "points": [
      { "x": 0, "y": 10, "z": 0 },
      { "x": 40, "y": 30, "z": 0 },
      { "x": 80, "y": 10, "z": 20 }
    ]
  },
  "geometry": { "radius": 3, "tubularSegments": 48 },
  "material": { "type": "standard", "color": "#67c23a" }
}
```

### `instanced`（显式 InstancedMesh）

对应 **`THREE.InstancedMesh`**。友好 JSON 使用 **`worldInfo.instancedList`**。

- 单条记录需 **`transforms`** 数组（每项含 `position` / `rotation` / `scale`），以及盒体 **`geometry`** + **`material`**（与 `box` 相同）。
- 仍可通过 **`boxModelList` + `instanceCode`** 由 `coalesceBoxModelList` 合并为 `instance: true` 的 `box` 条目（`objType` 保持 `box`）；`instanced` 用于在标准 `objectList` 中显式声明实例化网格。

### `skinned`（骨骼角色）

语义 **`objType: "skinned"`**，加载仍走 glTF/GLB（与 **`externalModel`** 共用加载器，但保留 `userData.objJson.objType === "skinned"` 便于业务区分）。友好 JSON 使用 **`worldInfo.skinnedList`**。

- **`modelPath`**、可选 **`modelFileType`**（`gltf` / `glb`）。
- 可选 **`attachTo`**：仅 `"camera"` 时走第一人称 viewmodel（挂 `scene` 并每帧跟随相机）；未写或其它值则按普通模型加入场景。viewmodel 下 `position` / `rotation` / `scale` 为**相机局部**变换。勿对 viewmodel 配置 `extensions.physics-rapier`。
- 可选 **`applyTransform`**（默认省略即 `true`）：为 `true` 时应用 JSON 的 `position` / `rotation` / `scale`；为 `false` 时保留 glTF 文件内变换。
- 可选 **`viewModelFit`**（`attachTo: "camera"` 时默认 `true`）：按包围盒缩放；蒙皮模型缩放各 `SkinnedMesh` 自身且不做 bbox 居中。
- 可选 **`viewModelMaxSize`**：配合 `viewModelFit` 的目标最大边长（默认 `1`）。
- **朝向**：Three.js 相机朝 **-Z**；Sketchfab / Unity 系 FPS 武器 glTF 常朝 **+Z**，`attachTo: "camera"` 时若枪口朝向自己，在 `rotation` 中加 **`rotationY: 3.141592653589793`** 即可；**勿**同时将 `position.x` 取反（绕 Y 翻转后右手偏移仍用正值，如 `0.15`）。示例见 `assets/json/tutorial/track-04/04-05-fps-rapier-collision.json`。
- glTF 贴图由文件内 `images[].uri`（如 `textures/*.png`）引用，加载器按 `.gltf` 所在目录解析，**无需**单独配置 `textures` 目录扫描。
- 静态复杂模型无动画需求时仍可用 **`externalModelList`**。

## `audio`

基于 Three.js `AudioListener` / `Audio` / `PositionalAudio` 与 `AudioLoader`（主包 `three`）。加载入口在相机配置应用之后部署内容对象，并向 `deployCanonicalRecord` 的上下文注入 `camera` / `renderer`，以便在相机上懒创建单个听者。

标准 `objectList` 示例：

```json
{
  "objType": "audio",
  "name": "dock-bell",
  "mode": "positional",
  "audioUrl": "/assets/audio/bell.ogg",
  "position": { "x": 10, "y": 2, "z": 0 },
  "volume": 0.8,
  "loop": false,
  "autoplay": false,
  "refDistance": 1,
  "rolloffFactor": 1,
  "maxDistance": 10000,
  "distanceModel": "inverse"
}
```

- **`mode`**：`positional`（默认，空间化，挂在 `scene` 下）或 `ambient`（非空间化，挂在主相机下，适合 BGM）。
- **`audioUrl`**：音频地址；也可用通用字段 **`url`**。
- **`volume`** / **`gain`**：音量（二者等价，取其一即可）。
- **`loop`**、**`playbackRate`**：播放参数。
- **`autoplay`**：为 `true` 时在缓冲就绪后调用 `play()`；受浏览器自动播放策略约束，失败时静默忽略。宿主页面可在用户手势中调用导出的 **`resumeThreeJsonAudioContextFromCamera(camera)`** 尝试恢复 `AudioContext`。
- **空间化**：可选 `refDistance`、`rolloffFactor`、`maxDistance`、`distanceModel`（`linear` / `inverse` / `exponential`），以及锥形衰减 `coneInnerAngle` / `coneOuterAngle` / `coneOuterGain`（与 Three.js `setDirectionalCone` 一致，单位为弧度）。

友好 JSON 可在 `worldInfo.audioList`（或顶层，取决于 `friendlyMap` 的 `scope`）中维护多条记录；列表项可省略 `objType`（默认 `audio`）。重新部署场景时，会先从相机上移除带 ThreeJSON 标记的 ambient 音轨，并在处置场景子树时对 `Audio` / `PositionalAudio` 调用 `stop` / `disconnect`。

## `externalModel`

第三方模型统一走：

```json
{
  "objType": "externalModel",
  "modelPath": "/assets/model/gltf/threejson_unlit_pyramid.gltf",
  "modelFileType": "gltf"
}
```

判型顺序如下：

1. 优先看 `modelFileType`
2. 没写时按 `modelPath` 扩展名判断
3. 仍然无法判断则解析失败

`modelFileType` 可写 `obj`、`gltf`、`glb`、`three`、`threejson`、`object`。

glTF/GLB 默认应用 JSON 的 `position` / `rotation` / `scale`（`applyTransform` 省略或为 `true`）；`applyTransform: false` 时保留文件内变换。可选 **`attachTo: "camera"`** 走 viewmodel（相机局部变换）；可选 **`viewModelFit`** / **`viewModelMaxSize`**（语义同 `skinned`）。贴图路径由 glTF 内 `uri` 解析，无需额外 `textures` 目录配置。

## `domain`

业务域记录统一使用：

```json
{
  "objType": "domain",
  "domain": "nativeThree",
  "handler": "loadFromUrl",
  "modelPath": "/assets/json/three_native.json"
}
```

说明：

- `objType: "domain"` 表示进入业务域系统
- `domain` 指向具体业务域 id
- `handler` 保留为 domain 内部入口函数或子类型名
- `items`、`payload`、`options` 仍然可用，含义由对应 domain 自己解释

更详细的业务域说明、descriptor 结构、注册方式与扩展步骤，请见 [业务域与 `domains/`](./domains.md)。

## 通用字段

```js
{
  name: "object-name",
  refName: "mainPump",
  threeJsonId: "tj_xxx",
  objType: "box",
  visible: true,
  geometry: {},
  position: { x: 0, y: 0, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: {}
}
```

- `name`：ThreeJS 对象名称，可用 `scene.getObjectByName()` 获取。
- `refName`：可选的运行时引用名；推荐在需要“像手写 Three.js 变量名那样”稳定取对象时使用。
- `threeJsonId`：可选的持久对象 ID；若场景入口调用了 `ensureThreeJsonIdsOnScenePayload()`，缺失值会在加载前自动补全。
- `objType`：core 统一分发字段，也会写入 `userData.objJson.objType`，可配合 `modelHandler` 批量查询、隐藏、删除。
- `visible`：是否可见。部分材质创建逻辑会读取该字段。
- `position`：位置，单位由调用者的场景约定决定。
- `rotation`：旋转，单位为弧度。
- `scale`：缩放。
- `events`（可选）：平台事件 → EventScript / `scriptUrl` 绑定。字段与语法见 [事件机制与 EventScript](./event-mechanism.md)。

```json
"events": {
  "click": {
    "mode": "dsl",
    "script": "self.moveBy(10, 0, 0)\nawait wait(200)\nself.moveBy(-10, 0, 0)"
  }
}
```

`script` 也可为 `lib://token` 或 HTTP(S) URL（`scriptUrl` 已弃用，仍兼容读取）。`events.<name>.mode` 可选 `"dsl"` | `"javascript"`。

**场景级开关**（可选）：

```json
"sceneConfig": {
  "interaction": {
    "bindSceneEvents": true,
    "enableObjectLifecycle": false
  }
}
```

- `bindSceneEvents`：是否在 `createJsonScene` 的 `onSceneReady` 自动绑定 ELM（默认 `true`）。
- `enableObjectLifecycle`：是否强制启用单对象 lifecycle 上下文（默认 `false`）；`createJsonScene(..., { enableObjectLifecycle: true })` 可覆盖 JSON。详见 [`event-mechanism.md`](./event-mechanism.md) §1.3.1。

不支持 `events.*.handler` 字符串；业务域触发走 domain API。Demo：[t04-09](../examples/html-demo/track-04-interaction/04-09-event-mechanism.html)。

## 运行时对象查询

ThreeJSON 现在提供一个轻量运行时对象注册表。只要对象是通过 `core/` 的构建器或外部模型加载入口创建的，就可以从 `core/index.js` 导入这些 API：

```js
import {
  getObjectByThreeJsonId,
  getObjectByUuid,
  getObjectByRefName,
  getObjectsByName
} from "./core/index.js";
```

推荐顺序：

- `getObjectByThreeJsonId(id)`：跨会话、最稳定。
- `getObjectByRefName(refName)`：适合手工编程命名。
- `getObjectsByName(name)`：便捷查询；`name` 不保证唯一，因此返回数组。
- `getObjectByUuid(uuid)`：适合当前会话调试或临时引用。

## 运行时 bucket 分类（systemBucket / customBucket）

**flat scene graph** 下，所有可注册 `Object3D` 直接挂在 `THREE.Scene`（或 archive 容器）上；core 用 **bucket 索引**做分类与批量查询，**不**再使用 physical managed sub-root（`baseRoot` / `overlayRoot` 等）。

### systemBucket（仅运行时，不写进 objJson）

由 `registerObject` 时根据 `objJson` + 部署上下文自动推断；同一 `threeJsonId` 可拥有 **多个 tag**：

| tag | 典型 objType / 来源 |
|-----|---------------------|
| `objects` | 普通内容对象 |
| `domain` | `domain`（常与 `objects` 并存） |
| `models` | `externalModel`、`skinned` 等（常与 `objects` 并存） |
| `native-record` | `native` / `parseMode: native` |
| `native-scene` | 嵌入的 ObjectLoader Scene 根 |
| `environment` | `light`、`camera` |
| `assist` | `gridHelper`、`axesHelper`、`boxHelper` |
| `temp` | 运行时 spawn（`isRuntimeSpawn`） |

**不进 bucket**：OrbitControls、Renderer、RenderLoop、Pass、scene 背景/fog 等纯 runtime 拆分项。

查询 API（从 `core/index.js` 导入）：

```js
import {
  getObjectsInSystemBucket,
  getObjectsInCustomBucket,
  hasSystemBucketTag,
  shouldIncludeThreeJsonIdInDefaultWorldExport
} from "./core/index.js";

const meshes = getObjectsInSystemBucket("objects");
const layerA = getObjectsInCustomBucket("layer-a");
```

默认 world 导出会排除 `assist`、`environment`、`temp`、`native-scene`（见 `shouldIncludeThreeJsonIdInDefaultWorldExport`）。

### customBucket（可选，写入 JSON）

用户自定义分层，**不**创建虚拟 `Object3D`，仅索引。

**单对象局部声明**（优先级最高）：

```json
{
  "objType": "box",
  "threeJsonId": "tj-wall-1",
  "customBucket": "layer-a",
  "name": "wall-1"
}
```

**全局映射**（`sceneConfig.customBuckets` 或归一化后的等价字段）：

```json
{
  "sceneConfig": {
    "customBuckets": {
      "layer-a": ["tj-wall-1", "tj-floor-1"],
      "ui-overlay": ["tj-label-1"]
    }
  }
}
```

规则：

- 单条 `customBucket` **覆盖**全局映射中的同名 id。
- 名称禁止 `system:` 前缀；建议 `[a-zA-Z0-9_-]+`。
- **`friendlyMap` 不会**自动映射到 customBucket；友好 JSON 先归一化为标准 `objectList`，bucket 在 deploy 时分配。

## 空间查询（core util，非物理引擎）

`core/util/spatialQuery.js` 提供几何级查询，**不包含**刚体或碰撞响应。物理落体等见 `extensions/` + `PluginHost`。

```js
import {
  setBox3FromObject,
  findAabbIntersections,
  raycastScene,
  ndcToRay
} from "./core/index.js";
```

| API | 用途 |
|-----|------|
| `setBox3FromObject` / `box3IntersectsBox3` | AABB 包围盒 |
| `collectObjectsWithObjJson` / `findAabbIntersections` | 与带 `userData.objJson` 物体的粗相交（不添加 Helper） |
| `raycastScene` / `ndcToRay` | 鼠标拾取射线 |

业务门洞等仍可能使用 `modelHandler.impactCheck`（内部基于 `findAabbIntersections`）；与 Rapier 插件可并存。

### 可选精确拾取（`three-mesh-bvh`，默认关闭）

`core/util/meshPick.js`：在 opt-in 时为 Mesh 构建 BVH 并加速射线。

| 开关 | 含义 |
|------|------|
| `sceneConfig.pick.meshBvh: true` | 场景内带 `objJson` 的 Mesh 参与 BVH 拾取 |
| 物体 `pick.precision: "bvh"` | 仅该物体 |

仍可用 `raycastScene`（标准 `Raycaster`）。与挖洞用的 `three-bvh-csg` **无关**。

### 可选扩展配置 `extensions`

场景级：`sceneConfig.extensions["<extensionId>"]`；物体级：同一条模型记录上的 **`extensions`**。`worldInfo.extensions` 归一化时合并进 `sceneConfig.extensions`。

core **透传**、不解析各插件专有字段；宿主在 `createJsonScene(..., { onSceneReady })` 中调用扩展 bootstrap。完整接入说明见 **[extensions.md](./extensions.md)**；容器约定详见 [`lab/extension-json.md`](../lab/extension-json.md)；示例 JSON：[`assets/json/tutorial/track-04/04-02-plugin-physics.json`](../assets/json/tutorial/track-04/04-02-plugin-physics.json)。

## 声明式动画 animations

对象 JSON 可以增加 `animations` 字段。统一帧循环会自动解析并更新这些动画。

```js
{
  name: "rotating-box",
  objType: "box",
  geometry: { width: 80, height: 80, depth: 80 },
  position: { x: 0, y: 40, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: { type: "standard", color: "#409eff" },
  animations: [
    { type: "rotate", axis: "y", speed: 0.6 }
  ]
}
```

当前支持：

- `type: "rotate"`：持续旋转。
- `axis`：`x`、`y`、`z`，也兼容 `rotationX`、`rotationY`、`rotationZ`。
- `speed`：弧度/秒。
- `enabled: false`：禁用单条动画。

### `animationMode`（可选）

与 glTF **`AnimationMixer`**（若资源含动画剪辑且已注册）及上述 **声明式 `animations`** 的并存关系：

| 取值 | 行为 |
|------|------|
| **缺省** 或 **`both`** | 声明式动画与 `AnimationMixer` **同时**更新（与旧 JSON 兼容）。若同时配置 `rotate` 与 glTF 骨骼动画，可能出现叠加，难调试；新场景建议显式指定模式。 |
| **`mixer`** | **仅**驱动已注册的 `AnimationMixer`；**跳过**声明式 `rotate`（其它声明式类型若将来扩展，仍以文档为准）。 |
| **`basic`** | **仅**声明式内置动画（当前主要为 `rotate`）；**不**对该对象根节点执行 `mixer.update`。若仍注册了 Mixer，文档建议 unregister 或勿用此档。 |

> **不要**使用字面量 `json` 作为模式名，易与「整份场景 JSON」混淆。

### `animationGraph`（可选，glTF 动画状态机）

仅当记录含 **`animationGraph`** 时启用状态机；**无 graph 时保持**历史行为（注册 Mixer 后 **play all clips**）。适用于 `externalModel` / `skinned` 等 glTF 加载记录。

```json
{
  "objType": "externalModel",
  "modelPath": "/assets/model/gltf/character.glb",
  "animationMode": "mixer",
  "animationGraph": {
    "defaultState": "idle",
    "parameters": {
      "speed": { "type": "float", "default": 0 },
      "attack": { "type": "bool", "default": false }
    },
    "states": {
      "idle": { "clips": [{ "name": "Idle", "loop": true }], "speed": 1 },
      "walk": { "clips": [{ "name": "Walk", "loop": true }], "speed": 1 },
      "attack": { "clips": [{ "name": "Attack", "loop": false }], "speed": 1 }
    },
    "transitions": [
      { "from": "idle", "to": "walk", "when": { "param": "speed", "gt": 0.1 }, "crossFade": 0.2 },
      { "from": "*", "to": "attack", "when": { "param": "attack", "eq": true }, "crossFade": 0.05 },
      { "from": "attack", "to": "idle", "when": { "event": "clipFinished" }, "crossFade": 0.2 }
    ]
  }
}
```

| 字段 | 说明 |
|------|------|
| `defaultState` | 初始状态名，必须在 `states` 中存在 |
| `parameters` | 运行时参数默认值；`type`: `float` / `bool` |
| `states` | 状态名 → `{ clips: [{ name, loop?, speed? }], speed? }` |
| `transitions` | `{ from, to, when, crossFade? }`；`from: "*"` 匹配任意当前状态 |
| `when.param` | 支持 `eq` / `ne` / `gt` / `gte` / `lt` / `lte` |
| `when.event` | 内置 `clipFinished`（非 loop 剪辑播放完毕） |

**Runtime API**（`threejson/core`）：

- `setAnimationParameter(rootOrThreeJsonId, name, value)`
- `fireAnimationEvent(rootOrThreeJsonId, eventName)`
- `getAnimationStateMachine(root)` / `isAnimationStateMachineRoot(root)`

教程：`assets/json/tutorial/track-03/03-06-animation-graph.json`

## 盒子 box

盒子由 `deployMesh()` 或 `deployBox()` 解析。`material.type` 使用 Three.js 材质类（`standard`、`lambert`、`phong`、`basic` 等）。墙体/玻璃等预设语义用 **`objType: "wall"`** / **`objType: "glass"`**（domain `legacyBoxObjTypes`），不要写在 `material.type` 里。

玻璃记录可选 **`glassKind`**：`clear` | `tinted` | `frosted`。

```js
{
  name: "blue-box",
  objType: "box",
  geometry: { width: 100, height: 80, depth: 60 },
  position: { x: 0, y: 40, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: {
    type: "standard",
    color: "#409eff",
    transparent: false,
    opacity: 1
  }
}
```

### 纹理盒子

```js
{
  name: "room-floor",
  label: "主地板",
  objType: "floor",
  geometry: { width: 300, height: 8, depth: 300 },
  position: { x: 0, y: -4, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: {
    type: "standard",
    color: "#ffffff",
    metalness: 0.05,
    roughness: 0.85,
    textureUrl: "/assets/textures/building/floor/wood_floor.webp",
    textureRepeat: { x: 2, y: 2 }
  }
}
```

### 六面材质

当需要为盒子六个面分别设置材质时，使用 `materials` 数组。顺序对应 ThreeJS BoxGeometry 的六个面。

```js
{
  name: "six-face-box",
  geometry: { width: 100, height: 100, depth: 100 },
  position: { x: 0, y: 50, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  materials: [
    { type: "standard", color: "#f56c6c" },
    { type: "standard", color: "#67c23a" },
    { type: "standard", color: "#409eff" },
    { type: "standard", color: "#e6a23c" },
    { type: "standard", color: "#909399" },
    { type: "standard", color: "#ffffff" }
  ]
}
```

## 球体 sphere

球体同样使用 `deployMesh()`。标准写法是 `objType: "sphere"`；旧 `boxType: "sphere"` 仍兼容读取。

```js
{
  name: "earth",
  objType: "sphere",
  geometry: { radius: 50, widthSegments: 32, heightSegments: 16 },
  position: { x: 160, y: 80, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: {
    type: "standard",
    color: "#00ffcc",
    textureUrl: "/assets/textures/environment/nature/planet/earth.png"
  }
}
```

## 其他基础几何体 primitive

除盒体与球体外，`deployMesh()` / `createMesh()` 现在还支持这些单材质基础几何体：

- `objType: "cylinder"`：`THREE.CylinderGeometry`
- `objType: "cone"`：`THREE.ConeGeometry`
- `objType: "ring"`：`THREE.RingGeometry`
- `objType: "torus"`：`THREE.TorusGeometry`
- `objType: "capsule"`：`THREE.CapsuleGeometry`

旧 `boxType` 与 `geometry.type` 仍可作为兼容输入读取；标准写法优先直接写在 `objType`。

最小示例：

```js
{
  name: "demo-cylinder",
  objType: "cylinder",
  geometry: {
    radiusTop: 20,
    radiusBottom: 20,
    height: 80,
    radialSegments: 32
  },
  position: { x: 0, y: 40, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: {
    type: "standard",
    color: "#409eff",
    metalness: 0.1,
    roughness: 0.65
  }
}
```

不同几何体常用字段：

- `cylinder`：`radiusTop`、`radiusBottom`、`height`、`radialSegments`、`heightSegments`、`openEnded`
- `cone`：`radius`、`height`、`radialSegments`、`heightSegments`、`openEnded`
- `ring`：`innerRadius`、`outerRadius`、`thetaSegments`、`phiSegments`
- `torus`：`radius`、`tube`、`radialSegments`、`tubularSegments`
- `capsule`：`radius`、`length`、`capSegments`、`radialSegments`

## subScene 嵌套（层级对象）

ThreeJSON 用 **`subScene[]`** 表达父对象描述符下的 deploy 子树（内部 canonical 为 **nested** 嵌套）。与 Three.js 原生 JSON 的 **`children`**（`objType: "native"` / ObjectLoader）以及 runtime 上的 `Object3D.children` **不是同一概念**。

### 写入规范

- **group 及可嵌套容器**：子对象写在 **`subScene`** 中。**不要**在 group 记录上使用 `boxModelList` / `subGroup` / `infoPanelList` — 这些字段在 group 上**不会被 deploy 读取**。历史 JSON 若在 group 内仍写上述字段，加载归一化时会通过 `migrateGroupDescriptorToSubScene` 迁入 `subScene`。
- **根级 `worldInfo.boxModelList`** 等友好列表：语义不变，表示场景根部的盒体、地板、薄 domain 等，**不是** group 的内部子字段。
- **空 group**：省略 `subScene` 或写 `subScene: []` 时只会创建空的 `THREE.Group`（无可见子 mesh，但可作为纯变换容器或占位组）。
- **`pickThroughRaycast`**（可选，默认 `false`）：声明于 **subScene 父节点 / deploy 容器**（`group`、`domain` 等）。为 `true` 时，ELM canvas 射线拾取可在该容器**后代范围内**跳过无 event binding 的壳 mesh，命中 sibling 子节点上的 binding；**不会**穿出容器去激活后方其它对象的 binding。仅影响 ELM 事件拾取，不改变渲染或物理。详见 [事件机制 § 1.3.2](./event-mechanism.md#132-elm-射线拾取与-pickthroughraycast)。

### 加载与导出

| 能力 | 说明 |
|------|------|
| **加载输入** | nested `subScene`、扁平 `parentThreeJsonId`、或顶层 `subSceneList` 块；归一化为 nested 后 deploy |
| **导出 layout** | `subSceneLayout`：`nested`（core 默认）\| `flat` \| `subSceneList` |
| **归一化策略** | `sceneJson.subSceneNormalizePolicy`：`warn`（默认，孤儿挂根、重复 id 取首）\| `strict`（抛错） |

更多实现细节见 [`lab/subscene-memo.md`](../lab/subscene-memo.md)。

```json
{
  "name": "nested-group",
  "objType": "group",
  "threeJsonId": "grp-demo",
  "position": { "x": 0, "y": 0, "z": 0 },
  "subScene": [
    {
      "name": "child-box",
      "objType": "box",
      "geometry": { "width": 50, "height": 50, "depth": 50 },
      "material": { "type": "standard", "color": "#67c23a" }
    },
    {
      "name": "child-subgroup",
      "objType": "group",
      "subScene": [
        {
          "name": "grandchild-sphere",
          "objType": "sphere",
          "geometry": { "radius": 20 },
          "material": { "type": "standard", "color": "#409eff" }
        }
      ]
    }
  ]
}
```

## 组合 group

组合由 `createGroup()` 创建空壳 `THREE.Group`；经 **`createJsonScene` / `deployObjectRecord`** 等统一加载链部署时，会读取 **`subScene`** 并递归挂子对象。若仅调用 `createGroup()` + 手动 `scene.add(group)`，需自行 deploy 子节点。

```js
{
  name: "simple-group",
  objType: "group",
  position: { x: 0, y: 0, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  subScene: [
    {
      name: "group-box-a",
      objType: "box",
      geometry: { width: 50, height: 50, depth: 50 },
      position: { x: -40, y: 25, z: 0 },
      rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
      scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
      material: { type: "standard", color: "#67c23a" }
    },
    {
      name: "group-box-b",
      objType: "box",
      geometry: { width: 40, height: 70, depth: 40 },
      position: { x: 35, y: 35, z: 20 },
      material: { type: "standard", color: "#e6a23c" }
    }
  ]
}
```

**兼容说明**：旧示例中的 `boxModelList` / `subGroup` 写在 **group 记录内** 时，请在加载前依赖归一化迁移，或手改为上例的 `subScene` 写法。Tutorial 参考：[`assets/json/tutorial/track-01/01-01-group-line-panel.json`](../assets/json/tutorial/track-01/01-01-group-line-panel.json)。

## 线条 line

普通线条用 `createLine()`，宽线用 `createLine2()`。`LineBasicMaterial` 在多数 WebGL 环境中不支持实际线宽，若需要线宽应使用 `createLine2()`。

```js
{
  name: "path-line",
  objType: "line",
  material: {
    color: "#1AD4D4",
    opacity: 0.85,
    transparent: true,
    linewidth: 4
  },
  points: [
    { x: -120, y: 5, z: -80 },
    { x: 0, y: 5, z: 80 },
    { x: 120, y: 5, z: -80 }
  ]
}
```

## 信息面板 infoPanel

完整选型、分类型示例与 Demo 索引见 **[信息面板专题](./info-panels.md)**。

信息面板由 `deployInfoPanel(scene, infoPanel)` 创建。载体字段为 `panelBoxType`，可选 `box`、`sprite` 或 `plane`；`sprite` 会始终面向相机，`plane` 为固定朝向平面（+Z 贴图）。旧 `boxType` 仍兼容读取。`type` 可选 `text`、`html`、`img`。

**行为字段**：

| 字段 | 默认 | 说明 |
|------|------|------|
| `visible` | `true` | 为 `false` 时不创建 |
| `dismissTrigger` | `none` | 关闭面板触发：`none` / `click` / `dblclick` / `keydown`（Escape，document 级） |
| `fix` | — | **已弃用**；`true` → 等同 `dismissTrigger: "none"`；`false` → 等同 `"dblclick"` |
| `textFace` | `single` | 仅 `panelBoxType: "box"`：`single` 正面贴图；`full` 六面同贴图（plane/sprite 忽略） |

- `type: "text"`：走 `createStrTextureMultiline`，可用 `font` 或结构化 `textStyle` 调整字号与排版；`backColor` 烘焙进贴图背景。
- `type: "html"`：以 `text` 内部 HTML/CSS 为准，不改写内容字体；可用 `contentScale`（或 `contentScaleX/Y`）缩放最终纹理显示尺寸。
- `type: "img"`：同样支持 `contentScale`（或 `contentScaleX/Y`）缩放显示尺寸；圆角需图片自带透明通道，或后续扩展 Canvas 裁剪。
- `borderRadius`：面板圆角半径（纹理逻辑像素，`0` 为直角，默认 `0`）。与 `css3dPanel` 字段语义一致；`sprite` / `box` 均通过贴图 alpha 实现圆角。

```js
{
  text: "ThreeJSON 信息面板",
  type: "text",
  objType: "infoPanel",
  panelBoxType: "sprite",
  visible: true,
  fix: true,
  color: "#ffffff",
  backColor: "#303133",
  borderRadius: 8,
  panelWidth: 16,
  panelHeight: 7,
  panelDepth: 0.2,
  transparent: true,
  opacity: 0.85,
  font: "18px Microsoft YaHei",
  textStyle: {
    fontSizePx: 22,
    autoFit: true,
    fitRatio: 0.78,
    minFontPx: 14,
    maxFontPx: 72
  },
  contentScale: 1,
  panel: {
    geometry: { width: 16, height: 7, depth: 0.2 },
    position: { x: 0, y: 14, z: 0 },
    material: { color: "#303133", transparent: true, opacity: 0.85 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  }
}
```

`textStyle` 常用字段：

- `fontSizePx`、`fontFamily`
- `padding`、`lineHeight`
- `autoFit`、`fitRatio`、`minFontPx`、`maxFontPx`

**盒体 + 文字**（`panelBoxType: "box"`）：

```js
{
  type: "text",
  panelBoxType: "box",
  text: "盒体文字面板",
  color: "#fff",
  backColor: "#409eff",
  panelWidth: 12,
  panelHeight: 6,
  panelDepth: 0.4,
  panel: { position: { x: 0, y: 8, z: 0 } }
}
```

**精灵 + HTML**（`type: "html"`，静态贴图不可点击）：

```js
{
  type: "html",
  panelBoxType: "sprite",
  text: "<div style='padding:8px;background:#fff'>HTML 标牌</div>",
  panelWidth: 18,
  panelHeight: 6,
  panel: { position: { x: 0, y: 12, z: 0 } }
}
```

## device 域设备面板触发

写在 **device 域 record**（如 `domain: "device.ups"`）上，与独立 `infoPanelList` 条目不同。完整 API 见 [api.md § domains/device](./api.md#domainsdevice-设备面板)。

| 字段 | 说明 |
|------|------|
| `panelShowTrigger` | 显式写入才派生 ELM：`hover` / `click` / `dblclick` / `none` |
| `panelHideTrigger` | 显式写入才派生 ELM：`mouseleave` / `click` / `dblclick` / `panel.click` / `panel.dblclick` / `none` |
| `panelHideDelayMs` | `hide=mouseleave` 时的延迟毫秒 |
| `infoPanel.visible` | deploy **初始**显隐：省略或 `true` → 显示；`false` → 隐藏 |
| `infoPanel.dismissTrigger` | 面板自关闭（优先于 `panelHideTrigger: panel.*`） |

同 record 上 `panelShowTrigger` 与 `panelHideTrigger` 为同一平台事件（如均为 `dblclick`）时，派生 **`device.togglePanel`** 一条绑定。`events.*` 显式配置优先于上述派生。

```json
{
  "objType": "domain",
  "domain": "device.ups",
  "panelShowTrigger": "dblclick",
  "panelHideTrigger": "dblclick",
  "infoPanel": {
    "visible": false,
    "dismissTrigger": "dblclick",
    "type": "html",
    "text": "<div>UPS</div>"
  }
}
```

## 可交互 CSS3D 面板 css3dPanel（core）

静态标牌请继续用 **`infoPanel`**（`type: html` 走 html2canvas 贴图，不可点击）。需要 **可交互 DOM / iframe** 时使用 **`css3dPanel`**（core 一等能力，与 `infoPanel` 同级）。

- 友好列表：`worldInfo.css3dPanelList[]`（与 `infoPanelList` 对称）
- 场景开关：`sceneConfig.extensions["css3d"]` — `enabled`、`pointerPolicy`（`panel` | `orbit` | `auto`）
- 加载：`createJsonScene` 即可；部署后自动 traverse 场景图，有 `CSS3DObject` 时挂载第二 pass

`content.type` 为 `html` 或 `url`（iframe）。`width` / `height` 为 DOM 像素尺寸；`panelWidth` 为场景世界宽度（用于缩放 DOM 到 3D 空间）。

```js
{
  objType: "css3dPanel",
  name: "ops-console",
  width: 320,
  height: 200,
  panelWidth: 3,
  position: { x: 0, y: 4, z: 0 },
  content: { type: "html", html: "<button>确认</button>" }
}
```

实现位于 [`core/builder/css3d/`](../core/builder/css3d/)。

## 热力图 heatMap

- **平面**：`createHeatmap(heatObj, scene)`。仅用 `geometry.width` / `height`；字段 `geometry.depth`（若存在）**忽略**。点数据中可仍有 `z` 等字段；栅格仅在平面内采样。
- **三维体**：`createHeatmapVolume(heatObj, scene)`；需有效 `geometry.depth > 0`，否则退化平面。
- **统一 world 加载**：当数据放在 `worldInfo.heatList` 并经 `createJsonScene()` / `deployJsonScene()` 进入统一加载链时，运行时会自动判断 `geometry.depth`。`depth > 0` 时走三维体热力，否则走平面热力。

热力纹理由 GPU 侧的 `DataTexture` / `Data3DTexture`（非 canvas）栅格生成后贴几何体。

```js
{
  geometry: { width: 300, height: 180 },
  position: { x: 0, y: 2, z: 0 },
  rotation: { rotationX: -Math.PI / 2, rotationY: 0, rotationZ: 0 },
  heatMap: [
    { x: 80, y: 80, temperature: 28 },
    { x: 180, y: 100, temperature: 35 }
  ]
}
```

## 动态平面 wind

条带风由 **weather 域**（`domains/weather`）部署：`deployWindStrip` / `createWind`（core 薄封装）创建带纹理的 `Plane`，UV 滚动在帧循环中由 `planeScrollMotion` 更新（与 `points` 的 `scrollUv` 同类）。使用 `createSceneRuntime()` 时需挂载 `updateSceneAnimations` 或等效帧循环。

handler 预设：`wind` | `coldWind` | `hotWind`（亦可在 `domainModelList` 写 `domain: "weather", handler: "coldWind"`）。

```js
{
  objType: "wind",
  speed: 1,
  geometry: { width: 80, height: 180 },
  position: { x: -120, y: 90, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  material: {
    textureUrl: "/assets/textures/environment/nature/weather/wind_cold_left.png",
    textureRepeat: { x: 0.1, y: 8 },
    transparent: true,
    opacity: 0.85,
    side: "double"
  }
}
```

**贴图与 UV 滚动**

- 资源目录 [`assets/textures/environment/nature/weather/`](../assets/textures/environment/nature/weather/) 提供 `wind_{cold,hot}_{left,right}.png`；箭头沿贴图 **U 轴**（横向），默认使用 **U 轴滚动**（省略 `scrollAxis` 或设为 `u`）。勿对横向箭头贴图随意设 `scrollAxis: "v"`，否则流动感很弱。
- `scrollAxis: "v"` 仅适用于纹理本身为纵向条纹的资源。
- **反向流动**优先级：`speed` 负数 > 换用 `_right` 贴图 > 调整 `rotationZ`。`speed` 可为任意非零有限值，负号表示 UV 偏移反向。
- 垂直上下流向靠 **平面旋转** + U 滚动实现，不靠 left/right 贴图区分。

## 外部模型 obj/gltf/glb/threejson

推荐统一使用 `objType: "externalModel"`，并交给 `loadExternalModel(externalModel, scene)` 分发。`worldInfo.externalModelList`、`objModelList` 以及旧 `objType: "gltf"` 等写法都仍兼容。

- `modelFileType: "obj"`：OBJLoader；可选 `mtlPath`，用于先加载 MTL 后加载 OBJ。若 JSON 未写 `mtlPath`，运行时还会尝试从 `.obj` 内容中的 `mtllib` 自动推导同目录 `.mtl`。
- `modelFileType: "gltf"` / `"glb"`：GLTFLoader。
- `modelFileType: "stl"` / `"ply"` / `"fbx"` / `"usdz"`（或 `"usd"`）：按扩展名懒加载对应 Three.js Loader，从 URL / blob 读取二进制后解析。
- `modelFileType: "three"` / `"threejson"` / `"object"`：Three.js `ObjectLoader` 加载 **Object/Scene** JSON（`Object3D.toJSON()` / 编辑器导出格式，非已废弃的 `JSONLoader` 几何文件）。

与 mesh 导出对称的格式集合：`glb`、`gltf`、`obj`、`stl`、`ply`、`usdz`、`fbx`。未知 `modelFileType` 将抛出 `E_EXTERNAL_MODEL_UNSUPPORTED`，不再误走 OBJLoader。
- `mtl` 在当前实现中仅作为 `obj` 的依赖材质描述文件，不作为独立可见模型渲染。

OBJ 贴图优先级如下：

1. `.mtl` 内已声明的贴图（如 `map_Kd`、`norm`、`map_bump` 等）。
2. OBJ 记录中的显式 `maps` 字段。
3. 若未配置 `maps`，尝试从 OBJ 或 MTL 同目录下的 `maps/` 文件夹按约定命名回退（可用 `mapsFolderFallback` 控制范围，见下文）。
4. 历史兼容字段 `material.textureUrl` / `material.map`（仅作为 `map` 槽位兜底）。
5. 在 `maps` 的槽位对象上可写 **`textureKind: "video"`**（及 `videoMuted` / `videoLoop` 等）或 **`textureKind: "gif"`**（及 `gifAutoplay` / `gifPlaybackRate` / `gifMaxFps`），与盒/球/平面等 primitive 材质约定相同；详见 [domains.md](./domains.md) 与 [../core/BUSINESS_DOMAINS.md](../core/BUSINESS_DOMAINS.md)。`textureKind` 省略或为 `image` 时，`.gif` URL 仍按静态图加载（仅首帧）；动画需显式 `gif`。

```js
{
  objType: "externalModel",
  modelFileType: "obj",
  modelPath: "/assets/model/obj/medium_cargo_ship/medium_cargo_ship.obj",
  mtlPath: "/assets/model/obj/medium_cargo_ship/medium_cargo_ship.mtl",
  position: { x: 0, y: 0, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
}
```

### 最小标准片段：`objectList` 指向 glTF

```json
{
  "objectList": [
    {
      "objType": "externalModel",
      "modelFileType": "gltf",
      "modelPath": "/assets/model/gltf/threejson_unlit_pyramid.gltf",
      "position": { "x": 0, "y": 12, "z": 0 },
      "scale": { "scaleX": 24, "scaleY": 24, "scaleZ": 24 }
    }
  ]
}
```

完整可走通示例：[03-01-external-gltf.html](../examples/html-demo/track-03-assets/03-01-external-gltf.html) 与 `assets/json/tutorial/track-03/03-01-external-gltf.json`。

### OBJ 显式 `maps`

推荐把 OBJ 贴图写在记录顶层，而不是塞进 `material`，这样更容易和旧 `material.textureUrl` 区分：

```js
{
  objType: "externalModel",
  modelFileType: "obj",
  modelPath: "/assets/model/obj/crane/crane.obj",
  mtlPath: "/assets/model/obj/crane/crane.mtl",
  mapsBasePath: "/assets/model/obj/crane/maps/",
  maps: {
    map: "baseColor.png",
    normalMap: "normal.png",
    roughnessMap: "roughness.png",
    metalnessMap: "metalness.png",
    alphaMap: {
      url: "alpha.png",
      repeat: { x: 1, y: 1 },
      offset: { x: 0, y: 0 }
    }
  }
}
```

说明：

- `mapsBasePath` 可选；当 `maps` 里的值是相对路径时，会以它为基准解析。未提供时默认相对 `modelPath` 所在目录。
- `maps` 当前支持这些常见槽位：`map`、`normalMap`、`roughnessMap`、`metalnessMap`、`aoMap`、`emissiveMap`、`bumpMap`、`alphaMap`、`specularMap`。
- 每个槽位既可直接写字符串，也可写对象；对象最常用字段是 `url`、`repeat`、`offset`、`rotation`、`center`、`colorSpace`。
- 当模型已经通过 MTL 获得某个槽位的贴图时，JSON `maps` 不会覆盖该槽位，只会补齐缺失槽位。

### OBJ 同目录 `maps/` 回退

如果 OBJ 记录没有配置 `maps`，运行时会尝试从与 OBJ 或 MTL 同目录的 `maps/` 文件夹加载贴图。

**`mapsFolderFallback`**（可选，写在 OBJ / `externalModel` 记录顶层，或 `material` 内）只控制上述 sibling `maps/` 这一步，不影响 MTL 贴图、显式 `maps` 或 `material.textureUrl`：

| 值 | 含义 |
|----|------|
| `"map"` | **默认**（省略字段等同此值）：仅在 `maps/` 中回退 diffuse / `map` 槽 |
| `"full"` | 在 `maps/` 中回退全部 9 个贴图槽位（见下表） |
| `"off"` | 关闭 sibling `maps/` 回退 |

```json
{
  "modelPath": "/assets/model/obj/maps_fallback/alpaca.obj",
  "material": { "color": "#2F3133" },
  "mapsFolderFallback": "off"
}
```

由于浏览器环境不能可靠枚举目录内容，这个回退依赖固定命名约定。`mapsFolderFallback: "full"` 时（或省略且需全槽位时显式写 `"full"`）会尝试如下文件名：

- `map`：`map.*`、`baseColor.*`、`albedo.*`、`diffuse.*`、`color.*`
- `normalMap`：`normalMap.*`、`normal.*`
- `roughnessMap`：`roughnessMap.*`、`roughness.*`
- `metalnessMap`：`metalnessMap.*`、`metalness.*`、`metallic.*`
- `aoMap`：`aoMap.*`、`ao.*`、`ambientOcclusion.*`
- `emissiveMap`：`emissiveMap.*`、`emissive.*`、`emission.*`
- `bumpMap`：`bumpMap.*`、`bump.*`、`height.*`
- `alphaMap`：`alphaMap.*`、`alpha.*`、`opacity.*`
- `specularMap`：`specularMap.*`、`specular.*`

扩展名当前会尝试：`png`、`jpg`、`jpeg`、`webp`、`bmp`。

例如：

```text
/assets/model/obj/crane/
  crane.obj
  crane.mtl
  maps/
    baseColor.png
    normal.png
    roughness.png
```

### 最小标准片段：`objectList` 指向原生 JSON

以下示例统一使用站点根路径，便于项目根目录页面与 `examples/html-demo/` 页面共用同一份资源。

```json
{
  "objectList": [
    {
      "objType": "externalModel",
      "modelFileType": "three",
      "modelPath": "/assets/json/three_native.json",
      "position": { "x": 0, "y": 0.5, "z": 0 }
    }
  ]
}
```

### 最小标准片段：`domain` + `nativeThree`

与 [`objType: "native"`](#objtype-native通用-threejs-对象)（**单条** ObjectLoader record）不同，本域加载 **整段** Three.js Object/Scene JSON（URL 或内联）。

与 `applyDomainModelsFromWorldInfo(scene, worldInfo)` 配合。业务域总览、注册方式与自定义扩展示例见 [业务域与 `domains/`](./domains.md)；底层实现约束补充见 [BUSINESS_DOMAINS.md](../core/BUSINESS_DOMAINS.md)。下例为 **`loadFromUrl`**；编辑器「加载原生 JSON」还会使用 **`handler: "parseInline"`** 与同域 `record.json` 的内联对象图（不写 `modelPath`）。

```json
{
  "objectList": [
    {
      "objType": "domain",
      "domain": "nativeThree",
      "handler": "loadFromUrl",
      "modelPath": "/assets/json/three_native.json",
      "position": { "x": 0, "y": 0.5, "z": 0 }
    }
  ]
}
```

完整可走通示例：[03-03-native-three-domain.html](../examples/html-demo/track-03-assets/03-03-native-three-domain.html)、[03-03-native-three-domain.json](../assets/json/tutorial/track-03/03-03-native-three-domain.json)（子图文件 **`assets/json/three_native.json`** 分文件存放，便于演示「编排 JSON」与「原生子图 JSON」分离）。

## CSG：合并、相交、挖洞

盒子和球体支持 `joins`、`inters`、`holes` 三类数组，内部通过 `three-bvh-csg` 进行布尔运算。

```js
{
  name: "wall-with-hole",
  objType: "wall",
  geometry: { width: 220, height: 120, depth: 20 },
  position: { x: 0, y: 60, z: 0 },
  rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
  scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
  material: { type: "standard", color: "#dcdfe6" },
  holes: [
    {
      geometry: { width: 80, height: 60, depth: 30 },
      position: { x: 0, y: 60, z: 0 },
      rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
      scale: { scaleX: 1, scaleY: 1, scaleZ: 1 },
      material: { type: "standard", color: "#ffffff" }
    }
  ]
}
```

CSG 比普通几何体更耗时，建议只用于确实需要布尔运算的模型。

## 盒子列表聚合：`instanceCode` / `mergeCode`

对于重复盒子较多的业务场景，可以先调用 `coalesceBoxModelList(boxModelList)`，把历史 JSON 中共享编码的条目合并成更紧凑的结构：

- 共享 `instanceCode` 的盒子会聚合为一条 `instance: true` 记录，并生成 `transforms` 数组，最终走 `InstancedMesh`。
- 共享 `mergeCode` 的盒子会聚合为一条 `merge: true` 记录，并生成 `geometryArr`、`materialArr`、`transforms` 等字段，最终走几何合并。

最小示例：

```js
[
  {
    objType: "rackUnit",
    instanceCode: "rack-shell",
    geometry: { width: 40, height: 8, depth: 30 },
    position: { x: -30, y: 4, z: 0 },
    material: { type: "standard", color: "#409eff" }
  },
  {
    objType: "rackUnit",
    instanceCode: "rack-shell",
    geometry: { width: 40, height: 8, depth: 30 },
    position: { x: 30, y: 4, z: 0 },
    material: { type: "standard", color: "#409eff" }
  }
]
```

调用后会变成一条实例化记录；`createJsonScene` 加载友好 JSON 时会通过 `normalizeScenePayload` 自动执行这层聚合（业务 demo 如 `room-show.html`、`port-show.html` 无需在页面层重复调用）。

## 暂不纳入当前 JSON 主线的能力

下面这些能力并非 Three.js 本身不支持，而是 **ThreeJSON 当前刻意没有做成一等 JSON schema**（或仅部分支持）：

- **骨骼动画进阶**：`animationGraph` 状态机与 runtime API 已支持 glTF 剪辑切换；morph target 状态机仍不在范围
- **GPU 粒子引擎**（超出 `THREE.Points` 的专用发射器库）
- **更多曲线曲面**：`ExtrudeGeometry`、`LatheGeometry`、`ShapeGeometry`、NURBS 等
- **`FBX`、`STL`、`PLY`、`DAE`** 等更多模型格式的统一主链支持
- **纯 CSS3D 场景 / 替换 WebGL 主渲染器**：不支持；可交互 DOM 见 core **`css3dPanel`**（双 pass，与 `infoPanel` 静态贴图分工）

现阶段建议：

- 静态复杂模型：`externalModelList` 或 `nativeThree`；需区分「角色/骨骼」语义时用 **`skinnedList`**。
- 管道路径：优先 **`tubeList`**；大面积贴图面片用 **`plane`** / **`wind`**。
- 点云/简单粒子：**`particleList`**（`THREE.Points`）。
