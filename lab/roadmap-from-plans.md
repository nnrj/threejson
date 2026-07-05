# 历史 Cursor 计划摘录（非发布承诺）

本页整理自仓库开发过程中在 Cursor 里生成的若干 `.plan.md` 结论与路线，**不代表当前里程碑或发布承诺**；与 [`doc/scope.md`](../doc/scope.md) 的「Core 承诺」区分。若与实现不一致，以代码与 `doc/` 正史为准。

## 已落地或已被代码覆盖的历史项

以下条目在旧计划中曾为待办，当前仓库已有对应实现或文档，**保留作溯源**：

- **声明式全景 / IBL 背景**：`sceneBackdropResolver` + `createSceneRuntimeAsync`；字段说明见 [`doc/json-format.md`](../doc/json-format.md) 中 `sceneConfig.scene` 的 `background` / `environment`（旧「360° 场景背景」评估中的多数待办已由实现替代）。
- **材质 `textureKind`（视频 / GIF 动画）**：`modelBuilder` 中 `ensureMaterialTextureFromJson` 等路径；说明见 [`core/BUSINESS_DOMAINS.md`](../core/BUSINESS_DOMAINS.md)。
- **合并盒 / CSG 子树与 `textureUrl`**：旧「core texture URL gaps」计划中的抽取与接线在 core 中已标记完成；若遇个案，优先查 CORS 与 `map` 仅写 URL 字符串的约定。
- **npm 库形态与裸模块 import**：根目录 [`package.json`](../package.json)、`doc/README.md` 安装段；旧「Phase B npm」中的技术债（仅 esm.sh 等）已按当前策略处理。

- **Rapier 物理插件（M5 方向）**：[`extensions/physics-rapier/README.md`](../extensions/physics-rapier/README.md) + [`examples/html-demo/track-04-interaction/04-02-plugin-physics.html`](../examples/html-demo/track-04-interaction/04-02-plugin-physics.html)。首版为可选扩展 + 演示页；WASM 来源与网络依赖以各 README 为准。

## 明确未做或长期 parked

| 主题 | 说明 |
|------|------|
| **L4 用户脚本沙箱** | 历史实施方案中已定「暂不实现」；安全与调试成本高，见 [`lab/README.md`](./README.md) 索引。 |
| **通用动画引擎 / 完整 ECS** | 评估结论为仅当业务真需要大量实体逻辑时再上；当前以 Mixer + 轻量声明式为主。 |
| **输入映射、状态机、碰撞策略、网络同步** | 明确为**宿主应用**或上层框架责任；ThreeJSON 侧提供循环钩子、稳定句柄与可选扩展挂载。 |

## 能力缺口与支持路线（摘自历史「支持路线」计划）

难度分层仍可作为排期参考（与当前代码基线对比后自行裁剪）：

- **较易**：增补更多基础几何体（Cylinder / Cone / Ring / Torus / Capsule 等，沿用 `modelBuilder` 模式）；体热力若主链分发仍不完整则打通 `heatList` 与体积 API；扩大 primitive 材质 JSON 字段（贴图槽、PBR 等）而非另起材质体系。
- **中等**：在已有 `EffectComposer` 接线上扩展 Bloom、SSAO、DOF 等并补 schema；环境与雾、HDR/IBL **工程化**（除已支持的声明式入口外，样例、资源管线、错误处理）；`InstancedMesh` / 几何合并的「普通 JSON 自动优化」稳定链路。
- **高难或架构级**：关键帧与骨骼动画体系统一、morph、路径动画；声明式粒子系统；Tube / Extrude / Lathe 等作为一等 JSON schema（若仅走 `nativeThree` 嵌入则成本较低）；FBX/STL/PLY 等多格式（常连带动画与单位约定）。

建议顺序仍是：**先低风险补齐与 demo 闭环 → 再选少量渲染增强 → 最后**在业务明确需要时再动动画 / 粒子 / 曲面主线。

## 架构与产品类后续（仍开放、非 urgent）

- **加载分发**：`worldInfo` 等路径上对象仍依赖**显式列表**与分发逻辑，而非完全按 `objType` 自发现；若未来要统一入口，需一次性设计兼容策略（历史「支持路线」已记录）。
- **合并优化与导出形状**：合并后顶层 Mesh 数量与 `boxModelList` 条数会变化；导出仍以**当前场景**采集为准。若需「始终保留优化前的人类可编辑列表」，需单独产品方案（例如导出前反合并、侧车保存源快照），**当前未做**。
- **原生 JSON 导出与远程贴图**：`embedPortableImageUrlsIntoThreeExportJson` 等路径对不可内联 URL 的替换策略，与运行时 `TextureLoader` 行为不同；若管线依赖「可搬运 JSON」，需在业务层约定占位或离线烘焙。

## 文档与站点类（同仓、非 core）

`doc/reader` 演示索引、多语言 README 等计划在 **Lab 范围外**；需要时直接在 `doc/` 或对应示例目录演进即可。
