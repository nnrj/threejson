# vue-app

ThreeJSON 与 **Vue 3 + Vite + TypeScript** 的最小示例：在 `onMounted` 中 `fetch` 场景 JSON 后调用 `createJsonScene`，在 `onBeforeUnmount` 中 `stop()` / `dispose()`。

在**本目录**执行：

```bash
npm install
npm run dev
```

`threejson` 通过 `package.json` 中的 `"file:../.."` 指向仓库根目录的本地包（即 `core/` 等源码）。

**自包含资源**：场景与贴图放在 `public/demo-assets/` 下（`scene/sceneRuntimeBasic.json`、`textures/...`），运行时通过站点根路径 `/demo-assets/...` 加载，**不依赖**仓库根的 `assets/`。`vite.config.ts` 中的 `server.fs.allow` 仍指向仓库根，仅供解析已链接的 `threejson` 包。
