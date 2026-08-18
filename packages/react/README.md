# @threejson/react

Thin React bindings over ThreeJSON's framework-agnostic kits. Mount a scene, react to its state,
read/write host settings and locale — nothing more. Application shells (top bars, playlists, scene
trees, AI panels) belong in your app.

## Install

```bash
npm install @threejson/react @threejson/host-kit @threejson/player-kit threejson three react
```

All of those except `@threejson/react` itself are peer dependencies.

The package root is the compatibility aggregate. Apps that need only one binding should use a capability subpath so unrelated player, playlist, settings, or conversation modules do not enter the static graph:

```jsx
import { SceneViewport } from "@threejson/react/viewport";
import { useHostI18n } from "@threejson/react/i18n";
```

## Quick start

```jsx
import { SceneViewport } from "@threejson/react/viewport";

export function App() {
  return <SceneViewport src="json/portShow.json" style={{ height: "100vh" }} />;
}
```

## API

### `<SceneViewport />`

A fill-parent wrapper containing the canvas the player renders into.

| Prop | Type | Notes |
|---|---|---|
| `src` | `string` | Scene URL; re-loads whenever it changes. Resolved against the `@threejson/assets` CDN unless absolute. |
| `onReady` | `(player) => void` | Called once the runtime mounts, with the full `useScenePlayer()` API. |
| `className` / `style` | | `style` merges over the default fill-parent style. |
| `canvasProps` | `object` | Extra props for the inner `<canvas>`. |
| *rest* | | Forwarded to `createPlayerRuntime` (`assetsBase`, `assetGatewayUrl`, `overrideSceneRenderLoop`, …). |

### `useScenePlayer(options?)`

The hook behind `SceneViewport`, for when you want your own markup. Creates the player-kit runtime
on mount and disposes it on unmount.

```jsx
const player = useScenePlayer();

<div ref={player.canvasWrapRef} style={{ height: "100%" }}>
  <canvas ref={player.canvasRef} />
</div>
{player.loading && <div>{player.loadingMessage}</div>}
<button onClick={player.togglePlayback} disabled={!player.hasScene}>
  {player.playing ? "Pause" : "Play"}
</button>
```

**State:** `loading`, `loadingMessage`, `error`, `playing`, `hasScene`, `title`, `volume`, `muted`, `ready`.
**Methods:** `loadFromUrl`, `loadFromFile`, `loadFromPayload`, `loadFromArchiveBytes`,
`loadNativeThreeJson`, `play`, `pause`, `togglePlayback`, `stop`, `setVolume`, `setMuted`,
`toggleMuted`, `resize`, `fitViewToSceneBounds`, `highlightModelList`,
`clearAlarmAndLocateHighlights`, `clearError`, `getSnapshot`, `getRuntime`.

Options are read through a "latest ref", so passing inline objects/callbacks will **not** tear down
and reload the scene on every render.

### `useHostI18n()` / `setHostLocale(locale)`

```jsx
const { locale, t, setLocale } = useHostI18n();
<h1>{t("player.shell.play", "Play")}</h1>
```

host-kit's i18n has no subscription API (it drives vanilla pages by re-scanning the DOM), so this
package layers a small pub-sub around it. **Always change locale via `setLocale`/`setHostLocale`** —
calling host-kit's `initHostI18n` directly still swaps the catalog, but no React component re-renders.

### `usePlayerSettings()`

Loads the merged player settings bundle (shipped `setting.json` defaults + localStorage cache) and
re-renders on write.

```jsx
const { settings, fileDefaults, loading, save, setByPath, resetToFileDefaults } = usePlayerSettings();
setByPath("render.targetFps", 30); // writes one dotted path, persists, re-renders
```

### `usePlaylist(options?)`

React binding for player-kit's headless playlist store (localStorage manifest + IndexedDB blobs),
subscribed via `useSyncExternalStore` so any reader re-renders on changes.

```jsx
const playlist = usePlaylist({ onActivate: (entry) => player.loadFromUrl(entry.url) });
playlist.addUrl("json/portShow.json");
await playlist.activate(0); // moves the pointer and calls onActivate
```

Loading is intentionally the caller's job: the store moves the pointer and hands you the entry via
`onActivate`; you decide how to play it. That keeps the playlist usable in contexts that do not own
a viewport. `autoRestore` (default on) rehydrates from storage on mount.

## No build step

Like the other `@threejson/*` kits, this package ships raw ESM and is authored with `createElement`
rather than JSX so it stays valid JavaScript as-written — no compile pipeline to publish. This is
invisible to consumers; you still write `<SceneViewport />`.

## Localisation is automatic

`useHostI18n()` loads the host catalog on first use. Call `setHostLocale(tag)` only to *change*
locale, not to bootstrap.

This used to be the app's job, and forgetting it failed silently rather than loudly: host-kit's
`t()` resolves a missing key to key-derived text ("Title" from `threebox.meshExport.title`) instead
of the fallback passed at the call site, so a forgotten init rendered plausible-looking copy. Two of
the three apps in this repo shipped that bug, both times surfacing only when a shared component
reached its second consumer.

The load is kicked off lazily from the hook rather than at module scope, so importing the package
performs no I/O and touches no browser storage.

Conversational scene-authoring hooks are intentionally separate from these general engine bindings.
Use `useSceneConversations()` from [`@threejson/react-scene-agent`](../react-scene-agent/README.md)
with a repository created by `@threejson/scene-agent-kit`.

## Status

Alpha. Boundaries may change before a stable 0.1.0. Editor bindings (over `@threejson/editor-kit`)
are not included yet.
