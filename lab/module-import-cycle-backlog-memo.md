# 模块 import 环 · 收尾后 backlog 备忘

本备忘记录 **2026-06 循环依赖收尾**（`trackedResourceRegistry` 叶子模块 + extension 公共 API + demo 顺序）之后**未纳入实现**的可选项。**非发布承诺**，不保证将来会做。

## 已落地（收尾 PR）

| 项 | 说明 |
|----|------|
| #4 叶子模块 | [`core/handler/trackedResourceRegistry.js`](../core/handler/trackedResourceRegistry.js)；builder/util track 改 import；[`resourceReclaimer.js`](../core/handler/resourceReclaimer.js) 编排 dispose |
| #12 extension 公共 API | [`extensions/particle-nebula`](../extensions/particle-nebula/index.js) 从 `core/index.js` 导入 `registerParticleEmitterProvider` / `deployParticleEmitterCore` |
| #2 demo 顺序 | [`02-10-particle-nebula-provider.html`](../examples/html-demo/track-02-visual-fx/02-10-particle-nebula-provider.html) 先 core 后 extension |
| 回归测试 | [`tests/module-import-order.test.mjs`](../tests/module-import-order.test.mjs)（含 extension-first 历史顺序） |
| 废弃 | `var` TDZ 妥协、`_clearTrackedResourceBucketForTests` 死代码 |

## 仍存在的结构环（当前无 TDZ 症状）

```text
resourceReclaimer → audioBuilder → util → businessDomainRegistry → modelBuilder → trackedResourceRegistry（叶子）
```

辅助：`util ↔ nativeObjectLoader ↔ heatmapTexture`；`disposeObjectTree → audioBuilder`。

## 未做项（备忘）

### #5 顶层 `trackDisposableResource(textureLoader)` → 惰性单例

- **现状**：[`pointsBuilder`](../core/builder/pointsBuilder.js)、[`spriteBuilder`](../core/builder/spriteBuilder.js)、[`infoPanelBuilder`](../core/builder/infoPanelBuilder.js)、[`modelBuilder`](../core/builder/modelBuilder.js)、[`meshText`](../core/builder/text/meshText.js) 等在模块加载时 track 共享 Loader。
- **作用**：供 [`disposeTrackedResources()`](../core/handler/resourceReclaimer.js) 清理（教程 `00-06`、整合页等）。
- **若做**：`getTextureLoader()` 内首次创建并 track；**不可简单删除**。
- **风险**：漏改引用 → 重复实例或 dispose 漏清理。

### #6 `audioBuilder` 不再 import `util.js`

- 将 `hasValue` 抽到 `valueGuards.js` 或内联。
- **单独做**无法消掉整环（util 仍被多处 import）。
- **风险**：低。

### #7 handler 对 `audioBuilder` 动态 import

- 涉及 [`resourceReclaimer.js`](../core/handler/resourceReclaimer.js)、[`disposeObjectTree.js`](../core/handler/disposeObjectTree.js) 的 teardown 路径。
- **收益**：handler 层不静态依赖 builder。
- **风险**：中；首次 dispose 时序、音频 teardown 需单测。

### #8 / #9 `util.js` 瘦身

- #8：`isThreeNativeJsonFileType` 移出，断 `util ↔ nativeObjectLoader`。
- #9：`persistWorldInfoMerge` 移出 util 静态依赖，断 `util → businessDomainRegistry`。
- **风险**：中；导出/持久化路径回归面大。

### #10 `businessDomainRegistry` 延迟 import `modelBuilder`

- **风险**：中高；域注册与部署时序。

### #11 `util.js` 拆 light/heavy 桶

- **风险**：高；全库引用震荡。

### #3 demo 内联注册 provider

- 与 extension 模块重复；仅适合「复制片段」演示。

### #13 全量治理（#4+#5+#6+#7+#8+#9+…）

- 见上；专门 architecture sprint 时再评估。

## 相关文档

- 同类备忘：[default-model-import-cycle-memo.md](./default-model-import-cycle-memo.md)
- 先例：[loading.js](../core/cache/loading.js) 注释「不纳入 resourceReclaimer，避免依赖环」
