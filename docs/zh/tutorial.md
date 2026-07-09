[中文](./tutorial.md) | [English](../en/tutorial.md)

# ThreeJSON 教程课表

[中文](./tutorial.md) | [English](../en/tutorial.md)

本课表与 [demo.html](../../examples/html-demo/demo.html) 索引一一对应：按 **Track 0 → 7** 从核心运行时契约到工具链、宿主应用、stat 域与场景文字。

**运行方式**：在仓库根目录启动静态服务（如 `python -m http.server 8080`），打开 `http://localhost:8080/examples/html-demo/demo.html`。

## Track 0 · 运行时与 JSON 契约

| ID | 先修 | 标题 | HTML | JSON |
|----|------|------|------|------|
| t00-01 | — | 最小场景 | [00-01-minimal-mesh.html](../../examples/html-demo/track-00-runtime/00-01-minimal-mesh.html) | [00-01-minimal-mesh.json](../../assets/json/tutorial/track-00/00-01-minimal-mesh.json) |
| t00-02 | t00-01 | 基础几何与材质 | [00-02-primitives-materials.html](../../examples/html-demo/track-00-runtime/00-02-primitives-materials.html) | [00-02-primitives.json](../../assets/json/tutorial/track-00/00-02-primitives.json) |
| t00-03 | t00-02 | 友好 JSON 全场景 | [00-03-friendly-full-scene.html](../../examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html) | [00-03-friendly-full-scene.json](../../assets/json/tutorial/track-00/00-03-friendly-full-scene.json) |
| t00-04 | t00-03 | 标准 objectList | [00-04-standard-objectlist.html](../../examples/html-demo/track-00-runtime/00-04-standard-objectlist.html) | [00-04-standard-objectlist.json](../../assets/json/tutorial/track-00/00-04-standard-objectlist.json) |
| t00-05 | t00-01 | 导入路径（拆开 vs import map） | [00-05-import-paths.html](../../examples/html-demo/track-00-runtime/00-05-import-paths.html) | [00-03-friendly-full-scene.json](../../assets/json/tutorial/track-00/00-03-friendly-full-scene.json) |
| t00-06 | t00-01 | 资源回收 | [00-06-resource-reclaimer.html](../../examples/html-demo/track-00-runtime/00-06-resource-reclaimer.html) | — |
| t00-08 | t00-01 | sceneConfig.intro 片头 | [00-08-scene-intro.html](../../examples/html-demo/track-00-runtime/00-08-scene-intro.html) | [00-08-scene-intro.json](../../assets/json/tutorial/track-00/00-08-scene-intro.json) |
| t00-07 | t00-01 | 单对象手写部署（**选修**） | [00-07-manual-deploy-mesh.html](../../examples/html-demo/track-00-runtime/00-07-manual-deploy-mesh.html) | —（内联单条 box JSON） |

学完本轨应能：用 `createJsonScene` 加载友好/标准 JSON（t00-01 起）、理解归一化为 `objectList` 后的分阶段 deploy；t00-06 了解资源回收 API；t00-08 了解 postLoad 片头与 load gate；选修 t00-07 了解 `deployMesh` 手写单对象路径。

## Track 1 · 场景对象与几何

