import test from "node:test";
import assert from "node:assert/strict";
import { receiveVideoProject } from "../tools/scene-host/video-editor/js/transfer.js";
import { ingestMediaDocument } from "../tools/scene-host/video-editor/js/documents.js";
import { packMediaDocument } from "../packages/media-kit/js/index.js";

test("video transfer requires approved origin, exact opener and one-time session before loading", async () => {
  const previousWindow = globalThis.window, previousLocation = globalThis.location;
  const replies = [], loaded = [], opener = { postMessage(value, origin) { replies.push({ value, origin }); } };
  let listener, cleanup;
  globalThis.location = { origin: "https://threejson.org", search: "?bridgeSession=unpredictable&openerOrigin=https%3A%2F%2Fthreebox.org" };
  globalThis.window = { opener, addEventListener(type, value) { listener = value; }, removeEventListener(type, value) { if (listener === value) listener = null; } };
  const data = { channel: "threejson:scene-transfer", version: 1, session: "unpredictable", action: "load", payload: { documentType: "composition" } };
  try {
    cleanup = receiveVideoProject(value => loaded.push(value));
    assert.equal(replies[0].value.action, "ready");
    await listener({ origin: "https://attacker.example", source: opener, data });
    await listener({ origin: "https://threebox.org", source: {}, data });
    await listener({ origin: "https://threebox.org", source: opener, data: { ...data, session: "wrong" } });
    assert.equal(loaded.length, 0);
    const captured = listener;
    await captured({ origin: "https://threebox.org", source: opener, data });
    await captured({ origin: "https://threebox.org", source: opener, data });
    assert.equal(loaded.length, 1); assert.equal(listener, null); assert.equal(window.opener, null);
    assert.equal(replies.at(-1).value.ok, true); assert.equal(replies.at(-1).origin, "https://threebox.org");
    location.search = "?bridgeSession=known&openerOrigin=https%3A%2F%2Fattacker.example"; window.opener = opener;
    assert.throws(() => receiveVideoProject(() => {}), /not allowed/);
  } finally { cleanup?.(); if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation; }
});

test("embedding external shots preserves their resource base, not the editor or parent URL", async () => {
  const scene = { version: "next", sceneConfig: {}, objectList: [{ objType: "box", threeJsonId: "box", material: { map: "paint.png" } }], timeline: { version: 1, captions: [{ id: "label", text: "../this is text", duration: 2 }], audio: [{ id: "sound", url: "./voice.wav", duration: 2 }] } };
  const composition = { documentType: "composition", compositionVersion: 1, scenes: {}, timeline: { version: 1, clips: [{ id: "a", source: "https://assets.example/shots/scene.json", duration: 2 }] } };
  const requested = [];
  const result = await ingestMediaDocument(composition, { addAsset() { throw new Error("No assets should be downloaded"); } }, { baseUrl: "https://assets.example/films/film.json", fetch: async url => { requested.push(url); return new Response(JSON.stringify(scene)); } });
  const shot = result.scenes[result.timeline.clips[0].source];
  assert.deepEqual(requested, ["https://assets.example/shots/scene.json"]);
  assert.equal(shot.objectList[0].material.map, "https://assets.example/shots/paint.png");
  assert.equal(shot.timeline.audio[0].url, "https://assets.example/shots/voice.wav");
  assert.equal(shot.timeline.captions[0].text, "../this is text");
});

test("packed resources become durable host assets rather than expiring archive object URLs", async () => {
  const document = { documentType: "composition", compositionVersion: 1, scenes: {}, mediaAssets: { image: { kind: "image", url: "local-test://image.png" } }, timeline: { version: 1, clips: [{ id: "a", source: { type: "media", assetId: "image" }, duration: 2 }] } };
  const packed = await packMediaDocument(document, { assets: { "local-test://image.png": new Uint8Array([1, 2, 3]) } }), assets = new Map();
  const result = await ingestMediaDocument(packed, { async addAsset(blob) { const uri = `local-media://asset-${assets.size}`; assets.set(uri, blob); return uri; } });
  assert.ok(result.mediaAssets.image.url.startsWith("local-media://"));
  assert.deepEqual([...new Uint8Array(await assets.get(result.mediaAssets.image.url).arrayBuffer())], [1, 2, 3]);
});
