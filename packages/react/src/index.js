/**
 * @threejson/react — thin React bindings over the framework-agnostic @threejson/* kits.
 *
 * Scope is deliberately narrow: mount a scene, react to its state, read/write host settings and
 * locale. Application shells (top bars, playlists, scene trees, AI panels) belong in the app, not
 * here — see the individual kits for the underlying logic.
 */
export { SceneViewport } from "./SceneViewport.js";
export { useScenePlayer } from "./useScenePlayer.js";
export { useHostI18n, setHostLocale } from "./i18n.js";
export { usePlayerSettings } from "./usePlayerSettings.js";
export { usePlaylist } from "./usePlaylist.js";
