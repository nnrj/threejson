# Phase 5：旧 HTML 退役说明（已完成）

`tools/scene-host/` 是旧版 `scene-editor.html`、`scene-player.html` 的模块化拆分重构。**本文档描述的切换已经完成**：scene-host 现为默认生产入口，旧版 HTML 已迁移到 [`tools/old_version/`](../old_version/) 作只读归档。

## 新入口（当前默认）

| 角色 | URL / 命令 |
|------|------------|
| 编辑器（Web） | `/tools/scene-host/editor/index.html` |
| 播放器（Web） | `/tools/scene-host/player/index.html` |
| 统一桌面入口（Desktop） | `cd tools/scene-host/desktop && npm start`（默认 Editor，可传 `--player`） |
| 编辑器（Desktop） | `cd tools/scene-host/desktop && npm run start:editor` |
| 播放器（Desktop） | `cd tools/scene-host/desktop && npm run start:player` |
| 桌面安装包（Desktop） | `cd tools/scene-host/desktop && npm run pack:win` |

## 与旧版归档的关系

- **旧版归档（只读对照）**：[`tools/old_version/scene-editor.html`](../old_version/scene-editor.html)、[`tools/old_version/scene-player.html`](../old_version/scene-player.html)
- **共用数据**：`sceneEditor_settings_v1`、`scenePlayer_settings_v1`、IndexedDB `threejson_scene_editor`、用户 baseline / 最近场景列表等
- **可 import**：`core/`、`domains/`、`builtins/`、`extensions/`、`assets/`

## 切换检查清单（验收已通过）

1. **打开/保存**：命名保存、另存为副本、覆盖确认、最近场景列表 ✅
2. **会话恢复**：脏数据退出三选一、启动恢复弹窗、自动快照 ✅
3. **编辑**：场景树、属性面板、Transform、撤销/重做、三视图 ✅
4. **导入导出**：场景 JSON/.tjz、对象 JSON/.tjz/GLB、Mesh 导入 ✅
5. **AI / Command**：侧栏 agent、exec 命令层（Desktop 需 `runTextureBridge`） ✅
6. **播放器**：播放列表、transport、`window.scenePlayer` 告警与高亮 API ✅
7. **桌面打包**：`pack:dir` / `pack:win` 可构建；安装包含 Editor / Player 双快捷方式 ✅

## 已执行的退役步骤

1. 文档与内部链接（网站、shower、examples/html-demo、README）已将默认入口改为 scene-host URL
2. `scene-editor.html` / `scene-player.html` 已迁移至 [`tools/old_version/`](../old_version/)，其内部导入/引用路径已调整为适配新目录深度（`./assets` → `../../assets` 等）
3. 旧 HTML 保留为只读对照，不再作为默认推荐；后续功能开发一律进入 scene-host

## 维护脚本

```bash
node tools/scene-host/scripts/assemble-editor-index.mjs
node tools/scene-host/scripts/copy-scene-editor-lib.mjs
```

以上脚本从 [`tools/old_version/scene-editor.html`](../old_version/scene-editor.html) 读取，仅用于历史对照，日常开发无需运行。

修改 `editor/_shell-body.html` 后必须运行 assemble 脚本以同步 `editor/index.html`。
