# Tests

## Core engine

Root `npm test` runs `tests/*.test.mjs` (Node built-in test runner).

材质面板二期相关：`materialDescriptorWalk.test.mjs`、`resolveTextureSource.test.mjs`、`editorMaterialHistorySnapshot.test.mjs`、`createInstanceBox.test.mjs`、`descriptorExportSanitize.test.mjs`（见 [`lab/archive/material-panel-phase2-shipped.md`](../lab/archive/material-panel-phase2-shipped.md)）。

## AI verification

| 文档 / 脚本 | 说明 |
|-------------|------|
| [`ai-manual-verification.md`](./ai-manual-verification.md) | **手动签收矩阵**（浏览器目视、MCP、完整 CLI 流程） |
| [`fixtures/ai-test/`](./fixtures/ai-test/) | 夹具 JSON |
| `npm run verify:ai-static` | 纯 Node 夹具、纹理槽和可选工具入口；不调用供应商 |
| `npm run verify:ai-live` | 显式设置 `THREEJSON_LIVE_SETTINGS` 后才调用真实供应商；可能收费 |
| `npm run verify` | `npm test` + `verify:ai-static` |

供应商失败或限流不算验证通过。Node 版本需为 **24+**。Windows 沙箱若禁止测试进程派生，
可逐个执行 `node tests/<file>.test.mjs`，而不是跳过断言。

新操作协议回归：`sceneOperationService`、`sceneOperationAgent`、`sceneTools`、
`sceneToolExtensions`、`sceneEditorBridge`。Python 外壳已退役。

浏览器集成回归（显式使用已安装的 Chromium/Edge，不下载浏览器、不调用 AI）：

```powershell
$env:THREEJSON_BROWSER = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node tools/dev/verify-scene-operations-browser.mjs
```

需要本地已安装可选 `playwright`。报告与截图在 `dist/scene-operation-check/`，不提交仓库。
该检查包括机房、港口、FPS、片头、粒子、算子 Worker，以及编辑器配对后修改和撤销。
示例页面仍会使用本身声明的 CDN 依赖，网络失败须单独检查，不能冒充渲染回归。
