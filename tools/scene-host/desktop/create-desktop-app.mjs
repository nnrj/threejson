import { app, BrowserWindow, ipcMain, utilityProcess } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProjectRoot, startStaticServer } from "./static-server.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isPathInsideRoot(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * @param {{
 *   entryPath: string,
 *   windowTitle?: string,
 *   preloadFile?: string,
 *   enableTextureIpc?: boolean
 * }} options
 */
export function launchDesktopApp(options) {
  const {
    entryPath,
    windowTitle = "ThreeJSON",
    preloadFile = "../editor/electron/preload.mjs",
    enableTextureIpc = false
  } = options;

  const projectRoot = resolveProjectRoot(import.meta.url, {
    isPackaged: app.isPackaged,
    packagedRoot: path.join(process.resourcesPath, "threejson-root")
  });
  const preloadPath = path.join(__dirname, preloadFile);

  let mainWindow = null;
  let staticServer = null;
  let creatingWindow = false;

  if (enableTextureIpc) {
    registerTextureIpcHandlers(projectRoot);
  }

  async function createWindow() {
    if (creatingWindow) {
      return;
    }
    creatingWindow = true;
    try {
      if (!staticServer) {
        const started = await startStaticServer(projectRoot, entryPath);
        staticServer = started.server;
      }
      const port = staticServer.address().port;
      mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 960,
        minHeight: 640,
        title: windowTitle,
        show: false,
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });
      mainWindow.once("ready-to-show", () => {
        mainWindow?.show();
      });
      await mainWindow.loadURL(`http://127.0.0.1:${port}${entryPath}`);
    } finally {
      creatingWindow = false;
    }
  }

  function shutdown() {
    staticServer?.close?.();
    staticServer = null;
    mainWindow = null;
  }

  app.whenReady().then(createWindow).catch((error) => {
    console.error("[scene-host desktop] failed to start:", error);
    shutdown();
    app.exit(1);
  });

  app.on("window-all-closed", () => {
    shutdown();
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });

  app.on("before-quit", shutdown);
}

function registerTextureIpcHandlers(projectRoot) {
  ipcMain.handle("threejson:getProjectRoot", () => projectRoot);

  ipcMain.handle("threejson:saveTexture", (_event, { relativePath, bytes }) => {
    const rel = String(relativePath || "").replace(/^[/\\]+/, "");
    if (!rel || rel.includes("..")) {
      throw new Error("Invalid texture path.");
    }
    const full = path.resolve(projectRoot, rel);
    if (!isPathInsideRoot(projectRoot, full)) {
      throw new Error("Texture path escapes project root.");
    }
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, Buffer.from(bytes));
    return `/${rel.replace(/\\/g, "/")}`;
  });

  ipcMain.handle("threejson:runTextureBridge", (_event, payload) => {
    const bridgeWorker = path.join(__dirname, "utility/texture-bridge-worker.mjs");
    return new Promise((resolve, reject) => {
      const proc = utilityProcess.fork(bridgeWorker, [], {
        serviceName: "threejson-texture-bridge"
      });
      let err = "";
      let settled = false;
      proc.stderr?.on("data", (chunk) => {
        err += chunk.toString("utf8");
      });
      proc.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      });
      proc.on("message", (event) => {
        if (settled) {
          return;
        }
        const message = event?.data || event || {};
        if (message.ok) {
          settled = true;
          resolve(message.result);
          return;
        }
        settled = true;
        reject(new Error(message.error || err || "texture bridge failed"));
      });
      proc.once("exit", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(err || `texture bridge exit ${code}`));
      });
      proc.postMessage({
        type: "run",
        payload: {
          ...(payload || {}),
          projectRoot
        }
      });
    });
  });
}
