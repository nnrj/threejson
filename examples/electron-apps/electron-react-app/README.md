# ThreeJSON Electron + React

Electron 壳 + Vite + React，与 `examples/react-app` 相同的 `createJsonScene` 集成，开发端口 **5175**。

```bash
cd examples/electron-apps/electron-react-app
npm install
npm run dev
```

本地验证打包结果用 `npm run preview`。若使用 `npm start`，须先 `npm run build`，否则 `dist/` 未更新时贴图（如 `textureUrl`）可能无法加载。详见 [`../README.md`](../README.md)。
