> **归档**：一次性迁移记录。

# Scene JSON 残留字段清理审计

**状态**：`archived`（2026-06 已执行）

## 已执行决策

- 项目未发布，无历史兼容包袱；清理时不保留旧 JSON 兼容读取分支。
- 删除 worldInfo 死字段：`fullScreen`、`fullPage`、`loading`、`editLock`。
- 删除 worldInfo 无用表单字段：`returnButtonShow`、`blockInfoPanel`、`floorElevation`、`floorHeight`。
- 删除顶层历史键：数字 `id`、`worldId`（以及 `worldInfo.id`）。
- `worldInfo` 运行时简写仅作为输入语法糖：
  - `camaraPosition` / `cameraPosition` / `camera` 预解析 lift 到 `sceneConfig.camera`
  - `controls` / `orbitControls` 预解析 lift 到 `sceneConfig.controls`
  - 持久化与导出仅写 `sceneConfig`，不再写回 `worldInfo` 简写
- `worldInfo.gridShow` / `axesShow` / `sceneAutoRotate` 不恢复为语法糖；统一使用 `sceneConfig.helpers.*` 与 `sceneConfig.controls.autoRotate`。

## 代码与脚本调整

- Core 预解析归一：`core/handler/sceneFriendlyNormalizer.js`
- runtime defaults 相机来源收敛：`core/util/sceneRuntimeDefaults.js`
- 导出路径不再保留 worldInfo 相机/控制简写：`core/util/util.js`
- 编辑器 Scene Manage 删除无效 worldInfo 字段，并将 helpers 区块明确为 `sceneConfig.helpers`：`scene-editor.html`
- 生成器同步：`tools/dev/build/generate-roomShow.mjs`
- 新增清理脚本：`tools/dev/migrate/migrate-worldinfo-cleanup.mjs`

## 本次迁移结果

- 清理脚本已执行，更新 `assets/json` 与 `tests/fixtures` 的相关文件，移除上述残留键并完成 `sceneConfig` 归一。
