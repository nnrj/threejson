# ThreeJSON AI 接口

[中文](./README.md) | [English](./README_EN.md)

`core/ai` 提供六类能力：

> 浏览器教程 Demo：[`examples/html-demo/track-05-tooling/05-01-ai-scene.html`](../../examples/html-demo/track-05-tooling/05-01-ai-scene.html)（JSON 向调整；命令模式见 Scene Editor）。

1. **生成**：输入提示词，返回可用于 ThreeJSON 引擎的完整场景 JSON 字符串。
2. **看图生成**：输入参考图（公网 URL、`data:image/*;base64,...` 字符串，或 `{ base64, mimeType }` 裸 base64），可选补充文本；返回完整场景 JSON。**需支持多模态 Chat Completions 的模型**（如 OpenAI `gpt-4o-mini` / `gpt-4o`）；仍走与文本生成相同的 HTTP 封装 `requestChatCompletion`。
3. **字符串级修改**：输入提示词 + 已有场景 JSON 字符串，返回调整后的 JSON 字符串（可在浏览器使用，不落盘）。
4. **命令级修改（core 命令脚本）**：输入提示词 + 场景上下文，LLM 产出 `scene.*` / `object.*` / `material.*` 命令（JSONL 或微 DSL）；经 `core/command` 执行或 MCP `threejson_exec`。**不含 `editor.*`**（编辑器包装在 `tools/common/editor-single/ai`）。
5. **文件级修改（Node）**：输入提示词 + 已有场景文件路径，读取后请求 AI，并把结果写回原 `.json` 或导出风格的 `.js` 模块。
6. **纹理规划与填充**：Chat 模型根据场景 JSON 输出每个 `textureUrl` 位点的 JSON Pointer 与英文生图提示；再调用可插拔的 `imageProvider` 生图，经 `normalizeImageRawToBlob` 统一为 `Blob`，由 `sink.saveLocal` / `sink.upload`（或 Node 下 `localOutputDir` 默认落盘）得到最终写入场景的 URL 或路径字符串。

支持的 AI Provider：

- `chatgpt`（默认模型 `gpt-4o-mini`，OpenAI Chat Completions：`https://api.openai.com/v1/chat/completions`）
- `deepseek`（默认模型 `deepseek-chat`，接口 `https://api.deepseek.com/chat/completions`）
- `custom`：任意 OpenAI 兼容的根 URL（与 `chatgpt` 相同路径后缀 `/chat/completions`），必须通过参数传入 `baseUrl`，例如 `https://your-gateway.example/v1`

## 文件说明

- `threeJsonCoreSkill.js`：将 core 能力整理为 AI 系统提示；含 primitive geometry、native Three.js、`sceneConfig`、infoPanel / css3dPanel / shaderSurface / particleEmitter、场景文字（`objectList` + `objType: text`）、few-shot 示例等。
- `sceneCapability.js`：从用户 prompt 推断能力提示（`buildIntentHints`），以及生成后的能力匹配评估（`evaluateCapabilityFit`）。
- `sceneCommandSkill.js`：core 命令模式 system prompt（`object.patch`、`material.patch`、`camera.fit`、`object.reconcile` 等；不含 `editor.*`）。
- `texturePrompt.js`：纹理任务计划的英文 system/user 模板（输出 `{ "tasks": [...] }`，pointer 为 RFC 6901）。
- `textureAiService.js`：`planTextures`、`fillTextureUrls`、`createOpenAiImageProvider`、`normalizeImageRawToBlob`、`listTextureUrlPointers` 等。
- `sceneAiService.js`：HTTP 调用、`extractJsonText` 解析、JSON 校验；`requestUpdatedSceneEditCommands`（命令模式更新）；高级用法可导入 `requestChatCompletion`。
- `sceneCommandSkill.js`：core 命令 system prompt 与 LLM 输出解析（`buildSceneCommandUpdateSystemPrompt`、`isLikelyCommandScriptText` 等）。
- `core/util/nodeSceneFile.js`：`updateSceneJsonFile`（Node 读写场景文件，勿从 `core/ai/index.js` 导入）。
- `index.js`：对外统一入口；在浏览器中挂载 `window.ThreeJsonAI`（适合浏览器的方法见下文）。

