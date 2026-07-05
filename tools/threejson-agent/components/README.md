# ThreeJSON external tool components

Platform-specific binaries for subcomponents invoked **only from Node** (`tools/threejson-agent/bridge/`). Python CLI/GUI must not call these directly.

## Layout

```text
components/
  manifest.json          # component id, binaryName, devFallback
  bin/
    win32-x64/           # e.g. asset-search.exe (CI build output)
    darwin-arm64/
    darwin-x64/
    linux-x64/
  portable/              # source / docs per component
```

Resolution: [`../bridge/resolveComponentBinary.mjs`](../bridge/resolveComponentBinary.mjs).

## Development without binaries

```bash
export THREEJSON_USE_PYTHON_COMPONENTS=1   # Windows: set THREEJSON_USE_PYTHON_COMPONENTS=1
```

Node `bridge/asset.mjs` will spawn `python -m threejson_agent.asset_bridge_entry` when no binary exists for the current platform.

## Building `asset-search` (placeholder)

Production packaging is **not** checked in. Options:

1. **PyInstaller** (from repo root, Python 3.10+):

```bash
pip install pyinstaller
pyinstaller --onefile --name asset-search \
  tools/threejson-agent/shell/py/threejson_agent/asset_bridge_entry.py
# Move dist/asset-search (or .exe) to tools/threejson-agent/components/bin/<platform>-<arch>/
```

2. **Rewrite in JS/Go** — evaluate separately (size, licensing, CI matrix).

Platform tag examples: `win32-x64`, `darwin-arm64`, `linux-x64` (must match `process.platform` + `process.arch`).

## CI (recommended later)

- Matrix: win / mac / linux on **Node 24+** (see repo [`.nvmrc`](../../../.nvmrc))
- Build step: `node tools/dev/build/build-threejson-component.mjs asset-search` (placeholder; copies or invokes PyInstaller when configured)
- Artifact: `components/bin/**/asset-search*`
- Attach to GitHub Release or optional npm optionalDependency
- Until binaries exist, set `THREEJSON_USE_PYTHON_COMPONENTS=1` for dev (requires Python 3.10+ on PATH)
