# Shader Preset 架构契约（V2 Phase 0）

**状态**：`shipped`（Phase 0/1 已落地）

## 三层分工

1. **Core 机制**：`shaderPresetRegistry`、`shaderMotion`、`objType: shaderSurface`
2. **Domain 语义**：`domains/nature`（`nature.sky`、`nature.water` 等）；启动时 `registerShaderPreset` + `resolveDomainModel`（`domainModelList`）
3. **Host**：菜单/API；不内嵌 GLSL

## JSON 规则

- 允许：`shaderPreset` + JSON 可序列化 `uniforms`
- 禁止：JSON 内嵌 `vertexShader` / `fragmentShader`（默认路径）
- 列表：`worldInfo.shaderSurfaceList`（Core 通用 `shaderSurface`）；天空/水面等业务走 **`domainModelList`**（`domain: "nature.sky"` / `"nature.water"`）

## 禁止默认路径变更

- 不得修改 `objType: wind` 默认贴图 + `planeScrollMotion`
- 不得在无 `shaderPreset` 时改变 `createPlane` / 标准材质行为
- heatmap 体渲染保持独立 `objType: heatMap`

## Core 模块

| 模块 | 路径 |
|------|------|
| Preset 注册表 | `core/builder/shader/shaderPresetRegistry.js` |
| 帧更新 | `core/builder/shader/shaderMotion.js` |
| 通用 deploy | `core/builder/shader/shaderSurfaceBuilder.js` |
| 启动注册 | `core/builder/shader/registerCoreShader.js` |

## Domain 注册 preset 示例

```js
import { registerShaderPreset } from "../../core/builder/shader/shaderPresetRegistry.js";

registerShaderPreset("atmosphere", {
  defaultUniforms: { turbidity: 10 },
  createMaterial(uniforms, ctx) { /* ShaderMaterial */ },
  updateUniforms(material, ctx) { /* optional */ }
});
```

## Phase 0 内置测试 preset

- `solidColor`：纯色平面，验证 registry + deploy + motion 链路

## Phase 1 Domain preset

| Domain | objType | handlers | presets |
|--------|---------|----------|---------|
| `domains/nature/sky` (`nature.sky`) | `skyDome` | 静态：`atmosphere`, `sunset`, `dawn`, `noon`, `night`；动态：`cycle` | `atmosphere`, `sunset`, `skyCycle` |
| `domains/nature/water` (`nature.water`) | `waterSurface` | `ocean`, `flow` | `ocean` |

教程：`assets/json/tutorial/track-02/02-07-shader-sky-water.json`
