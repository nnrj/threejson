# ThreeJSON Electron Examples

[中文](./README.md) | [English](./README_EN.md)

在桌面壳中运行与 `examples/react-app`、`examples/vue-app` 相同的最小 ThreeJSON 场景（`sceneRuntimeBasic.json`）。

| 目录 | 说明 | 开发端口 |
|------|------|----------|
| [`electron-app/`](./electron-app/) | 原生 Electron + Vite（无 UI 框架） | 5173 |
| [`electron-vue/`](./electron-vue/) | Electron + Vue 3 | 5174 |
| [`electron-react-app/`](./electron-react-app/) | Electron + React | 5175 |

## 环境

- **Node.js 24+**（与仓库根 [`.nvmrc`](../../.nvmrc) 一致）。
- 首次使用请在**各子目录**分别执行 `npm install`（会下载 Electron 二进制，体积较大，可能较慢）。

## 安装（请在本机手动执行）

在仓库根目录打开终端，按需进入子项目：

```bash
cd examples/electron-apps/electron-app
npm install
npm run dev
```

```bash
cd examples/electron-apps/electron-vue
npm install
npm run dev
```

```bash
cd examples/electron-apps/electron-react-app
npm install
npm run dev
```

若曾在较低 Node 版本下安装中断，请先删除该目录下的 `node_modules` 再重新 `npm install`。

`npm run dev` 会并行启动 Vite 与 Electron；`npm run preview` 先构建再打开打包后的 `dist/index.html`。

### `npm start` 与 `npm run build`

| 命令 | 行为 |
|------|------|
| `npm run dev` | Vite 开发服（HTTP）+ Electron；贴图从 `public/demo-assets/` 提供，**无需**先 build。 |
| `npm run preview` | **`npm run build` 后再**用 Electron 打开 `dist/`（推荐用于本地验证打包结果）。 |
| `npm start` | **仅**启动 Electron，加载已有 `dist/index.html`（`file://`）。**不会**自动执行 build。 |

**首次或修改过 `public/`、场景 JSON、源码后**，若直接 `npm start` 而未 build，`dist/` 可能缺失或过期，表现为 **纹理/贴图无法加载**（例如地球显示为黑球）。请先在该子目录执行：

```bash
npm run build
npm start
```

或直接使用：`npm run preview`（等价于 build + Electron）。

依赖通过 `threejson: "file:../../.."` 链接仓库根包；Vite 的 `server.fs.allow` 已包含仓库根目录，与 Web 示例一致。

## 与 Web 示例的差异

- 渲染进程仍使用 `createJsonScene`，场景 JSON 与贴图放在各应用的 `public/demo-assets/`。
- 场景内 `textureUrl` 使用 **相对路径** `./demo-assets/...`，以便 Electron 以 `file://` 加载 `dist` 时仍能解析贴图。
- 主进程仅负责窗口与开发/生产 URL 切换；未实现 IPC 读写本地工程文件（完整编辑器见 `tools/threejson-agent-desktop`）。
