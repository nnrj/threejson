import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { mergeHydratedSidebarRecords } from "../tools/scene-host/threebox/js/threeBoxSidebar.js";
import {
  getHostLocale,
  loadHostLocaleCatalog
} from "../tools/scene-host/shared/i18n/index.js";

const repoFile = (path) => new URL(`../${path}`, import.meta.url);

test("ThreeBox sidebar hydration preserves conversations created during the IndexedDB read", () => {
  const loaded = [
    { id: "old", title: "Stored" },
    { id: "same", title: "Stale snapshot" }
  ];
  const live = [
    { id: "same", title: "Updated in memory" },
    { id: "new", title: "First message" }
  ];

  const merged = mergeHydratedSidebarRecords(loaded, live);
  assert.deepEqual(merged.map((item) => item.id), ["old", "same", "new"]);
  assert.equal(merged.find((item) => item.id === "same")?.title, "Updated in memory");
});

test("ThreeBox binds primary shell and composer interaction before background startup work", async () => {
  const source = await readFile(
    repoFile("tools/scene-host/threebox/js/threeBoxApp.js"),
    "utf8"
  );
  const startup = source.slice(source.lastIndexOf("sidebar = createThreeBoxSidebar"));
  const sidebarInit = startup.indexOf("sidebar.init()");
  const composerInit = startup.indexOf("wireThreeBoxComposerStub({");
  const templateInit = startup.indexOf("scheduleNonCriticalStartupTask(() => templateGallery.init())");

  assert.ok(sidebarInit >= 0);
  assert.ok(composerInit > sidebarInit);
  assert.ok(templateInit > composerInit);
  assert.doesNotMatch(startup, /await sidebar\.init\(\)/);
  assert.doesNotMatch(startup, /await templateGallery\.init\(\)/);
  assert.doesNotMatch(source, /await initHostI18n\(settingsModal\.getSettings\(\)\?\.general\?\.locale\)/);
});

test("ThreeBox sidebar wires menus before hydration and renders long histories incrementally", async () => {
  const source = await readFile(
    repoFile("tools/scene-host/threebox/js/threeBoxSidebar.js"),
    "utf8"
  );
  const init = source.slice(source.indexOf("function init()"), source.indexOf("function refresh()"));

  assert.ok(init.indexOf("wireUserMenu();") >= 0);
  assert.ok(init.indexOf("wireUserMenu();") < init.indexOf("hydrateSidebarData()"));
  assert.match(source, /mergeHydratedSidebarRecords\(loadedConversations, conversations\)/);
  assert.match(source, /HISTORY_INITIAL_BATCH_SIZE/);
  assert.match(source, /scheduleSidebarRenderWork\(\(\) =>/);
});

test("ThreeBox template thumbnails yield to input, scene generation, and browser idle time", async () => {
  const source = await readFile(
    repoFile("tools/scene-host/threebox/js/threeBoxTemplateGallery.js"),
    "utf8"
  );

  assert.match(source, /navigator\.scheduling\?\.isInputPending/);
  assert.match(source, /task\?\.shouldDeferBackgroundWork\?\.\(\) === true/);
  assert.match(source, /isThreeBoxSceneLoadBusy\(\)/);
  assert.match(source, /window\.requestIdleCallback\(run\);/);
  assert.doesNotMatch(source, /requestIdleCallback\(run, \{ timeout:/);
  assert.match(source, /if \(initPromise\)/);
});

test("host locale becomes usable before its remote catalog finishes", async () => {
  const source = await readFile(
    repoFile("tools/scene-host/shared/i18n/index.js"),
    "utf8"
  );
  const init = source.slice(source.indexOf("export async function initHostI18n"));
  assert.ok(init.indexOf("currentLocale = locale;") >= 0);
  assert.ok(init.indexOf("currentLocale = locale;") < init.indexOf("await loadHostLocaleCatalog(locale);"));
});

test("a slow startup locale fetch cannot overwrite a newer locale choice", async () => {
  const originalFetch = globalThis.fetch;
  const pendingResponses = [];
  globalThis.fetch = () => new Promise((resolve) => pendingResponses.push(resolve));
  try {
    const slowChineseLoad = loadHostLocaleCatalog("zh-CN");
    await Promise.resolve();
    assert.equal(pendingResponses.length, 5);

    await loadHostLocaleCatalog("en-US");
    for (const resolve of pendingResponses) {
      resolve({ ok: true, json: async () => ({}) });
    }
    await slowChineseLoad;
    assert.equal(getHostLocale(), "en-US");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
