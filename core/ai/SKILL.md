---
name: threejson-ai-scene
description: Generate or modify ThreeJSON scene JSON, core command scripts, and optional multi-step agents via core/ai; plan/fill textureUrl. Use for prompts, image-to-scene, command-mode edits, or texture pipelines.
---

# ThreeJSON AI Scene Skill

## Purpose

Provide a clear workflow for AI-driven ThreeJSON scene generation and scene updates.

This skill is the human-readable guide. **Runtime LLM prompts** are assembled in `threeJsonCoreSkill.js` (scene) and `texturePrompt.js` (texture task plans). **Intent/capability matching** for post-generation review lives in `sceneCapability.js`. Editing this SKILL.md alone does not change single-turn API behavior.

## When To Use

Use this skill when the request includes one of these intents:

- Generate a new ThreeJSON scene from a natural-language prompt.
- Generate a scene from a reference image (URL / `data:` URL / raw base64 + MIME via `resolveVisionImageUrl`) using compatible vision-capable Chat Completions.
- Modify an existing scene JSON string based on a prompt (browser or Node).
- Modify an existing `.json` / `.js` scene file by prompt (Node only).
- Integrate AI scene generation in browser HTML flow.
- Switch between ChatGPT and DeepSeek providers for scene tasks.
- Plan or generate material textures: chat proposes per-slot prompts, image API produces pixels, sinks persist URLs or paths into `textureUrl`.
- Apply **command-mode** edits (`requestUpdatedSceneEditCommands`) producing `scene.*` / `object.*` / `material.*` / `camera.*` scripts (not `editor.*`).
- Run optional **multi-step agent** (`runSceneAgent` with `agent.enabled: true`).

## Capability catalog (runtime prompts)

Generation/update prompts (`threeJsonCoreSkill.js`) include the compact runtime index from `sceneCapabilityIndex.js`, then focused schema/few-shot blocks. The index covers primitives, complex/native geometry, CSG, assetLibrary, materials/texture sampling, post-processing passes, built-in domains, events/EventScript, object/scene lifecycle, audio, animationGraph, scene intro, shader/particles/weather/nature/stat/device/port capabilities, and command/Patch editing. Host-only wiring (PluginHost, extension bootstrap) is **not** auto-generated — see [`docs/zh/extensions.md`](../../docs/zh/extensions.md). Business objects use [`docs/zh/domains.md`](../../docs/zh/domains.md) — see [`docs/zh/glossary.md`](../../docs/zh/glossary.md).

Use `THREE_JSON_AGENT_CAPABILITY_INDEX` as the token-cheap multi-turn lookup surface. Do not paste all docs into every turn; use the index first, then retrieve docs/examples only for a specific capability.

## Core Interfaces

Runtime exports: npm **`threejson`** (built-in domains + core) or **`threejson/core`**; in-repo [`../index.js`](../index.js) / [`../core/index.js`](../core/index.js) (pure core). AI helpers are re-exported from core; [`index.js`](./index.js) in this folder remains an internal aggregator and browser `window.ThreeJsonAI` side-effect entry.

From **`threejson`** / **`threejson/core`** / **`core/index.js`** (ESM named exports):

