# Phase 5：旧 HTML 退役说明

`tools/scene-host/` 是 [`scene-editor.html`](../../scene-editor.html)、[`scene-player.html`](../../scene-player.html) 的模块化拆分重构。**本文档描述的是绿场验收完成后的切换步骤**；在此之前，根目录 HTML 仍为**正本（稳定版）**，绿场尚在对齐与调试中，请勿将 scene-host 作为默认生产入口推广。

## 新入口（验收完成后）

| 角色 | URL / 命令 |
|------|------------|
| 编辑器（Web） | `/tools/scene-host/editor/index.html` |
| 播放器（Web） | `/tools/scene-host/player/index.html` |
| 统一桌面入口（Desktop） | `cd tools/scene-host/desktop && npm start`（默认 Editor，可传 `--player`） |
| 编辑器（Desktop） | `cd tools/scene-host/desktop && npm run start:editor` |
| 播放器（Desktop） | `cd tools/scene-host/desktop && npm run start:player` |
| 桌面安装包（Desktop） | `cd tools/scene-host/desktop && npm run pack:win` |

## 与正本的关系

- **正本（稳定版，切换前默认）**：`scene-editor.html`、`scene-player.html`
- **对照基准（拆分期勿改 diff）**：上述正本 HTML、`tools/common/editor-single/`
- **共用数据**：`sceneEditor_settings_v1`、`scenePlayer_settings_v1`、IndexedDB `threejson_scene_editor`、用户 baseline / 最近场景列表等
- **可 import**：`core/`、`domains/`、`builtins/`、`extensions/`、`assets/`

## 切换检查清单

在团队内推广 scene-host 前，建议逐项确认：

1. **打开/保存**：命名保存、另存为副本、覆盖确认、最近场景列表
2. **会话恢复**：脏数据退出三选一、启动恢复弹窗、自动快照
3. **编辑**：场景树、属性面板、Transform、撤销/重做、三视图
4. **导入导出**：场景 JSON/.tjz、对象 JSON/.tjz/GLB、Mesh 导入
5. **AI / Command**：侧栏 agent、exec 命令层（Desktop 需 `runTextureBridge`）
6. **播放器**：播放列表、transport、`window.scenePlayer` 告警与高亮 API
7. **桌面打包**：`pack:dir` / `pack:win` 可构建；安装包含 Editor / Player 双快捷方式

## 退役步骤（建议）

1. 在文档与内部链接中将默认入口改为 scene-host URL
2. 在 `scene-editor.html` / `scene-player.html` 顶部增加「已迁移」提示与跳转链接（**仅当产品允许修改基准 HTML 时**；当前约束为 diff=0，故通常只改外部文档与书签）
3. 观察一个发布周期：无 P0 反馈后，将旧 HTML 标记为 deprecated（README），不再作为默认推荐
4. 长期：旧 HTML 保留为只读对照，或归档到 `docs/legacy/`

## 维护脚本

```bash
node tools/scene-host/scripts/assemble-editor-index.mjs
node tools/scene-host/scripts/copy-scene-editor-lib.mjs
```

修改 `editor/_shell-body.html` 后必须运行 assemble 脚本以同步 `editor/index.html`。
