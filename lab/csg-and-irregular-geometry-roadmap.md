# CSG 泛化与不规则体 — 远期规划

**非发布承诺**；与 [`doc/scope.md`](../doc/scope.md) Core 承诺区分。

## 背景

当前 CSG（`joins` / `inters` / `holes`）仅在 box/sphere 等 primitive 的 `createMesh` 路径生效。不规则平面/几何体 v1 已提供：

- `shapePlane` / `irregularPlane`（`planeKind: shape|mesh|rect`）
- `shapeExtrude` / `irregularGeometry`（`geometryKind: shapeExtrude|mesh`）
- `bufferMesh`（硬编码顶点/三角上限）

**未实现**：`planeKind: "csg"`、`geometryKind: "csg"`。

## Phase CSG-1（建议范围）

1. `buildBrushFromRecord(record)`：从 box、sphere、shapeExtrude、bufferMesh 生成 `three-bvh-csg` Brush
2. 将 `joins`/`inters`/`holes` 钩子扩展到上述 objType
3. 门面占位：`irregularPlane.planeKind: "csg"`、`irregularGeometry.geometryKind: "csg"`

## 风险

- 大 mesh / 非流形几何 CSG 稳定性
- 性能：JSON 内嵌大 buffer + CSG 组合
- 2D 洞优先 `Shape.holes`，不必为平面强行 CSG

## 相关

- 现有 CSG：`core/handler/csgBrushOps.js`、`core/builder/modelBuilder.js`、`core/handler/holeSceneOps.js`
- [`roadmap-from-plans.md`](./roadmap-from-plans.md)
