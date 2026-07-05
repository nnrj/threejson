# renderLoop autoFps 备忘（本期不实现）

## 背景

当前 `sceneConfig.renderLoop` 采用 `lowFps + fps` 双字段：

- `lowFps = false`：按浏览器 `requestAnimationFrame` 频率渲染（通常接近显示器刷新率上限）。
- `lowFps = true`：按 `fps` 做节流（目标频率，不会突破 rAF 上限）。

本期已确定该模型继续保留，`autoFps` 仅记入备忘。

## autoFps 设想

`autoFps` 目标是根据运行时负载动态调整节流目标，降低卡顿与发热风险，同时尽量维持流畅度。

建议语义（草案）：

- `autoFps = false`（默认）：维持当前行为。
- `autoFps = true`：启用动态策略，`fps` 作为初始值或上限值。

## 待评估点

1. **策略来源**：基于帧时长滑窗、设备分档、还是业务自定义回调。
2. **抖动控制**：调整步长、冷却时间、最小稳定窗口。
3. **可观测性**：是否暴露当前实际目标 FPS 到调试面板。
4. **与宿主覆盖关系**：`overrideSceneRenderLoop` 与 `autoFps` 的冲突优先级。
5. **跨页一致性**：编辑器与播放器是否共用同一策略实现。

## 建议落地方式（未来）

优先走独立实验开关，不与当前 `lowFps/fps` 改造耦合；待验证稳定后再考虑进入 `sceneConfig.renderLoop` 正式 schema。
