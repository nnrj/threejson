# MCP integration (Cursor / compatible hosts)

Register the stdio server at `tools/mcp-threejson/server.mjs` with `THREEJSON_ROOT` pointing at the repository root.

Credentials: `tools/mcp-threejson/setting.json` → `llm` (optional `imageModel` for textures), or `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` env vars.

Texture fill via MCP requires Node (local filesystem); browser editors should use `fillTextureUrls` with `browserTextureSink` instead.

See [`doc/mcp-cursor.md`](../../../../doc/mcp-cursor.md) for example `.cursor/mcp.json`.
