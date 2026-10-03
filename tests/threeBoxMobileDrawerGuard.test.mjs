import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("the early mobile menu waits for a completed click before opening the drawer", async () => {
  const html = await read("../tools/scene-host/threebox/index.html");
  assert.match(html, /button\.addEventListener\("click", onClick, true\)/);
  assert.doesNotMatch(html, /button\.addEventListener\("pointerdown", onPointerDown/);
});

test("the runtime mobile menu no longer opens during pointerdown", async () => {
  const source = await read("../tools/scene-host/threebox/js/threeBoxViewChrome.js");
  assert.doesNotMatch(source, /mobileMenuBtn\?\.addEventListener\("pointerdown"/);
  assert.match(source, /mobileMenuBtn\?\.addEventListener\("click"/);

  const guardIndex = source.indexOf("armMobileOpenGuard();");
  const openIndex = source.indexOf("leftDockPeek = true;", guardIndex);
  assert.ok(guardIndex >= 0);
  assert.ok(openIndex > guardIndex);
});

test("the freshly opened mobile drawer temporarily rejects pointer interaction", async () => {
  const css = await read("../tools/scene-host/threebox/css/threebox.css");
  assert.match(
    css,
    /#rootContainer\.mobileDockInteractionGuard \.leftDock\s*\{\s*pointer-events:\s*none;\s*\}/
  );
});

test("native and React mobile drawers share a bounded width and a tappable dismissal strip", async () => {
  const styles = await Promise.all([
    read("../tools/scene-host/threebox/css/threebox.css"),
    read("../apps/threebox/src/threebox.css")
  ]);
  for (const css of styles) {
    const mobile = css.slice(css.indexOf("@media (max-width: 720px)"));
    assert.match(mobile, /--leftDockWidth: min\(288px, calc\(100vw - 64px\)\)/);
    assert.match(mobile, /\.mobileMenuBtn \{[^}]*width: 44px; height: 44px;/);
    assert.match(mobile, /left: calc\(var\(--leftDockWidth\) \+ 8px\)/);
    assert.match(mobile, /\.mobileDockBackdrop \{[^}]*left: var\(--leftDockWidth\);[^}]*pointer-events: auto/s);
    assert.match(mobile, /\.flyoutHostLeft \{[^}]*transition: none;/);
    assert.match(mobile, /body:has\(#rootContainer\.leftDockPeek\) \.threeboxNotificationBell,/);
    assert.match(mobile, /body:has\(#rootContainer\.leftDockPeek\) \.threeboxNotificationInbox \{ visibility: hidden; \}/);
    assert.doesNotMatch(mobile, /88vw/);
    assert.match(mobile, /\.sidebarHistoryEmptyFull \{ display: none; \}/);
    assert.match(mobile, /\.sidebarHistoryEmptyCompact \{ display: inline; \}/);
  }
});

test("both startup and initialized shells consume backdrop clicks without activating the chat beneath", async () => {
  const html = await read("../tools/scene-host/threebox/index.html");
  const chrome = await read("../tools/scene-host/threebox/js/threeBoxViewChrome.js");
  const react = await read("../apps/threebox/src/App.jsx");
  assert.match(html, /id="mobileDockBackdrop"[^>]*type=|type="button"[^>]*id="mobileDockBackdrop"/);
  assert.match(html, /backdrop\?\.addEventListener\("click", onBackdropClick\)/);
  assert.match(html, /backdrop\?\.removeEventListener\("click", onBackdropClick\)/);
  assert.match(chrome, /mobileDockBackdrop\?\.addEventListener\("click",[\s\S]*?event\.stopPropagation\(\);[\s\S]*?closeLeftDock\(\)/);
  assert.match(react, /mobileDockBackdropRef\.current\?\.contains\(event\.target\)/);
  assert.match(react, /ref=\{mobileDockBackdropRef\}[\s\S]*?onClick=[\s\S]*?event\.stopPropagation\(\);[\s\S]*?closeLeftDock\(\)/);
});

test("compact empty history keeps both host locale catalogs and UI variants in sync", async () => {
  for (const base of ["../tools/scene-host/shared/i18n", "../packages/host-kit/i18n"]) {
    const zh = JSON.parse(await read(`${base}/locales/threebox-shell.zh-CN.json`));
    const en = await read(`${base}/threeboxShellLabels.en.js`);
    assert.equal(zh["threebox.sidebar.historyEmptyCompact"], "暂无历史记录");
    assert.match(en, /"threebox\.sidebar\.historyEmptyCompact": "No chat history yet\."/);
    assert.equal(zh["threebox.shell.closeMenu"], "收起菜单");
    assert.match(en, /"threebox\.shell\.closeMenu": "Close menu"/);
  }
  for (const path of ["../tools/scene-host/threebox/js/threeBoxSidebar.js", "../apps/threebox/src/App.jsx"]) {
    const source = await read(path);
    assert.match(source, /sidebarHistoryEmptyFull/);
    assert.match(source, /sidebarHistoryEmptyCompact/);
    assert.match(source, /暂无历史记录/);
  }
});