1. `generateSceneJsonString(prompt, options?)` — full scene JSON string. AI authoring and the default return use standard scheme B (`sceneConfig` + `objectList`); pass `outputFormat: "friendly"` to project only the final return to `worldInfo` lists.
2. `generateSceneJsonFromImage({ prompt?, image }, options?)` — same output shape as (1); `image` is an `http(s)` URL, `data:image/*` string, or `{ base64, mimeType? }`. Uses multimodal Chat Completions (same `fetch` helper as text chat). Supports `options.imageDetail`: `auto` | `low` | `high` (OpenAI `image_url.detail`). Prefer vision-capable models (for example GPT-4o class); `deepseek-chat` commonly cannot consume images here.
3. `updateSceneJsonString(prompt, currentSceneJsonString, options?)` — updated full scene JSON string; optional `updateMode: "incremental"` for RFC 6902 patch array output (`scenePatch.js`).
4. `requestUpdatedSceneEditCommands(prompt, context?, options?)` — LLM outputs core command scripts; `outputMode: "commands"|"json"`; context may include `objectList`, spatial cards, selection, `fullSceneJson`.
5. `updateSceneJsonFile(prompt, sceneFilePath, options?)` — read file, apply AI, write back; **Node only**, import from `core/util/nodeSceneFile.js` (not `core/ai/index.js`).
6. `planTextures(sceneJsonStringOrObject, userHint, options?)` — chat returns `{ tasks: [{ pointer, prompt, size? }] }` validated against scene JSON Pointers (RFC 6901).
7. `fillTextureUrls(sceneJsonStringOrObject, options?)` — optionally calls `planTextures`, then runs `imageProvider.generateImage` per task, normalizes `url` / `b64_json` / bytes, writes strings via **`sink.saveLocal` / `sink.upload`** (required for persistence). External Node tools may pass `localOutputDir` only if wrapped with `core/util/nodeTextureSink.withNodeTextureSink`. Returns `{ scene, sceneJsonString, tasks, skipped, taskResults }`.
8. `createOpenAiImageProvider({ apiKey, baseUrl?, model?, defaultSize?, responseFormat? })` — reference `fetch` implementation for OpenAI `/v1/images/generations` (DALL·E-style `response_format`: `url` or `b64_json`).
9. `normalizeImageRawToBlob(raw)` — unify provider output before sinks.
10. `listTextureUrlPointers(sceneObj)` — list valid `/objectList/.../textureUrl` targets, with friendly `/worldInfo/boxModelList/...` compatibility (includes `material`, `materials[]`, nested `joins` / `inters` / `holes`).
11. `parseSceneJsonString(str)` / `extractJsonText(str)` / `resolveVisionImageUrl(image)` — parsing and image URL normalization for vision chat.
12. `createSceneAiClient(defaultOptions?)` — merges defaults into generate/update/plan/fill/agent methods (no file I/O).
13. `runSceneAgent(input, options?)` — optional multi-step agent; **requires `options.agent.enabled === true`**; default is single-shot. Depth: `simple` | `medium` | `deep` | `auto`. Browser agent does not persist textures to disk.
14. Scene generation prompts describe full engine capabilities; `sceneCapability.js` infers intent hints and optional capability-fit review.
15. `generateSceneJsonString` options: `planFirst`, `capabilityReview` (default on), `maxCapabilityReviewAttempts`, `maxTokens` (**default 6000** for generation).
16. Agent depth presets (`agentDepth.js`): `simple` runs structural repair + capability review; `medium`/`deep`/`auto` add outline/layout review. This is **business Agent depth**, not a provider/model reasoning-depth parameter.

Browser global `window.ThreeJsonAI` exposes `createSceneAiClient`, `generateSceneJsonString`, `generateSceneJsonFromImage`, `updateSceneJsonString`, `resolveVisionImageUrl`, `planTextures`, `fillTextureUrls`, `createOpenAiImageProvider`, `normalizeImageRawToBlob`, `listTextureUrlPointers`, and **`runSceneAgent`** (no `updateSceneJsonFile`; avoid shipping secrets in public bundles).

Low-level `requestChatCompletion` is exported from `sceneAiService.js` if you need custom message arrays.

## Texture Pipeline

- **Planning (chat LLM):** Input is the current scene JSON plus a user style hint. Output is strict JSON `{ "tasks": [...] }` with one entry per `textureUrl` pointer (see `texturePrompt.js`). Pointers must match the candidate list derived from the scene; invented paths are rejected.
- **Execution (image model):** Each task calls a pluggable `imageProvider.generateImage({ prompt, size })`, returning `{ kind: 'url' | 'base64' | 'bytes', ... }`. `normalizeImageRawToBlob` downloads ephemeral URLs immediately so links do not expire before persistence.
- **Persistence (`TextureSink`):** Implement `upload(blob, meta) => Promise<string>` for CDN/OSS/图床, and/or `saveLocal(blob, meta) => Promise<string>` for disk paths. Node CLIs use `createLocalOutputDirSink` / `withNodeTextureSink` from `core/util/nodeTextureSink.js`.
- **Security / cost:** Treat image keys like chat keys; prefer server-side or private scripts. Image APIs bill per request; use `dryRun: true` to inspect `tasks` only. Respect provider ToS for generated imagery.

## Provider Rules

- Supported providers: `chatgpt`, `deepseek`, `custom` (OpenAI-compatible root URL; **requires** `baseUrl`)
- Required: `apiKey`
- Optional: `model`, `baseUrl`, `temperature`, `maxTokens`

Recommended defaults:

