[中文](./json-format.md) | [English](../en/json-format.md)

# ThreeJSON JSON 配置手册

ThreeJSON JSON 是对 Three.js 场景的声明式描述。它由两部分组成：

- 运行时配置：场景、相机、渲染器、控制器、灯光、资源、事件、渲染循环。
- 场景对象：几何体、材质、模型、domain 对象、扩展对象、面板、音频等。

ThreeJSON 支持两种等价写法：

- 标准 JSON：以统一的 `objectList` 为核心，推荐用于程序与 AI 生成、存储和差异比较。
- 友好 JSON：以 `worldInfo` 中的分类列表为核心，适合人类阅读、手写和示例。

加载时，友好 JSON 会被归一化为标准对象列表；导出时也可以在两种格式之间转换。

## 1. 最小结构

```json
{
  "version": "next",
  "name": "hello-threejson",
  "sceneConfig": {
    "scene": { "background": "#11151b" },
    "camera": { "fov": 55, "near": 0.1, "far": 200, "position": { "x": 10, "y": 8, "z": 12 } },
    "controls": { "enableDamping": true, "target": { "x": 0, "y": 1.5, "z": 0 } },
    "lights": [{ "type": "ambient", "intensity": 1 }],
    "renderLoop": { "autoResize": true, "firstAutoResize": true }
  },
  "worldInfo": {
    "boxModelList": [
      {
        "threeJsonId": "box-1",
        "objType": "box",
        "geometry": { "width": 3, "height": 3, "depth": 3 },
        "position": { "x": 0, "y": 1.5, "z": 0 },
        "material": { "type": "standard", "color": "#5470c6" }
      }
    ]
  }
}
```

## 2. 顶层字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | string | JSON 版本标识。当前示例常用 `next`。 |
| `threeJsonId` | string | 场景文档 ID。不是场景内对象 ID。 |
| `name` | string | 场景名称。 |
| `label` | string | 显示名称。 |
| `sceneConfig` | object | 运行时配置。 |
| `worldInfo` | object | 友好 JSON 的对象分类列表和场景元信息。 |
| `objectList` | array | 标准 JSON 的对象列表。 |
| `friendlyMap` | object | 自定义友好列表映射规则。高级用法。 |
| `subSceneList` | array | 子场景定义。 |
| `extensions` | object | 扩展配置。 |

当 `objectList` 与 `worldInfo` 同时存在且 `objectList` 非空时，加载器优先按标准 JSON 处理对象列表。

## 3. 标准 JSON

标准 JSON 把运行时记录和对象记录都放在 `objectList` 中。它适合编辑器保存、精确 diff 和程序生成。

```json
{
  "version": "next",
  "objectList": [
    {
      "objType": "scene",
      "background": "#11151b"
    },
    {
      "objType": "camera",
      "fov": 55,
      "position": { "x": 10, "y": 8, "z": 12 }
    },
    {
      "objType": "light",
      "lightType": "ambient",
      "intensity": 1
    },
    {
      "threeJsonId": "box-1",
      "objType": "box",
      "geometry": { "width": 3, "height": 3, "depth": 3 },
      "material": { "color": "#5470c6" }
    }
  ]
}
```

常见运行时 `objType`：

| `objType` | 说明 |
| --- | --- |
| `scene` | 背景、环境、雾等场景配置。 |
| `camera` | 相机配置。 |
| `renderer` | 渲染器配置。 |
| `controls` | 控制器配置。 |
| `light` | 灯光记录。 |
| `renderLoop` | 渲染循环配置。 |

## 4. 友好 JSON

友好 JSON 把对象按用途放在 `worldInfo` 的分类列表里。

```json
{
  "sceneConfig": {
    "scene": { "background": "#11151b" },
    "camera": { "position": { "x": 10, "y": 8, "z": 12 } }
  },
  "worldInfo": {
    "boxModelList": [],
    "sphereModelList": [],
    "lineList": [],
    "domainModelList": []
  }
}
```

常用列表：

