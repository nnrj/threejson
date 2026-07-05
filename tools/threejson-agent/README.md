# ThreeJSON Agent (external product)

External agent tooling around repository [`core/ai`](../../core/ai/) (canonical scene/texture AI). This directory is the **product root** — not a Python-only tree.

## Layout

```text
tools/threejson-agent/
  setting.json              # CLI + GUI (gitignored); copy from setting.example.json
  bridge/                   # Node IPC scripts → core/ai (shared by all shells)
  components/               # Packaged subcomponent binaries (asset-search, …)
  shell/
    py/                     # Python shell: threejson_agent, gui/, tests/
```

| Path | What it is |
|------|------------|
| [`core/ai`](../../core/ai/) | **Brain** — `runSceneAgent`, scene generate/update, textures |
| `bridge/` | **Node entry** — thin subprocess wrappers (not a second agent implementation) |
| [`shell/py/`](shell/py/README.md) | **Python shell** — Click CLI + Gradio GUI |
| `setting.json` | Product config (LLM keys, texture, asset) |

Parallel apps (not under this folder): [`scene-editor.html`](../../scene-editor.html) (browser + localStorage), [`tools/mcp-threejson`](../mcp-threejson/) (Node MCP).

## Quick start

```bash
cd tools/threejson-agent
cp setting.example.json setting.json
pip install -r shell/py/requirements.txt
```

Requires **Node 24+** on PATH for default scene/texture paths (`bridge/*.mjs`). See repo [`.nvmrc`](../../.nvmrc).

### CLI (from repo root)

Ensure `tools/threejson-agent/shell/py` is on `PYTHONPATH`, or:

```bash
cd tools/threejson-agent/shell/py
python -m threejson_agent init-config
python -m threejson_agent scene generate --prompt "智慧园区" -o ./out/scene.json
```

CLI relative paths use **cwd** by default; see `setting.example.json` for `paths.relativetRoot` / `paths.redirectRelative`. Custom config: `python -m threejson_agent --config /path/to/setting.json scene ...`.

### GUI

```bash
npm run threejson-agent:gui
```

## Node bridges

- `bridge/scene-agent.mjs` — `runSceneAgent` from `core/ai`
- `bridge/texture-fill.mjs` — `fillTextureUrls` + `nodeTextureSink`
- `bridge/asset.mjs` — asset subcomponent (Python shell must not import `asset_provider` directly in production flow)

## More detail

- Python shell: [`shell/py/README.md`](shell/py/README.md)
- Shell layer overview: [`shell/README.md`](shell/README.md)
- Components: [`components/README.md`](components/README.md)
- AI manual verification matrix: [`../../tests/ai-manual-verification.md`](../../tests/ai-manual-verification.md)