## 模块导出（ESM）

```js
import {
  createSceneAiClient,
  generateSceneJsonString,
  generateSceneJsonFromImage,
  updateSceneJsonString,
  requestUpdatedSceneEditCommands,
  buildSceneCommandUpdateSystemPrompt,
  planTextures,
  fillTextureUrls,
  createOpenAiImageProvider,
  normalizeImageRawToBlob,
  listTextureUrlPointers,
  parseSceneJsonString,
  extractJsonText,
  resolveVisionImageUrl
} from "./core/ai/index.js";
```

`createSceneAiClient(defaultOptions)` 返回对象，方法会把 `defaultOptions` 与每次调用的 `options` 合并：

- `generateSceneJsonString(prompt, options?)` — 默认 `maxTokens: 6000`；可选 `planFirst: true`（先大纲再生成）、`capabilityReview: false`（跳过能力匹配修正，默认开启一次）
- `generateSceneJsonFromImage({ prompt?, image }, options?)` — `image` 为 URL 字符串、`data:image/...` 字符串，或 `{ base64: string, mimeType?: string }`
- `updateSceneJsonString(prompt, currentSceneJsonString, options?)`
- `requestUpdatedSceneEditCommands(prompt, context?, options?)` — `outputMode: 'commands'|'json'`；commands 失败可 `fallbackToJson`
- `updateSceneJsonFile(prompt, sceneFilePath, options?)`（`core/util/nodeSceneFile.js`，不要在浏览器里调用）
- `planTextures(sceneJsonStringOrObject, userHint, options?)`
- `fillTextureUrls(sceneJsonStringOrObject, options?)`
- `runSceneAgent(input, options?)` — 可选多轮 Agent；**默认 `agent.enabled: false`**（与单次生成相同，不额外消耗轮次）

浏览器全局（非模块脚本可用）：

```text
window.ThreeJsonAI.createSceneAiClient
window.ThreeJsonAI.generateSceneJsonString
window.ThreeJsonAI.generateSceneJsonFromImage
window.ThreeJsonAI.updateSceneJsonString
window.ThreeJsonAI.resolveVisionImageUrl
window.ThreeJsonAI.planTextures
window.ThreeJsonAI.fillTextureUrls
window.ThreeJsonAI.createOpenAiImageProvider
window.ThreeJsonAI.normalizeImageRawToBlob
window.ThreeJsonAI.listTextureUrlPointers
window.ThreeJsonAI.runSceneAgent
```

不提供 `updateSceneJsonFile` 的全局挂载（避免在无 Node API 的环境下误用）。纹理相关接口会暴露密钥与计费风险，生产环境请放在服务端或本地脚本。

## 接口：可选场景 Agent（`runSceneAgent`）

仅当显式传入 `agent.enabled: true` 时启用多轮流程（大纲 → 生成 → 结构修复 → **能力匹配审查** → 布局审查 → 可选纹理位点 dry-plan）。**未启用时**仍走单次 API，但会注入 intent hints，并在默认情况下做一次 capability review。

```js
const result = await aiClient.runSceneAgent(
  { mode: "generate", prompt: "智慧园区，含道路与两栋建筑" },
  {
    agent: { enabled: true, depth: "medium" }, // simple | medium | deep | auto
    onProgress: ({ step, kind, message }) => console.log(step, kind, message),
    apiKey: "...",
    provider: "chatgpt"
  }
);
// result.sceneJsonString, result.steps, result.agentUsed, result.tokenHint
```

`depth` 预设：`simple`（1 轮）、`medium`（大纲+修复）、`deep`（+纹理位点 dry-plan）、`auto`（在 deep 预算内尽量校验通过）。

浏览器内 Agent **不会**默认调用 `fillTextureUrls` 写入本地 `assets/textures/`；编辑器可配置 `texture.sink`（目录授权 / 图床 / ZIP），外置批处理见 `tools/threejson-agent/`。

## 浏览器编辑器（tools/scene-host/editor）接入

