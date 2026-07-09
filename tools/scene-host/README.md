# scene-host（场景编辑器 / 播放器）

`tools/scene-host/` 内的**编辑器**（`editor/`）与**播放器**（`player/`）是对旧版 [`tools/old_version/scene-editor.html`](../old_version/scene-editor.html)、[`tools/old_version/scene-player.html`](../old_version/scene-player.html) 的**拆分重构版**：从旧版 HTML **复制**业务逻辑后模块化，与旧版**代码零耦合**（禁止 import 旧版文件）。

## 当前阶段：scene-host 为正式版

Phase 5 切换已完成：**`editor/` / `player/` 现为推荐 / 稳定入口**，日常开发、演示与问题排查请以此为准。旧版 `scene-editor.html` / `scene-player.html` 已迁移到 [`tools/old_version/`](../old_version/)，仅作只读归档与历史对照保留，不再作为默认推荐。

| 角色 | scene-host（**当前推荐 / 稳定版**） | 旧版归档（`tools/old_version/`，只读对照） |
|------|--------------------------------------|--------------------------------------------|
| 编辑器 | [`editor/index.html`](editor/index.html) | [`../old_version/scene-editor.html`](../old_version/scene-editor.html) |
| 播放器 | [`player/index.html`](player/index.html) | [`../old_version/scene-player.html`](../old_version/scene-player.html) |

二者共用 settings / 播放列表等存储 key，便于历史数据延续与对照排查。

## 访问入口（仓库根静态服务）

| 应用 | URL |
|------|-----|
| 编辑器 | `/tools/scene-host/editor/index.html` |
| 播放器 | `/tools/scene-host/player/index.html` |

**Desktop（Electron）**：见 [`desktop/README.md`](desktop/README.md) — `npm start`（统一入口）/ `npm run start:editor` / `npm run start:player` / `npm run pack:win`。

## 旧版归档说明

[`tools/old_version/`](../old_version/) 下的 `scene-editor.html`、`scene-player.html` 是切换前的正本，仅作只读对照与历史参考；其内部导入/引用路径已随迁移调整（`./assets`、`./core` 等改为 `../../assets`、`../../core` 等），行为保持不变。**不建议**再对旧版做功能性修改；新功能一律进入 scene-host。

**允许 import**：`core/`、`domains/`、`builtins/`、`extensions/`、`assets/`（与旧版宿主相同）。

## Settings 与 localStorage

与旧版**共用同一套**（同一产品，便于历史数据延续）：

- 编辑器 key：`sceneEditor_settings_v1`
- 模板：`/assets/json/other/scene-editor/setting.json`
- 播放器：`scenePlayer_settings_v1` 对应路径

scene-host **复制**常量与字段形状，不 import 旧版代码。

## 目录结构

```text
tools/scene-host/
  README.md
  shared/          # editor + player 共用（runtime、settings、sceneLoad、CSS tokens）
  editor/          # 编辑器（正式版）
  player/          # 播放器（正式版）
  desktop/         # Electron 双入口
  scripts/         # 从旧版归档复制用的维护脚本（非运行时）
```

## 实施阶段（历史记录）

| 阶段 | 内容 |
|------|------|
| 0 | 本 README + 骨架 + `docs/zh/tools.md` 说明 |
| 1 | `shared/`：settings、runtimeConfig、基础 CSS |
| 2 | Editor **mvp_canvas**：全量加载入口 + settings + 复制基准 CSS；**无** AI/command/场景树/TransformControls |
| 2b+ | command/ai 复制到 `editor/lib/`；场景树、属性、AI |
| 3 | Player **parity_player**（薄壳 + 差量） |
| 4 | `desktop/` Electron |
| 5 | 工具链切换与旧文件退役（**已完成**，见 [`PHASE5-retirement.md`](PHASE5-retirement.md)） |

## 不在本工具链范围内

- [`examples/electron-apps/`](../../examples/electron-apps/) — 集成教程
- [`tools/threejson-agent-desktop/`](../../tools/threejson-agent-desktop/) — Agent 壳（已切换指向 scene-host editor）
- [`examples/html-demo/`](../../examples/html-demo/)、[`demo.html`](../../examples/html-demo/demo.html) — 教程索引

## 对照测试

同一 JSON、同一 settings 模板，对比 `tools/old_version/` 版与 scene-host 版：加载、保存、archive、objectRecord、settings 持久化。

## 维护脚本

```bash
node tools/scene-host/scripts/copy-scene-editor-lib.mjs
node tools/scene-host/scripts/extract-settings-schema.mjs
node tools/scene-host/scripts/extract-editor-shell.mjs
node tools/scene-host/scripts/assemble-editor-index.mjs
```

以上脚本从 [`tools/old_version/scene-editor.html`](../old_version/scene-editor.html) 读取，仅用于历史对照或补齐遗漏内容，日常开发无需运行。

### 当前结构

- `editor/lib/` — 自 `tools/common/editor-single/` **复制**的 command / ai / domainEditSession（勿 import 冻结目录）
- `editor/js/sceneTreePanel.js` — 场景树 + 属性面板
- `editor/js/commandLayer.js` — `editor.*` 命令 API
- `editor/js/aiSidebar.js` — 左侧 AI 侧栏