- `provider`: `chatgpt`
- `temperature`: `0.2`
- `maxTokens`: `4000` for updates/textures; **`generateSceneJsonString` defaults to 6000** unless overridden

Built-in default models: `gpt-4o-mini`, `deepseek-chat` (override with `model`).

## Output Contract

AI output should satisfy:

- A single JSON object representing the **full** scene (no prose outside JSON).
- Top-level **`threeJsonId`** (stable string; no `worldId`).
- **Standard form** (required for AI authoring and the default API result): `sceneConfig` + one heterogeneous `objectList`; every deployable item has an explicit `objType`.
- **Friendly form** (human-facing compatibility projection): request it with `outputFormat: "friendly"`; include only non-empty `worldInfo` lists actually used and omit unused list properties.
- Geometry fields for generic boxes use `width`, `height`, `depth` (not `length`).
- Do not embed `alarmList` or page UI chrome in scene JSON.
- Numeric values are finite and practical for scene rendering.
- **Scene text** (`objType: "text"` in `objectList`): plain floating labels — not `infoPanelList`. Use `content`, `fontSize`, `color`, optional `mode` (`sdf` | `texture` | `mesh`).
- **Static panels** → `infoPanelList` (baked texture). **Interactive DOM** → `css3dPanelList` (host CSS3D required). **Particles** → prefer `objType: particleEmitter`.
- Do not put panel chrome in `objType: text` records.

## Command-mode update (preferred for small edits)

Use `requestUpdatedSceneEditCommands` when changing few objects, colors, or camera framing. Output is micro DSL or JSONL (`object.patch`, `material.patch`, `object.add`, `camera.fit`, etc.). Prompt rules live in `sceneCommandSkill.js`. Editor wrappers add `editor.*` separately — not in core prompts.

Implementation note: `sceneAiService.extractJsonText()` may still recover JSON from Markdown fences or surrounding text; prefer teaching the model to output raw JSON only.

## File Update Workflow

For `updateSceneJsonFile`:

1. Read existing target file.
2. Parse existing scene object (`.json` or object literal inside `.js` module).
3. Ask AI to return the full updated scene JSON.
4. Validate minimal structure.
5. Write back:
   - `.json`: pretty JSON
   - `.js`: rebuild `const <name> = {...}; export {...};` module style

## Integration Patterns

### Browser (HTML)

- Use `createSceneAiClient()` and call `generateSceneJsonString` / `updateSceneJsonString`.
- Texture: `planTextures` / `fillTextureUrls` are available, but exposing image or chat API keys in the browser is risky; prefer a backend or local script. Use an `upload` sink to obtain stable URLs if the engine loads textures over HTTP(S).
- Parse returned string and feed into existing scene build/render flow.
- Do not use `updateSceneJsonFile` in browser bundles.

### Node

- Use `updateSceneJsonFile` for prompt-based edits that must persist to disk.
- Use `fillTextureUrls` with `sink` (or Node `withNodeTextureSink({ localOutputDir })`) for batch `textureUrl` generation (requires a separate OpenAI-compatible image key for `createOpenAiImageProvider` unless you substitute another provider).
- Keep source scene files under version control and review diffs.

## Error Handling

Handle these errors explicitly:

- Unsupported provider
- Missing API key
- Empty or non-JSON AI output after extraction
- Invalid scene structure (not loadable: missing `worldInfo` and empty standard `objectList`/`sceneConfig`)
- Unsupported file extension for update (only `.json` / `.js`)
- Upstream API non-200 responses
- Texture plan JSON missing `tasks` or pointers not in the scene-derived list
- Image API failures or missing `url` / `b64_json` in image responses
- Temporary image URL download failure before persistence
- Missing `imageProvider` when `fillTextureUrls` is not in `dryRun`
- Missing `sink.saveLocal` / `sink.upload` when persistence is required

## Compatibility Notes

- Keep this file concise and documentation-focused.
- Keep runtime skill logic in `threeJsonCoreSkill.js` (full scene), `sceneCommandSkill.js` (commands), `texturePrompt.js` (texture plans), and `textureAiService.js` (image pipeline).
- If schema constraints change, update `threeJsonCoreSkill.js`, `sceneCapability.js`, `sceneCommandSkill.js`, this skill, and `docs/zh/json-format.md` / `core/ai/README.md` together. Archived gap matrix: [`lab/archive/ai-skill-gap-matrix.md`](../../lab/archive/ai-skill-gap-matrix.md).
