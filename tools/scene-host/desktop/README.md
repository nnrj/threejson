# scene-host desktop（阶段 4/5 过渡）

Electron 桌面端与 `tools/scene-host/` Web 端共用 editor/player 渲染代码，Desktop 负责主进程、IPC、打包与分发。**当前阶段正本仍为**根目录 `scene-editor.html` / `scene-player.html`；scene-host desktop 已可独立打包安装，但仍处于「资源内置 + CDN fallback」的过渡状态。

## 定位：同代码库的桌面产品线

`desktop/` 不是独立前端渲染工程；它是 scene-host 的 Electron 宿主层：

1. 主进程启动 **本地 HTTP 静态服务**（`static-server.mjs`），把 **整个仓库根** 当网站根目录；
2. `BrowserWindow` 用 `loadURL` 打开与浏览器相同的页面（`editor/index.html` 或 `player/index.html`）；
3. 仅通过 **preload** 多暴露桌面能力（编辑器：纹理落盘、`texture-fill` bridge；播放器：`isDesktop`）。

因此开发期必须在**完整 ThreeJSON 仓库**旁运行（或设置 `THREEJSON_ROOT` 指向该根目录），并依赖其中的 `builtins/`、`core/`、`tools/scene-host/`、`assets/`、`extensions/` 等路径。页面 `importmap` 里 Three.js 等当前仍走 **CDN**（Phase C 改为本地 vendor）。

**编辑器与播放器是两个独立 exe 级入口**（`start:editor` / `start:player`），共用 `create-desktop-app.mjs`，并非混在一个窗口里。

## 能否打包成 exe / 独立分发？

| 能力 | 当前 scene-host/desktop | 说明 |
|------|-------------------------|------|
| 开发态运行 | ✅ `npm run start:editor` / `start:player` | 需本机 Node + `npm install`，且能访问仓库根 |
| 打包产物（目录） | ✅ `npm run pack:dir` | 使用 `electron-builder --dir` 生成 `dist/win-unpacked` |
| 打包安装包（Windows） | ✅ `npm run pack:win` | NSIS 安装包（一个安装包，含 Editor / Player 双快捷方式） |
| 运行资源 | ✅ 已内置 | 通过 `.pack/threejson-root` + `extraResources` 打入包内 |

当前为**分阶段方案（你已确认）**：

- Phase B（当前）：打包管线 + 资源内置 + `utilityProcess` 纹理 bridge；
- Phase C（待做）：importmap 全量本地 vendor，去掉 CDN 依赖，实现严格离线。

对比：[`tools/threejson-agent-desktop/`](../../threejson-agent-desktop/) 已有 `npm run pack`（`electron-builder --dir`），但同样只打包壳文件，**默认仍假设** `THREEJSON_ROOT` 或开发目录旁有完整仓库；[`examples/electron-apps/electron-app/`](../../../examples/electron-apps/electron-app/) 则是 Vite 打包 + `electron-builder` 的完整应用示例。

**结论（当前状态）**：scene-host desktop 已进入可打包阶段，开发态与打包态都可运行；但打包态仍是「资源内置 + CDN fallback」模式，严格离线将在下一阶段完成。

## 入口

| 命令 | 加载页面 | 说明 |
|------|----------|------|
| `npm start` | `/tools/scene-host/editor/index.html` | 统一入口（默认 editor，可传 `--player`） |
| `npm run start:editor` | `/tools/scene-host/editor/index.html` | 完整 `ThreeJsonDesktop` API（纹理落盘 + bridge） |
| `npm run start:player` | `/tools/scene-host/player/index.html` | 仅暴露 `isDesktop: true` |

## 安装与运行

```bash
cd tools/scene-host/desktop
npm install
npm start
# 或
npm run start:editor
# 或
npm run start:player
npm run pack:dir
# 或
npm run pack:win
```

可选环境变量 `THREEJSON_ROOT` 指向仓库根目录（默认自动推断为 `desktop/` 上三级）。

## 架构

```text
desktop/
  create-desktop-app.mjs   # 共享：窗口、静态服务、生命周期
  main.mjs                 # 统一入口（--editor / --player）
  static-server.mjs        # 127.0.0.1 本地 HTTP，服务仓库根目录
  editor-main.mjs          # 编辑器入口（薄壳）
  player-main.mjs          # 播放器入口（薄壳）
editor/
  electron/preload.mjs     # 编辑器 preload（纹理 / bridge）
player/
  electron/preload.mjs     # 播放器 preload（仅 isDesktop）
```

静态服务会提供 `builtins/`、`core/`、`assets/`、`extensions/` 等路径。开发态默认读取仓库根；打包态默认读取 `process.resourcesPath/threejson-root`。Three.js 等当前仍通过 `importmap` 的 CDN 项加载（Phase C 会改为本地 vendor）。

`pack:win` 生成安装包后会创建两个快捷方式：

- `ThreeJSON Scene Editor`（参数 `--editor`）
- `ThreeJSON Scene Player`（参数 `--player`）

## 与 agent-desktop 的关系

编辑器壳提供与 [`tools/threejson-agent-desktop/`](../../threejson-agent-desktop/) 相同的 `ThreeJsonDesktop` preload API（`getProjectRoot`、`saveTextureToProject`、`runTextureBridge`），便于 AI 纹理落盘。

播放器壳不需要纹理 IPC，故使用精简 preload。

拆分期不修改 `tools/threejson-agent-desktop/`。

## 故障排查

| 现象 | 处理 |
|------|------|
| 窗口空白 / 404 | 确认 `THREEJSON_ROOT` 指向含 `builtins/full.js` 的仓库根 |
| AI 纹理无法落盘 | 仅用 `start:editor`；检查 `assets/textures/ai-generated/` 可写 |
| `runTextureBridge` 失败 | 打包态使用 `utilityProcess`；开发态确认 `tools/threejson-agent/bridge/texture-fill.mjs` 存在 |
| 场景 JSON 加载失败 | 静态服务日志：路径须在仓库根下（如 `/assets/json/...`） |
