# assetRegistry 生命周期（方案 B）

- **填充**：`deployIntoTarget` / `deployIntoTargetSimple` 在 `resetScene !== false` 时 `clearAssetRegistry()`，再从 `assetLibrary`（`normalized.assetLibrary` 或 `worldInfo.assetLibrary`）`registerAssetLibrary`。
- **解析**：`resolveTextureSource` 对 `lib://{threeJsonId}` 查表；未命中再按 `name` 首条匹配。
- **缺失**：`console.warn`，返回 `null`（无贴图）。
- **增量 deploy**（`resetScene: false`）：不清 registry，仅追加注册条目（若库有更新）。
