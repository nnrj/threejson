# ThreeJSON Electron (native)

原生 Electron + Vite 渲染进程，无 React/Vue。加载 `public/demo-assets` 中的 `sceneRuntimeBasic.json`，调用 `createJsonScene`。

## 运行

```bash
cd examples/electron-apps/electron-app
npm install
npm run dev
```

开发模式会同时启动 Vite（5173）与 Electron 窗口。

生产预览（**推荐**：会自动 build）：

```bash
npm run preview
```

若使用 `npm start`（仅打开 Electron、**不会** build），须**先**执行 `npm run build`，否则 `dist/` 中缺少或过期的 `demo-assets` 会导致场景 JSON 里的 `textureUrl` 贴图无法加载（例如地球变黑）。流程：

```bash
npm run build
npm start
```

依赖仓库根目录的 `threejson`（`file:../../..`），与 `examples/react-app` 相同。
