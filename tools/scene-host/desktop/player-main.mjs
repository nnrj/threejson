import { launchDesktopApp } from "./create-desktop-app.mjs";

launchDesktopApp({
  entryPath: "/tools/scene-host/player/index.html",
  windowTitle: "ThreeJSON 场景播放器",
  preloadFile: "../player/electron/preload.mjs",
  enableTextureIpc: false
});
