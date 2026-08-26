# 能力真源、Particle V2 与 WebGPU/TSL

本页说明容易与旧行为混淆的可选或预览能力。机器可读的唯一真源是 `threejson/capabilities`（也由 `threejson/core` 导出）的 `getSceneCapabilityManifest()`。它按 `stable`、`preview`、`unavailable` 记录渲染后端、对象、材质、纹理槽、后处理 Pass、模型格式、粒子后端/来源和控制器。

```js
import { getSceneCapabilityManifest } from "threejson/capabilities";

const webgl = getSceneCapabilityManifest({ rendererBackend: "webgl" });
```

默认快照会隐藏 `unavailable`，AI 提示词和宿主 UI 不应宣传这些能力。可选入口导入后会更新同一注册表。加载场景时会在部署前验证明确不可用的组合，并通过 `SceneCapabilityError.diagnostics` 返回结构化诊断，不再静默创建空对象。

## WebGL 生产主线

WebGL 仍是默认后端。普通立方体不会加载 WebGPU、栅格粒子、高级后处理或额外控制器，也不会因能力系统产生网络请求。

- 友好材质支持 `basic`、`lambert`、`phong`、`standard`、`physical`、`toon`、`matcap`、`normal`。
- Physical 包含 clearcoat、transmission、IOR、thickness/attenuation、sheen、iridescence、dispersion、specular、anisotropy 及对应 PBR 纹理槽。
- renderer JSON 支持色调映射/曝光、输出色彩空间、阴影类型、powerPreference、logarithmicDepthBuffer、reversedDepthBuffer。
- 场景实际引用 `unrealBloom`、`fxaa`、`smaa` 或已注册 `shaderPreset` Pass 时才加载高级模块，并自动装配 EffectComposer、RenderPass 与 OutputPass。
- `shaderSurface` 的含义是“已注册的 WebGL GLSL preset + 类型化 uniforms”，不是任意 shader 源码入口。
- `instanced` 可使用任意已注册 geometry/material，并支持逐实例颜色。
- RectAreaLight、LOD、GLTF/GLB/OBJ/STL/PLY/FBX/USD/USDZ 加载，以及 GLTF Draco/Meshopt/KTX2 配置均由能力 manifest 明确声明。

## Particle V2

发射器由五个互相正交的区块组成：

```json
{
  "objType": "particleEmitter",
  "source": { "type": "shell", "radius": 20, "thickness": 3 },
  "emission": { "mode": "continuous", "count": 5000, "rate": 800, "loop": true, "seed": 2026 },
  "particle": {
    "lifetime": { "min": 4, "max": 8 },
    "velocity": {
      "min": { "x": -0.2, "y": 0.1, "z": -0.2 },
      "max": { "x": 0.2, "y": 0.8, "z": 0.2 }
    },
    "sizeOverLife": [0, 4, 1],
    "colorOverLife": ["#60a5fa", "#ffffff", "#7c3aed"],
    "opacityOverLife": [0, 1, 0]
  },
  "simulation": {
    "backend": "cpu",
    "gravity": { "x": 0, "y": -0.1, "z": 0 },
    "drag": 0.03,
    "noise": { "strength": 0.1, "frequency": 1.2 },
    "attractors": [{ "position": { "x": 0, "y": 0, "z": 0 }, "strength": 8 }],
    "boundary": { "type": "wrap", "width": 60, "height": 60, "depth": 60 }
  },
  "render": { "type": "points", "size": 3, "blending": "additive", "depthWrite": false }
}
```

来源支持 `positions`、`box`、`sphere`、`shell`、`disc`、`cone`、`line`、`curve`、`meshSurface`；发射方式支持 `static`、`continuous`、`burst`；边界支持 `none`、`wrap`、`bounce`、`kill`。渲染可选择 Points 或实例化 billboard，并支持 sprite/atlas、逐粒子颜色、尺寸、透明度与旋转。

