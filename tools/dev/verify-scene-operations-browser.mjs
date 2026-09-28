/** Opt-in integration checks; uses an installed browser, never a paid model. */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";
import { startEditorBridge, callEditorBridge } from "../../packages/scene-tools/js/editor-bridge.js";
import { verifySceneInBrowser } from "../../packages/scene-tools/js/browser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executablePath = process.env.THREEJSON_BROWSER;
if (!executablePath) throw new Error("Set THREEJSON_BROWSER to an installed Chromium/Edge executable; no browser is downloaded.");
const output = path.join(root, "dist/scene-operation-check"); await mkdir(output, { recursive: true });
const { server, port } = await startStaticServer(root), origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ executablePath, headless: true });
const report = [];
try {
  const cube = await verifySceneInBrowser({ json: { objectList: [{ objType: "box", threeJsonId: "box", material: { type: "basic", color: "#44aaff" } }] }, executablePath });
  report.push({ name: "browser-tool-cube", ...cube }); console.log(JSON.stringify(report.at(-1)));
  for (const name of ["room-show.html", "port-show.html", "examples/html-demo/track-04-interaction/04-03-fps-walk.html", "examples/html-demo/track-00-runtime/00-08-scene-intro.html", "examples/html-demo/track-01-geometry/01-09-computable-modeling.html", "examples/html-demo/track-02-visual-fx/02-10-particle-v2-sources.html", "tools/scene-host/editor/index.html"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    const errors = [], networkFailures = []; let bridge;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => networkFailures.push({ url: request.url(), error: request.failure()?.errorText }));
    const item = { name, errors, networkFailures };
    try {
      await page.goto(`${origin}/${name}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      if (name.includes("/editor/")) {
        await page.locator("#emptyStateNewBtn").click();
        await page.locator("#emptyStateNewBtn").waitFor({ state: "hidden" });
      }
      if (name.includes("01-09-computable-modeling")) await page.locator("#apply:not([disabled])").waitFor({ state: "visible", timeout: 45000 });
      await page.waitForFunction(() => [...document.querySelectorAll("canvas")].some((c) => c.width > 10 && c.height > 10 && c.getBoundingClientRect().width > 10), { timeout: 30000 });
      if (await page.locator("#loadingMask").count()) await page.locator("#loadingMask").waitFor({ state: "hidden", timeout: 30000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      item.canvases = await page.locator("canvas").evaluateAll((list) => list.map((c) => ({ width: c.width, height: c.height })));
      if (name.includes("/editor/")) {
        bridge = await startEditorBridge({ origin });
        await page.locator("#menuExternalSceneTools").evaluate((button) => { button.closest("details").open = true; });
        await page.locator("#menuExternalSceneTools").click();
        await page.locator("#scenePresetNameInput").fill(bridge.pairingUrl);
        await page.locator("#scenePresetNameConfirmBtn").click();
        await page.waitForFunction(() => document.getElementById("menuExternalSceneTools").textContent.includes("断开"));
        const call = async (method, params) => {
          const submitted = await callEditorBridge({ url: bridge.url, token: bridge.agentToken, method, params });
          if (!submitted.ok) throw new Error(JSON.stringify(submitted));
          for (const deadline = Date.now() + 10000; Date.now() < deadline;) {
            const reply = await callEditorBridge({ url: bridge.url, token: bridge.agentToken, requestId: submitted.requestId });
            if (reply.status === "completed") return reply.result;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error("Editor bridge result timed out.");
        };
        const discovery = await call("discover"), sessionId = discovery.sessionId;
        const before = await call("export", { sessionId });
        const receipt = await call("execute", { sessionId, baseRevision: discovery.revision,
          commands: [{ op: "object.add", args: { descriptor: { objType: "box", threeJsonId: "bridge-smoke", position: [2, 1, 0] } } }] });
        if (!receipt.ok || !receipt.sceneMutated) throw new Error(JSON.stringify(receipt));
        const undo = await call("undo", { sessionId, baseRevision: receipt.afterRevision });
        const after = await call("export", { sessionId });
        item.bridge = { applied: receipt.ok, undo: undo.ok, sourceRestored: JSON.stringify(before.json) === JSON.stringify(after.json) };
        if (!item.bridge.undo || !item.bridge.sourceRestored) throw new Error("Editor undo did not restore the original source.");
      }
      item.ok = errors.length === 0;
    } catch (error) { item.ok = false; item.failure = error.message; }
    finally {
      item.screenshot = path.join(output, name.replaceAll("/", "_") + ".png");
      await page.screenshot({ path: item.screenshot }).catch(() => {});
      await bridge?.close(); await page.close(); report.push(item); console.log(JSON.stringify(item));
    }
  }
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
}
if (report.some((item) => !item.ok)) process.exitCode = 1;
