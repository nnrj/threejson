# scene-host（绿场编辑器 / 播放器）

`tools/scene-host/` 内的**编辑器**（`editor/`）与**播放器**（`player/`）是对根目录 [`scene-editor.html`](../../scene-editor.html)、[`scene-player.html`](../../scene-player.html) 的**拆分重构版**：从正本 HTML **复制**业务逻辑后模块化，与正本**代码零耦合**（禁止 import 基准文件）。

## 当前阶段：正本为稳定版

| 角色 | 正本（**当前推荐 / 稳定版**） | 绿场（**对齐与调试中**） |
|------|------------------------------|--------------------------|
| 编辑器 | [`scene-editor.html`](../../scene-editor.html) | [`editor/index.html`](editor/index.html) |
| 播放器 | [`scene-player.html`](../../scene-player.html) | [`player/index.html`](player/index.html) |

**在完成与正本的行为/UI 对齐并通过验收之前**，日常开发、演示与问题排查请以 **`scene-editor.html` / `scene-player.html` 为正本**。绿场版用于模块化演进与对照测试；二者共用 settings / 播放列表等存储 key，便于并行验证。

拆分期 **不修改** 正本 HTML 与 [`tools/common/editor-single/`](../common/editor-single/)（仅作对照与复制来源）。退役与默认入口切换见 [`PHASE5-retirement.md`](PHASE5-retirement.md)（**须在绿场验收完成后**再执行）。

## 访问入口（仓库根静态服务）

| 应用 | URL |
|------|-----|
| 编辑器 | `/tools/scene-host/editor/index.html` |
| 播放器 | `/tools/scene-host/player/index.html` |

**Desktop（Electron）**：见 [`desktop/README.md`](desktop/README.md) — `npm start`（统一入口）/ `npm run start:editor` / `npm run start:player` / `npm run pack:win`。

## 拆分期硬性约束（三不碰）

以下资产拆分期 **git diff 必须为零**，仅作**正本**对照与复制来源：

| 基准 | 说明 |
|------|------|
| [`scene-editor.html`](../../scene-editor.html) | 根目录编辑器（**正本 / 稳定版**） |
| [`scene-player.html`](../../scene-player.html) | 根目录播放器（**正本 / 稳定版**） |
| [`tools/common/editor-single/`](../../tools/common/editor-single/) | command / ai / domainEditSession |

**禁止**：从 scene-host `import` 上述路径；禁止修改根 HTML 做转发接线。

**允许 import**：`core/`、`domains/`、`builtins/`、`extensions/`、`assets/`（与现有宿主相同）。

## Settings 与 localStorage

与旧版**共用同一套**（同一产品，过渡对照）：

- 编辑器 key：`sceneEditor_settings_v1`
- 模板：`/assets/json/other/scene-editor/setting.json`
- 播放器（阶段 3）：`scene-player` 对应路径

scene-host **复制**常量与字段形状，不 import 旧宿主代码。

## 目录结构

```text
tools/scene-host/
  README.md
  shared/          # editor + player 共用（runtime、settings、sceneLoad、CSS tokens）
  editor/          # 编辑器绿场（阶段 2 MVP 起）
  player/          # 播放器绿场（阶段 3，Editor MVP + shared 验证后）
  desktop/         # Electron 双入口（阶段 4）
  scripts/         # 从基准复制用的维护脚本（非运行时）
```

## 实施阶段

| 阶段 | 内容 |
|------|------|
| 0 | 本 README + 骨架 + `docs/zh/tools.md` 说明 |
| 1 | `shared/`：settings、runtimeConfig、基础 CSS |
| 2 | Editor **mvp_canvas**：全量加载入口 + settings + 复制基准 CSS；**无** AI/command/场景树/TransformControls |
| 2b+ | command/ai 复制到 `editor/lib/`；场景树、属性、AI |
| 3 | Player **parity_player**（薄壳 + 差量） |
| 4 | `desktop/` Electron |
| 5 | 工具链切换与旧文件退役（由维护者触发） |

**宏观顺序**：先 Editor，后 Player。Player 启动门槛：Editor MVP 跑通且 `shared` 已在 Editor 路径验证。

## 不在本工具链范围内

- [`examples/electron-apps/`](../../examples/electron-apps/) — 集成教程，拆分期不修改
- [`tools/threejson-agent-desktop/`](../../tools/threejson-agent-desktop/) — Agent 壳，拆分期不修改
- [`examples/html-demo/`](../../examples/html-demo/)、[`demo.html`](../../demo.html) — 教程索引

## 对照测试

同一 JSON、同一 settings 模板，对比根版与 scene-host 版：加载、保存、archive、objectRecord、settings 持久化。

## 维护脚本

```bash
node tools/scene-host/scripts/copy-scene-editor-lib.mjs
node tools/scene-host/scripts/extract-settings-schema.mjs
node tools/scene-host/scripts/extract-editor-shell.mjs
node tools/scene-host/scripts/assemble-editor-index.mjs
```

### 阶段 2b+（当前）

- `editor/lib/` — 自 `tools/common/editor-single/` **复制**的 command / ai / domainEditSession（勿 import 冻结目录）
- `editor/js/sceneTreePanel.js` — 场景树 + 属性面板
- `editor/js/commandLayer.js` — `editor.*` 命令 API
- `editor/js/aiSidebar.js` — 左侧 AI 侧栏
