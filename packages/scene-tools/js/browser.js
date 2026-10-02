import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { toolError } from "./files.js";

/** Optional real-browser check. Never downloads a browser or starts one on ordinary commands. */
async function runSceneBrowserTask({ file, json, executablePath, channel, headless = true, timeoutMs = 60000, screenshot = false, capabilities = [], signal, mediaOptions, onOutput, onProgress } = {}) {
  let chromium;
  try { ({ chromium } = await import("playwright")); }
  catch { return { ok: false, status: "unavailable", code: "BROWSER_ADAPTER_NOT_INSTALLED", checks: { render: "unchecked" }, error: "Install the optional playwright peer and select an installed browser. No browser was downloaded." }; }
  if (file) json = /\.tjz$/i.test(file) && mediaOptions ? { archiveBytes: [...await readFile(file)] } : JSON.parse(await readFile(file, "utf8"));
  if (!json) throw toolError("SCENE_REQUIRED", "Provide scene JSON or a file.");
  const engine = path.dirname(fileURLToPath(import.meta.resolve("threejson/package.json")));
  const three = path.resolve(path.dirname(fileURLToPath(import.meta.resolve("three"))), "..");
  const token = randomBytes(24).toString("hex"), prefix = `/${token}/`;
  const mounts = new Map([["engine", engine], ["three", three]]);
  const virtualModules = new Map();
  const imports = { three: `${prefix}three/build/three.module.js`, "three/": `${prefix}three/`, "threejson/": `${prefix}engine/core/` };
  // gifuct-js publishes CommonJS only. Bundle the installed peer on first use;
  // do not require a CDN, a pre-generated artifact or a renderer-core change.
  try {
    const entry = fileURLToPath(import.meta.resolve("gifuct-js"));
    imports["gifuct-js"] = `${prefix}gifuct-browser.js`;
    let bundle;
    virtualModules.set("gifuct-browser.js", () => bundle ??= import("esbuild").then(({ build }) => build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "browser" })).then((result) => result.outputFiles[0].text));
  } catch { /* An unused optional decoder is not required. */ }
  if (mediaOptions) {
    for (const name of ["@threejson/media-kit", "@threejson/audio-kit", "mediabunny", "gifenc"]) {
      let entry = fileURLToPath(import.meta.resolve(name));
      if (name === "gifenc") entry = path.join(path.dirname(entry), "gifenc.esm.js");
      if (name === "mediabunny") entry = path.resolve(path.dirname(entry), "../../bundles/mediabunny.mjs");
      const key = `media${mounts.size}`; mounts.set(key, path.dirname(entry)); imports[name] = `${prefix}${key}/${path.basename(entry)}`;
    }
    imports["threejson/archive"] = `${prefix}engine/core/archive/index.js`;
    imports["threejson/runtime"] = `${prefix}engine/core/runtime.js`;
    imports["threejson/timeline"] = `${prefix}engine/core/timeline.js`;
    imports["threejson/session"] = `${prefix}engine/core/session.js`;
    imports["threejson/assets"] = `${prefix}engine/core/assets.js`;
  }
  // Static browser ESM peers are mounted locally, not replaced with CDN dependencies.
  for (const name of ["@tweenjs/tween.js", "troika-three-text", "troika-worker-utils", "troika-three-utils", "webgl-sdf-generator", "bidi-js", "fflate", "three-mesh-bvh", "three-bvh-csg"]) {
    try {
      let entry = fileURLToPath(import.meta.resolve(name));
      const replacements = { "bidi-js": "bidi.mjs", "troika-worker-utils": "troika-worker-utils.esm.js", "troika-three-utils": "troika-three-utils.esm.js", "troika-three-text": "troika-three-text.esm.js", "webgl-sdf-generator": "webgl-sdf-generator.mjs" };
      if (replacements[name]) entry = path.join(path.dirname(entry), replacements[name]);
      if (name === "fflate") entry = path.join(path.dirname(entry), "browser.js");
      const key = `peer${mounts.size}`; mounts.set(key, path.dirname(entry)); imports[name] = `${prefix}${key}/${path.basename(entry)}`;
    } catch { /* an unused peer is not required */ }
  }
  if (file) mounts.set("workspace", path.dirname(path.resolve(file)));
  const errors = [], resourceFailures = [];
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
      const local = decodeURIComponent(url.pathname.slice(prefix.length));
      if (virtualModules.has(local)) { res.setHeader("Content-Type", "text/javascript"); res.end(await virtualModules.get(local)()); return; }
      if (local === "") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(`<!doctype html><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports })}</script><canvas id="canvas" style="width:640px;height:480px"></canvas>`); return;
      }
      const [mount, ...parts] = local.split("/"), root = mounts.get(mount);
      if (!root) { res.writeHead(404).end(); return; }
      const candidate = await realpath(path.resolve(root, ...parts)), actualRoot = await realpath(root), relative = path.relative(actualRoot, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) { res.writeHead(403).end(); return; }
      const mime = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" }[path.extname(candidate)] || "application/octet-stream";
      res.setHeader("Content-Type", mime); res.end(await readFile(candidate));
    } catch { res.writeHead(404).end(); }
  });
  let browser, timer, timedOut = false;
  const interrupt = () => { void browser?.close().catch(() => {}); };
  try {
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    browser = await chromium.launch({ headless, ...(executablePath ? { executablePath } : channel ? { channel } : {}) });
    signal?.throwIfAborted();
    signal?.addEventListener("abort", interrupt, { once: true });
    timer = setTimeout(() => { timedOut = true; interrupt(); }, timeoutMs);
    const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
    if (mediaOptions) {
      await page.exposeFunction("__threejsonWriteMediaChunk", (position, data) => onOutput?.(position, new Uint8Array(data)));
      await page.exposeFunction("__threejsonMediaProgress", (progress) => onProgress?.(progress));
    }
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" && /shader|WebGL|GL_INVALID|compile|linkProgram/i.test(message.text())) errors.push(message.text()); });
    page.on("requestfailed", (request) => resourceFailures.push({ url: request.url(), error: request.failure()?.errorText }));
    page.on("response", (response) => { if (response.status() >= 400) resourceFailures.push({ url: response.url(), status: response.status() }); });
    await page.goto(`http://127.0.0.1:${server.address().port}${prefix}`);
    const result = await page.evaluate(async ({ json, prefix, capabilities, screenshot, mediaOptions }) => {
      const allowed = { modeling: "core/modeling/index.js", complexMesh: "core/builder/complexMeshCapability.js", webgpu: "webgpu/index.js", postprocessing: "core/builder/postprocess/webglAdvancedPasses.js" };
      for (const capability of capabilities) { if (!allowed[capability]) throw new Error(`Unsupported verifier capability: ${capability}`); await import(`${prefix}engine/${allowed[capability]}`); }
      if (mediaOptions) {
        // CLI is an application host, not the lightweight engine entry. Register
        // bundled domains here so existing room/port/stat scenes retain meaning.
        await import(`${prefix}engine/builtins/register.js`);
        const media = await import("@threejson/media-kit"), format = mediaOptions.format || "mp4";
        const input = json.archiveBytes ? new Uint8Array(json.archiveBytes) : json;
        const send = async (position, data) => { for (let start = 0; start < data.length; start += 65536) await window.__threejsonWriteMediaChunk(position+start, [...data.subarray(start,start+65536)]); };
        const options = { ...mediaOptions, onProgress: (progress) => window.__threejsonMediaProgress(progress), baseUrl: `${location.origin}${prefix}workspace/` };
        let result;
        if (["png", "jpeg", "webp"].includes(format)) result = await media.renderImage(input, { ...options, type: `image/${format}` });
        else if (format === "gif") result = await media.renderGif(input, options);
        else result = await media.renderVideo(input, { ...options, writable: new WritableStream({ write: (chunk) => send(chunk.position, chunk.data) }) });
        if (result.blob) await send(0, new Uint8Array(await result.blob.arrayBuffer()));
        return { ok: true, status: "rendered", ...result, blob: undefined, checks: { render: "passed" } };
      }
      const { createRuntimeSceneSession, createSceneOperationService } = await import(`${prefix}engine/core/session.js`);
      let session;
      try {
        session = await createRuntimeSceneSession(json, { canvas: document.getElementById("canvas"), viewportSize: { width: 640, height: 480 }, assetsBase: `${location.origin}${prefix}workspace/`, autoStart: false });
        const service = createSceneOperationService({ session });
        const capture = await service.execute({ op: "scene.capture" });
        const data = capture.results?.[0]?.data ? structuredClone(capture.results[0].data) : null;
        if (!screenshot && data?.views) data.views = data.views.map(({ dataUrl, ...view }) => view);
        return { ok: capture.ok, status: capture.ok ? "verified" : "failed", capture: data || null, error: capture.error, checks: { structure: "passed", geometry: "passed", render: capture.ok ? "passed" : "failed", resources: data?.observation?.resources?.status || "unchecked" } };
      } finally { session?.dispose(); }
    }, { json, prefix, capabilities, screenshot, mediaOptions });
    return { ...result, ...(errors.length ? { status: "failed", checks: { ...result.checks, render: "failed" } } : {}), browserErrors: errors, resourceFailures, ok: result.ok && errors.length === 0 };
  } catch (error) {
    return { ok: false, status: signal?.aborted ? "cancelled" : browser ? "failed" : "unavailable", code: signal?.aborted ? "ABORTED" : timedOut ? "BROWSER_TIMEOUT" : browser ? "BROWSER_SCENE_FAILED" : "BROWSER_UNAVAILABLE", error: timedOut ? `Browser verification exceeded ${timeoutMs} ms.` : error.message, checks: { render: "unchecked" }, browserErrors: errors, resourceFailures };
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", interrupt); await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
}

export function verifySceneInBrowser(options = {}) { return runSceneBrowserTask(options); }
export function renderMediaInBrowser(options = {}) { return runSceneBrowserTask({ ...options, mediaOptions: options.mediaOptions || {}, timeoutMs: options.timeoutMs ?? 600000 }); }
