/** Real native ThreeBox card + SDF fill/outline timeline regression. No AI calls.
 * THREEJSON_BROWSER=installed browser; optional first argument: a scene JSON file.
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executablePath = process.env.THREEJSON_BROWSER;
if (!executablePath) throw new Error("Set THREEJSON_BROWSER to an installed browser.");
const output = path.join(root, "dist/timeline-material-check", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const samples = [{ name: "outlined-billboard", json: {
  sceneConfig: { scene: { background: "#05070f" }, camera: { position: { x: 0, y: 0, z: 10 }, lookAt: { x: 0, y: 0, z: 0 } }, controls: { enabled: false } },
  objectList: [{ threeJsonId: "title-text", objType: "text", content: "双缝干涉 ThreeJSON", mode: "sdf", fontSize: .65, color: "#ffffff", billboard: true, anchor: { x: .5, y: .5 }, sdf: { outlineWidth: .04, outlineColor: "#cc4488" } }],
  timeline: { duration: 4, tracks: [
    { id: "title-in", target: "title-text", property: "material.opacity", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }, { time: 3, value: 1 }, { time: 4, value: 0 }] },
    { id: "camera", target: "$camera", property: "position", keyframes: [{ time: 0, value: [0, 0, 10] }] },
    { id: "aim", target: "$camera", property: "lookAt", keyframes: [{ time: 0, value: [0, 0, 0] }] }
  ] }
} }];
if (process.argv[2]) samples.push({ name: "input-scene", json: JSON.parse(await readFile(path.resolve(process.argv[2]), "utf8")) });
const { server, port } = await startStaticServer(root);
let browser;
const report = [];
try {
  browser = await chromium.launch({ executablePath, headless: true });
  for (const sample of samples) {
    const page = await browser.newPage({ viewport: { width: 1120, height: 760 } });
    const errors = [], item = { name: sample.name, errors };
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(`http://127.0.0.1:${port}/tools/scene-host/threebox/index.html`, { waitUntil: "domcontentloaded" });
      item.loaded = await page.evaluate(async (json) => {
        const { createThreeBoxSceneCard } = await import("/tools/scene-host/threebox/js/threeBoxSceneCard.js");
        const card = createThreeBoxSceneCard({ previewAuxiliaryLights: false });
        const mount = document.createElement("div");
        Object.assign(mount.style, { position: "fixed", inset: "20px", zIndex: "10000", background: "#05070f" });
        mount.append(card.el); document.body.append(mount);
        await card.render(json, { authoritative: true });
        const runtime = card.getRuntime(); runtime.timeline.pause(); runtime.renderLoop.stop();
        window.__materialRegression = { card, runtime, original: await card.exportSceneJsonString() };
        const text = [];
        runtime.scene.traverse(object => { if (typeof object.sync === "function" && "textRenderInfo" in object) text.push({ text: object.text, glyphs: object.textRenderInfo?.glyphBounds?.length, materials: [].concat(object.material).length }); });
        return { duration: runtime.timeline.duration, text };
      }, sample.json);
      assert.ok(item.loaded.text.length > 0, "Must use real SDF text, not texture fallback.");
      assert.ok(item.loaded.text.some(t => t.materials === 2), "Both outline and fill must be present.");
      assert.ok(item.loaded.text.every(t => t.glyphs > 0), "All glyphs must be ready before playback.");
      const track = sample.json.timeline.tracks.find(t => t.property === "material.opacity");
      const last = track.keyframes.at(-1).time, firstVisible = track.keyframes.find(f => f.value === 1).time;
      item.frames = [];
      for (const time of [0, firstVisible / 2, firstVisible, last, firstVisible]) {
        const state = await page.evaluate(async ({ time, track }) => {
          const { runtime, card } = window.__materialRegression;
          await runtime.timeline.renderAt(time);
          const { sampleTimelineTrack } = await import("/core/timeline/tracks.js");
          const expected = sampleTimelineTrack(track, time), matches = [];
          runtime.scene.traverse(object => { if ((object.userData?.threeJsonId || object.userData?.objJson?.threeJsonId) === track.target) matches.push(object); });
          const opacities = [], glyphs = [];
          matches[0].traverse(object => {
            if (object.material) opacities.push(...[].concat(object.material).map(m => m.opacity));
            if (typeof object.sync === "function" && "textRenderInfo" in object) glyphs.push(object.textRenderInfo?.glyphBounds?.length);
          });
          // Capture synchronously after drawing; do not rely on preserveDrawingBuffer.
          runtime.renderLoop.renderCurrentFrame();
          const data = card.canvas.toDataURL("image/png");
          const image = new Image(); image.src = data; await image.decode();
          const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
          const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let brightPixels = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 100 || pixels[i+1] > 100 || pixels[i+2] > 100) brightPixels++;
          return { time, expected, opacities, glyphs, brightPixels };
        }, { time, track });
        assert.ok(state.opacities.length >= 2);
        assert.ok(state.opacities.every(value => Math.abs(value - state.expected) < 1e-7), JSON.stringify(state));
        item.frames.push(state);
        if (time === firstVisible) await page.screenshot({ path: path.join(output, `${sample.name}.png`) });
      }
      if (sample.name === "outlined-billboard") {
        assert.equal(item.frames[0].brightPixels, 0, "Opacity zero must hide fill and outline.");
        assert.ok(item.frames[2].brightPixels > 100, "Visible keyframe must actually render text pixels.");
        assert.equal(item.frames[3].brightPixels, 0);
        assert.equal(item.frames[2].brightPixels, item.frames[4].brightPixels, "Backward seek must reproduce the frame.");
      }
      item.sourcePreserved = await page.evaluate(async () => await window.__materialRegression.card.exportSceneJsonString() === window.__materialRegression.original);
      assert.ok(item.sourcePreserved, "Playback must not write its poses back to the document.");
      await page.evaluate(() => window.__materialRegression.card.dispose());
      assert.deepEqual(errors, []);
      item.ok = true;
    } catch (error) { item.ok = false; item.error = error.stack; }
    finally { await page.close(); report.push(item); console.log(JSON.stringify(item)); }
  }
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
}
console.log(`Report: ${output}`);
if (report.some(item => !item.ok)) process.exitCode = 1;
