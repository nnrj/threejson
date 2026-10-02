/** Local installed browser, real GPU shader compilation/pixels; no AI provider. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";
import { createCinematicFilm } from "./fixtures/cinematicFilm.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/cinematic-video", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const { server, port } = await startStaticServer(root);
let browser; const report = [], errors = [];
try {
  if (!process.env.THREEJSON_BROWSER) throw new Error("Set THREEJSON_BROWSER to an installed browser.");
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER, headless: true });
  const page = await browser.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && /shader|WebGL|GL_INVALID|compile|linkProgram/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/tools/scene-host/threebox/index.html`, { waitUntil: "domcontentloaded" });
  for (const count of [100000, 500000]) {
    const film = createCinematicFilm({ particles: count });
    // Check selective bloom as well as the regular bloom variant.
    if (count === 500000) Object.assign(film.scenes.cloud.objectList.find(o => o.id === "glow"), { passType: "selectivebloom", targets: ["cloud", "core"] });
    await page.evaluate(async film => {
      const { createMediaProject } = await import("@threejson/media-kit");
      window.__filmProject = await createMediaProject(film, { width: 960, height: 540 });
    }, film);
    try {
      const times = count === 100000 ? [3, 30, 57, 78, 105, 3] : [3, 4, 3];
      for (const time of times) {
        const result = await page.evaluate(async time => {
          const start = performance.now(), canvas = await window.__filmProject.renderAt(time), ctx = canvas.getContext("2d");
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let bright = 0, hash = 2166136261;
          for (let i = 0; i < pixels.length; i += 4) { if (pixels[i] > 100 || pixels[i+1] > 100 || pixels[i+2] > 100) bright++; hash = Math.imul(hash ^ pixels[i] ^ pixels[i+1] << 8 ^ pixels[i+2] << 16, 16777619); }
          return { time, bright, hash: hash >>> 0, elapsedMs: performance.now() - start, image: canvas.toDataURL("image/png") };
        }, time);
        assert.ok(result.bright > 500, `Shot at ${time}s must have visible pixels.`);
        await writeFile(path.join(output, `${count}-${time}.png`), Buffer.from(result.image.split(",")[1], "base64"));
        delete result.image; report.push({ count, ...result }); console.log(JSON.stringify(report.at(-1)));
      }
      if (count === 100000) assert.equal(report[0].hash, report[5].hash, "Seeking back must reproduce exactly the same frame.");
    } finally { await page.evaluate(() => window.__filmProject.dispose()); }
  }
  const isolation = await page.evaluate(async () => {
    const { createMediaProject } = await import("@threejson/media-kit");
    const base = { sceneConfig: { scene: { background: "#000000" }, renderer: { toneMapping: "none" }, camera: { position: { x: 0, y: 0, z: 10 } }, controls: { type: "none" } }, objectList: [
      { objType: "text", threeJsonId: "text", mode: "sdf", content: "清晰文字 SDF", fontSize: .6, color: "#ffffff", anchor: { x: .5, y: .5 }, sdf: { outlineWidth: .02, outlineColor: "#66aacc" } },
      { objType: "pass", id: "output", passType: "output" }], timeline: { duration: 1 } };
    const pixels = [];
    for (const bloom of [false, true]) {
      const scene = structuredClone(base);
      if (bloom) scene.objectList.splice(1, 0, { objType: "pass", id: "bloom", passType: "selectivebloom", targets: [], strength: 5, threshold: 0, radius: 1 });
      const project = await createMediaProject(scene, { width: 320, height: 180 });
      try { await project.renderAt(0); pixels.push(project.canvas.getContext("2d").getImageData(0, 0, 320, 180).data); } finally { project.dispose(); }
    }
    let difference = 0; for (let i = 0; i < pixels[0].length; i++) difference += Math.abs(pixels[0][i] - pixels[1][i]);
    return { unselectedSdfMeanDifference: difference / pixels[0].length };
  });
  report.push(isolation); assert.ok(isolation.unselectedSdfMeanDifference < .01, JSON.stringify(isolation));
  const transitionResult = await page.evaluate(async () => {
    const { createMediaTransitions } = await import("/packages/media-kit/js/transitions.js");
    const canvas = document.createElement("canvas"); canvas.width = 96; canvas.height = 54;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const transitions = createMediaTransitions(() => document.createElement("canvas"), 96, 54);
    const render = (type, time) => {
      ctx.fillStyle = "red"; ctx.fillRect(0, 0, 96, 54);
      const layer = transitions.layer(), target = layer.getContext("2d"); target.fillStyle = "blue"; target.fillRect(0, 0, 96, 54);
      transitions.draw(ctx, layer, { localTime: time, transitionIn: { type, direction: "left", duration: 1, seed: 7, softness: 0 } });
      const data = ctx.getImageData(0, 0, 96, 54).data; let blue = 0, hash = 0;
      for (let i = 0; i < data.length; i += 4) { if (data[i + 2] > 200) blue++; hash = Math.imul(hash ^ data[i] ^ data[i+2] << 8, 16777619); }
      return { blue, hash };
    };
    try { return { wipe: [render("wipe", 0), render("wipe", .5), render("wipe", 1)], dissolve: [render("dissolve", .5), render("dissolve", .8), render("dissolve", .5)] }; }
    finally { transitions.dispose(); }
  });
  assert.deepEqual(transitionResult.wipe.map(r => r.blue), [0, 96 * 54 / 2, 96 * 54]);
  assert.ok(Math.abs(transitionResult.dissolve[0].blue / (96 * 54) - .5) < .05);
  assert.equal(transitionResult.dissolve[0].hash, transitionResult.dissolve[2].hash);
  report.push({ transitions: transitionResult });
  assert.deepEqual(errors, [], "No shader/page errors are allowed.");
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify({ report, errors }, null, 2)); console.log(`Report: ${output}`);
}