| 列表 | 典型 `objType` | 说明 |
| --- | --- | --- |
| `boxModelList` | `box`、`cylinder`、`cone`、`ring`、`torus`、`capsule` | 基础几何体。 |
| `sphereModelList` | `sphere` | 球体。 |
| `meshList` | `box`、`sphere` | 兼容列表，主要用于基础 mesh。 |
| `groupList` | `group` | 分组对象。 |
| `lineList` | `line` | 线段、折线。 |
| `planeList` | `plane` | 平面。 |
| `spriteList` | `sprite` | 精灵对象。 |
| `particleList` | `points`、粒子对象 | 点云和粒子。 |
| `tubeList` | `tube` | 管线。 |
| `instancedList` | `instanced` | 实例化对象。 |
| `externalModelList` | `externalModel` | glTF、OBJ、FBX 等外部模型。 |
| `objModelList` | `externalModel` 或兼容 OBJ 记录 | OBJ 兼容列表。 |
| `domainModelList` | `domain` | 业务 domain 对象。 |
| `infoPanelList` | `infoPanel` | 3D 信息面板。 |
| `css3dPanelList` | `css3dPanel` | CSS3D 面板。 |
| `heatList` | `heatMap` | 热力图。 |
| `windList` | `wind` | 风场。 |
| `shaderSurfaceList` | `shaderSurface` | 着色器表面。 |
| `shapePlaneList` | `shapePlane` | 形状平面。 |
| `shapeExtrudeList` | `shapeExtrude` | 形状拉伸。 |
| `irregularPlaneList` | `irregularPlane` | 不规则平面。 |
| `irregularGeometryList` | `irregularGeometry` | 不规则几何。 |
| `bufferMeshList` | `bufferMesh` | 显式 BufferGeometry。 |
| `audioList` | `audio` | 场景音频。 |
| `skinnedList` | `skinned` | 骨骼模型。 |

## 5. `sceneConfig`

`sceneConfig` 描述运行时环境。

```json
{
  "sceneConfig": {
    "assetsBase": "/assets",
    "assetsBaseMode": "base-first",
    "scene": { "background": "#11151b" },
    "camera": { "fov": 55, "near": 0.1, "far": 200, "position": { "x": 10, "y": 8, "z": 12 } },
    "renderer": { "antialias": true, "ratioRate": 1 },
    "controls": { "enableDamping": true, "target": { "x": 0, "y": 1.5, "z": 0 } },
    "lights": [{ "type": "ambient", "color": "#ffffff", "intensity": 1 }],
    "renderLoop": { "autoResize": true, "firstAutoResize": true }
  }
}
```

### 5.1 场景

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `scene.background` | string/object | 背景。可写颜色字符串，例如 `"#11151b"`；也可写对象形式。 |
| `scene.environment` | string/object | 环境贴图。 |
| `scene.fog` | object | 雾配置，具体字段按 Three.js Fog/FogExp2 语义。 |

背景对象常见写法：

```json
{
  "scene": {
    "background": { "type": "color", "value": "#11151b" }
  }
}
```

### 5.2 相机

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 相机类型。默认透视相机。 |
| `fov` | number | 透视相机视角。 |
| `near` / `far` | number | 裁剪面。 |
| `position` | Vector3 | 相机位置。 |
| `target` | Vector3 | 看向目标。 |
| `lookAt` | Vector3 | 看向位置。 |
| `up` | Vector3 | 相机上方向。 |

### 5.3 渲染器

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `antialias` | boolean | 是否抗锯齿。 |
| `alpha` | boolean | 是否开启透明背景。 |
| `preserveDrawingBuffer` | boolean | 是否保留绘图缓冲，截图时有用。 |
| `shadowMapEnabled` | boolean | 是否开启阴影。 |
| `ratioRate` | number | 像素比倍率。最终像素比为 `devicePixelRatio * ratioRate`。 |
| `clearAlpha` | number | 清屏透明度。 |

### 5.4 控制器

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 控制器类型。默认使用 Orbit 风格控制器。 |
| `enabled` | boolean | 是否启用控制器。 |
| `target` | Vector3 | 旋转/缩放中心。 |
| `enableDamping` | boolean | 是否启用阻尼。 |
| `dampingFactor` | number | 阻尼系数。 |
| `enableZoom` / `enableRotate` / `enablePan` | boolean | 分别控制缩放、旋转、平移。 |
| `minDistance` / `maxDistance` | number | 缩放距离限制。 |

### 5.5 灯光

`lights` 是数组。常用类型：

```json
[
  { "type": "ambient", "color": "#ffffff", "intensity": 0.8 },
  { "type": "directional", "color": "#ffffff", "intensity": 1.2, "position": { "x": 10, "y": 16, "z": 12 } },
  { "type": "point", "color": "#ffdd99", "intensity": 1200, "distance": 120, "position": { "x": 0, "y": 8, "z": 0 } }
]
```

| 字段 | 说明 |
| --- | --- |
| `type` | `ambient`、`directional`、`point` 等。 |
| `color` | 灯光颜色。 |
| `intensity` | 光照强度。 |
| `position` | 需要位置的灯光使用。 |
| `target` | 方向灯等可使用。 |
| `distance` / `decay` | 点光源等可使用。 |

