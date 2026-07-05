# extensions

仓库内的**可选参考实现**与示例：随 `threejson` npm 包以子路径发布（`threejson/extensions/...`），**不**从 `core/index.js` 自动加载；重依赖（如 Rapier）请 optional peer install。

**接入说明（调用者手册）**：[`doc/extensions.md`](../doc/extensions.md)

| 目录 | 说明 |
|------|------|
| `simple-gravity/` | 基于 `PluginHost` 的极简「重力」演示（欧拉积分，非真实刚体引擎），用于验证插件钩子与 `sceneRuntimeApi` 写回。 |
| `physics-rapier/` | **Rapier WASM** 最小落体（`createRapierBoxDropPlugin`）；见 README 与 [`04-02-plugin-physics.html`](../examples/html-demo/track-04-interaction/04-02-plugin-physics.html)。 |
| `stat-echarts/` | **ECharts** 挂 CSS3D 面板（配合 `stat.chart` 子域）；见 README 与 Track 6 `06-04-stat-chart-echarts.html`。 |
| `fps-walk/` | 第一人称 **`floorMeshRef`** 贴地；`bootstrapFirstPersonExtensionsFromScene` 统一入口。 |
| （同上目录） | `bootstrapFirstPersonExtensions.js` — 按 `collision.provider` 分发 fps-walk / Rapier。 |
| `physics-rapier/` | 含 **`firstPersonBridge.js`**（第一人称 Rapier 碰撞）。 |
| `particle-nebula/` | **粒子第三方适配器骨架**；`provider: "nebula"` → `registerParticleEmitterProvider` 示例。 |

可交互 **CSS3D 面板**（`css3dPanel`）已迁入 **core**（`core/builder/css3d/`），见 [`doc/json-format.md`](../doc/json-format.md) 与 `04-06-css3d-panel.html`。

真实 ammo 等可作为后续独立扩展添加；建议保持 **core 无 WASM 依赖**。

**CSG 与旧版 Three**：core 内置 `three-bvh-csg@0.0.18`（需 `three >= r179`），不从本目录自动加载。若执意在不支持的 revision 上试验 CSG，请在宿主侧用 import map / npm overrides 解析 `three-bvh-csg`（见 [`doc/three-compat.md`](../doc/three-compat.md)「特殊需求」一节），**无需**也**无法**通过 `extensions/` 插件机制零改 core 地替换 CSG 后端。