| ID | 先修 | 标题 | HTML | JSON |
|----|------|------|------|------|
| t01-01 | t00-03 | 组合、线条与面板 | [01-01-group-line-panel.html](../../examples/html-demo/track-01-geometry/01-01-group-line-panel.html) | [01-01-group-line-panel.json](../../assets/json/tutorial/track-01/01-01-group-line-panel.json) |
| t01-02 | t01-01 | 平面与线拓扑 | [01-02-plane-line-topology.html](../../examples/html-demo/track-01-geometry/01-02-plane-line-topology.html) | [01-02-plane-line-topology.json](../../assets/json/tutorial/track-01/01-02-plane-line-topology.json) |
| t01-03 | t00-03 | 预设 objType | [01-03-preset-objtypes.html](../../examples/html-demo/track-01-geometry/01-03-preset-objtypes.html) | [01-03-preset-objtypes.json](../../assets/json/tutorial/track-01/01-03-preset-objtypes.json) |
| t01-04 | t01-03 | CSG 合并与挖洞 | [01-04-csg-joins.html](../../examples/html-demo/track-01-geometry/01-04-csg-joins.html) | [01-04-csg-joins.json](../../assets/json/tutorial/track-01/01-04-csg-joins.json) |
| t01-05 | t01-02 | Helpers 与不规则几何 | [01-05-helpers-irregular-geometry.html](../../examples/html-demo/track-01-geometry/01-05-helpers-irregular-geometry.html) | [01-05-helpers-irregular.json](../../assets/json/tutorial/track-01/01-05-helpers-irregular.json) |
| t01-06 | t00-04, t01-02 | Native 通用对象 | [01-06-native-object-dispatch.html](../../examples/html-demo/track-01-geometry/01-06-native-object-dispatch.html) | [01-06-native-objects.json](../../assets/json/tutorial/track-01/01-06-native-objects.json) |
| t01-07 | t01-06 | jsm 几何与资源引用 | [01-07-jsm-geometries.html](../../examples/html-demo/track-01-geometry/01-07-jsm-geometries.html) | [01-07-jsm-geometries.json](../../assets/json/tutorial/track-01/01-07-jsm-geometries.json) |
| t01-08 | t01-07 | 正交相机 + Fly 漫游 | [01-08-ortho-fly.html](../../examples/html-demo/track-01-geometry/01-08-ortho-fly.html) | [01-08-ortho-fly.json](../../assets/json/tutorial/track-01/01-08-ortho-fly.json) |

## Track 2 · 可视化与特效

| ID | 先修 | 标题 | HTML | JSON |
|----|------|------|------|------|
| t02-01 | t00-03 | 热力图与风带 | [02-01-heatmap-wind.html](../../examples/html-demo/track-02-visual-fx/02-01-heatmap-wind.html) | [02-01-heatmap-wind.json](../../assets/json/tutorial/track-02/02-01-heatmap-wind.json) |
| t02-02 | t02-01 | 点云与 motion | [02-02-points-motion.html](../../examples/html-demo/track-02-visual-fx/02-02-points-motion.html) | [02-02-points-motion.json](../../assets/json/tutorial/track-02/02-02-points-motion.json) |
| t02-03 | t02-02 | 天气域模型 | [02-03-weather-domain.html](../../examples/html-demo/track-02-visual-fx/02-03-weather-domain.html) | [02-03-weather-domain.json](../../assets/json/tutorial/track-02/02-03-weather-domain.json) |
| t02-04 | t02-01 | Sprite / Tube / Instanced | [02-04-sprite-tube-instanced.html](../../examples/html-demo/track-02-visual-fx/02-04-sprite-tube-instanced.html) | [02-04-sprite-tube-instanced.json](../../assets/json/tutorial/track-02/02-04-sprite-tube-instanced.json) |
| t02-05 | t00-04 | 场景背景与全景 | [02-05-scene-background.html](../../examples/html-demo/track-02-visual-fx/02-05-scene-background.html) | [02-05-scene-background.json](../../assets/json/tutorial/track-02/02-05-scene-background.json) |
| t02-06 | t00-03 | 空间音频 | [02-06-audio-spatial.html](../../examples/html-demo/track-02-visual-fx/02-06-audio-spatial.html) | [02-06-audio-spatial.json](../../assets/json/tutorial/track-02/02-06-audio-spatial.json) |
| t02-09 | t02-02 | particleEmitter gpuCompute | [02-09-particle-emitter-gpu.html](../../examples/html-demo/track-02-visual-fx/02-09-particle-emitter-gpu.html) | [02-09-particle-emitter-gpu.json](../../assets/json/tutorial/track-02/02-09-particle-emitter-gpu.json) |
| t02-10 | t02-09 | particleEmitter 第三方 provider | [02-10-particle-nebula-provider.html](../../examples/html-demo/track-02-visual-fx/02-10-particle-nebula-provider.html) | [02-10-particle-nebula-provider.json](../../assets/json/tutorial/track-02/02-10-particle-nebula-provider.json) |
| t02-11 | t02-06 | textureQuality 纹理采样档位 | [02-11-texture-sampling-toggle.html](../../examples/html-demo/track-02-visual-fx/02-11-texture-sampling-toggle.html) | [02-11-texture-sampling-toggle.json](../../assets/json/tutorial/track-02/02-11-texture-sampling-toggle.json) |
| t02-sky | t00-03 | Shader 天空与海（目录） | [02-08-shader-sky-cycle.html](../../examples/html-demo/track-02-visual-fx/02-08-shader-sky-cycle.html) | — |
| t02-07 | t02-sky | 静态天空与海面 | [02-07-shader-sky-water.html](../../examples/html-demo/track-02-visual-fx/02-07-shader-sky-water.html) | [02-07-shader-sky-water.json](../../assets/json/tutorial/track-02/02-07-shader-sky-water.json) |
| t02-08 | t02-07 | 天空昼夜循环 | [02-08-shader-sky-cycle.html](../../examples/html-demo/track-02-visual-fx/02-08-shader-sky-cycle.html) | [02-08-shader-sky-cycle.json](../../assets/json/tutorial/track-02/02-08-shader-sky-cycle.json) |