[`tools/scene-host/editor/`](../../tools/scene-host/editor/)（当前正式版，旧版归档见 [`tools/old_version/scene-editor.html`](../../tools/old_version/scene-editor.html)）与 CLI/MCP **平行**：只 `import` 本模块，凭据存 **localStorage**，**不**读取 `setting.json`，**不** spawn Node 桥。

```js
const client = createSceneAiClient({ provider: "chatgpt", apiKey, model });
const abort = new AbortController();

const { sceneJsonString } = await client.runSceneAgent(
  { mode: "update", prompt, currentSceneJsonString: currentJson },
  {
    agent: { enabled: true, depth: "medium" },
    updateMode: "incremental", // 可选，默认 full
    stream: true, // 可选，默认 false
    streamPreview: true, // 可选：onProgress 携带 previewDelta
    signal: abort.signal,
    onProgress: ({ step, kind, message, previewDelta }) => {
      console.log(step, kind, message, previewDelta || "");
    }
  }
);
// abort.abort() 可中止进行中的 fetch
```

## 接口一：生成场景 JSON 字符串

```html
<script type="module">
  import { createSceneAiClient } from "./core/ai/index.js";

  const aiClient = createSceneAiClient({
    provider: "chatgpt",
    apiKey: "YOUR_API_KEY"
  });

  const prompt = "生成一个工业园区场景，包含道路、仓库、两座办公楼和信息面板";
  const sceneJsonString = await aiClient.generateSceneJsonString(prompt);
  const sceneObj = JSON.parse(sceneJsonString);
  console.log(sceneObj.worldInfo.boxModelList.length);
</script>
```

## 接口「看图」：参考图生成场景 JSON 字符串

与「接口一」相同返回格式（格式化后的 JSON 字符串）。底层仍调用 `chat/completions`，`user` 消息为多模态（文本 + `image_url`）。

- **适用模型**：需提供 **Vision / 多模态** 支持的 Chat 模型（如 `gpt-4o-mini`、`gpt-4o`）；`deepseek-chat` 等纯文本路由通常不可用。
- **`input.image`**：公网 **`https?://...`** URL；或 **`data:image/*;base64,...`**；或 **`{ base64: "...", mimeType: "image/png" }`**（内部拼成 data URL）。
- **`input.prompt`**：可选；为空时使用库内默认英文指令。
- **额外 `options`**：与其它接口相同；另支持 **`imageDetail`**：`auto` | `low` | `high`（写入 OpenAI `image_url.detail`，默认 `auto`）。

浏览器若需上传本地文件，请先 `FileReader.readAsDataURL(file)`，将得到的字符串作为 `image` 传入。

```html
<script type="module">
  import { createSceneAiClient } from "./core/ai/index.js";

  const aiClient = createSceneAiClient({
    provider: "chatgpt",
    apiKey: "YOUR_API_KEY",
    model: "gpt-4o-mini"
  });

  const sceneJsonString = await aiClient.generateSceneJsonFromImage(
    {
      prompt: "Match building masses and roads approximately.",
      image: "https://example.com/site-plan.png"
    },
    { imageDetail: "auto", maxTokens: 8192 }
  );
</script>
```

## 接口二：按提示词修改 JSON 文件（Node）

```js
import { updateSceneJsonFile } from "./core/util/nodeSceneFile.js";

const result = await updateSceneJsonFile(
  "把场景里所有 container 颜色改成蓝色，并在中心增加一个 infoPanel",
  "E:/WORKSPACE/00ProjectSpace/ThreeJSJson/ThreeJSON/assets/json/portShow.json",
  {
    provider: "chatgpt",
    apiKey: process.env.OPENAI_API_KEY
  }
);

console.log("written path:", result.path);
console.log(result.sceneJsonString);
```

`.js` 场景文件需为「`const name = { ... };` + `export { ... };`」风格；写回时会保留变量名与 export 块格式。

## 接口三：按提示词修改已有 JSON 字符串（浏览器 / Node 均可）

