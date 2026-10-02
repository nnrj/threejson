import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";
import { createCinematicFilm } from "./fixtures/cinematicFilm.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/threebox-film", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const { server, port } = await startStaticServer(root); let browser;
const report = [], errors = [], requests = [];
try {
  if (!process.env.THREEJSON_BROWSER) throw new Error("Set THREEJSON_BROWSER to an installed browser.");
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER, headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", e => errors.push(e.message)); page.on("request", r => requests.push(r.url()));
  await page.goto(`http://127.0.0.1:${port}/tools/scene-host/threebox/index.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async film => {
    const { createThreeBoxSceneCard } = await import("/tools/scene-host/threebox/js/threeBoxSceneCard.js");
    const mount = document.createElement("div"); Object.assign(mount.style, { position: "fixed", inset: "8px", overflow: "auto", zIndex: 10000, background: "#05070f" }); document.body.append(mount);
    const a = createThreeBoxSceneCard(), b = createThreeBoxSceneCard(); mount.append(a.el, b.el);
    await a.render(film); const saved = await a.exportSceneJsonString();
    window.__filmCards = { a, b, saved, mount }; localStorage.setItem("film-test-snapshot", saved);
  }, createCinematicFilm({ particles: 3000 }));
  const slider = page.locator('input[aria-label="Video time"]');
  await slider.fill("54"); await slider.dispatchEvent("input");
  await page.waitForFunction(() => [...document.querySelectorAll("output")].some(n => n.textContent.startsWith("54.0 /")));
  await page.locator('button[title="Play / Pause"]').click();
  await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Video time"]').value) > 54.1);
  await page.locator('button[title="Play / Pause"]').click();
  report.push(await page.evaluate(async () => {
    const { a, b, saved, mount } = window.__filmCards;
    const film = JSON.parse(saved); film.scenes.cloud.sceneConfig.scene.background = "#123456";
    await b.render(film);
    const { sharedSceneViewportPool } = await import("/tools/scene-host/shared/js/sceneViewportPool.js");
    return { oldSourcePreserved: await a.exportSceneJsonString() === saved, pool: sharedSceneViewportPool.inspect(), activePlayers: mount.querySelectorAll('input[aria-label="Video time"]').length,
      overflow: mount.scrollWidth > mount.clientWidth + 2 };
  }));
  assert.equal(report[0].oldSourcePreserved, true); assert.equal(report[0].pool.active, 1); assert.equal(report[0].activePlayers, 1); assert.equal(report[0].overflow, false);
  await page.screenshot({ path: path.join(output, "mobile-history.png") });
  await page.evaluate(() => { window.__filmCards.a.dispose(); window.__filmCards.b.dispose(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  report.push(await page.evaluate(async () => {
    const { createThreeBoxSceneCard } = await import("/tools/scene-host/threebox/js/threeBoxSceneCard.js");
    const saved = localStorage.getItem("film-test-snapshot"), card = createThreeBoxSceneCard(); document.body.append(card.el);
    await card.render(JSON.parse(saved)); const correct = await card.exportSceneJsonString() === saved; card.dispose(); localStorage.removeItem("film-test-snapshot"); return { reloadPreserved: correct };
  }));
  assert.equal(report[1].reloadPreserved, true);
  assert.deepEqual(requests.filter(url => /\.(onnx|wasm)(?:[?#]|$)/.test(url)), [], "No narration model is downloaded implicitly.");
  assert.deepEqual(errors, []);
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify({ report, errors }, null, 2)); console.log(`Report: ${output}`);
}
