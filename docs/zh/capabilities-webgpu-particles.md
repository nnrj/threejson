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

WebGPU 必须显式导入，适配层固定保证 Three.js r184：

```js
import "threejson/webgpu";
import { createJsonScene } from "threejson/core";

const result = await createJsonScene(payload, { canvas });
```

```json
{
  "sceneConfig": {
    "renderer": { "backend": "webgpu", "compatibilityPolicy": "error" }
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

预览内置 `solid`、`uv-gradient`、`pulse`，宿主可调用 `registerTslPreset()`。

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

graphVersion 1 会校验节点数量、唯一 ID、引用、循环、节点类型、输出、URL/CORS 和纹理加载。节点覆盖常量/uniform/时间、UV/位置/法线/纹理、算术、mix/smoothstep/clamp、常见一元运算、噪声与 swizzle。

### TSL code 安全边界

TSL code 是拥有页面同等级权限的 JavaScript，不是沙箱 shader 文本。默认完全关闭，场景 JSON 无权开启。宿主必须导入 `threejson/tsl-code`、开启总开关，并逐一确认精确的 SHA-256 内容哈希和 URL/内联来源；内容变化后必须重新确认。

```js
import "threejson/webgpu";
import { configureTslCodeExecution } from "threejson/tsl-code";

configureTslCodeExecution({
  enabled: true,
  authorize: async ({ hash, source, notice }) => showUserConfirmation({ hash, source, notice })
});
```

模块必须是自包含的，并默认导出 `(params, context) => outputs` 工厂；`TSL` 与 `WEBGPU` 由 `context` 提供。外部 import 会执行未被当前批准哈希覆盖的可变代码，因此会被拒绝。生产宿主应同时配置严格 CSP，也可以完全禁止第三方 code。

## 其它稳定补全

- `objType: "lod"` 使用 `levels: [{ distance, hysteresis, object }]`，导出时只保留权威的嵌套描述。
- Line、CatmullRom、Quadratic/Cubic Bezier、Ellipse、CurvePath 共用同一曲线工厂，供 Tube、Line、路径动画和粒子使用。
- `morph.list` / `morph.set` 查询和调整按名称或索引定位的 morph target；描述符可用 `morphInfluences`，也支持声明式 `morph` 动画。
- 异步 `createJsonScene()` 遇到相应描述符时会按需加载 MapControls、TrackballControls、ArcballControls；也可预先导入 `threejson/controls-extra`。TransformControls 仍属于 Editor。

可运行素材位于 `examples/particle-v2/`、`examples/webgpu/` 和 `examples/capabilities/`。
