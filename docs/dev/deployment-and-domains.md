# Deployment surface and domain strategy

> **Media update — 2026-09-29.** The explicitly opened media workbench now shares
> browser modules from `packages/audio-kit/js`, `packages/media-kit/js` and exactly
> `host-kit/js/mediaStudio.js` / `audioModelPanel.js`. `.assetsignore` includes only
> those runtime paths; all other packages, Node model storage, package metadata and
> local secrets stay excluded. Ordinary scene startup still has no media dependency.
> This supersedes the blanket `packages/` exclusion below, not the deployment strategy.
> Matching follows [Cloudflare's gitignore-compatible rules](https://developers.cloudflare.com/workers/static-assets/binding/)
> and is covered by a deployment-surface regression test.

> **Implementation update — 2026-07-29.** The deploy-surface exclusions, per-app Cloudflare
> deployment skeletons, explicit origin allowlists, and popup `postMessage` handshakes described
> below are now implemented. The legacy `tools/scene-host` products remain deployed and unchanged
> as the validation baseline; the React products do **not** replace them in this change. The old
> localStorage scene handoff stays only in the legacy products for that reason.

> **Maintainer decisions.** `apps/*` will eventually replace `tools/scene-host`, after deployment
> validation. `community.threebox.org` is not being split out now: it is the current open-source
> ThreeBox experience, and a later path such as `threebox.org/community/threebox/` remains an
> option. No DNS or product-boundary change is part of this work.

Assessment of how `threejson.org` is currently deployed, whether the website should stay in this
repository, and what it would actually cost to move the `apps/*` products onto their own subdomains.

- Date: 2026-07-29 (Asia/Shanghai)
- Status: assessment + phased plan. Only the Phase 1 deploy-surface change is proposed for
  immediate action; the domain split is deliberately deferred.

## 1. Current state (measured, not assumed)

`wrangler.jsonc` serves the **repository root** as a Cloudflare static-asset site:

```jsonc
{ "name": "threejson", "assets": { "directory": "./" } }
```

`.assetsignore` currently excludes only `.git`, `node_modules`, IDE folders, OS junk, `.wrangler`,
logs and `package-lock.json`. Everything else in the tree is publicly served — confirmed live:
`https://threejson.org/package.json` returns **200**.

Measured deploy surface (excluding `node_modules`):

| Directory | Size | Files | Needed at runtime by the live site? |
|---|---|---|---|
| `assets/` | 132 MB | 262 | **Yes** — demo scenes, textures, models |
| `tools/` | 4.1 MB | 325 | **Yes** — the live editor / player / shower / threebox |
| `core/` `domains/` `extensions/` `builtins/` | ~3.3 MB | 389 | **Yes** — the apps' importmaps load `../../../core/index.js` and `builtins/full.js` |
| `docs/en/` `docs/zh/` | ~0.6 MB | 73 | **Yes** — `core/ai/sceneReferenceCatalog.js` fetches doc excerpts at runtime |
| `website/` | 68 KB | 3 | **Yes** — the site itself |
| `apps/*/dist/` | **10.9 MB** | — | No — built artifacts of products that are not routed here |
| `apps/` (source) | 526 KB | 158 | No |
| `packages/` | 872 KB | 97 | No — these ship via npm |
| `tests/` | 1.2 MB | 182 | No |
| `docs/dev/` | — | — | No — internal planning archive |

Total file count is ~1,500, far below Cloudflare's 20,000-asset limit, so the constraint is **bytes
and deploy time, not file count**. `assets/` dominates at 132 MB and is genuinely required.

### 1.1 Deploy-surface hygiene risk (act on this regardless of the domain decision)

`servertmp/` (13 MB — `threebox-server`, `threebox-cloud`, `three-box-dashboard`) is **git-ignored
but not `.assetsignore`-ignored**. It contains secret-bearing files by convention:

```
servertmp/threebox-server/.dev.vars          # Cloudflare Workers local secrets
servertmp/three-box-dashboard/.env.production
servertmp/threebox-server/wrangler.toml
```

These currently return 404 — because they are dotfiles and because a CI/clean checkout never has
`servertmp/` (it is git-ignored). **But a `wrangler deploy` run from a working directory that has
`servertmp/` present would upload them**, since `.assetsignore` does not exclude it. This is a
latent credential-exposure path, not a theoretical one. `.assetsignore` must exclude it explicitly
rather than relying on "the file happens to start with a dot" and "CI happens not to have it".

The same applies to `apps/*/settings.test.json` (developer AI keys, git-ignored, currently 404).

## 2. Should the website stay in this repository?

**Yes — keep it.** The website's whole value is that its examples demonstrate the *current* engine:
it loads scenes from `assets/`, and the live tools load `core/` and `builtins/` directly. Co-location
means the demo can never drift from the shipped code, with no publish or sync step.

Splitting the site into its own repository would introduce exactly the failure mode the project has
been careful to avoid elsewhere (see the pinned-asset-version guard in `core/util/assetsBase.js`): a
second artifact that silently goes stale against the first. The cost of keeping it is one
`.assetsignore` file; the cost of splitting it is a permanent version-sync obligation.

**Should the site move to `website.threejson.org`?** **No.** The apex domain is the project's front
door — it owns the SEO, the inbound links, and the docs. Moving the site to a subdomain devalues the
apex and breaks existing URLs for no architectural gain. If anything moves to a subdomain, it should
be the *applications*, not the site.

## 3. Moving `apps/*` to subdomains: what it actually costs

The React apps under `apps/*` are independent Vite SPAs that consume the published `@threejson/*`
packages. Subdomains (`editor.threejson.org`, `player.threejson.org`, …) are a natural fit **once
they replace the live `tools/scene-host` products**. The real question is the cross-origin bill.

### 3.1 What does *not* break

Asset loading is already cross-origin today: `@threejson/assets` is fetched from the jsDelivr CDN via
`DEFAULT_CDN_ASSETS_BASE`. Splitting origins changes nothing here. This is the single biggest reason
the split is cheaper than it first appears.

### 3.2 What breaks, and the correct fix

There are exactly two cross-app mechanisms in the current products:

**(a) Editor ↔ player preview — `postMessage`.** `tools/scene-host/shared/js/scenePreviewProtocol.js`
opens the player with `window.open()` and hands the scene over by message. It is currently pinned to
same-origin in two places:

```js
if (event.origin && event.origin !== window.location.origin) { /* reject */ }
postScenePreviewMessage(target, message, targetOrigin = window.location.origin)
```

`postMessage` is **natively cross-origin**. The fix is to make the peer origin explicit and
configurable (an allowlist of expected app origins) instead of implicitly "my own origin". This is a
small, well-scoped change to one protocol module — **not** a reason to build a backend.

**(b) ThreeBox / shower → editor — `localStorage` bridge.** Three apps share the key prefix
`threejson.editor.openScene.<id>` to hand a scene to the editor. `localStorage` is **origin-scoped**,
so this breaks completely across subdomains. It must be migrated to the same `window.open()` +
`postMessage` handshake as (a). The mechanism already exists and is proven in this codebase; this is
consolidation, not new invention.

### 3.3 Do we need `threebox-server` APIs for the handoff?

**No — and routing scene handoff through a server would be a regression.**

A server relay would send the user's scene JSON to a backend purely to move it between two tabs on
the same machine. That contradicts the project's existing privacy posture, where even cloud migration
is explicit, user-initiated and end-to-end encrypted (`threeBoxCloudMigration.js`). It would also add
an auth requirement, a network failure mode, and a retention question — for data that never needed to
leave the browser.

`postMessage` handles the tab-to-tab case completely and offline.

A server API *is* the right answer for a genuinely different feature: **shareable scene links** that
survive the originating tab being closed and can be sent to another person. That is a product
decision to make on its own merits, not a prerequisite for the domain split.

### 3.4 The real cost: fragmented per-origin state

The honest downside of subdomains. These keys are origin-scoped and would no longer be shared:

| Key | Consequence of splitting |
|---|---|
| `threejson.host.locale`, `threejson.site.lang` | Language re-selected per app |
| `threejson.builtin-provider-privacy.v1` | **Built-in provider consent re-prompted per app** |
| ThreeBox settings + conversation IndexedDB | Per-origin; history does not follow the user across apps |
| `threejson.scenePlayer.*`, `threejson.shower.*` | Per-app preferences reset |

Mitigations exist (a shared-preferences iframe on one canonical origin, or moving preferences into an
account once one exists), but each adds complexity. This is the main argument for keeping the apps on
path prefixes of a single origin (`threejson.org/editor/`) rather than subdomains, if the products are
meant to feel like one suite.

## 4. Recommendation

**Phase 1 — now (independent of any domain decision).** Narrow the deploy surface via
`.assetsignore`. This is pure win: it removes ~13 MB of uploads and closes the `servertmp/` exposure
path, with zero effect on the live site.

Exclude: `servertmp/`, `apps/`, `packages/`, `tests/`, `**/dist/`, `docs/dev/`, `.claude/`,
`*.test.json`.

**Must NOT be excluded** (verified runtime dependencies of the deployed products):
`assets/`, `tools/`, `core/`, `builtins/`, `domains/`, `extensions/`, `website/`, `docs/en/`,
`docs/zh/`.

> `docs/en` and `docs/zh` are easy to mistake for build-time-only content. They are fetched at
> runtime by `core/ai/sceneReferenceCatalog.js` to give the AI agent reference excerpts. Excluding
> them would silently degrade ThreeBox's generation quality rather than produce an obvious error.

**Phase 2 — when `apps/*` are ready to replace `tools/scene-host`.** Keep the site at the apex. Serve
the apps as path prefixes on the same origin first (`threejson.org/editor/`, `/player/`, …). This
keeps the explicit handshake on one origin and preserves the remaining `localStorage` state without
requiring a separate cross-origin deployment configuration.

**Phase 3 — only if a product reason demands separate origins** (independent deploy cadence, separate
security boundary, or a distinct product identity such as `community.threebox.org`):

1. Make the preview protocol's peer origin explicit and configurable (fixes 3.2a).
2. Replace the `threejson.editor.openScene.*` `localStorage` bridge with the `postMessage`
   handshake (fixes 3.2b).
3. Decide the shared-preferences story (consent re-prompting is the user-visible pain point).
4. Only then, cut the DNS over.

Sequencing matters: doing (1) and (2) *before* the DNS change means the split becomes a
configuration change rather than a debugging exercise.

## 5. Confirmed maintainer decisions and implementation status

### Current implementation and deferred path deployment

### Implemented now

- Root `.assetsignore` excludes non-runtime source, test, local-server, build, and secret-bearing
  files while preserving the live site's runtime inputs.
- Each React app has its own `.gitignore`, `.assetsignore`, `wrangler.jsonc`, and `deploy` /
  `versions:upload` scripts. These configurations deliberately contain no routes or DNS bindings.
- `tools/scene-host/shared/js/scenePreviewProtocol.js` now rejects an omitted or non-allowlisted
  `targetOrigin`. Its current allowlist is `threejson.org`, `threebox.org`,
  `cloud.threebox.org`, `editor.threejson.org`, `player.threejson.org`, and
  `shower.threejson.org`, plus explicit local development ports.
- The React ThreeBox and Shower applications open the React editor with a one-time
  `window.open()` + `postMessage` handshake. React ThreeBox also opens the React player through
  the same pattern. The receivers validate origin, opener window, protocol version, and an
  unguessable session identifier before accepting a payload.
- The React apps maintain this configuration in their own source files; they do not import the
  legacy scene-host protocol.

### Deferred: mapping the React applications to same-origin paths

This is feasible, but intentionally **not enabled** yet. When the React apps have passed the
legacy deployment baseline, use a staging build rather than serving their source directories:

1. Set each Vite application's `base` to its final path, for example `"/editor/"`, `"/player/"`,
   `"/shower/"`, and `"/threebox/"`.
2. Build every app, then copy each `dist/` into a generated root-site staging directory at the
   matching path (`editor/`, `player/`, and so on).
3. Point the root Cloudflare assets deployment at that staging directory. Keep the existing
   runtime tree (`assets/`, `tools/`, `core/`, `builtins/`, `domains/`, `extensions/`, `website/`,
   `docs/en/`, and `docs/zh/`) in the staging build as well.
4. Set the `VITE_THREEJSON_*_URL` build variables to the final path URLs. Since their origin is
   still `https://threejson.org`, the explicit handshake remains valid without weakening its
   allowlist.

That work belongs to the later replacement cutover, not this preparatory change. It is not
necessary to add a Cloudflare Worker merely to map these static SPA paths.