## Track 3 · 外部资产与域模型

| ID | 先修 | 标题 | HTML | JSON |
|----|------|------|------|------|
| t03-01 | t00-04 | glTF 外部模型 | [03-01-external-gltf.html](../../examples/html-demo/track-03-assets/03-01-external-gltf.html) | [03-01-external-gltf.json](../../assets/json/tutorial/track-03/03-01-external-gltf.json) |
| t03-02 | t03-01 | glTF 动画剪辑 | [03-02-gltf-animation-mixer.html](../../examples/html-demo/track-03-assets/03-02-gltf-animation-mixer.html) | [03-02-gltf-animation-mixer.json](../../assets/json/tutorial/track-03/03-02-gltf-animation-mixer.json) |
| t03-03 | t03-01 | 原生 Three JSON 域 | [03-03-native-three-domain.html](../../examples/html-demo/track-03-assets/03-03-native-three-domain.html) | [03-03-native-three-domain.json](../../assets/json/tutorial/track-03/03-03-native-three-domain.json) |
| t03-04 | t03-01 | OBJ 与 maps 回退 | [03-04-obj-maps-fallback.html](../../examples/html-demo/track-03-assets/03-04-obj-maps-fallback.html) | [03-04-obj-maps-fallback.json](../../assets/json/tutorial/track-03/03-04-obj-maps-fallback.json) |
| t03-06 | t03-02 | animationGraph 状态机 | [03-06-animation-graph.html](../../examples/html-demo/track-03-assets/03-06-animation-graph.html) | [03-06-animation-graph.json](../../assets/json/tutorial/track-03/03-06-animation-graph.json) |

## Track 4 · 运行时交互与扩展（LAB）

