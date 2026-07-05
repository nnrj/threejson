# 未来：第二物理后端（ammo / cannon-es 等）

## 背景

首版仓库主推 **Rapier**（`@dimforge/rapier3d-compat` + WASM），见 [`extensions/physics-rapier/README.md`](../extensions/physics-rapier/README.md)。

## 若增加第二引擎

- **同一契约**：仍通过 `PluginHost` 的 `beforePhysics` / `afterPhysics` 与 `sceneRuntimeApi.applyTransform` 写回 Three，**不**在 `core` 内部分支多引擎。
- **独立目录**：建议 `extensions/physics-<name>/`，各自 README 说明 WASM 来源、初始化与单位制。
- **不强制二选一**：上游可同时依赖多个扩展包，但 **ThreeJSON core 不 re-export** 具体引擎，避免 semver 与体积绑定。

## 退出条件

若某引擎长期无维护或无法在目标浏览器加载 WASM，在本文件标注 `rejected` 并链接替代方案。

其它从历史计划整理的待观察项见 [roadmap-from-plans.md](./roadmap-from-plans.md)。

## LOD（细节层次）

- **现状**：Three.js 自带 `THREE.LOD` 与视锥裁剪；ThreeJSON **不**在 core 内建 JSON→LOD 映射。
- **若要做**：建议在 `lab/` 或独立扩展中定义 `objType: "lod"` 或 `lodLevels[]` schema，由页面或插件在 `onSceneReady` 后挂接；避免与 `deployScheduler` 的阶段 2/3/4 语义冲突。
- **退出条件**：无统一 schema 需求前保持 deferred；大场景优先用 `deployScheduler` 限流 + 外部模型按需加载。

## Worker 解码（几何 / 纹理）

- **现状**：core 在主线程 `TextureLoader` / `GLTFLoader` 等加载；`createJsonSceneSimple` 不引入 Worker。
- **若要做**：在扩展层用 `LoadingManager` + 自定义 `URL` 或 `ArrayBuffer` 入口，解码完成后仍通过 `deployJsonScene` 挂到 scene；**不在** core 承诺多线程默认路径。
- **风险**：与 `cancelActiveDeployScheduler`、场景切换时的 `resourceClear` 生命周期需成对设计，避免 Worker 回调在已销毁 scene 上 `add`。
