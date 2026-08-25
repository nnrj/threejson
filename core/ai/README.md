# ThreeJSON AI 接口

[中文](./README.md) | [English](./README_EN.md)

`threejson/ai` 负责场景生成、看图生成、场景调整、命令输出、意图协商与纹理语义规划。AI 不再由 `threejson` 或 `threejson/core` 根入口静态加载；不使用 AI 的应用无需承担相关代码和网络行为。

```js
import {
  createSceneAiClient,
  createSceneTexturePlanner,
  parseSceneJsonString,
  requestUpdatedSceneEditCommands,
  runSceneAgent
} from "threejson/ai";
```

主要能力：

- `createSceneAiClient(options)`：创建场景生成与调整客户端。
- `generateSceneJsonString(prompt, options)`：生成完整场景 JSON。
- `generateSceneJsonFromImage(input, options)`：根据参考图片生成场景。
- `updateSceneJsonString(prompt, scene, options)`：使用完整 JSON 或 RFC 6902 Patch 调整场景。
- `requestUpdatedSceneEditCommands(prompt, context, options)`：生成 `scene.*`、`object.*`、`material.*`、`camera.*` 命令。
- `classifyTurnIntent(input, options)`：协商生成/调整意图与完整生成/增量构建策略。空历史中的第一条消息直接判定为生成。
- `runSceneAgent(input, options)`：执行完整生成或增量构建；轮数值只是防失控上限，不是必须执行的目标。
- `createSceneTexturePlanner(options)`：创建一次调用的纹理语义规划器，供纯核心纹理管线注入。

## 统一纹理边界

纹理槽位扫描、规划编排和原子应用位于 `threejson/texture`：

```js
import { createSceneTexturePlanner } from "threejson/ai";
import {
  TextureAcquisitionProvider,
  listMaterialTextureSlots,
  planSceneTextures,
  runSceneTexturePipeline,
  applyTextureAssignmentAsync
} from "threejson/texture";

const plan = await planSceneTextures(scene, userPrompt, {
  planner: createSceneTexturePlanner(chatOptions)
});

const result = await runSceneTexturePipeline(scene, {
  plan,
  textureProvider: new TextureAcquisitionProvider({
    capabilities,
    search,
    generate,
    persist
  })
});
```

规划器只输出材质语义、槽位、投影和来源偏好，不输出或猜测 URL。搜索、生图、许可处理、代理与归档由宿主或服务端 Provider 实现。普通图片模型只能提供颜色贴图；只有显式声明 `pbr-set` 或 `pbr-derive` 的 Provider 才能提供完整 PBR 套图。

场景生成提示词只表达对象和材质语义，并保留用户提供或已有的纹理字段。ThreeBox/Editor 在首个可用场景显示后另行运行纹理管线，因此纹理服务失败不会把场景生成变成失败。

已移除旧的纹理 Pointer/生图 Sink 管线，不提供兼容包装。不要再从 AI 客户端直接生成 URL 或把浏览器目录/ZIP Sink 注入核心。

## Provider 与流式输出

聊天 Provider 支持 `chatgpt`、`deepseek` 与任意 OpenAI-compatible `custom` 端点。常用参数包括 `apiKey`、`model`、`baseUrl`、`temperature`、`maxTokens`、`stream`、`signal`。

产品自有网关通过 `providerAdapter` 注入 `endpoint`、请求体转换、响应观察和错误分类；`requestContext` 只作为不透明状态传给该适配器。core 不识别产品供应商名称、审核字段、专用响应头或额度错误码。

完整生成默认返回一个可直接渲染的场景；真正复杂或供应商明确截断的场景才进入增量构建。场景调整优先使用命令，其次 JSON Patch，完整 JSON 重写仅作为兜底。模型输出 `# done` 或没有剩余工作时立即结束。

## 入口与依赖

- 引擎：`threejson` 或 `threejson/core`
- AI：`threejson/ai`
- 纯纹理核心：`threejson/texture`
- Node 文件写回：`core/util/nodeSceneFile.js`

Poly Haven、Openverse、生图供应商、R2 和 ThreeBox 服务端适配器不得进入 ThreeJSON npm 包依赖图。未传入纹理 Provider 时，AI 和引擎都不会发起纹理请求。
