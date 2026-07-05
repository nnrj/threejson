# defaultModel 模块 import 环 — 备忘

## 现状（方案 A 之后）

已拆分 [`core/handler/defaultModelDescriptor.js`](../core/handler/defaultModelDescriptor.js)（纯描述符，无 `modelBuilder`）。

仍存在的 **deploy 静态 import 环**：

```
sceneDefaultModel → modelBuilder → modelHandler → domainDeployDescriptor → businessDomainRegistry → sceneDefaultModel
```

生产入口多为 `businessDomainRegistry` / `core/index.js`（BDR-first），环在求值中通常能完成；**以 `sceneDefaultModel` 为入口的单测**曾触发 `CORE_MESH_PRIMITIVE_OBJ_TYPES` TDZ。

## 方案 A 已缓解

- BDR 从 `defaultModelDescriptor` 读常量与 `isDefaultModelEnabled`，不为常量拖入 `deployMesh`
- `buildDefaultDeployDescriptor` / `sourceObjType` 单测直接 import 纯模块

## 远期 — 绝对消除环（方案 B，本期不做）

可选路径：

1. **BDR 延迟加载** `deployAsDefaultModel`（`import()` 于 `deployMeshWithDomains` 回落分支）— 部署链可能变 async
2. **`domainDeployDescriptor` 延迟** `getDomain` — 打断 `modelHandler` 链
3. **独立 `defaultModelDeploy.js`** + BDR 仅在运行时 `import()`

触发立项条件：bundler 树摇/新入口顺序导致生产故障，或需对 `sceneDefaultModel` 做稳定单入口测试。

## 回滚策略

若拆分引入部署回归且修复需动 `modelBuilder` / BDR 主链 → 撤销 `defaultModelDescriptor` 拆分，由维护者决定后续方案。
