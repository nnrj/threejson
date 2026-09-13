import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSceneDocument, applyDocumentOperations, indexSceneDocument } from "../core/document/sceneDocument.js";
import { compileAuthoring, formatAuthoring, inspectAuthoringMigration } from "../core/document/authoringAdapters.js";
import { createSceneSession } from "../core/session.js";
import "../builtins/register.js";

const scene = () => ({ name: "Authored", sceneConfig: { lights: [] }, objectList: [
  { objType: "box", threeJsonId: "a", position: { x: 1, y: 2, z: 3 }, material: { color: "red" } },
  { objType: "box", threeJsonId: "b", position: { x: 4, y: 2, z: 3 }, material: { color: "blue" } }
] });

test("deserialized and shallow-frozen envelopes cannot mutate owned authoring snapshots", () => {
  const raw = JSON.parse(JSON.stringify(compileAuthoring(scene())));
  Object.freeze(raw);
  const document = compileAuthoring(raw), session = createSceneSession(raw);
  const noChange = applyDocumentOperations(raw, []).document;
  raw.root.objectList[0].material.color = "black";
  for (const snapshot of [document, session.document, noChange]) {
    assert.equal(snapshot.root.objectList[0].material.color, "red");
    assert.ok(Object.isFrozen(snapshot.root.objectList[0].material));
  }
  assert.equal(compileAuthoring(document), document);
  session.dispose();
});

test("document edits are immutable, copy-on-write, reversible and revision checked", () => {
  const document = createSceneDocument(scene());
  const changed = applyDocumentOperations(document, [{ op: "object.patch", id: "a", patch: { position: { x: 9 } } }], { baseRevision: 0 });
  assert.equal(document.root.objectList[0].position.x, 1);
  assert.equal(changed.document.root.objectList[0].position.x, 9);
  assert.equal(changed.document.root.objectList[1], document.root.objectList[1]);
  assert.equal(changed.document.root.objectList[0].material, document.root.objectList[0].material);
  assert.equal(changed.document.revision, 1);
  const restored = applyDocumentOperations(changed.document, changed.inverse);
  assert.deepEqual(restored.document.root, document.root);
  assert.equal(restored.document.revision, 2);
  assert.throws(() => applyDocumentOperations(changed.document, [], { baseRevision: 0 }), { code: "STALE_SCENE_REVISION" });
  assert.throws(() => { document.root.objectList[0].position.x = 20; }, TypeError);
});

test("a failed batch changes neither the authoring root nor any previous snapshot", () => {
  const document = createSceneDocument(scene());
  assert.throws(() => applyDocumentOperations(document, [
    { op: "object.patch", id: "a", patch: { position: { x: 9 } } },
    { op: "replace", path: "/objectList/99/material", value: {} }
  ]));
  assert.equal(document.revision, 0);
  assert.equal(document.root.objectList[0].position.x, 1);
});

test("add/remove and escaped keys invert exactly, including deleting the final object", () => {
  const document = createSceneDocument({ objectList: [scene().objectList[0]], "a/b~c": 1 });
  const changed = applyDocumentOperations(document, [
    { op: "add", path: "/objectList/-", value: scene().objectList[1] },
    { op: "remove", path: "/objectList/0" },
    { op: "remove", path: "/objectList/0" },
    { op: "replace", path: "/a~1b~0c", value: 2 }
  ]);
  assert.equal(changed.document.root.objectList.length, 0);
  assert.deepEqual(applyDocumentOperations(changed.document, changed.inverse).document.root, document.root);
  assert.throws(() => applyDocumentOperations(document, [{ op: "add", path: "/__proto__/bad", value: true }]), { code: "INVALID_POINTER" });
});

test("the authoring adapters retain standard/friendly JSON, metadata, library references and advanced geometry", () => {
  const source = scene();
  source.assetLibrary = { assets: [{ id: "wood", url: "https://origin.test/wood.png" }] };
  source.custom = { untouched: true };
  source.objectList[0].material.textureUrl = "lib://wood";
  source.objectList.push({ objType: "editableMesh", threeJsonId: "mesh", topology: { vertices: [], faces: [] }, modifiers: [{ type: "mirror" }] });
  const document = compileAuthoring(source);
  const standard = formatAuthoring(document, { format: "standard" });
  const friendly = formatAuthoring(document, { format: "friendly" });
  assert.equal(standard.schemaVersion, 2);
  assert.equal(friendly.schemaVersion, 2);
  assert.deepEqual(standard.custom, source.custom);
  assert.deepEqual(standard.assetLibrary, source.assetLibrary);
  assert.equal(indexSceneDocument(compileAuthoring(friendly)).get("a").record.material.textureUrl, "lib://wood");
  assert.deepEqual(indexSceneDocument(compileAuthoring(friendly)).get("mesh").record.topology, { vertices: [], faces: [] });
  assert.equal(source.schemaVersion, undefined);
  assert.equal(inspectAuthoringMigration(source).fromVersion, 1);
  assert.throws(() => compileAuthoring({ ...source, schemaVersion: 999 }), { code: "UNSUPPORTED_SCHEMA_VERSION" });
});

