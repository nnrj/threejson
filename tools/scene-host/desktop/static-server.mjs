import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".obj": "text/plain; charset=utf-8",
  ".mtl": "text/plain; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".fbx": "application/octet-stream",
  ".tjz": "application/octet-stream",
  ".zip": "application/zip",
  ".hdr": "application/octet-stream",
  ".exr": "application/octet-stream"
};

export function resolveProjectRoot(fromDir = import.meta.url, options = {}) {
  const __dirname = path.dirname(fileURLToPath(fromDir));
  const packagedRoot = options.packagedRoot ? path.resolve(options.packagedRoot) : "";
  if (options.isPackaged === true && packagedRoot) {
    return packagedRoot;
  }
  return process.env.THREEJSON_ROOT
    ? path.resolve(process.env.THREEJSON_ROOT)
    : path.resolve(__dirname, "../../..");
}

function isPathInsideRoot(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function resolveSafeFilePath(root, urlPath, defaultPath) {
  const normalized = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const relative =
    normalized === "/" || normalized === path.sep
      ? defaultPath.replace(/^\//, "")
      : normalized.replace(/^[/\\]+/, "");
  const filePath = path.resolve(root, relative);
  if (!isPathInsideRoot(root, filePath)) {
    return null;
  }
  return filePath;
}

export function startStaticServer(root, defaultPath = "/tools/scene-host/editor/index.html") {
  const resolvedRoot = path.resolve(root);
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
        const filePath = resolveSafeFilePath(resolvedRoot, urlPath, defaultPath);
        if (!filePath) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }
        const stat = statSync(filePath);
        if (!stat.isFile()) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const data = readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port, root: resolvedRoot });
    });
  });
}
