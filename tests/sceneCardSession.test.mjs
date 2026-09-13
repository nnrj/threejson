import test from "node:test";
import assert from "node:assert/strict";
import { createSceneCardSession } from "@threejson/host-kit/js/sceneCardSession.js";
import { createJsonScene } from "../core/handler/sceneLoadHandler.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import * as THREE from "three";

const scene = (name = "box") => ({ name, objectList: [{ objType: "box", threeJsonId: "one", position: { x: 0 }, material: { color: "#336699" } }] });

test("progressive texture assignment commits once only after decoding and rejects stale plans", async () => {
  let fail = false, commitCount = 0;
  const card = createSceneCardSession({ createRuntime: createJsonScene, loader: { load(_url, ready, _progress, error) {
    const texture = new THREE.Texture();
    queueMicrotask(() => { if (fail) error(new Error("decode failed")); else { texture.image = { width: 4, height: 4 }; ready(texture); } });
    return texture;
  } } });
  try {
    await card.render(scene());
    const expected = card.export().objectList[0].material;
    const assignment = { threeJsonId: "one", maps: { baseColor: "https://source.invalid/color.png" }, slotRecords: { baseColor: { material: expected } } };
    const old = card.document;
    fail = true;
    await assert.rejects(card.applyTextureAssignment(assignment, { commitSceneAssignment: () => commitCount++ }), /decode failed/);
    assert.equal(card.document, old); assert.equal(commitCount, 0);
    fail = false;
    await card.applyTextureAssignment(assignment, { commitSceneAssignment: () => commitCount++ });
    assert.equal(commitCount, 1); assert.equal(card.document.revision, old.revision + 1);
    const mesh = getObjectByThreeJsonId("one", card.runtime.scene);
    assert.ok((Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).map?.image);
    assert.equal(card.export().objectList[0].material.textureUrl, assignment.maps.baseColor);
    await assert.rejects(card.applyTextureAssignment({ ...assignment, maps: { baseColor: "https://source.invalid/new.png" } }), { code: "STALE_TEXTURE_ASSIGNMENT" });
  } finally { card.dispose(); }
});

test("native/React card controller preserves the old scene until the next viewport is committed", async () => {
  const viewports = [], published = [], documents = [];
  let fail = false, release;
  const card = createSceneCardSession({
    createViewport: () => {
      const viewport = { active: false, disposed: false, commit() { this.active = true; }, rollback() { this.active = false; }, dispose() { this.disposed = true; } };
      viewports.push(viewport); return viewport;
    },
    createRuntime: async (...args) => {
      if (fail) { await new Promise((resolve) => { release = resolve; }); throw new Error("injected scene compilation failure"); }
      return createJsonScene(...args);
    },
    onRuntimeChanged: (runtime) => published.push(runtime),
    onDocumentChanged: (document) => documents.push(document)
  });
  try {
    const input = scene(); await card.render(input);
    const previous = card.runtime, snapshot = card.document;
    input.objectList[0].material.color = "red";
    assert.equal(card.export().objectList[0].material.color, "#336699");
    fail = true;
    const next = scene("replacement"); next.objectList.push({ objType: "sphere", threeJsonId: "two" });
    const pending = card.render(next);
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(card.runtime, previous); assert.equal(viewports[0].disposed, false); assert.equal(viewports[1].active, false);
    release(); await assert.rejects(pending, /compilation failure/);
    assert.equal(card.runtime, previous); assert.equal(card.document, snapshot);
    assert.equal(viewports[0].disposed, false); assert.equal(viewports[1].disposed, true); assert.equal(published.length, 1);
    fail = false; await card.render(next);
    assert.notEqual(card.runtime, previous); assert.equal(viewports[0].disposed, true); assert.equal(documents.length, 2);
  } finally { card.dispose(); }
});

test("card history exports authoring state and keeps old snapshots independent of later edits", async () => {
  const card = createSceneCardSession({ createRuntime: createJsonScene });
  try {
    await card.render(scene());
    const old = card.export(), runtime = card.runtime;
    const object = getObjectByThreeJsonId("one", runtime.scene);
    object.position.y = 25; // animated or user orbit/preview state must not become history
    const change = await card.execute([{ op: "material.patch", args: { id: "one", partial: { color: "red" } } }]);
    assert.equal(change.ok, true); assert.equal(card.runtime, runtime);
    assert.equal(old.objectList[0].material.color, "#336699");
    const saved = card.export(); assert.equal(saved.objectList[0].position.y, 0);
    await card.update(saved); assert.equal(card.runtime, runtime, "adding a version marker must not reload the renderer");
    const revision = card.document.revision;
    await card.suspend(); assert.equal(card.runtime, null); assert.equal(card.document.revision, revision);
    await card.resume(); assert.notEqual(card.runtime, runtime);
    assert.equal(card.export().objectList[0].material.color, "red");
    assert.equal(getObjectByThreeJsonId("one", card.runtime.scene).position.y, 0);
  } finally { card.dispose(); }
});

test("a superseded or disposed card cleans up late preparation without publishing it", async () => {
  let release, creates = 0, publications = 0, disposals = 0;
  const card = createSceneCardSession({
    createRuntime: async (...args) => { if (++creates === 1) await new Promise((resolve) => { release = resolve; }); return createJsonScene(...args); },
    createViewport: () => ({ dispose() { disposals++; } }),
    onRuntimeChanged: () => publications++
  });
  const first = card.render(scene("first"));
  const firstFailure = assert.rejects(first, { name: "AbortError" });
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  const second = card.render(scene("second")); release();
  await firstFailure; await second;
  assert.equal(publications, 1); assert.equal(card.export().name, "second"); assert.equal(disposals, 1);
  card.dispose(); assert.equal(disposals, 2);
});