```html
<script type="module">
  import { createSceneAiClient } from "./core/ai/index.js";

  const aiClient = createSceneAiClient({
    provider: "chatgpt",
    apiKey: "YOUR_API_KEY"
  });

  const currentSceneJsonString =
    '{"threeJsonId":"example","worldInfo":{"boxModelList":[]}}';
  const updatedSceneJsonString = await aiClient.updateSceneJsonString(
    "在场景中心添加一个蓝色立方体",
    currentSceneJsonString
  );
  console.log(updatedSceneJsonString);
</script>
```

## 接口六：命令模式场景调整（`requestUpdatedSceneEditCommands`）

适用于增量编辑：LLM 只产出 **core 命令**，不返回整段 JSON。编辑器侧由 `tools/common/editor-single/ai/runEditorAiUpdate.js` 组装上下文并执行；headless 可走 MCP 或 `tools/threejson-agent/bridge/scene-update-commands.mjs`。

```js
import { requestUpdatedSceneEditCommands } from "./core/ai/index.js";

const result = await requestUpdatedSceneEditCommands(
  "把主楼颜色改成蓝灰色",
  {
    currentSceneJsonString: sceneJson,
    objectList: [{ threeJsonId: "b1", name: "Main", objType: "box" }],
    selectionId: "b1"
  },
  { provider: "chatgpt", apiKey: process.env.OPENAI_API_KEY, outputMode: "commands" }
);

// result.outputMode === "commands"
// result.commands — 已解析的 { op, args }[]
// result.commandScript — 原始脚本文本
// result.fallbackUsed — 解析失败时是否已回退 JSON
```

**上下文 `context` 字段**

| 字段 | 说明 |
|------|------|
| `objectList` | 精简对象列表（id/name/objType），默认推荐 |
| `selectionId` / `selectionDescriptor` | 当前选中对象 |
| `fullSceneJson` / `includeFullJson` | 需要全文参考时附带 |
| `userMessage` | 若已自行拼装 user 消息，可直传跳过内部模板 |

**与 `updateSceneJsonString` 的选择**

| 场景 | 推荐 |
|------|------|
| 侧栏「调整当前场景」（默认） | 编辑器 `runEditorAiUpdate` → commands，失败 fallback JSON |
| 勾选「增量更新 RFC6902」 | `updateSceneJsonString` + `updateMode: 'incremental'` |
| MCP / CLI headless | `threejson_update` + `outputMode: 'commands'`，再 `threejson_exec` |
| 从零生成整场景 | `generateSceneJsonString` → `editor.ingest` / `scene.load` |

**命令规范**：见 `core/command/` 与 `getCommandSpec()`。常用：`object.patch`、`material.patch`、`object.add`、`object.remove`、`scene.list`、`object.get`。**不要**在 core prompt 中使用 `editor.*`。

**MCP 示例**

- `threejson_update`：`{ prompt, currentSceneJsonString, outputMode: "commands" }`
- `threejson_exec`：`{ script, sceneJson?, dryRun: true }` 先预演；`executeMode: "auto"` 在无 runtime 时跳过 `object.*`

## 可选参数（各接口共用）

- `provider`: `chatgpt` | `deepseek` | `custom`（`custom` 时必须同时提供非空的 `baseUrl`）
- `apiKey`: 对应平台的 API Key（必填）
- `model`: 覆盖默认模型（可选）
- `baseUrl`: 自定义 API 根 URL（可选）
- `temperature`: 默认 `0.2`
- `maxTokens`: 默认 `4000`
- `imageDetail`（仅 `generateSceneJsonFromImage`）：`auto` | `low` | `high`，默认 `auto`，对应 OpenAI 多模态 `image_url.detail`

### `planTextures` / `fillTextureUrls` 额外参数

- `userHint`：风格与纹理描述（传给规划模型）。
- `plan`：`{ tasks: [...] }` 可选；若提供则跳过 Chat 规划（任务仍会校验 pointer）。
- `imageProvider`：必填（`dryRun` 除外）；需含 `generateImage({ prompt, size })`。
- `sink.saveLocal` / `sink.upload`：持久化钩子（必填其一）。
- Node 外部工具：`withNodeTextureSink({ localOutputDir, projectRoot })`（`core/util/nodeTextureSink.js`）。
- `overwriteExisting`：为 `false` 时跳过已有非空 `textureUrl`。
- `dryRun`：为 `true` 时只返回规划与 `skipped`，不调生图接口。
- `concurrency`：并发任务数，默认 `2`。
- `chatOptions`：仅传入规划阶段的对象，与 `pick` 后的 Chat 字段合并（避免把 `sink` 等传入 completions）。