| ID | 先修 | 标题 | HTML | JSON |
|----|------|------|------|------|
| t04-01 | t00-02 | 对象管理器 | [04-01-object-registry.html](../../examples/html-demo/track-04-interaction/04-01-object-registry.html) | [04-01-object-registry.json](../../assets/json/tutorial/track-04/04-01-object-registry.json) |
| t04-02 | t00-04 | PluginHost 与物理 | [04-02-plugin-physics.html](../../examples/html-demo/track-04-interaction/04-02-plugin-physics.html) | [04-02-plugin-physics.json](../../assets/json/tutorial/track-04/04-02-plugin-physics.json) |
| t04-fps | t04-02 | 第一人称漫游（折叠） | 默认 [04-05-fps-rapier-collision.html](../../examples/html-demo/track-04-interaction/04-05-fps-rapier-collision.html) | — |
| t04-03 | t00-04 | ↳ 基础漫游 | [04-03-fps-walk.html](../../examples/html-demo/track-04-interaction/04-03-fps-walk.html) | [04-03-fps-walk.json](../../assets/json/tutorial/track-04/04-03-fps-walk.json) |
| t04-04 | t04-03 | ↳ Player Rig | [04-04-fps-player-rig.html](../../examples/html-demo/track-04-interaction/04-04-fps-player-rig.html) | [04-04-fps-player-rig.json](../../assets/json/tutorial/track-04/04-04-fps-player-rig.json) |
| t04-05 | t04-02, t04-03 | ↳ Rapier 碰撞 | [04-05-fps-rapier-collision.html](../../examples/html-demo/track-04-interaction/04-05-fps-rapier-collision.html) | [04-05-fps-rapier-collision.json](../../assets/json/tutorial/track-04/04-05-fps-rapier-collision.json) |
| t04-08 | t00-04 | 信息面板类型一览 | [04-08-info-panel-gallery.html](../../examples/html-demo/track-04-interaction/04-08-info-panel-gallery.html) | [04-08-info-panel-gallery.json](../../assets/json/tutorial/track-04/04-08-info-panel-gallery.json) |
| t04-09 | t04-01 | 事件机制与 EventScript | [04-09-event-mechanism.html](../../examples/html-demo/track-04-interaction/04-09-event-mechanism.html) | [04-09-event-mechanism.json](../../assets/json/tutorial/track-04/04-09-event-mechanism.json) |
| t04-10 | t04-09 | 单对象 lifecycle（ready / dispose） | [04-10-object-lifecycle.html](../../examples/html-demo/track-04-interaction/04-10-object-lifecycle.html) | [04-10-object-lifecycle.json](../../assets/json/tutorial/track-04/04-10-object-lifecycle.json) |
| t04-11 | t04-09 | 声明式 actions | [04-11-declarative-actions.html](../../examples/html-demo/track-04-interaction/04-11-declarative-actions.html) | [04-11-declarative-actions.json](../../assets/json/tutorial/track-04/04-11-declarative-actions.json) |
| t04-06 | t00-04 | CSS3D 可交互面板 | [04-06-css3d-panel.html](../../examples/html-demo/track-04-interaction/04-06-css3d-panel.html) | [04-06-css3d-panel.json](../../assets/json/tutorial/track-04/04-06-css3d-panel.json) |
| t04-07 | t04-06 | ↳ 曲面屏浏览器 | [04-07-css3d-curved-browser.html](../../examples/html-demo/track-04-interaction/04-07-css3d-curved-browser.html) | [04-07-css3d-curved-google.json](../../assets/json/tutorial/track-04/04-07-css3d-curved-google.json) |

## Track 5 · 工具链

| ID | 先修 | 标题 | 入口 |
|----|------|------|------|
| t05-01 | t00-04 | AI 场景生成 | [05-01-ai-scene.html](../../examples/html-demo/track-05-tooling/05-01-ai-scene.html) |
| t05-02a | t02-03 | 嵌套子域（weather.rain / weather.wind） | [05-02-nested-domain.html](../../examples/html-demo/track-05-tooling/05-02-nested-domain.html) |

## Track 5 · 宿主应用样例

| ID | 先修 | 标题 | 入口 |
|----|------|------|------|
| t05-02 | t00-04 | 核心网络机房 A 区 | [room-show.html](../../room-show.html) |
| t05-03 | t00-04 | 场景编辑器 | [tools/scene-host/editor/index.html](../../tools/scene-host/editor/index.html) |
| t05-04 | t00-04 | 场景播放器 | [tools/scene-host/player/index.html](../../tools/scene-host/player/index.html) |
| t05-05 | t05-02 | 智慧港口 | [port-show.html](../../port-show.html) |

## Track 6 · 统计与可视化（stat domain）

