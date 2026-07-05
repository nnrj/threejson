# react-app

Minimal **React + Vite + TypeScript** sample for ThreeJSON: `fetch` scene JSON then `createJsonScene` in `useEffect`, `stop()` / `dispose()` in the effect cleanup (with an `alive` flag for async + **StrictMode**).

From **this directory**:

```bash
npm install
npm run dev
```

`threejson` is linked via `"file:../.."` in `package.json` (the repo `core/` tree).

**Bundled demo assets**: scene JSON and textures live under `public/demo-assets/` (`scene/sceneRuntimeBasic.json`, `textures/...`). They load from absolute paths `/demo-assets/...` so the app does **not** rely on the repo root `assets/` folder. `vite.config.ts` still sets `server.fs.allow` to the repo root for the linked `threejson` package resolution.
