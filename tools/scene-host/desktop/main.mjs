import { launchDesktopApp } from "./create-desktop-app.mjs";

function resolveDesktopEntry(argv = process.argv.slice(1)) {
  const args = new Set(argv.map((v) => String(v || "").toLowerCase()));
  const isPlayer = args.has("--player");
  if (isPlayer) {
    return {
      entryPath: "/tools/scene-host/player/index.html",
      windowTitle: "ThreeJSON 场景播放器",
      preloadFile: "../player/electron/preload.mjs",
      enableTextureIpc: false
    };
  }
  return {
    entryPath: "/tools/scene-host/editor/index.html",
    windowTitle: "ThreeJSON 场景编辑器",
    preloadFile: "../editor/electron/preload.mjs",
    enableTextureIpc: true
  };
}

launchDesktopApp(resolveDesktopEntry());