### 5.6 渲染循环

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `autoStart` | boolean | 是否自动启动。 |
| `autoResize` | boolean | 是否监听容器尺寸变化。 |
| `firstAutoResize` | boolean | 首次加载后是否立即适配尺寸。 |
| `enabled` | boolean | 是否启用渲染循环。 |

### 5.7 资源

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `assetsBase` | string | 资源基址，例如 `/assets` 或 CDN URL。 |
| `assetsBaseMode` | string | 资源模式，见下表。 |

可用 `assetsBaseMode`：

| 值 | 说明 |
| --- | --- |
| `base-first` | 优先使用 `assetsBase`。 |
| `cdn-first` | 优先使用 `@threejson/assets` CDN。 |
| `local-first` | 优先使用 `/assets`。 |
| `base-only` | 只使用 `assetsBase`。 |
| `cdn-only` | 只使用 CDN。 |
| `local-only` | 只使用 `/assets`。 |

## 6. 对象通用字段

所有场景对象都可以使用以下字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `threeJsonId` | string | ThreeJSON 稳定对象 ID。强烈建议每个可交互对象都设置。 |
| `objType` | string | 对象类型。 |
| `name` | string | Three.js 对象名称。 |
| `label` | string | UI 显示名称。 |
| `refName` | string | 业务引用名，可用于查询。 |
| `visible` | boolean | 是否可见。 |
| `position` | Vector3 | 位置。 |
| `rotation` | Vector3 | 旋转。 |
| `scale` | Vector3 或 number | 缩放。 |
| `parent` / `parentId` | string | 父对象引用。 |
| `children` | array | 子对象列表，常用于 `group`。 |
| `geometry` | object | 几何参数。 |
| `material` | object/array | 材质参数。 |
| `animations` | array/object | 动画配置。 |
| `events` | array/object | 事件配置。 |
| `businessInfo` | object | 业务信息，domain 和 UI 可使用。 |
| `userData` | object | 附加数据。 |
| `customBucket` | string/array | 自定义分组桶，用于可见性和查询。 |

Vector3 可写完整对象：

```json
{ "x": 1, "y": 2, "z": 3 }
```

也可以在部分字段中只写需要覆盖的轴：

```json
{ "y": 2 }
```

## 7. 基础几何体

基础几何体通过 `objType` 和 `geometry` 描述。

### 7.1 盒子 `box`

```json
{
  "threeJsonId": "box-1",
  "objType": "box",
  "geometry": { "width": 3, "height": 2, "depth": 1 },
  "material": { "type": "standard", "color": "#5470c6" }
}
```

### 7.2 球体 `sphere`

```json
{
  "threeJsonId": "sphere-1",
  "objType": "sphere",
  "geometry": { "radius": 2, "widthSegments": 32, "heightSegments": 16 },
  "material": { "type": "standard", "color": "#73c0de" }
}
```

### 7.3 圆柱、圆锥、圆环、胶囊

```json
{ "objType": "cylinder", "geometry": { "radiusTop": 1, "radiusBottom": 1, "height": 3, "radialSegments": 32 } }
```

```json
{ "objType": "cone", "geometry": { "radius": 1.5, "height": 3, "radialSegments": 32 } }
```

```json
{ "objType": "torus", "geometry": { "radius": 2, "tube": 0.35, "radialSegments": 16, "tubularSegments": 64 } }
```

```json
{ "objType": "capsule", "geometry": { "radius": 0.8, "length": 2, "capSegments": 8, "radialSegments": 16 } }
```

### 7.4 平面 `plane`

```json
{
  "objType": "plane",
  "geometry": { "width": 10, "height": 10 },
  "rotation": { "x": -1.5708, "y": 0, "z": 0 },
  "material": { "color": "#3a3f45", "side": "double" }
}
```

### 7.5 分组 `group`

```json
{
  "threeJsonId": "group-1",
  "objType": "group",
  "position": { "x": 0, "y": 0, "z": 0 },
  "children": [
    { "threeJsonId": "child-box", "objType": "box", "geometry": { "width": 1, "height": 1, "depth": 1 } }
  ]
}
```

## 8. 材质与纹理

### 8.1 常用材质字段

