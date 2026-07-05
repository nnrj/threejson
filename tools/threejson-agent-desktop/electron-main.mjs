import { app, BrowserWindow, ipcMain } from "electron";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.THREEJSON_ROOT
  ? path.resolve(process.env.THREEJSON_ROOT)
  : path.resolve(__dirname, "../..");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

function startStaticServer(root) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url || "/", "http://x").pathname);
        const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
        const filePath = path.join(root, safe === "/" ? "scene-editor.html" : safe);
        if (!filePath.startsWith(root)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const data = readFileSync(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

let mainWindow = null;

async function createWindow() {
  const { port } = await startStaticServer(projectRoot);
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await mainWindow.loadURL(`http://127.0.0.1:${port}/scene-editor.html`);
}

ipcMain.handle("threejson:getProjectRoot", () => projectRoot);

ipcMain.handle("threejson:saveTexture", (_e, { relativePath, bytes }) => {
  const rel = String(relativePath).replace(/^[/\\]+/, "");
  const full = path.join(projectRoot, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, Buffer.from(bytes));
  return `/${rel.replace(/\\/g, "/")}`;
});

ipcMain.handle("threejson:runTextureBridge", (_e, payload) => {
  const bridge = path.join(
    projectRoot,
    "tools/threejson-agent/bridge/texture-fill.mjs"
  );
  return new Promise((resolve, reject) => {
    const proc = spawn("node", [bridge], {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => {
      out += d.toString("utf8");
    });
    proc.stderr.on("data", (d) => {
      err += d.toString("utf8");
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err || out || `bridge exit ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();
  });
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
