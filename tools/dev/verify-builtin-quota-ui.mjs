/** Offline browser regression. All account data and mutations are local fixtures;
 * external requests are blocked. Requires a local three-box-dashboard build. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
const threeRoot = path.resolve(root, "..");
const dashboard = path.join(threeRoot, "three-box-dashboard/dist");
for (const name of ["builtinQuotaPresentation.js", "builtinQuotaPresentation.d.ts"]) {
  // Cloud is independently published against older packages. Its compatibility copy
  // must remain byte-equivalent to the shared host source until that dependency moves.
  const shared = await readFile(path.join(root, "tools/scene-host/shared/js", name), "utf8");
  const cloud = await readFile(path.join(threeRoot, "threebox-cloud/src/lib", name), "utf8");
  assert.equal(cloud.replaceAll("\r\n", "\n"), shared.replaceAll("\r\n", "\n"));
}
const out = path.join(root, "dist/builtin-quota-ui");
await mkdir(out, { recursive: true });
const quota = { mode: "device", roundsUsed: 248, roundsLimit: 50030, costUsedUsdCents: 100, costLimitUsdCents: 100, exhausted: ["cost"] };
const device = { deviceId: "test-device", shortId: "TB-QUOTATEST0", status: "active", ...quota, firstSeenAt: Date.now(), lastSeenAt: Date.now(), clientSurfaces: ["threebox"] };
let offlineQuota = false, topUpCalls = [];
const grants = new Map();
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/ThreeJSON/tools/scene-host/threebox/css/threebox.css">
<div id="settingsModal" class="modalOverlay" role="dialog" hidden><div class="modalDialog settingsDialog"><div class="modalHeader">设置</div>
<div class="settingsBody"><nav class="settingsNav" id="settingsNav"></nav><div class="settingsScroll" id="settingsScroll"></div></div>
<div class="modalFooter"><button id="settingsCancelBtn">取消</button><button id="settingsSaveBtn">保存</button></div></div></div>
<script type="module">
import { createThreeBoxSettingsModal } from '/ThreeJSON/tools/scene-host/threebox/js/threeBoxSettingsModal.js';
import { setBuiltinPrivacyDecision } from '/ThreeJSON/tools/scene-host/shared/js/builtinProviderPrivacy.js';
import { loadHostLocaleCatalog } from '/ThreeJSON/tools/scene-host/shared/i18n/index.js';
await loadHostLocaleCatalog('zh-CN'); setBuiltinPrivacyDecision('threebox','accepted');
window.settingsController = createThreeBoxSettingsModal();
settingsController.updateSettings(draft => {
  draft.ai.builtinBackendUrl = location.origin;
  const provider = draft.ai.providers.find(p => p.provider === 'threebox-builtin');
  provider.apiKey = 'local-fixture'; provider.builtinShortId = 'TB-QUOTATEST0'; provider.builtinQuota = ${JSON.stringify(quota)};
}, { notify:false, toast:false });
settingsController.init(); settingsController.open('ai');
</script></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const json = (body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (url.pathname === "/quota-fixture") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(fixture); return; }
  if (url.pathname === "/v1/quota") return json({ quota, shortId: device.shortId }, offlineQuota ? 503 : 200);
  if (url.pathname === "/v1/capabilities") return json({ models: { enabled: false } });
  if (url.pathname === "/admin/auth/me") return json({ username: "offline-test-admin" });
  if (url.pathname === "/admin/stats/overview") return json({ totalDevices: 1, activeDevicesLast24h: 1, bannedDevices: 0, roundsLast24h: 0, costUsdCentsLast24h: 0, pendingModerationFlags: 0 });
  if (url.pathname === "/admin/stats/usage") return json([]);
  if (url.pathname === "/admin/devices") return json({ items: [device], total: 1, page: 1, pageSize: 20 });
  if (url.pathname === "/admin/devices/test-device") return json({ device, usage: [], sameIpDevices: [], moderationFlags: [], user: null });
  if (url.pathname === "/admin/devices/test-device/quota/topup") {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); topUpCalls.push(body);
    if (!grants.has(body.idempotencyKey)) {
      grants.set(body.idempotencyKey, body.amountUsdCents); device.costLimitUsdCents += body.amountUsdCents;
      // Simulate the grant succeeding but the client losing its success response.
      return json({ error: "TEST_RESPONSE_LOST", message: "local test: retry the same grant" }, 503);
    }
    return json({ ok: true, alreadyApplied: true });
  }
  try {
    const base = url.pathname.startsWith("/ThreeJSON/") ? threeRoot : dashboard;
    const target = path.resolve(base, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
    if (!target.startsWith(base + path.sep)) { res.writeHead(403); res.end(); return; }
    const type = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json" }[path.extname(target)] || "application/octet-stream";
    const content = await readFile(target);
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` }); res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: process.env.THREEJSON_TEST_BROWSER || (process.platform === "win32" ? "msedge" : undefined) });
try {
  const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 900 } });
  await context.route("**/*", async route => {
    if (route.request().url().startsWith(origin + "/")) return route.continue();
    // Dashboard builds may embed a production API base. Never contact it: route only
    // its admin path to our in-memory fixture, including all POST mutations.
    const url = new URL(route.request().url());
    const adminStart = url.pathname.indexOf("/admin/");
    if (adminStart >= 0) {
      const response = await fetch(origin + url.pathname.slice(adminStart) + url.search, {
        method: route.request().method(), body: route.request().postData(), headers: { "Content-Type": "application/json" }
      });
      return route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
    }
    return route.abort();
  });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/quota-fixture`);
  const card = page.locator(".providerCardBuiltin");
  await card.getByText(/剩余 49782 轮/).waitFor();
  assert.match(await card.innerText(), /金额（USD）：已用 \$1\.00/);
  assert.match(await card.innerText(), /TB-QUOTATEST0/);
  await page.screenshot({ path: path.join(out, "settings-desktop.png") });
  await page.setViewportSize({ width: 360, height: 800 });
  const bounds = await card.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 360, "quota card fits a narrow viewport");
  await page.screenshot({ path: path.join(out, "settings-mobile.png") });
  offlineQuota = true;
  await page.evaluate(() => settingsController.open("ai"));
  await card.getByText(/并非实时余额/).waitFor();
  await page.screenshot({ path: path.join(out, "settings-offline.png") });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => { localStorage.setItem("threebox.currency", "CNY"); localStorage.setItem("threebox.usdToCnyRate", "7.2"); });
  await page.goto(origin);
  await page.getByRole("button", { name: "设备 / 用户", exact: true }).click();
  await page.getByRole("cell", { name: device.shortId, exact: true }).click();
  const input = page.getByLabel("充值金额额度（CNY）");
  await input.fill("14.4");
  page.on("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "充值金额额度", exact: true }).click();
  await page.getByText("local test: retry the same grant", { exact: true }).waitFor({ state: "attached" });
  await page.getByRole("button", { name: "充值金额额度", exact: true }).click();
  await page.getByText(/已增加.*金额额度，原有用量已保留/).waitFor({ state: "attached" });
  assert.equal(topUpCalls.length, 2);
  assert.equal(topUpCalls[0].idempotencyKey, topUpCalls[1].idempotencyKey);
  assert.equal(topUpCalls[0].amountUsdCents, 200);
  assert.equal(device.costLimitUsdCents, 300);
  assert.equal(device.costUsedUsdCents, 100);
  await page.screenshot({ path: path.join(out, "dashboard-topup.png") });
  assert.deepEqual(errors, []);
  console.log(`PASS: desktop/mobile quota, offline cache warning, CNY conversion and safe top-up retry. Screenshots: ${out}`);
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