`cpu` 是功能正确的参考实现；`webgl-compute` 共用同一描述符，不再维护缩水版 schema。它依据渲染器真实纹理上限验证数量，不会静默截断。宿主可显式传入性能预算。当前跨后端统一契约最多支持 16 个吸引子和每条生命周期曲线 8 个关键帧；超出时返回结构化诊断，不会静默裁剪。

文字和图片蒙版依赖浏览器 Canvas/图片解码，因此实现不进入默认静态加载图。异步 `createJsonScene()` 在描述符实际出现 `textMask` / `imageMask` 时才按需加载 `threejson/particles-raster`；普通场景不会加载它，也不会产生图片请求。若希望预加载模块，也可显式导入：

```js
import "threejson/particles-raster";
```

两种方式均可使用 `source.type: "textMask"`（`text`、`font`、`width`、`height`、`depth`）和 `"imageMask"`（`url` 或 ImageData）；远程图片仍受 CORS 约束。同步子集 `createJsonSceneSimple()` 不执行可选模块加载，请使用异步入口。

第三方计算实现通过 `registerParticleSimulationBackend()` 注册 `simulation.backend`，并通过 `registerParticleSimulationLifecycle()` 管理更新和释放。

## 显式启用的 WebGPU/TSL 预览

WebGPU 必须显式导入。适配层以 Three.js r184 为持续测试基线，但不会把测试矩阵误作能力封锁：其他 revision 默认以 `best-effort` 运行并发出警告；需要认证组合的宿主可显式选择 `strict`：

```js
import "threejson/webgpu";
import { createJsonScene } from "threejson/core";

const result = await createJsonScene(payload, { canvas });
```

```json
{
  "sceneConfig": {
    "renderer": {
      "backend": "webgpu",
      "revisionPolicy": "best-effort",
      "compatibilityPolicy": "error"
    }
  }
}
```

`createSceneRuntime()` 保持同步且只用于 WebGL；WebGPU 使用 `createSceneRuntimeAsync()` 或 `createJsonScene()`。预览版支持 render/output/bloom RenderPipeline 与 `simulation.backend: "webgpu-compute"`。场景若包含 GLSL ShaderMaterial 或 WebGL 专属 Pass，会给出明确诊断。只有确实接受整场景回退时才设置 `compatibilityPolicy: "fallback-webgl"`。

### TSL preset

```json
{
  "material": {
    "type": "tsl",
    "base": "standard",
    "tsl": {
      "kind": "preset",
      "preset": "uv-gradient",
      "params": { "colorA": "#2563eb", "colorB": "#f97316" }
    }
  }
}
```

预览内置 `solid`、`uv-gradient`、`pulse`，宿主可调用 `registerTslPreset()`。燃烧、溶解等复杂效果不写死为针对单个示例的特殊分支，可由下述通用 graph 节点或 code 模块组合实现。

### TSL graph

```json
{
  "material": {
    "type": "tsl",
    "base": "physical",
    "roughness": 0.35,
    "tsl": {
      "kind": "graph",
      "source": {
        "inline": {
          "graphVersion": 1,
          "nodes": [
            { "id": "uv", "type": "uv" },
            { "id": "uvY", "type": "swizzle", "input": "uv", "components": "y" },
            { "id": "a", "type": "color", "value": "#1d4ed8" },
            { "id": "b", "type": "color", "value": "#fb923c" },
            { "id": "mix", "type": "mix", "a": "a", "b": "b", "factor": "uvY" }
          ],
          "outputs": { "color": "mix" }
        }
      }
    }
  }
}
```

graphVersion 1 会校验节点数量、唯一 ID、引用、循环、节点类型、输出、URL/CORS 和纹理加载。节点覆盖常量/uniform/时间、UV/位置/法线/纹理、算术、mix/smoothstep/clamp、常见一元运算、普通噪声、fractal noise 与 swizzle。`call` 节点可调用当前 `three/tsl` 实际导出的函数；宿主也可通过 `registerTslGraphNode()` 注册新的可序列化节点。输出可以映射到目标 NodeMaterial 实际提供的任意安全 `*Node` 属性，而不是由 ThreeJSON 维护一个滞后的固定白名单。