| ID | 先修 | 标题 | HTML | JSON |
|----|------|------|------|------|
| t06-stat | t00-04, t04-06 | stat 域（折叠） | 默认 [06-04-stat-chart-echarts.html](../../examples/html-demo/track-06-stat/06-04-stat-chart-echarts.html) | — |
| t06-01 | t00-04 | ↳ stat.bar | [06-01-stat-bar.html](../../examples/html-demo/track-06-stat/06-01-stat-bar.html) | [06-01-stat-bar.json](../../assets/json/tutorial/track-06/06-01-stat-bar.json) |
| t06-02 | t06-01 | ↳ stat.grid | [06-02-stat-grid.html](../../examples/html-demo/track-06-stat/06-02-stat-grid.html) | [06-02-stat-grid.json](../../assets/json/tutorial/track-06/06-02-stat-grid.json) |
| t06-03 | t06-02 | ↳ stat.panel | [06-03-stat-panel.html](../../examples/html-demo/track-06-stat/06-03-stat-panel.html) | [06-03-stat-panel.json](../../assets/json/tutorial/track-06/06-03-stat-panel.json) |
| t06-04 | t06-03, t04-06 | ↳ stat.chart + ECharts | [06-04-stat-chart-echarts.html](../../examples/html-demo/track-06-stat/06-04-stat-chart-echarts.html) | [06-04-stat-chart-echarts.json](../../assets/json/tutorial/track-06/06-04-stat-chart-echarts.json) |
| t06-05 | t06-04 | ↳ stat.line | [06-05-stat-line.html](../../examples/html-demo/track-06-stat/06-05-stat-line.html) | [06-05-stat-line.json](../../assets/json/tutorial/track-06/06-05-stat-line.json) |
| t06-06 | t06-05 | ↳ stat.pie | [06-06-stat-pie.html](../../examples/html-demo/track-06-stat/06-06-stat-pie.html) | [06-06-stat-pie.json](../../assets/json/tutorial/track-06/06-06-stat-pie.json) |
| t06-07 | t06-06 | ↳ stat.pie + stat.ring | [06-07-stat-pie-ring.html](../../examples/html-demo/track-06-stat/06-07-stat-pie-ring.html) | [06-07-stat-pie-ring.json](../../assets/json/tutorial/track-06/06-07-stat-pie-ring.json) |

## Track 7 · 场景文字（objType: text）

| ID | 先修 | 标题 | HTML | JSON |
|----|------|------|------|------|
| t07-text | t00-04 | text 对象（折叠） | 默认 [07-02-text-mesh.html](../../examples/html-demo/track-07-text/07-02-text-mesh.html) | — |
| t07-01 | t00-04 | ↳ sdf / texture | [07-01-text-modes.html](../../examples/html-demo/track-07-text/07-01-text-modes.html) | [07-01-text-modes.json](../../assets/json/tutorial/track-07/07-01-text-modes.json) |
| t07-02 | t07-01 | ↳ mesh 立体字 | [07-02-text-mesh.html](../../examples/html-demo/track-07-text/07-02-text-mesh.html) | [07-02-text-mesh.json](../../assets/json/tutorial/track-07/07-02-text-mesh.json) |

## 路线图（暂无独立 demo）

与 [json-format.md § 暂不纳入](./json-format.md#暂不纳入当前-json-主线的能力) 一致：骨骼动画状态机、FBX/STL 等更多格式、descriptorBinding / 空间查询进阶课、mesh 导入/导出独立教程页等计划在后续版本补充。

## 编写新课

1. 在 `assets/json/tutorial/track-XX/` 增加 JSON。
2. 在 `examples/html-demo/track-XX-*/` 增加 HTML（可复制 [00-03-friendly-full-scene 模板](../../examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html)）。
3. 在 [`demo-catalog.zh.json`](../../examples/html-demo/demo-catalog.zh.json) 与 [`demo-catalog.en.json`](../../examples/html-demo/demo-catalog.en.json) 增加条目（各语言各维护一份完整 catalog；`demo.html` 按 locale 加载其一），并更新本文档课表。可用 `npm run validate:demo-catalog` 校验 zh/en 结构一致。
4. catalog 的 `path` 必须指向 `track-*` 或根目录整合页。
5. 若新课使用 SDF 场景文字（`objType: text` 默认 `mode: "sdf"`），HTML import map 需保留 `troika-three-text` + `fflate`（参考 [Track 7](./tutorial.md#track-7--场景文字objtype-text)）；其余页面勿批量加入。
