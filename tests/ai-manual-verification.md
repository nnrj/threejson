# Scene tool and AI manual verification

Automated: `npm test`, `npm run verify:ai-static`. Real model calls require explicit
`THREEJSON_LIVE_SETTINGS`; a provider failure/rate limit is not a pass.

- Run CLI discover/query/preflight/apply/undo through MCP; compare revisions and source output.
- Change the same source file externally before saving; the tool must refuse to overwrite it.
- Connect a real MCP client to packages/scene-tools/bin/threejson-mcp.mjs; no model key required.
- Open Editor, pair its exact origin using editor-bridge, edit through editor.call, reconcile editor.result,
  and undo in the browser. Change scene; stale-session requests must be rejected.
- Test Editor and baseline/React ThreeBox on narrow screens; queries must not activate suspended historical canvases.
- Capture a textured lit scene, and an intentionally unlit scene. Diagnostic relighting must be labeled.
- Real browser smoke: room-show.html, port-show.html, particles, modeledMesh, FPS and intro html-demo.
- Test an unreachable texture; existing source/color must remain, resource diagnostics must identify failure.
- Check native function tools only with a provider known to support them; JSONL remains available.
- Test an explicit token/time budget, cancellation, repeated invalid output, and postcondition failure.

Desktop product-level workflows remain a separate phase. Local tests do not prove behavior of paid providers
or Cloud deployments. See [tool protocol](../docs/en/scene-operations.md) and [CLI/MCP](../packages/scene-tools/README.md).