## 响应与校验说明

- 系统提示要求模型只输出单个 JSON 对象；实现上仍会用 `extractJsonText()` 尝试剥离 Markdown 代码块或截取首尾 `{}`，以提高容错。
- 解析后会校验顶层为对象且包含 `worldInfo`；若缺少 `worldInfo.boxModelList` 会自动补成空数组。
- 生成或更新失败常见原因：HTTP 非 200、返回内容无法解析为 JSON、或结构不满足上述约束。

## 接口五：批量生成 `textureUrl`（Node 示例）

流程：先用与场景相同的 Chat Provider 解析场景并得到任务列表（可选 `dryRun: true` 只预览），再调用 OpenAI Images（或其它实现相同 `generateImage` 签名的适配器）逐张生图并写入 JSON。

```js
import fs from "node:fs/promises";
import {
  fillTextureUrls,
  createOpenAiImageProvider
} from "./core/ai/index.js";

const scenePath = "./assets/json/tutorial/track-05/05-01-ai-scene.json";
const raw = await fs.readFile(scenePath, "utf-8");

const imageProvider = createOpenAiImageProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: "dall-e-3",
  responseFormat: "url"
});

const result = await fillTextureUrls(raw, {
  provider: "chatgpt",
  apiKey: process.env.OPENAI_API_KEY,
  userHint: "Industrial port, realistic PBR, seamless where possible",
  imageProvider,
  localOutputDir: "./assets/textures/ai-generated",
  overwriteExisting: false,
  concurrency: 2
});

await fs.writeFile(scenePath, result.sceneJsonString, "utf-8");
console.log("skipped (already had url):", result.skipped);
```

要点：

- **规划模型**与**生图**可使用同一平台密钥（如上）或分开配置；传入 `fillTextureUrls` 的 `provider` / `apiKey` 仅用于 `planTextures` 的 Chat 请求。
- **`sink.upload`**：自行接入 OSS/图床时，实现 `(blob, meta) => Promise<string>`，返回可被 ThreeJSON 加载的公网 URL；若提供 `upload`，会优先使用其返回值作为 `textureUrl`。
- **临时 URL**：`response_format: "url"` 时平台返回的链接可能在一小时内失效；实现已在写入前通过 `fetch` 下载为 `Blob` 再落盘或上传。
- **其它厂商**：实现 `imageProvider.generateImage({ prompt, size })`，返回 `{ kind: 'url' | 'base64' | 'bytes', ... }` 即可复用 `normalizeImageRawToBlob` 与 sink 逻辑。

可选依赖：官方 `openai` SDK 可代替手写 `fetch`，本仓库默认零依赖，参考实现为 `createOpenAiImageProvider`。

## 手动验证

完整矩阵见 **[`tests/ai-manual-verification.md`](../../tests/ai-manual-verification.md)**。自动化（无 Key）：`npm test`；静态 AI 夹具 + bridge：`npm run verify:ai-static`；可选 live CLI：`npm run verify:ai-live`（需 `tools/threejson-agent/setting.json`）。

完整说明见 [`core/ai/SKILL.md`](./SKILL.md)、[`docs/zh/json-format.md`](../../docs/zh/json-format.md)、[`docs/zh/extensions.md`](../../docs/zh/extensions.md)、[`docs/zh/glossary.md`](../../docs/zh/glossary.md)。能力 gap 归档：[`lab/archive/ai-skill-gap-matrix.md`](../../lab/archive/ai-skill-gap-matrix.md)。

更多演示见 `docs/zh/demos.md`（[`examples/html-demo/track-05-tooling/05-01-ai-scene.html`](../examples/html-demo/track-05-tooling/05-01-ai-scene.html)、`ai-scene.html`、`examples/script/ai-update-scene.mjs`）。
