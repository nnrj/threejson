// Local browser regression. Build apps/threebox first; no provider or public network is used.
// THREEJSON_BROWSER should point to an installed Chromium/Edge executable.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/mobile-drawer", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const servers = [], report = [], errors = [];
let browser;

async function isOpen(page, open) {
  await page.waitForFunction(expected => document.getElementById("rootContainer").classList.contains("leftDockPeek") === expected, open);
  if (open) await page.waitForFunction(() => Math.abs(document.getElementById("leftDock").getBoundingClientRect().x) < 1);
}

async function inspectMobile(page, label, width, locale) {
  await page.setViewportSize({ width, height: 844 });
  const menu = page.locator(".mobileMenuBtn");
  await menu.tap();
  await isOpen(page, true);
  assert.equal(await page.locator(".threeboxNotificationBell").isVisible(), false, "The floating notification bell must not obscure dismissal controls.");
  assert.equal(await page.locator(".threeboxNotificationInbox").isVisible(), false);
  const layout = await page.evaluate(() => {
    const dock = document.getElementById("leftDock").getBoundingClientRect();
    const menu = document.querySelector(".mobileMenuBtn").getBoundingClientRect();
    const hint = document.querySelector(".sidebarHistoryEmptyCompact");
    return {
      viewport: innerWidth, dockWidth: dock.width, backdropWidth: innerWidth - dock.right,
      menuWidth: menu.width, menuRight: menu.right,
      empty: hint?.innerText, compactVisible: hint && getComputedStyle(hint).display !== "none",
      fullHidden: getComputedStyle(document.querySelector(".sidebarHistoryEmptyFull")).display === "none",
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth
    };
  });
  const hit = await page.evaluate(width => {
    const backdrop = document.querySelector(".mobileDockBackdrop");
    return { bounds: backdrop.getBoundingClientRect().toJSON(), display: getComputedStyle(backdrop).display, pointerEvents: getComputedStyle(backdrop).pointerEvents,
      host: document.getElementById("leftFlyoutHost").getBoundingClientRect().toJSON(), target: document.elementFromPoint(width - 24, 410)?.className };
  }, width);
  assert.ok(layout.dockWidth <= 288, JSON.stringify(layout));
  assert.ok(layout.backdropWidth >= 64, JSON.stringify(layout));
  assert.ok(layout.menuRight <= width && layout.menuWidth >= 44, JSON.stringify(layout));
  assert.equal(layout.empty, locale === "zh-CN" ? "暂无历史记录" : "No chat history yet.");
  assert.equal(layout.compactVisible, true);
  assert.equal(layout.fullHidden, true);
  assert.equal(layout.horizontalOverflow, false);
  assert.equal(hit.target, "mobileDockBackdrop", "The backdrop covers the entire dismissal strip without waiting for a width animation.");
  report.push({ label, locale, ...layout, hit });
  if ([320, 424].includes(width)) await page.screenshot({ path: path.join(output, `${label}-${locale}-${width}.png`) });
  // Place a real chat-side control under the dismissal strip to detect click-through.
  await page.evaluate(() => {
    window.drawerUnderlyingClicks = 0;
    window.drawerTapEvents = [];
    const button = document.createElement("button");
    button.id = "drawer-underlying-test";
    Object.assign(button.style, { position: "absolute", right: "0", top: "380px", width: "64px", height: "80px" });
    button.addEventListener("click", () => { window.drawerUnderlyingClicks += 1; });
    document.getElementById("mainArea").append(button);
    for (const type of ["pointerdown", "pointerup", "click"]) {
      document.addEventListener(type, event => window.drawerTapEvents.push({ type, target: event.target.id || event.target.className }), { once: true, capture: true });
    }
  });
  await page.touchscreen.tap(width - 24, 410);
  await isOpen(page, false);
  assert.equal(await page.locator(".threeboxNotificationBell").isVisible(), true, "Notifications return after dismissal.");
  assert.equal(await page.evaluate(() => window.drawerUnderlyingClicks), 0, `${label}: backdrop must consume the tap: ${JSON.stringify(await page.evaluate(() => window.drawerTapEvents))}`);
  await page.locator("#drawer-underlying-test").evaluate(node => node.remove());
  // The menu button must also remain fully reachable when open.
  await menu.tap(); await isOpen(page, true);
  await menu.tap(); await isOpen(page, false);
  await menu.tap(); await isOpen(page, true);
  await page.keyboard.press("Escape"); await isOpen(page, false);
}

