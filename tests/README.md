# Tests

## Core engine

Root `npm test` runs `tests/*.test.mjs` (Node built-in test runner).

材质面板二期相关：`materialDescriptorWalk.test.mjs`、`resolveTextureSource.test.mjs`、`editorMaterialHistorySnapshot.test.mjs`、`createInstanceBox.test.mjs`、`descriptorExportSanitize.test.mjs`（见 [`lab/archive/material-panel-phase2-shipped.md`](../lab/archive/material-panel-phase2-shipped.md)）。

## AI verification

| 文档 / 脚本 | 说明 |
|-------------|------|
| [`ai-manual-verification.md`](./ai-manual-verification.md) | **手动签收矩阵**（浏览器目视、MCP、完整 CLI 流程） |
| [`fixtures/ai-test/`](./fixtures/ai-test/) | 夹具 JSON |
| `npm run verify:ai-static` | 夹具 + bridge 语法 +（已装依赖时）Python config 单测 |
| `npm run verify:ai-live` | 可选：最短 CLI generate + texture plan（需 agent `setting.json`） |
| `npm run verify` | `npm test` + `verify:ai-static` |

Live 验证若遇 **429 限流** 会 SKIP 而不失败；请确保 `node -v` 为 **24+**（与 [`.nvmrc`](../.nvmrc) 一致），否则 bridge 子进程可能用错 Node 版本。

Python Agent 依赖：`pip install -r tools/threejson-agent/shell/py/requirements.txt`

Agent Python 单测：`cd tools/threejson-agent/shell/py && python -m unittest discover -s tests`
