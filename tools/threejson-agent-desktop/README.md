# ThreeJSON Agent Desktop (Electron)

Electron 壳加载仓库根目录的 `scene-editor.html`，并通过 preload 将纹理写入 `assets/textures/`。

## 要求

- Node.js 24+（与仓库 [`.nvmrc`](../../.nvmrc) 一致）
- 在 `tools/threejson-agent-desktop` 执行 `npm install`

## 运行

```bash
# 可选：指定仓库根（默认为 desktop 目录上两级）
set THREEJSON_ROOT=E:\WORKSPACE\00ProjectSpace\ThreeJSJson\ThreeJSON
npm start
```

`window.ThreeJsonDesktop.saveTextureToProject(relativePath, Uint8Array)` 供编辑器 AI 纹理落盘。

## 打包

```bash
npm run pack
```

代码签名与自动更新未包含在首版中。