```json
{
  "material": {
    "type": "standard",
    "color": "#5470c6",
    "roughness": 0.45,
    "metalness": 0.1,
    "transparent": true,
    "opacity": 0.85,
    "side": "double"
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `type` | 材质类型。常用 `basic`、`standard`、`physical`、`lambert`、`phong`。 |
| `color` | 基础颜色。 |
| `opacity` | 透明度。小于 1 时通常同时设置 `transparent: true`。 |
| `transparent` | 是否透明。 |
| `side` | 渲染面，可用 `front`、`back`、`double`。 |
| `roughness` | 粗糙度，PBR 材质常用。 |
| `metalness` | 金属度，PBR 材质常用。 |
| `emissive` | 自发光颜色。 |
| `emissiveIntensity` | 自发光强度。 |
| `wireframe` | 是否线框。 |

### 8.2 纹理

```json
{
  "material": {
    "type": "standard",
    "color": "#ffffff",
    "map": "/assets/textures/wood.webp",
    "repeat": { "x": 2, "y": 2 },
    "anisotropy": 4,
    "minFilter": "linearMipmapLinear",
    "magFilter": "linear"
  }
}
```

常见纹理字段：

| 字段 | 说明 |
| --- | --- |
| `map` / `textureUrl` | 颜色贴图。 |
| `normalMap` | 法线贴图。 |
| `roughnessMap` | 粗糙度贴图。 |
| `metalnessMap` | 金属度贴图。 |
| `emissiveMap` | 自发光贴图。 |
| `alphaMap` | 透明贴图。 |
| `repeat` | 纹理重复。 |
| `offset` | 纹理偏移。 |
| `rotation` | 纹理旋转。 |
| `wrapS` / `wrapT` | 包裹模式。 |
| `anisotropy` | 各向异性过滤。 |
| `minFilter` / `magFilter` | 采样过滤。 |
| `textureQuality` | 纹理质量配置。 |

路径建议：

- 项目资源写 `/assets/...`。
- 外部资源可写完整 URL。
- 示例资源可配合 `assetsBaseMode: "cdn-first"` 使用 `@threejson/assets` CDN。

## 9. 外部模型

外部模型使用 `externalModel`。

```json
{
  "threeJsonId": "robot-1",
  "objType": "externalModel",
  "modelFileType": "gltf",
  "modelPath": "/assets/models/robot.glb",
  "position": { "x": 0, "y": 0, "z": 0 },
  "scale": { "x": 1, "y": 1, "z": 1 }
}
```

常用字段：

| 字段 | 说明 |
| --- | --- |
| `modelFileType` | 模型格式，如 `gltf`、`glb`、`obj`、`fbx`、`stl`。 |
| `modelPath` | 模型文件路径。 |
| `mtlPath` | OBJ 材质文件路径。 |
| `mapsBasePath` | 贴图基址。 |
| `mapsFolderFallback` | 贴图文件夹兜底路径。 |
| `castShadow` / `receiveShadow` | 阴影配置。 |
| `animations` | 模型动画配置。 |

## 10. domain 对象

domain 用于把业务语义映射到 Three.js 对象。典型场景包括机柜、门、港口、天气、自然环境等。

```json
{
  "threeJsonId": "cabinet-1",
  "objType": "domain",
  "domain": "device.cabinet",
  "position": { "x": 0, "y": 0, "z": 0 },
  "businessInfo": {
    "label": "A01",
    "height": 8,
    "width": 2,
    "depth": 2
  }
}
```

常用字段：

| 字段 | 说明 |
| --- | --- |
| `objType` | 固定为 `domain`。 |
| `domain` | domain ID，例如 `device.cabinet`、`device.ups`、`nature.sky`。 |
| `handler` | 指定处理器。部分 domain 使用。 |
| `businessInfo` | 业务参数。 |
| `payload` / `options` | domain 扩展参数。 |

如果从 `threejson/core` 导入，需要确保相关 domain 已注册：

```js
import "threejson/builtins/register";
```

## 11. 面板、文本与 CSS3D

### 11.1 信息面板 `infoPanel`

```json
{
  "threeJsonId": "panel-1",
  "objType": "infoPanel",
  "position": { "x": 0, "y": 4, "z": 0 },
  "title": "设备状态",
  "items": [
    { "label": "温度", "value": "26℃" },
    { "label": "状态", "value": "正常" }
  ]
}
```

### 11.2 CSS3D 面板 `css3dPanel`

```json
{
  "threeJsonId": "css-panel-1",
  "objType": "css3dPanel",
  "position": { "x": 0, "y": 3, "z": 0 },
  "html": "<div class=\"panel\">Hello</div>"
}
```

CSS3D 面板需要页面提供对应 CSS3D 集成环境。简单 3D 场景不建议优先使用。

## 12. 事件与脚本

对象可声明事件：

```json
{
  "threeJsonId": "door-1",
  "objType": "door",
  "events": {
    "click": [
      { "type": "toggleVisible", "target": "panel-1" }
    ],
    "dblclick": [
      { "type": "script", "source": "console.log('double click door')" }
    ]
  }
}
```

常见平台事件：

| 事件 | 说明 |
| --- | --- |
| `click` | 单击。 |
| `dblclick` | 双击。 |
| `pointerdown` / `pointerup` | 指针按下/抬起。 |
| `pointermove` | 指针移动。 |
| `mouseenter` / `mouseleave` | 指针进入/离开。 |

事件动作由 core 事件机制和 domain 能力共同决定。复杂业务建议把脚本限制在可控动作集合内，避免把大段应用逻辑塞进 JSON。

## 13. 动画

对象可以声明动画配置，运行时会在渲染循环中更新。

```json
{
  "threeJsonId": "box-1",
  "objType": "box",
  "animations": [
    {
      "type": "rotation",
      "axis": "y",
      "speed": 0.8
    }
  ]
}
```

实际可用动画类型取决于当前内核和扩展注册情况。编辑器导出的动画配置优先作为权威示例。

## 14. 粒子、着色器与其它扩展

### 14.1 粒子

```json
{
  "threeJsonId": "particles-1",
  "objType": "points",
  "count": 1000,
  "position": { "x": 0, "y": 2, "z": 0 },
  "material": { "color": "#ffffff", "size": 0.05 }
}
```

使用第三方粒子 provider 时，需要在代码中导入对应扩展：

```js
import "threejson/extensions/particle-nebula";
```

### 14.2 着色器表面

```json
{
  "threeJsonId": "shader-1",
  "objType": "shaderSurface",
  "geometry": { "type": "plane", "width": 8, "height": 8 },
  "shader": { "preset": "water" }
}
```

着色器能力依赖已注册的 preset。自定义 preset 应在应用启动时注册。

## 15. 子场景

`subSceneList` 用于组织较大的场景，把对象分组为可复用或可独立管理的子场景。

```json
{
  "subSceneList": [
    {
      "threeJsonId": "floor-a",
      "name": "一层",
      "objectList": [
        { "threeJsonId": "box-a1", "objType": "box", "geometry": { "width": 1, "height": 1, "depth": 1 } }
      ]
    }
  ]
}
```

简单项目可以先不使用子场景。

## 16. ID、命名与可维护性

建议：

- 每个需要查询、编辑、交互、增量更新的对象都写 `threeJsonId`。
- `threeJsonId` 在一个场景内保持唯一。
- `name` 用于 Three.js 层级显示，`label` 用于 UI 显示，`refName` 用于业务引用。
- 几何体尺寸、材质、资源路径尽量写在对象自身，运行时 UI 状态不要写进场景 JSON。
- 路径不要写本机绝对路径，例如 `E:\...` 或 `C:\...`。
- 面向 GitHub Pages 或子路径部署时，不要假设 `/assets` 一定是站点根目录资源。必要时配置 `assetsBase`。

## 17. 格式转换

应用中可以使用 API 在标准和友好格式之间转换：

```js
import {
  normalizeScenePayload,
  buildFriendlyScenePayloadFromCanonical,
  sceneToStandardJson,
  sceneToFriendlyJson
} from "threejson/core";

const standardPayload = normalizeScenePayload(friendlyPayload);
const friendlyPayload2 = buildFriendlyScenePayloadFromCanonical(
  standardPayload,
  standardPayload
);

const standardFromScene = await sceneToStandardJson(runtime.scene);
const friendlyFromScene = await sceneToFriendlyJson(runtime.scene);
```

编辑器和官网示例中的“标准 JSON / 友好 JSON”切换，本质上也是调用这些 core 能力。

## 18. 排错清单

| 现象 | 优先检查 |
| --- | --- |
| 画布黑屏 | 控制台报错、JSON 是否有效、相机是否看向对象、灯光是否足够、对象是否在视锥内。 |
| 纹理 404 | 路径是否应走 `assetsBase`，GitHub Pages 是否部署在子目录，文件名大小写是否一致。 |
| 对象无法增量更新 | 是否有 `threeJsonId`，是否已部署并进入对象索引，字段是否支持同步更新。 |
| domain 不生效 | 是否导入了 `threejson` 主入口或 `threejson/builtins/register`。 |
| 模型无法加载 | `modelFileType` 是否正确，模型和贴图路径是否可通过浏览器访问。 |
| `file://` 报跨源或模块错误 | 改用 HTTP 服务启动页面。 |
