# ThreeJSON Electron Examples

[中文](./README.md) | [English](./README_EN.md)

Minimal ThreeJSON demos in a desktop shell, matching the web `examples/react-app` and `examples/vue-app` integrations (`sceneRuntimeBasic.json`).

| Folder | Stack | Dev port |
|--------|-------|----------|
| [`electron-app/`](./electron-app/) | Electron + Vite (no UI framework) | 5173 |
| [`electron-vue/`](./electron-vue/) | Electron + Vue 3 | 5174 |
| [`electron-react-app/`](./electron-react-app/) | Electron + React | 5175 |

## Requirements

- **Node.js 24+** (matches repo root [`.nvmrc`](../../.nvmrc)).
- Run `npm install` **inside each subfolder** (downloads Electron binaries; can take a while).

## Install (run locally)

```bash
cd examples/electron-apps/electron-app && npm install && npm run dev
cd examples/electron-apps/electron-vue && npm install && npm run dev
cd examples/electron-apps/electron-react-app && npm install && npm run dev
```

If a previous install failed on an older Node version, remove `node_modules` in that folder and reinstall.

`npm run dev` runs Vite and Electron together; `npm run preview` builds then opens `dist/index.html` in Electron.

### `npm start` vs `npm run build`

| Command | Behavior |
|---------|----------|
| `npm run dev` | Vite dev server (HTTP) + Electron; assets served from `public/demo-assets/` — **no build** required. |
| `npm run preview` | **`npm run build` then** Electron opens `dist/` (recommended for local production check). |
| `npm start` | Electron only, loading existing `dist/index.html` via `file://`. Does **not** run build. |

If you run `npm start` without a fresh build after changing `public/`, scene JSON, or source, `dist/` may be missing or stale and **textures may fail to load** (e.g. a black earth sphere). Run:

```bash
npm run build
npm start
```

Or use `npm run preview` (build + Electron in one step).

The `threejson` package is linked via `file:../../..`. Vite `server.fs.allow` includes the repo root, same as the web examples.

## Notes

- Renderer uses `createJsonScene`; assets live under `public/demo-assets/`.
- Texture URLs use **relative** `./demo-assets/...` paths so `file://` loads work after `vite build`.
- Main process only opens the window; no project file IPC (see `tools/threejson-agent-desktop` for a fuller editor shell).
