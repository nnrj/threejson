[中文](../zh/scope.md) | [English](./scope.md)

# Scope and data contract

[中文](../zh/scope.md) | [English](./scope.md)

This document describes **core** capability boundaries and how **canonical JSON** relates to the **runtime Object3D overlay**, so upstream callers and contributors share the same expectations.

## Core commitments (summary)

- JSON normalization, scene deployment, object registry indexing (`threeJsonId` / `uuid` / `name` / `refName`).
- Declarative `animations` (e.g. `rotate`) integrated with the render loop.
- For loaded **glTF with clips**, optional `AnimationMixer` registration and per-frame updates (coordination with declarative animation via `animationMode`).
- `sceneRuntimeApi`: controlled imperative transforms on `Object3D` (see `core/handler/sceneRuntimeApi.js`).
- `descriptorSync`: partial descriptor merge, writing transforms back to `objJson`, cooperation with descriptor-binding dirty flags (see `core/handler/descriptorSync.js`).
- **L3 JSON Patch**: opt-in via package entry `threejson/patch`; RFC 6902-style ops on a whitelist with binding dirty marks (not in the default frame loop).
- `PluginHost`: minimal plugin lifecycle hooks (see `core/plugin/pluginHost.js`); concrete physics etc. live in `extensions/`.

## Canonical source vs runtime overlay

- **Authoring**: document sessions own immutable `SceneDocument` persistence, reload and undo. `userData.objJson` / `worldInfo` are compiled descriptor views; non-session imperative APIs retain their existing descriptor-sync contract.
- **Runtime overlay**: game loop, physics, scripts may modify `Object3D` directly; **need not** match JSON every frame.
- **Explicit runtime capture**: imperative callers can use `reconcileTransformToDescriptor`; session hosts commit selected poses as transactions instead of letting animation overwrite authoring history. See the [migration guide](../dev/scene-authoring-runtime.md).

For an **ideal, non-mandatory** split of `core/builder`, `core/handler`, and `core/runtime`, see [Design principles · core source layout](./design-principles.md#core-source-layout-builder--handler--runtime-ideal-reference-not-mandatory) and the long-term memo [lab/core-layering-memo.md](../../lab/core-layering-memo.md).

## Three-tier sync (with `worldInfo.descriptorBinding`)

**RuntimeOnly / AuthoringOnly / Hybrid** modes described in `sceneDescriptorBinding` match the canonical/overlay split: high-frequency object writes, low-frequency or explicit write-back to JSON.

## Bundled extensions (`extensions/`)

Example plugins and simple physics demos: **not** semver-locked with core; see each folder’s README. Wiring guide: **[extensions.md](./extensions.md)**.

## Lab ([`lab/README.md`](../../lab/README.md))

Future-capability drafts and experiment index (**not** a release commitment), separate from formal contracts in `docs/`.

## Explicitly out of core

Full network sync, ECS, production-level editor UI, anti-cheat and untrusted-input validation (see optional security placeholder in [`design-principles.md`](./design-principles.md))—implemented by hosts or optional extensions.
