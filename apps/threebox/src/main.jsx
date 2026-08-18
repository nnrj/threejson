import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
// Verbatim from tools/scene-host/threebox — the app reproduces that DOM so this design applies as-is.
import "./threebox.css";
import "@threejson/react-scene-agent/styles.css";
// The handful of controls the original does not have (adjust/generate toggle, error colouring).
import "./styles.css";

// NOTE: intentionally NOT wrapped in <StrictMode>. Each scene card owns a live Three.js WebGL
// context on its own canvas (SceneCard.jsx), created/disposed imperatively — exactly the original's
// architecture. StrictMode's dev-only double-invoke of effects (setup → cleanup → setup on the same
// canvas DOM node) tears down that context and cannot recreate it on the reused canvas, leaving the
// card stuck on its loading mask. The vanilla original has no such double-mount; production React
// never double-invokes either, so this only affects dev. Canvas/WebGL-heavy React apps commonly
// opt out of StrictMode for this reason.
createRoot(document.getElementById("root")).render(<App />);
