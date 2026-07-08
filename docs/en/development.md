[中文](../zh/development.md) | [English](./development.md)

# Development and toolchain

[中文](../zh/development.md) | [English](./development.md)

The ThreeJSON **library** ([`core/`](../../core/), [`domains/`](../../domains/)) is **browser / bundler ESM** and does **not** require Node at runtime.

To develop in this repo, run tests, build examples, and use external tools, you need **Node.js 24+** (see root [`.nvmrc`](../../.nvmrc) and `engines` in [`package.json`](../../package.json)).

## Environment

```bash
nvm install 24
nvm use          # reads .nvmrc
node -v          # v24.x
npm ci
npm test
```

Optional Python agent shell: **Python 3.10+**; dependencies in [`tools/threejson-agent/shell/py/requirements.txt`](../../tools/threejson-agent/shell/py/requirements.txt).

## Layers

| Layer | Node required | Notes |
|-------|---------------|-------|
| `core/`, `domains/` | No | Static server or bundler → browser |
| Root `npm test` | 24+ | Node runs `tests/*.test.mjs` |
| `examples/*` (Vite / Electron) | 24+ | `npm install` / `npm run build` per subfolder |
| `tools/threejson-agent/bridge/` | 24+ | Python CLI spawns Node to load `core/ai` |
| `tools/mcp-threejson` | 24+ | Cursor MCP |
| `tools/threejson-agent-desktop` | 24+ | Electron desktop shell |

## AI credentials

- Browser: [`scene-editor.html`](../../scene-editor.html) / html-demo → **localStorage**
- CLI / GUI: [`tools/threejson-agent/setting.json`](../../tools/threejson-agent/setting.json) (copy from `setting.example.json`)
- MCP: [`tools/mcp-threejson/setting.json`](../../tools/mcp-threejson/setting.json) (separate file)

## AI verification

- Automated (no API key): `npm test`, `npm run verify:ai-static`
- Manual matrix: [`tests/ai-manual-verification.md`](../../tests/ai-manual-verification.md)
- Optional live (agent `setting.json` required): `npm run verify:ai-live`

## Sync / async API naming convention

New public APIs follow these four cases:

1. **No async needed**: provide `abc()` only (sync).
2. **Async valuable but sync still valid**: provide `abc()` + `abcAsync()` (same semantics; Async waits for async work).
3. **Full capability must be async; sync is subset**: provide `abc()` (async full) + `abcSimple()` (sync subset).
4. **Async only**: provide `abc()` only (returns `Promise`; no extra `Async` suffix).

### Why case 3 uses `*Simple`, not `*Sync`

Sync subsets for case 3 use **`abcSimple()`** only. Public APIs **must not** use a `*Sync` suffix:

- **Readability**: `Async` and `Sync` differ by one letter; side-by-side suffixes are easy to misread or mistype (e.g. `createJsonScene` vs `createJsonSceneSync`).
- **Semantics**: the subset is not a sync-equivalent twin of the async API—it **skips or degrades** work that requires async preparation. `Simple` means reduced/subset capability.
- **Discoverability**: avoid `sync*` / `async*` prefixes for all APIs; they clutter autocomplete and hide full vs subset entry points.

Example: `createJsonScene()` (async full) + `createJsonSceneSimple()` (sync subset). Do **not** add `createJsonSceneSync`.

objectMutation texture paths are case 2: sync APIs do not block texture download; `*Async` APIs wait until textures settle.

## AI-generated code guidelines

This project **allows** AI-assisted code, provided contributors follow:

1. **Docs in sync**: code changes must update project docs (`docs/`, API, JSON contracts, examples, tool READMEs).
2. **Plan before code**: a written plan must exist and be **human-reviewed** before implementation merges.
3. **Attach plans on submit**: include related materials under [`docs/dev/plans/`](../../dev/plans/).
4. **Plan folder naming**: `{unix_ms_timestamp}_{brief-description}_{32-char-hex-uuid}` — e.g. `1782301810000` → `2026-06-24 19:50:10` (UTC+8). See [`docs/dev/plans/README.md`](../../dev/plans/README.md).
5. **Plan contents**: prompt/context summary, requirements assessment, and solution design (may be split across `.md` files).
6. **Tests**: when appropriate, add automated cases under [`tests/`](../../tests/) (`*.test.mjs`) and document coverage in the plan; otherwise document manual verification in acceptance criteria.

Details and an example folder: **[`docs/dev/plans/README.md`](../../dev/plans/README.md)**.

## Language and documentation policy

| Layer | Policy |
|-------|--------|
| **Docs `docs/`** | Public contracts live in `docs/` + [`docs/en/`](./); add English mirrors for new docs when practical |
| **Code comments** | New code and public APIs in **English**; legacy Chinese comments in `core/` and `domains/` are migrated **in batches** (remove stale comments, add missing notes; continue when touching files) |
| **[`demo.html`](../../demo.html)** | Single-page runtime i18n; `navigator.language` → `zh-CN` / `en-US`, fallback `en-US`; Chinese UI links to `docs/*.md`; English UI links to `docs/en/*.md` where mirrors exist (e.g. `event-mechanism.md` stays Chinese-only) |
| **`html-demo` tutorial pages** | Body UI stays Chinese |
| **`tools/scene-host` editor / player** | Application i18n (gap-fill only); settings can override locale; default follows browser, fallback `en-US` |
| **Canonical `scene-editor.html` / `scene-player.html`** | **No UI i18n for now** (avoid drift before greenfield aligns with canonical pages) |
| **`room-show.html` / `port-show.html`** | **No UI i18n for now** (business reference pages) |
| **`core` / `domains` / `extensions`** | **No UI i18n runtime** (no `t()` / locale files); comments, JSDoc, and runtime diagnostics (`Error`, `console.*`) use **English**; scene JSON display `name`/`label` may stay Chinese; keep bilingual regex in `sceneCapability`, CJK probe in `textureUtils`, and legacy keys such as `brandName` |

For canonical Chinese/English **concept names and definitions**, see the **[Terminology glossary](./glossary.md)** (complements the policy table above; not a UI string catalog).
