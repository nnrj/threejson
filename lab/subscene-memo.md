# subScene Memo

**状态**：`shipped`（嵌套加载/导出/editor 已启用）

用户文档：[JSON 配置手册 §subScene 嵌套](../docs/zh/json-format.md#subscene-嵌套层级对象)（英文：[docs/en/json-format.md](../docs/en/json-format.md#subscene-nested-hierarchy)）。

## Current Status (enabled)

- **Internal canonical**: nested `subScene[]` on parent object descriptors.
- **Load**: accepts nested `subScene`, flat `parentThreeJsonId`, or top-level `subSceneList` blocks; normalizes to nested before deploy.
- **Export layouts** (`subSceneLayout`): `nested` (core default) | `flat` | `subSceneList`.
- **Group internals**: `boxModelList` / `subGroup` / `infoPanelList` on group records are **not read**; use `subScene` only.
- **Empty group**: omit `subScene` or `subScene: []` → empty `THREE.Group` (no visible child meshes; valid transform container).
- **Root `worldInfo.boxModelList`**: unchanged (floor, walls, typed friendly lists).
- **Normalize policy**: default `warn` (orphan parent → root; duplicate id → first wins); `strict` throws.

## Editor

- Code/sidebar default display: `subSceneLayout: subSceneList` (orthogonal to friendly/standard).
- Setting: `sceneJson.subSceneNormalizePolicy` (`warn` | `strict`).

## `.tjz` / archive

- Full scene and object record entries load via normal paths.
- Legacy `.tjz` boolean `subScene: true` entry gate **removed** (no `E_SUBSCENE_RUNTIME_FORBIDDEN`).
- Prefer `subSceneList` in payload or nested `subScene` on records.

## Domains

- `cabinet` / `port` factories migrate output to `subScene` via `migrateGroupDescriptorToSubScene`.
- Runtime deploy: `deployGroupDescriptor` / `createGroupFromDescriptor` in `objectLoadHandler.js`.

## Deferred

- `worldInfo` → `rootScene`, `boxList` rename.
- `sceneInfoList` renamed to **`nativeSceneList`** (embed native Three `toJSON`).
