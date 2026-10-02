/** Installed-browser integration: real examples, mobile controls and model cache UI. */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const executablePath = process.env.THREEJSON_BROWSER;
if (!executablePath) throw new Error("Set THREEJSON_BROWSER to an installed browser.");
const output = path.join(root, "dist/media-studio-check", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const { server, port } = await startStaticServer(root);
const browser = await chromium.launch({ executablePath, headless: true });
const report = [];
try {
  for (const sample of ["particle-morph", "camera-product", "data-film", "composition"]) {
    const mobile = sample === "data-film", light = sample === "camera-product";
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1100, height: 820 } });
    const errors = [], requests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => requests.push(request.url()));
    const item = { sample, mobile, light, errors };
    try {
      await page.goto(`http://127.0.0.1:${port}/examples/html-demo/track-08-media/08-01-media-studio.html`);
      if (light) await page.addStyleTag({ content: ":root{color-scheme:light;--panel:#f7f7f8;--panel2:#e9eaed;--text:#20242a;--line:#8885}" });
      await page.locator("#sample").selectOption(sample); await page.locator("#open").click();
      await page.waitForFunction(() => [...document.querySelectorAll(".threejsonMediaStudio button")].some((button) => button.textContent === "播放" && !button.disabled), { timeout: 45000 });
      item.initialStatus = await page.locator(".mediaStatus").innerText();
      if (!/可播放/.test(item.initialStatus)) throw new Error(item.initialStatus);
      const slider = page.locator(".threejsonMediaStudio input[type=range]");
      const sampleTime = sample === "composition" ? 13 : sample === "particle-morph" ? 6 : 4;
      await slider.fill(String(sampleTime)); await slider.dispatchEvent("input");
      await page.waitForFunction((time) => document.querySelector(".threejsonMediaStudio output").textContent === `${time}.00 s`, sampleTime);
      await page.screenshot({ path: path.join(output, `${sample}.png`) });
      await page.getByText("可选语音模型与缓存", { exact: true }).click();
      await page.getByText("没有已缓存的模型。", { exact: true }).waitFor();
      item.overflow = await page.locator(".threejsonMediaStudio").evaluate((node) => node.scrollWidth > node.clientWidth + 2);
      if (item.overflow) throw new Error("Dialog overflows horizontally.");
      item.modelDownloads = requests.filter((url) => /\.(onnx|ort)(\?|$)/i.test(url));
      if (item.modelDownloads.length) throw new Error("Unexpected model download.");
      await page.getByRole("button", { name: "播放", exact: true }).click();
      await page.waitForFunction((time) => Number(document.querySelector(".threejsonMediaStudio output").textContent.replace(" s", "")) > time, sampleTime + .2);
      await page.getByRole("button", { name: "暂停", exact: true }).click();
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      item.ok = errors.length === 0;
    } catch (error) { item.ok = false; item.failure = error.message; item.status = await page.locator(".mediaStatus").innerText().catch(() => "unavailable"); }
    finally { await page.close(); report.push(item); console.log(JSON.stringify(item)); }
  }
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
  const errors = [], requests = [], native = { sample: "native-editor-optional-boundary", errors };
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  // Mirror the tested deploy allowlist: no unrelated workspace package is served.
  await page.route("**/packages/**", route => {
    const name = new URL(route.request().url()).pathname;
    if (/\/packages\/(?:audio-kit|media-kit)\/js\//.test(name) && !name.includes("/nodeModels") || /\/packages\/host-kit\/js\/(?:mediaStudio|audioModelPanel|localSpeech)\.js$/.test(name)) return route.continue();
    return route.abort("blockedbyclient");
  });
  try {
    await page.goto(`http://127.0.0.1:${port}/tools/scene-host/editor/index.html`);
    await page.locator("#emptyStateNewBtn").click();
    await page.locator("#emptyStateNewBtn").waitFor({ state: "hidden" });
    native.eagerMediaRequests = requests.filter(url => /\/packages\/(?:audio-kit|media-kit)\/|mediabunny|gifenc|\/core\/timeline\//.test(url));
    if (native.eagerMediaRequests.length) throw new Error("Ordinary scene eagerly loaded media dependencies.");
    await page.locator("#menuExportMedia").evaluate(button => button.closest("details").open = true);
    await page.locator(".topNestedTrigger").filter({ hasText: /^导出$/ }).hover();
    await page.locator("#menuExportMedia").click();
    await page.waitForFunction(() => [...document.querySelectorAll(".threejsonMediaStudio button")].some(button => button.textContent === "播放" && !button.disabled), { timeout: 45000 });
    native.status = await page.locator(".mediaStatus").innerText();
    if (!/可播放/.test(native.status)) throw new Error(native.status);
    native.palette = await page.locator(".threejsonMediaStudio").evaluate(node => ({ background: getComputedStyle(node).backgroundColor, text: getComputedStyle(node).color }));
    await page.screenshot({ path: path.join(output, "native-editor.png") });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    native.ok = errors.length === 0;
  } catch (error) { native.ok = false; native.failure = error.message; }
  finally { await page.close(); report.push(native); console.log(JSON.stringify(native)); }
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
}
console.log(`Report: ${output}`);
if (report.some((item) => !item.ok)) process.exitCode = 1;