try {
  assert.ok(process.env.THREEJSON_BROWSER, "Set THREEJSON_BROWSER to an installed browser.");
  const native = await startStaticServer(root);
  servers.push(native.server);
  const react = await startStaticServer(path.join(root, "apps/threebox/dist"), "/index.html");
  servers.push(react.server);
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER, headless: true });
  for (const label of ["native", "react"]) {
    for (const locale of ["zh-CN", "en-US"]) {
      const context = await browser.newContext({ viewport: { width: 320, height: 844 }, hasTouch: true, isMobile: true, locale });
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.hostname !== "127.0.0.1") return route.abort();
        // Exercise the native shell in isolation, including its pre-bootstrap menu. Do not
        // load renderers, thumbnails or AI; the production chrome/sidebar modules are used below.
        if (url.pathname.endsWith("/js/threeBoxApp.js")) return route.fulfill({ contentType: "text/javascript", body: "" });
        return route.continue();
      });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(`${label}/${locale}: ${error.message}`));
      const url = label === "native"
        ? `http://127.0.0.1:${native.port}/tools/scene-host/threebox/index.html`
        : `http://127.0.0.1:${react.port}/index.html`;
      await page.goto(url, { waitUntil: "load" });
      if (label === "react") {
        // Decline first-run trial-provider consent in this throwaway profile; no account or
        // API call is needed for layout testing.
        await page.locator(".builtinPrivacyDecline").tap();
        await page.waitForSelector(".builtinPrivacyOverlay", { state: "hidden" });
        // The normal decline flow offers custom provider settings; close without saving.
        await page.waitForSelector("#settingsModal", { state: "visible" });
        await page.keyboard.press("Escape");
        await page.waitForSelector("#settingsModal", { state: "hidden" });
      }
      if (label === "native") {
        // Opening and closing before heavy application bootstrap must work too.
        await page.locator(".mobileMenuBtn").tap(); await isOpen(page, true);
        await page.touchscreen.tap(296, 410); await isOpen(page, false);
        // Hand off an already open drawer without losing state or binding a duplicate toggle.
        await page.locator(".mobileMenuBtn").tap(); await isOpen(page, true);
        await page.evaluate(async locale => {
          const { initHostI18n } = await import("/tools/scene-host/shared/i18n/index.js");
          await initHostI18n(locale);
          const { createThreeBoxViewChrome } = await import("/tools/scene-host/threebox/js/threeBoxViewChrome.js");
          const chrome = createThreeBoxViewChrome(); chrome.init();
          const { createThreeBoxSidebar } = await import("/tools/scene-host/threebox/js/threeBoxSidebar.js");
          await createThreeBoxSidebar({ closeLeftDock: chrome.closeLeftDock }).init();
        }, locale);
        await isOpen(page, true);
        await page.touchscreen.tap(296, 410); await isOpen(page, false);
      }
      await page.waitForSelector(".sidebarHistoryEmptyCompact", { state: "attached" });
      await page.evaluate(() => {
        // Use the production notification styles without accepting a provider or requesting
        // notifications. These normally mount directly on body, outside the app root.
        for (const [tag, className] of [["button", "threeboxNotificationBell"], ["div", "threeboxNotificationInbox"]]) {
          const element = document.createElement(tag);
          element.className = className;
          element.textContent = "Notification test";
          document.body.append(element);
        }
      });
      for (const width of [280, 320, 360, 390, 424, 540, 720]) await inspectMobile(page, label, width, locale);
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.waitForFunction(() => document.getElementById("rootContainer").classList.contains("leftDockPinned"));
      await page.waitForFunction(() => document.getElementById("mainArea").getBoundingClientRect().x === 288);
      const desktop = await page.evaluate(() => ({
        width: document.getElementById("leftDock").getBoundingClientRect().width,
        backdropHidden: getComputedStyle(document.querySelector(".mobileDockBackdrop")).display === "none",
        fullVisible: getComputedStyle(document.querySelector(".sidebarHistoryEmptyFull")).display !== "none",
        compactHidden: getComputedStyle(document.querySelector(".sidebarHistoryEmptyCompact")).display === "none"
      }));
      assert.deepEqual(desktop, { width: 288, backdropHidden: true, fullVisible: true, compactHidden: true });
      // Resizing back to phone must collapse even a previously pinned desktop sidebar.
      await page.setViewportSize({ width: 320, height: 844 }); await isOpen(page, false);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Passed ${report.length} mobile viewport/locale/app combinations plus desktop and startup checks.`);
} finally {
  await browser?.close();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  await writeFile(path.join(output, "report.json"), JSON.stringify({ report, errors }, null, 2));
  console.log(`Report: ${output}`);
}
