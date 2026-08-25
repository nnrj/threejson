# ThreeJSON AI API

[中文](./README.md) | [English](./README_EN.md)

`threejson/ai` provides scene generation, image-to-scene, scene updates, command output, turn negotiation, and semantic texture planning. AI is no longer statically loaded by the `threejson` or `threejson/core` root entries.

```js
import {
  createSceneAiClient,
  createSceneTexturePlanner,
  parseSceneJsonString,
  requestUpdatedSceneEditCommands,
  runSceneAgent
} from "threejson/ai";
```

Core capabilities:

- `createSceneAiClient(options)` creates a generation/update client.
- `generateSceneJsonString(prompt, options)` generates a complete scene.
- `generateSceneJsonFromImage(input, options)` generates from a reference image.
- `updateSceneJsonString(prompt, scene, options)` uses full JSON or RFC 6902 Patch updates.
- `requestUpdatedSceneEditCommands(prompt, context, options)` produces core scene commands.
- `classifyTurnIntent(input, options)` negotiates intent and direct/incremental construction. The first message in an empty conversation is generation without an intent-classification call.
- `runSceneAgent(input, options)` executes direct or incremental construction. Numeric round settings are runaway guards, never target round counts.
- `createSceneTexturePlanner(options)` creates the one-call semantic planner injected into the pure texture pipeline.

## Unified texture boundary

Slot discovery, orchestration, and atomic runtime assignment live in `threejson/texture`:

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

The planner returns semantics, slots, projection, and source preference only. It never emits or guesses URLs. Search, generation, licensing, proxying, and archival belong to a host-injected Provider or server. A conventional image model may provide base color only; full PBR maps require an explicitly declared `pbr-set` or `pbr-derive` capability.

Scene authoring describes object/material semantics and preserves user-supplied or existing texture fields. ThreeBox and Editor run texture acquisition after the first usable scene is visible, so texture failures never fail scene generation.

The former pointer/image-sink texture pipeline has been removed without compatibility wrappers.

## Providers, streaming, and execution

Chat supports `chatgpt`, `deepseek`, and arbitrary OpenAI-compatible `custom` endpoints. Common options are `apiKey`, `model`, `baseUrl`, `temperature`, `maxTokens`, `stream`, and `signal`.

Product-owned gateways inject `providerAdapter` hooks for endpoint selection, request-body transformation, response observation, and error classification. `requestContext` is opaque state forwarded only to that adapter. Core does not recognize product provider names, moderation fields, private response headers, or quota codes.

Direct generation returns a complete usable scene. Incremental construction is reserved for genuinely complex scenes or explicit provider truncation. Updates prefer commands, then JSON Patch, with full JSON rewrite as a final fallback. `# done` and no-op/repeated output stop immediately.

## Entry and dependency boundaries

- Engine: `threejson` or `threejson/core`
- AI: `threejson/ai`
- Pure texture core: `threejson/texture`
- Node file write-back: `core/util/nodeSceneFile.js`

Poly Haven, Openverse, image providers, R2, and ThreeBox server adapters must not enter the ThreeJSON package dependency graph. Without an injected texture Provider, neither the engine nor AI performs texture requests.
