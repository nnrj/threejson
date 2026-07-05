import { launchDesktopApp } from "./create-desktop-app.mjs";

launchDesktopApp({
  entryPath: "/tools/scene-host/editor/index.html",
  windowTitle: "ThreeJSON 场景编辑器",
  preloadFile: "../editor/electron/preload.mjs",
  enableTextureIpc: true
});
