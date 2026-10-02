/** Explicit, offline 1080p/30fps long-film verification. Uses an installed browser. */
import assert from "node:assert/strict";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";
import { createCinematicFilm } from "./fixtures/cinematicFilm.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/cinematic-export", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const { server, port } = await startStaticServer(root);
let browser, handle; const results = [], errors = [];
try {
  if (!process.env.THREEJSON_BROWSER) throw new Error("Set THREEJSON_BROWSER to an installed browser.");
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER, headless: true });
  const page = await browser.newPage();
  page.on("pageerror", e => errors.push(e.message));
  await page.exposeFunction("writeVideoChunk", async ({ position, data }) => {
    const buffer = Buffer.from(data, "base64"); let offset = 0;
    while (offset < buffer.length) offset += (await handle.write(buffer, offset, buffer.length - offset, position + offset)).bytesWritten;
  });
  await page.exposeFunction("exportProgress", info => console.log(JSON.stringify(info)));
  await page.goto(`http://127.0.0.1:${port}/tools/scene-host/threebox/index.html`, { waitUntil: "domcontentloaded" });
  for (const duration of [120, 300]) {
    const file = path.join(output, `${duration}s-1080p.mp4`); handle = await open(file, "wx");
    const result = await page.evaluate(async film => {
      const kit = await import("@threejson/media-kit"), start = performance.now();
      const writable = new WritableStream({ async write(chunk) {
        const bytes = chunk.data, parts = [];
        for (let i = 0; i < bytes.length; i += 8192) parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
        await window.writeVideoChunk({ position: chunk.position, data: btoa(parts.join("")) });
      } });
      const result = await kit.renderVideo(film, { writable, audio: false, format: "mp4", width: 1920, height: 1080, fps: 30,
        onProgress(info) { if (info.frame % 300 === 0) window.exportProgress({ duration: film.timeline.duration, frame: info.frame, frames: info.frames }); } });
      return { ...result, elapsedMs: performance.now() - start };
    }, createCinematicFilm({ duration, particles: 100000 }));
    await handle.close(); handle = null;
    // Inspect the encoded artifact, not just the requested export options.
    const metadata = await page.evaluate(async url => {
      const video = document.createElement("video"); video.preload = "metadata";
      try {
        await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error("Encoded video cannot be opened.")); video.src = url; });
        return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
      } finally { video.removeAttribute("src"); video.load(); }
    }, `http://127.0.0.1:${port}/${path.relative(root, file).replaceAll("\\", "/")}`);
    assert.equal(result.blob, null, "Export must stream, not retain a full file buffer.");
    assert.equal(result.frames, duration * 30); assert.equal(metadata.width, 1920); assert.equal(metadata.height, 1080);
    assert.ok(Math.abs(metadata.duration - duration) < .1);
    results.push({ ...result, metadata, file }); console.log(JSON.stringify(results.at(-1)));
  }
  assert.deepEqual(errors, []);
} finally {
  await handle?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify({ results, errors }, null, 2)); console.log(`Report: ${output}`);
}