### 外部模型材质绑定

GLTF/GLB 加载完成后，可按节点名、节点路径、节点类型、mesh 序号、材质名或材质槽序号，将原模型材质替换为任意已注册材质，包括 TSL：

```json
{
  "objType": "externalModel",
  "modelFileType": "glb",
  "modelPath": "/assets/head.glb",
  "materialBindings": [{
    "selector": { "nodeName": "Head*" },
    "required": true,
    "material": {
      "type": "tsl",
      "base": "standard",
      "transparent": true,
      "tsl": { "kind": "graph", "source": { "url": "/materials/burn.graph.json" } }
    }
  }]
}
```

可运行的完整内联燃烧 graph 见 `examples/webgpu/tsl-burning-model.json`。`selector` 为空或 `{ "all": true }` 时匹配全部材质槽；字符串选择器支持 `*`/`?`。`mode` 可为 `replace`（默认）或 `patch`，`shareMaterial` 控制多个命中槽是否共享同一材质。TSL 替换材质还支持 `inheritOriginal: "textures" | "all"`，可沿用 GLTF 原材质的贴图或全部兼容属性。`required` 或顶层 `materialBindingsStrict` 可把未命中变成结构化错误。

### TSL code 执行策略

TSL code 是拥有页面同等级权限的 JavaScript 模块，不是受限 shader 文本。导入可选入口就是宿主对能力的显式启用；它同时注册 WebGPU/TSL，不必重复导入 `threejson/webgpu`。默认 `trusted` 提供正常 ESM 能力，场景 JSON 无权修改宿主策略。

```js
import { configureTslCodeExecution } from "threejson/tsl-code";

configureTslCodeExecution({
  executionPolicy: "prompt",
  authorize: async ({ hash, source, notice }) => showUserConfirmation({ hash, source, notice })
});
```

可选策略如下：

- `trusted`（默认）：完整加载模块及其 ESM 依赖，适合作者自有内容、离线工具和可信项目。
- `prompt`：对精确源码哈希进行宿主确认，确认后仍保留正常 ESM 依赖能力。
- `restricted`：要求确认并拒绝源码中的静态/动态 import，适合只接受自包含模块的站点。
- `disabled`：完全禁用 code，仍可使用 preset 和 graph。

模块默认导出 `(params, context) => result` 工厂；`TSL`、`WEBGPU`、描述符和目标材质由 `context` 提供。工厂可返回完整 NodeMaterial、单个 TSL 节点、输出节点表，也可直接修改 `context.material` 后不返回值。URL 模块从原 URL 导入，因此相对依赖正常解析；内联模块可使用宿主 import map，也可由 `moduleLoader` 接入 bundler、CSP 或自定义解析。`source.sha256` 可用于完整性校验。宿主应根据内容来源自行选择策略，而不是由引擎替所有应用统一阉割能力。

## 其它稳定补全

- `objType: "lod"` 使用 `levels: [{ distance, hysteresis, object }]`，导出时只保留权威的嵌套描述。
- Line、CatmullRom、Quadratic/Cubic Bezier、Ellipse、CurvePath 共用同一曲线工厂，供 Tube、Line、路径动画和粒子使用。
- `morph.list` / `morph.set` 查询和调整按名称或索引定位的 morph target；描述符可用 `morphInfluences`，也支持声明式 `morph` 动画。
- 异步 `createJsonScene()` 遇到相应描述符时会按需加载 MapControls、TrackballControls、ArcballControls；也可预先导入 `threejson/controls-extra`。TransformControls 仍属于 Editor。

可运行素材位于 `examples/particle-v2/`、`examples/webgpu/` 和 `examples/capabilities/`。
