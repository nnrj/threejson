import assert from "node:assert/strict";
import { test, mock, beforeEach } from "node:test";
import {
  fetchReferenceMaterial,
  _resetSceneReferenceCatalogCacheForTests
} from "../core/ai/sceneReferenceCatalog.js";
import { matchIntentSignals } from "../core/ai/sceneCapability.js";
import { buildStructuredTurnEnvelope } from "../core/ai/sceneChatSession.js";

const MANIFEST = [
  {
    section: "event-mechanism",
    sectionTitle: "事件机制",
    sectionTitleEn: "Event Mechanism",
    docLinks: [{ file: "event-mechanism.md", label: "Event Mechanism" }],
    items: [
      {
        id: "declarative-action",
        json: "assets/json/demo-show/event-mechanism/declarative-action.json"
      }
    ]
  },
  {
    section: "basic-geometry",
    sectionTitle: "基础几何",
    sectionTitleEn: "Basic Geometry",
    docLinks: [{ file: "json-format.md" }],
    items: [{ id: "box", json: "assets/json/demo-show/basic-geometry/box.json" }]
  }
];

function resolveUrl(path) {
  return `https://example.test/${path}`;
}

function installFetchMock(routes) {
  const originalFetch = globalThis.fetch;
  const fetchMock = mock.fn(async (url) => {
    const body = routes[url];
    return {
      ok: body !== undefined,
      async text() {
        return body ?? "";
      }
    };
  });
  globalThis.fetch = fetchMock;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

beforeEach(() => {
  _resetSceneReferenceCatalogCacheForTests();
});

test("fetchReferenceMaterial returns '' when resolveUrl is missing", async () => {
  const signals = matchIntentSignals("add click event on the box");
  const result = await fetchReferenceMaterial(signals, {});
  assert.equal(result, "");
});

test("fetchReferenceMaterial returns '' when no signal maps to a known section", async () => {
  const signals = matchIntentSignals("add a sphere");
  const restore = installFetchMock({});
  try {
    const result = await fetchReferenceMaterial(signals, { resolveUrl });
    assert.equal(result, "");
  } finally {
    restore();
  }
});

test("fetchReferenceMaterial fetches doc + example for an 'events' signal", async () => {
  const signals = matchIntentSignals("add a click event handler to the door");
  assert.ok(signals.some((s) => s.id === "events"));

  const restore = installFetchMock({
    "https://example.test/assets/json/demo-show/manifest.json": JSON.stringify(MANIFEST),
    "https://example.test/docs/en/event-mechanism.md": "# Event Mechanism\nUse object events with action(s).",
    "https://example.test/assets/json/demo-show/event-mechanism/declarative-action.json":
      '{"threeJsonId":"demo","worldInfo":{"boxModelList":[{"threeJsonId":"box-1","objType":"box","geometry":{"width":1,"height":1,"depth":1}}]}}'
  });
  try {
    const result = await fetchReferenceMaterial(signals, { resolveUrl, locale: "en-US" });
    assert.ok(result.includes("Event Mechanism"));
    assert.ok(result.includes("Use object events with action(s)."));
    assert.ok(result.includes("declarative-action"));
    assert.ok(result.includes('"objectList"'));
    assert.ok(result.includes('"objType": "box"'));
    assert.equal(result.includes("boxModelList"), false);
  } finally {
    restore();
  }
});

test("fetchReferenceMaterial maps lighting and animation signals to focused references", async () => {
  const signals = matchIntentSignals("make it brighter and spin the planet");
  assert.ok(signals.some((s) => s.id === "lighting"));
  assert.ok(signals.some((s) => s.id === "declarativeAnimation"));

  const restore = installFetchMock({
    "https://example.test/assets/json/demo-show/manifest.json": JSON.stringify([
      ...MANIFEST,
      {
        section: "materials-lighting",
        sectionTitleEn: "Materials And Lighting",
        docLinks: [{ file: "materials.md" }],
        items: [{ id: "directional-light", json: "assets/json/demo-show/materials-lighting/directional-light.json" }]
      },
      {
        section: "runtime",
        sectionTitleEn: "Runtime",
        docLinks: [{ file: "runtime.md" }],
        items: [{ id: "runtime-animation", json: "assets/json/demo-show/runtime/runtime-animation.json" }]
      }
    ]),
    "https://example.test/docs/en/materials.md": "# Materials\nUse sceneConfig.lights.",
    "https://example.test/assets/json/demo-show/materials-lighting/directional-light.json":
      '{"sceneConfig":{"lights":[{"type":"directional","intensity":1}]}}',
    "https://example.test/docs/en/runtime.md": "# Runtime\nUse renderLoop updateAnimations for declarative animations.",
    "https://example.test/assets/json/demo-show/runtime/runtime-animation.json":
      '{"animations":[{"type":"rotate","axis":"y","speed":0.1}]}'
  });
  try {
    const result = await fetchReferenceMaterial(signals, { resolveUrl, locale: "en-US" });
    assert.ok(result.includes("Materials And Lighting"));
    assert.ok(result.includes("sceneConfig.lights"));
    assert.ok(result.includes("directional-light.json"));
    assert.ok(result.includes("Runtime"));
    assert.ok(result.includes("updateAnimations"));
    assert.ok(result.includes("runtime-animation.json"));
    assert.ok(result.includes("cdn.jsdelivr.net"));
  } finally {
    restore();
  }
});

test("fetchReferenceMaterial degrades to '' on fetch failure, never throws", async () => {
  const signals = matchIntentSignals("add a click event handler");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => {
    throw new Error("network down");
  });
  try {
    const result = await fetchReferenceMaterial(signals, { resolveUrl, locale: "en-US" });
    assert.equal(result, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildStructuredTurnEnvelope omits referenceLinks by default", () => {
  const envelope = JSON.parse(buildStructuredTurnEnvelope({ userPrompt: "add a box", intent: "generate" }));
  assert.equal(envelope.referenceLinks, undefined);
});

test("buildStructuredTurnEnvelope adds referenceLinks when includeReferenceLinks is true", () => {
  const envelope = JSON.parse(
    buildStructuredTurnEnvelope({ userPrompt: "add a box", intent: "generate", includeReferenceLinks: true })
  );
  assert.equal(envelope.referenceLinks.docsIndex, "https://threejson.org/website/#/docs-index");
  assert.equal(
    envelope.referenceLinks.jsonExamples,
    "https://github.com/nnrj/threejson/tree/master/assets/json"
  );
});

test("buildStructuredTurnEnvelope carries the negotiated compact generation strategy", () => {
  const envelope = JSON.parse(buildStructuredTurnEnvelope({
    userPrompt: "a forest with many animals",
    intent: "generate",
    generationStrategy: "compact"
  }));
  assert.equal(envelope.generationStrategy, "compact");
  assert.equal(envelope.generationConstraints.completeJsonInOneResponse, true);
  assert.match(envelope.generationConstraints.instruction, /instancedList\/transforms/);
});
