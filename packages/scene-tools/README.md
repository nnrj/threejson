# @threejson/scene-tools

Persistent ThreeJSON scene sessions for Node CLI and MCP. No Python, browser or model key is required
for ordinary editing. [中文协议文档](../../docs/zh/scene-operations.md) · [English protocol](../../docs/en/scene-operations.md)

## Setup

Requires Node 24+. In the repository run `npm install` once. The package is included in the release pipeline;
until its first publication, use repository commands instead of `npx` fetching a nonexistent version.

```sh
npm run scene-tools -- discover
npm run scene-tools -- query --file scene.json
npm run scene-tools -- preflight --file scene.json --commands edits.json
npm run scene-tools -- apply --file scene.json --commands edits.json --output edited.json
```

After publishing/installing the package, the equivalent command is `threejson ...`.
edits.json accepts a command object, array or JSONL script. Writes are opt-in: `--write` replaces the opened
source only if its hash is unchanged; `--output` creates a new file. Existing destinations require
`--expected-version <SHA256>`. A `.threejson-lock` prevents cooperating writers from racing; inspect a stale
lock before removing it. No unsafe overwrite retry. Receipts/errors use JSON on stdout; diagnostic logs go
to stderr. `check` exits nonzero for failed or unchecked postconditions, even when observation itself succeeded.

`--runtime` explicitly compiles a headless Three.js scene for applicable commands. It does not create a canvas;
capture/raycast availability depends on actual adapters. Read each receipt's checks.

## MCP

Configure your MCP client with an absolute path to the local Node entry:

```json
{ "mcpServers": { "threejson": {
  "command": "node",
  "args": ["/absolute/path/ThreeJSON/packages/scene-tools/bin/threejson-mcp.mjs"]
} } }
```

After package publication you may use its installed `threejson-mcp` binary. There is no nested LLM.
Use session.open → scene.discover → op.scene.query → scene.preflight → scene.apply → scene.save.
Use sessionId/baseRevision/requestId for writes, scene.undo/redo for history. session.list/close manage lifetime.
job.start/get/cancel handle long work. A process restart expires sessions/request caches; reopen and reconcile.
Each `op.*` input schema comes from the engine, not a separate hand-maintained MCP list.

## Browser verification and live Editor

Optional: install `playwright` yourself and point to an already installed browser; no browser downloads occur.

```sh
threejson browser-check --file scene.json --browser "/path/to/browser"
threejson editor-bridge --origin http://localhost:5173
```

For Windows Edge, the typical executable is `C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`.
Pass `--capabilities modeling,complexMesh,webgpu,postprocessing` only when required.
Browser checks use local ESM files and the scene file's directory for relative assets, with ordinary CORS.
The optional JavaScript API supports screenshot output, abort signal and timeout.

In Editor Settings choose “连接本机场景工具…”, enter pairingUrl and approve. Keep agentToken secret.
Use MCP editor.call/editor.result, or `threejson editor-call --options private.local` and
`threejson editor-result --options private.local`; options contain url/token/method/params/requestId.
Result lookup omits method. Never resend an uncertain edit with a new ID. Explicitly disconnect or Ctrl+C
the relay when finished. Browser local-network restrictions can require permission.

## Optional AI, textures and assets

```sh
threejson ai --config setting.json --prompt "A blue cube" --options generation.local
threejson ai --mode update --file scene.json --prompt "Move the chair two metres" --config setting.json --write
threejson texture --file scene.json --config setting.json --options texture.local --write
threejson asset-search --options search.local
threejson asset-import --options import.local
```

Copy setting.example.json to a private setting.json; prefer THREEJSON_AI_API_KEY and
THREEJSON_TEXTURE_API_KEY environment variables. Generation options support image, agent, modelBudget,
scenePath/writeScene; update uses the neutral service and optional `protocol:"native"` (default JSONL).
No model/service calls happen unless these explicit commands are invoked. Texture dryRun still uses the
semantic planner; it is not a no-network preview. Provider failures are errors, never simulated success.

Asset search accepts explicit urls or a provider `{endpoint,headers,queryParameter}` returning items/results.
The JavaScript API also accepts a provider function. allowedLicenses is a host filter; unknown is never CC0.
Import uses `{source,directory,filename?,metadata?}` and saves a SHA-256 name plus source/license sidecar.
It does not overwrite different bytes. This replaces the old Node→Python chain; default web scraping and
platform-binary guessing were retired. Existing user setting.json files and downloaded assets remain untouched.

## Limits and extension points

This package does not claim CAD manufacturing validation or image-based aesthetic guarantees. AABB checks
are approximations. Registered action callbacks are trusted host code with explicit transient effects.
Engine cores import neither this package nor the MCP SDK. Browser verification/AI/asset acquisition are
separate opt-in subpaths. Desktop product modernization remains separate work.
