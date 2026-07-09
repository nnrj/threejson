# editor-single（单文件旧版编辑器依赖）

[`scene-editor.html`](../../old_version/scene-editor.html) 位于 [`tools/old_version/`](../../old_version/)，是本仓库已退役的**单文件旧版编辑器**（只读归档）；本目录为其 **import 依赖**（`command/`、`ai/`、`domainEditSession.js`），**不是**模块化拆分版。

模块化拆分重构版在 [`tools/scene-host/editor/`](../../scene-host/editor/)，现为默认推荐入口，二者勿混淆。

## 接线

```javascript
import { createCommandRegistry, executeCommands } from "./core/command/index.js";
import { registerEditorCommands } from "./tools/common/editor-single/command/index.js";

const registry = createCommandRegistry();
registerEditorCommands(registry, editorApi);
```

编辑器内 AI 应优先使用 `editor.exec` / `editor.ingest`，而非裸 `object.add`（否则不进撤销栈）。

命令支持 **双格式**（可混用）：

- **JSONL**：`{"op":"object.patch","args":{"id":"x","partial":{...}}}`
- **微 DSL**：`object.patch id=x partial={"position":{"x":1}}`

侧栏 AI 若返回上述脚本（可包在 ` ```command ` 代码块内），将自动走 `runEditorCommands` 而非整段 JSON 载入。

## 与 scene-host 的关系

绿场 [`tools/scene-host/editor/lib/`](../../scene-host/editor/lib/) 由本目录 **复制**生成（见 `tools/scene-host/scripts/copy-scene-editor-lib.mjs`）。运行时 scene-host **不 import** 本目录，避免与正本耦合。
