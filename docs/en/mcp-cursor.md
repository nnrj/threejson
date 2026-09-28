[中文](../zh/mcp-cursor.md) | [English](./mcp-cursor.md)

# ThreeJSON MCP (Cursor and other clients)

MCP is a thin adapter over `@threejson/scene-tools` persistent scene sessions.
Ordinary queries, edits, validation, undo and saves call no model and require no provider key.

## Source checkout

Run `npm install` at the repository root. Configure an absolute server path in your MCP client:

```json
{
  "mcpServers": {
    "threejson": {
      "command": "node",
      "args": ["E:/WORKSPACE/AgentWork/Three/ThreeJSON/packages/scene-tools/bin/threejson-mcp.mjs"]
    }
  }
}
```

After the new package is published, install `@threejson/scene-tools` and use `threejson-mcp`.
Do not mix this source protocol with an older published npm version. No Python, Gradio or legacy setting.json is needed.

## Workflow

1. `session.open` with `json` or an absolute `file`; retain sessionId and revision.
2. `scene.discover` for schemas, target types, prerequisites and runtime availability.
3. `op.scene.query` for identities, exact transforms, compact summaries and design bindings.
4. `scene.preflight` prepares a candidate. Read coverage: unchecked is not passed.
5. `scene.apply` with baseRevision and a stable requestId commits one batch.
6. `op.scene.check` verifies deterministic postconditions; `scene.undo` reverses a commit.
7. `scene.save` explicitly writes, refusing an externally changed destination.

`job.start/get/cancel` supports longer operations. Request IDs prevent duplicate commits during the
session lifetime, not across process restarts. Standard input/output is reserved for MCP, not debug logs.

## Images and Editor

Ordinary Node sessions have no browser canvas; capture reports unavailable. Optional `browser-check`
uses explicitly installed Playwright and a local browser, without automatic browser downloads.
Actual scene captures and relit diagnostics carry different metadata.

Editor Settings → Connect local scene tools pairs with an explicitly started `editor-bridge`.
Use MCP `editor.call` to submit, then `editor.result` to reconcile without blindly resending writes.
The editor does not depend on MCP. See [scene operations](./scene-operations.md) and
[CLI usage](../../packages/scene-tools/README.md).

Legacy Python/MCP shells are retired; user settings, scenes and caches are retained. Explicit AI,
texture and asset services now live in optional package entry points, invoked only on request.