test("document-only modules do not import runtime, renderer, AI or host implementations", () => {
  for (const file of ["sceneDocument", "sceneSession"]) {
    const text = readFileSync(new URL(`../core/document/${file}.js`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /from\s+["'](?:three|\.\.\/(?:builder|handler|ai|runtime|webgpu))/u);
  }
});

test("native scene embeds and unrecognized author metadata survive both projections", () => {
  const source = { worldInfo: { sphereModelList: [{ threeJsonId: "sphere" }],
    nativeSceneList: [{ json: { metadata: { type: "Object" }, object: { type: "Group", uuid: "native" } } }],
    surveyList: [{ label: "custom data, not scene entities" }] } };
  for (const format of ["standard", "friendly"]) {
    const restored = formatAuthoring(compileAuthoring(source), { format });
    assert.deepEqual(restored.worldInfo.nativeSceneList, source.worldInfo.nativeSceneList);
    assert.deepEqual(restored.worldInfo.surveyList, source.worldInfo.surveyList);
    assert.equal(indexSceneDocument(compileAuthoring(restored)).get("sphere").record.objType, "sphere");
  }
});

for (const fixture of ["roomShow", "portShow"]) test(`${fixture} preserves authoring identities and Domain parameters through document adapters`, () => {
  const payload = JSON.parse(readFileSync(new URL(`../assets/json/${fixture}.json`, import.meta.url), "utf8"));
  const first = compileAuthoring(payload);
  const second = compileAuthoring(formatAuthoring(first, { format: "friendly" }));
  const index = indexSceneDocument(second);
  for (const [id, entry] of indexSceneDocument(first)) {
    assert.ok(index.has(id), `lost object ${id}`);
    const restored = index.get(id).record;
    assert.equal(restored.objType, entry.record.objType, id);
    if (entry.record.domain) {
      assert.equal(restored.domain, entry.record.domain, id);
      assert.equal(restored.handler, entry.record.handler, id);
      assert.deepEqual(restored.geometry, entry.record.geometry, id);
    }
  }
});

test("session prepare/commit failures preserve the document, history, viewport and undo entry", async () => {
  let visible = 1, failPrepare = false, failCommit = false;
  const session = createSceneSession(scene(), { driver: {
    async prepare(document) {
      if (failPrepare) throw new Error("prepare failed");
      const before = visible;
      return { commit() { visible = document.root.objectList[0].position.x; if (failCommit) throw new Error("commit failed"); }, rollback() { visible = before; } };
    }
  } });
  const command = { baseRevision: 0, operations: [{ op: "object.patch", id: "a", patch: { position: { x: 5 } } }] };
  failPrepare = true;
  await assert.rejects(session.dispatch(command), /prepare failed/);
  assert.equal(session.revision, 0); assert.equal(visible, 1); assert.equal(session.canUndo, false);
  failPrepare = false; failCommit = true;
  await assert.rejects(session.dispatch(command), /commit failed/);
  assert.equal(session.revision, 0); assert.equal(visible, 1);
  failCommit = false;
  await session.dispatch(command);
  assert.equal(session.revision, 1); assert.equal(visible, 5);
  failPrepare = true;
  await assert.rejects(session.undo(), /prepare failed/);
  assert.equal(session.canUndo, true); assert.equal(session.canRedo, false); assert.equal(visible, 5);
  failPrepare = false;
  await session.undo(); assert.equal(visible, 1);
  await session.redo(); assert.equal(visible, 5);
  session.dispose();
});

test("queued commands detect stale revisions and at least 50 edits remain undoable", async () => {
  const session = createSceneSession(scene());
  const command = (value) => ({ baseRevision: session.revision, operations: [{ op: "object.patch", id: "a", patch: { position: { x: value } } }] });
  const first = session.dispatch(command(5));
  const stale = session.dispatch(command(6));
  await first;
  await assert.rejects(stale, { code: "STALE_SCENE_REVISION" });
  for (let i = 0; i < 50; i++) await session.dispatch(command(i));
  for (let i = 0; i < 50; i++) { assert.equal(session.canUndo, true); await session.undo(); }
  assert.equal(session.document.root.objectList[0].position.x, 5);
  assert.equal(session.canUndo, false);
  assert.ok(session.getJournal().length <= 20);
  session.dispose();
});

test("cancellation releases prepared resources without publishing a new revision", async () => {
  const controller = new AbortController();
  let disposed = 0;
  const session = createSceneSession(scene(), { driver: { async prepare() {
    controller.abort();
    return { commit() { assert.fail("cancelled commit"); }, dispose() { disposed++; } };
  } } });
  await assert.rejects(session.dispatch({ signal: controller.signal, operations: [{ op: "remove", path: "/objectList/0" }] }), { name: "AbortError" });
  assert.equal(session.revision, 0); assert.equal(disposed, 1);
  session.dispose();
});
