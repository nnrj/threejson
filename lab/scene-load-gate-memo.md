# 场景 Load Gate 与 per-object 进度排除备忘（非发布承诺）

**状态**：`idea`（开放探索，**不承诺实现**）  
**关联**：[`sceneConfig.intro`](../docs/zh/json-format.md#sceneconfigintro-可选加载完成后片头)、[`deployScheduler`](../core/runtime/deployScheduler.js)、[`scene-load-lifecycle.md`](../docs/zh/scene-load-lifecycle.md)  
**记录日期**：2026-07-05  

本页记录 load gate（「何时算加载完成」）的扩展设想。与 [`docs/zh/scope.md`](../docs/zh/scope.md) 的 Core 承诺区分。

**已实现（方案 A，2026-07-05）**：`sceneConfig.intro.postLoad.excludeFromLoadWait` — intro 不阻塞 `createJsonScene` / `onSceneReady`；`blockInteraction` 控制 overlay 指针捕获（`excludeFromLoadWait: true` 且未写 `blockInteraction` 时默认 `false`；`blockInteraction: false` 时 overlay `pointer-events: none`，`skipOnClick` 仅绑定 slide 内容区）。见 `core/runtime/sceneIntroConfig.js`、`sceneIntroOverlay.js`。

---

## 背景

页面宿主常把 `await createJsonScene(...)` 或 `onSceneReady` 当作关闭 `#loadingMask` 的条件。intro、scheduled deploy、Rapier bootstrap 等步骤若串在同一 Promise 链上，会出现：

- loading 文案与 intro 文字叠加；
- 用户以为「还在加载」，实际在等 2s 版权闪屏。

intro 的 `excludeFromLoadWait` 已解决 **intro 专用** 场景。以下方案 C 探讨 **通用化** 到 objectList 各 `objType` 的可行性与代价。

---

## 当前「加载进度」的两套机制

| 机制 | 数据源 | 是否阻塞 `createJsonScene` |
|------|--------|---------------------------|
| `THREE.LoadingManager` + `bindProgressElement` | 纹理/模型 URL | 否（页面自行轮询 `checkComplete()`） |
| `onDeployProgress({ done, total })` | scheduled 模式下 deploy job 计数 | 否（仅回调；Promise 仍等全部 deploy 完成） |

intro **不是** objectList 的一条 deploy job，无法用 per-record 字段直接描述，除非引入统一的 load gate 抽象。

---

## 方案 C1：per-record 不计入进度条（`excludeFromDeployProgress`）

**设想**：JSON 记录上声明 `{ "excludeFromDeployProgress": true }`，在 `buildDeployJobs` / `notify()` 时跳过 `done/total` 计数。

| 维度 | 评估 |
|------|------|
| 可行性 | **高** — 改动集中在 `deployScheduler.js` |
| 行为 | UI 进度条更快到 100%；**`createJsonScene` 仍 await 该对象 deploy** |
| 适用 | 大场景 scheduled 模式下装饰物不影响百分比展示 |
| 风险 | `done/total` 与真实剩余时间不一致，需文档说明 |

**状态**：未实现；**不承诺**。

---

## 方案 C2：per-record 后台 deploy（不阻塞 load gate）

**设想**：记录上声明例如 `{ "loadGate": { "exclude": true } }` 或 `deployScheduler: { "mode": "background" }`，deploy 改为 fire-and-forget / deferred queue，`createJsonScene` 在「gate 内对象」完成后即 resolve。

| 维度 | 评估 |
|------|------|
| 可行性 | **中** — 需定义 gate 边界、失败策略、registry 一致性 |
| 与现有 | 现有 `deployScheduler.mode: "immediate"` 仅 **插队**，不跳过等待 |
| 难点 | async `externalmodel` 失败重试、subScene 子树、physics 依赖顺序 |
| 适用 | 「先可交互，装饰模型随后到达」类 showroom |

**状态**：未实现；**不承诺**。若立项需与 `load:onAssetsReady`（lifecycle 已预留 phase、尚未 emit）一并设计。

---

## 方案 C3：scene 级统一 load gate 策略

**设想**：

```json
"sceneConfig": {
  "loadGate": {
    "waitFor": ["deploy", "extensions"],
    "excludeTags": ["decorative", "intro"]
  }
}
```

- intro / 带 tag 的 record / 显式 `loadGate.exclude` 均不参与 gate；
- `onAssetsReady` 在 gate 外任务全部完成后 emit。

| 维度 | 评估 |
|------|------|
| 可行性 | **中–低** — 架构级，适合长期而非热修 |
| 优点 | 单一语义，editor/player 可复用 |
| 缺点 | tag 体系、编辑器 UX、与 friendly JSON 归一化交叉 |

**状态**：未实现；**不承诺**。

---

## 建议优先级（若未来排期）

1. 维持 intro 的 `excludeFromLoadWait` + `blockInteraction`（**已 shipped**）。
2. 可选：C1 进度计数排除（小改、价值有限）。
3. 单独立项：C2/C3 + `onAssetsReady`（需 RFC，避免与 `deployScheduler` 语义冲突）。

---

## 参考页面

- [`port-show.html`](../port-show.html) — `#loadingMask` + intro 版权闪屏（`excludeFromLoadWait: true`）。
- [`04-05-fps-rapier-collision.html`](../examples/html-demo/track-04-interaction/04-05-fps-rapier-collision.html) — 同上 + `onSceneReady` Rapier bootstrap。
