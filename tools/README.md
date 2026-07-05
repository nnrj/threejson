# ThreeJSON 外置工具链

本目录收纳**不随 npm 包 `threejson` 发布**的仓库级工具：CLI/GUI、MCP、桌面壳、以及开发维护脚本。运行时引擎在 [`core/`](../core/)，根目录 [`tests/`](../tests/) 为 core 的 Node 单测。

## 目录

| 路径 | 用途 |
|------|------|
| [`threejson-agent/`](threejson-agent/README.md) | 外置 Agent 产品根：`bridge/` + `shell/py/`（Python CLI/GUI）；配置 `threejson-agent/setting.json` |
| [`mcp-threejson/`](mcp-threejson/) | Cursor MCP stdio；直接 import `core/ai`；读写 `mcp-threejson/setting.json`（与 agent 分离） |
| [`threejson-agent/components/`](threejson-agent/components/README.md) | Agent 子进程二进制（如 `asset-search`），仅由 Node bridge 解析 |
| [`threejson-agent-desktop/`](threejson-agent-desktop/) | Electron 桌面壳，复用 agent 的 texture bridge |
| [`common/editor-single/`](common/editor-single/README.md) | 单文件正本 [`scene-editor.html`](../scene-editor.html) 的依赖：`command/`（`editor.*`）、`ai/`、`domainEditSession.js` |
| [`scene-host/`](scene-host/README.md) | **绿场**：[`scene-editor.html`](../scene-editor.html) / [`scene-player.html`](../scene-player.html) 的拆分重构（`editor/`、`player/`、`desktop/`）；**对齐与调试中**；完成前以根 HTML 为正本 |
| [`dev/`](dev/) | 仓库维护脚本（非产品运行时） |

### `dev/` 子目录

| 子目录 | 脚本示例 |
|--------|----------|
| `importmap/` | `bump-three-importmap.mjs`、`check-importmaps.mjs`、`patch-gifuct-importmap.mjs` |
| `migrate/` | `migrate-preset-json.mjs`、`migrate-scene-json-objtypes.mjs` |
| `build/` | `generate-business-domain-manifest.mjs`、`build-threejson-component.mjs` |

## 常用命令（仓库根）

```bash
npm run threejson-agent:gui
npm run generate:business-domain-manifest
npm test
node tools/dev/build/build-threejson-component.mjs asset-search
```

## 与编辑器的关系

[`scene-editor.html`](../scene-editor.html) 使用浏览器内 `core/ai`（localStorage 配置），并 **import** [`common/editor-single/command/`](common/editor-single/command/) 提供 `editor.*` 命令（`window.sceneEditor.runEditorCommands`）。不依赖 Python/Node 外置链。各外置入口各自维护 `setting.json`；字段形状可参考 [`examples/script/setting.example.json`](../examples/script/setting.example.json)。

**宿主配置契约**（`sysConfig` 与 `sceneConfig`）：[`doc/tools.md`](../doc/tools.md)。
