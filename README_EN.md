# ThreeJSON

[中文](./README.md) | [English](./README_EN.md)

[![CI](https://github.com/nnrj/threejson/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/nnrj/threejson/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/nnrj/threejson)](./LICENSE)

JSON-driven [Three.js](https://threejs.org/) scene runtime: build 3D scenes from configuration instead of hand-writing large chunks of Three.js boilerplate.

**Repository**: [github.com/nnrj/threejson](https://github.com/nnrj/threejson) · **Issues**: [GitHub Issues](https://github.com/nnrj/threejson/issues)

Exact description:

ThreeJSON is a JSON-driven declarative scene runtime for Three.js, designed for persistent, mutable and extensible 3D worlds — from human-authored scenes to AI and Agent-driven generation and control.

## Development environment

To run tests, examples, and external tools (agent bridges, MCP) in this repo, use **Node.js 24+**.

```bash
git clone https://github.com/nnrj/threejson.git
cd threejson
nvm use          # reads .nvmrc
npm ci && npm test
```

See **[`doc/development.md`](doc/development.md)** (Chinese; English: [`doc/en/development.md`](doc/en/development.md)).

## Contributing and AI-generated code

This project **allows** AI-assisted contributions, subject to the **AI-generated code guidelines** in [`doc/development.md`](doc/development.md) (keep docs in sync, human-reviewed plans, attach `doc/dev/plans/` with each submission). See also [`doc/dev/plans/README.md`](doc/dev/plans/README.md).

## Documentation

See **[`doc/en/README.md`](doc/en/README.md)** for the full caller guide, JSON format, and API reference.

If you want to understand the design of `domains/`, how `domainModelList` works, or how to create a custom business domain, see **[`doc/en/domains.md`](doc/en/domains.md)**.

## Install from npm (package name: `threejson`)

Peer dependencies must be installed in your app (versions should satisfy the `peerDependencies` field in [`package.json`](package.json)):

- **Three.js**: `>= 0.179.0` (recommended **0.184.x**). See [`doc/three-compat.md`](doc/three-compat.md) (Chinese; version matrix and workarounds).

```bash
npm install threejson three @tweenjs/tween.js html2canvas-pro
```

If you use **`textureKind: "gif"`**, the runtime does `import("gifuct-js")`; your bundler should resolve it from **`node_modules`** (`gifuct-js` is a dependency of `threejson` and is usually installed transitively).

For **`objType: "text"`** with **`mode: "sdf"`** (default), the runtime lazy-loads **`troika-three-text`** (a `dependencies` entry; bundlers usually resolve it automatically). No extra setup is needed for `texture` / `mesh` modes or scenes without text objects.

Example:

```js
import { createSceneRuntime, deployMesh, door } from "threejson";
import { applyJsonPatchToObjectDescriptor } from "threejson/patch";
import { applyJsonPatchToJsonDocument } from "threejson/patch-core";
```

For pure core without built-in domains: `import { createSceneRuntime } from "threejson/core"`. To control registration order yourself, add `import "threejson/builtins/register"`.

### Static assets (textures / models / scene JSON)

After `npm install`, built-in domains and `/assets/...` paths in scene JSON **default** to jsDelivr [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets) (version pinned in runtime `ASSETS_PACKAGE_VERSION`). You do not need to install the assets package for CDN loading.

**Use a local static mount** (clone, self-hosted):

```js
import { createJsonScene, LOCAL_ASSETS_BASE, setAssetsBaseUrl } from "threejson/core";

setAssetsBaseUrl(LOCAL_ASSETS_BASE); // "/assets"

await createJsonScene(payload, {
  canvas,
  assetsBase: "/assets" // or sceneConfig.assetsBase in JSON
});
```

Priority (high → low): `createJsonScene({ assetsBase })` → `sceneConfig.assetsBase` → `setAssetsBaseUrl()` → built-in CDN default. Keep `/assets/textures/...` in JSON; the loader rewrites against the active base. Full `https://` URLs are unchanged.

Bundlers (Vite, Webpack, etc.) resolve `three` and addons from `node_modules`.

**npm + bundler vs import map + CDN**: npm builds give **locked versions**, **reproducible installs**, and tree-shaking, at the cost of a build step. Import maps pointing at **esm.sh / jsdelivr** work in **no-build** HTML demos but depend on **CDN availability**; pin major versions in URLs to reduce drift.

## Use without npm (clone + static server)

Clone the repo and serve it over HTTP (e.g. Live Server). Map **`threejson`** → [`builtins/full.js`](builtins/full.js) and **`threejson/core`** → [`core/index.js`](core/index.js) in an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap), then use `import { createJsonScene } from "threejson"` like npm. See [`examples/html-demo/README.md`](examples/html-demo/README.md). Relative `core/index.js` + `builtins/register.js` is documented in `00-05-import-paths.html`. Map `three`, `@tweenjs/tween.js`, `html2canvas-pro` by default. Add **`gifuct-js`** (`textureKind: "gif"`) and **`troika-three-text`** + **`fflate`** (SDF scene text) only when needed — see [`doc/en/quick-start.md`](doc/en/quick-start.md).

## Quick Local Preview

After starting a static server, open [`index.html`](index.html) at the repo root. It redirects to [`demo.html`](demo.html), which aggregates the `examples/html-demo/*.html` samples together with the root-level integrated pages such as [`room-show.html`](room-show.html), [`scene-editor.html`](scene-editor.html), [`scene-player.html`](scene-player.html), and [`port-show.html`](port-show.html).

## License

[MIT](./LICENSE)
