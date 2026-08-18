import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Imports through the published-style "@threejson/react" specifier, proving the workspace link and
// exports map resolve as a real consumer's would. <SceneViewport /> is exercised via SSR
// (renderToStaticMarkup), which runs the component body and render output but not useEffect — so
// the DOM structure and prop handling are covered without needing a browser or WebGL context.

test("package exposes the documented React surface", async () => {
  const mod = await import("@threejson/react");
  assert.equal(typeof mod.SceneViewport, "function");
  assert.equal(typeof mod.useScenePlayer, "function");
  assert.equal(typeof mod.useHostI18n, "function");
  assert.equal(typeof mod.setHostLocale, "function");
  assert.equal(typeof mod.usePlayerSettings, "function");
  assert.equal(typeof mod.usePlaylist, "function");
});

test("SceneViewport renders a fill-parent wrapper containing a canvas", async () => {
  const { SceneViewport } = await import("@threejson/react");
  const html = renderToStaticMarkup(createElement(SceneViewport));
  assert.match(html, /^<div style="[^"]*"><canvas style="[^"]*"><\/canvas><\/div>$/);
  assert.match(html, /position:relative/);
  assert.match(html, /width:100%/);
  assert.match(html, /height:100%/);
});

test("SceneViewport forwards className and merges custom wrapper style over the defaults", async () => {
  const { SceneViewport } = await import("@threejson/react");
  const html = renderToStaticMarkup(
    createElement(SceneViewport, { className: "myViewport", style: { height: "480px" } })
  );
  assert.match(html, /class="myViewport"/);
  // Caller override wins over the default height:100%.
  assert.match(html, /height:480px/);
  // Non-overridden defaults survive the merge.
  assert.match(html, /position:relative/);
});

test("SceneViewport forwards canvasProps to the inner canvas", async () => {
  const { SceneViewport } = await import("@threejson/react");
  const html = renderToStaticMarkup(
    createElement(SceneViewport, { canvasProps: { id: "sceneCanvas", "data-testid": "vp-canvas" } })
  );
  assert.match(html, /<canvas[^>]*id="sceneCanvas"/);
  assert.match(html, /data-testid="vp-canvas"/);
});

test("SceneViewport does not leak player options onto the DOM wrapper", async () => {
  const { SceneViewport } = await import("@threejson/react");
  // assetGatewayUrl/overrideSceneRenderLoop are createPlayerRuntime options, not DOM attributes —
  // the component must consume them rather than spreading them onto the div.
  const html = renderToStaticMarkup(
    createElement(SceneViewport, {
      assetGatewayUrl: "https://example.com",
      overrideSceneRenderLoop: true
    })
  );
  assert.ok(!html.includes("assetGatewayUrl"), "assetGatewayUrl leaked into markup");
  assert.ok(!html.includes("overrideSceneRenderLoop"), "overrideSceneRenderLoop leaked into markup");
});

test("setHostLocale switches the host-kit catalog and is observable through it", async () => {
  const { setHostLocale } = await import("@threejson/react");
  const { getHostLocale, t } = await import("@threejson/host-kit/i18n/index.js");
  const resolved = await setHostLocale("en-US");
  assert.equal(resolved, "en-US");
  assert.equal(getHostLocale(), "en-US");
  // A key present in the bundled en catalog resolves to its English string, proving the catalog
  // actually loaded rather than falling through to the supplied fallback.
  assert.equal(t("player.shell.play", "FALLBACK"), "Play");
});

test("useSceneConversations degrades to session-only history when IndexedDB is absent", async () => {
  const { useSceneConversations } = await import("@threejson/react-scene-agent/conversations");
  const { createSceneAgentRepository } = await import("@threejson/scene-agent-kit/repository");
  const { createElement: h } = await import("react");

  // Node has no indexedDB. The hook must render rather than throw, and must say so via
  // `persistent: false` so an app can warn the user their history will not be saved.
  let observed = null;
  function Probe() {
    observed = useSceneConversations({
      repository: createSceneAgentRepository({ dbName: "react-scene-agent-ssr-test", indexedDb: null })
    });
    return h("div", null, String(observed.persistent));
  }
  const html = renderToStaticMarkup(h(Probe));

  assert.equal(html, "<div>false</div>");
  assert.equal(observed.persistent, false);
  assert.deepEqual(observed.conversations, []);
  assert.equal(observed.active, null);
  assert.equal(observed.error, null);
  for (const fn of ["create", "update", "remove", "loadTurns", "appendTurn", "refresh", "setActiveId"]) {
    assert.equal(typeof observed[fn], "function", `missing: ${fn}`);
  }
  // Reads against a missing database resolve empty instead of rejecting.
  assert.deepEqual(await observed.loadTurns("conv-1"), []);
  assert.equal(await observed.appendTurn("conv-1", { userPrompt: "x" }), null);
});


test("useHostI18n loads the catalog itself, without an explicit setHostLocale", async () => {
  // The regression guarded here: two of the three apps never called setHostLocale, and host-kit's
  // t() answers a missing key with key-derived text rather than the supplied fallback — so the
  // failure looked like plausible UI copy ("Title") instead of an error.
  const { useHostI18n } = await import("@threejson/react");
  const { createElement: h } = await import("react");

  function Probe() {
    const { t, locale } = useHostI18n();
    return h("div", null, `${locale}|${t("player.shell.play", "FALLBACK")}`);
  }

  renderToStaticMarkup(h(Probe));           // kicks off the async load
  await new Promise((resolve) => setTimeout(resolve, 80));
  const after = renderToStaticMarkup(h(Probe));

  // Locale-agnostic on purpose: auto-init resolves from navigator/storage, so the answer depends on
  // the machine (Node exposes navigator.language from the OS). What must hold is that a *catalog*
  // was loaded — i.e. the supplied fallback was not used.
  assert.ok(!after.includes("FALLBACK"), `catalog did not auto-load: ${after}`);
  const expected = { "en-US": "Play", "zh-CN": "播放" };
  const [locale, text] = after.replace(/^<div>|<\/div>$/g, "").split("|");
  assert.ok(expected[locale], `unexpected resolved locale: ${locale}`);
  assert.equal(text, expected[locale]);
});
