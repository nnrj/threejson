import assert from "node:assert/strict";
import { test } from "node:test";
import { createJsonScene } from "../core/handler/sceneLoadHandler.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { syncBoxModelTransformFromObject3D } from "../core/builder/modelBuilder.js";
import { createEditorAuthoringSession } from "../tools/scene-host/editor/js/editorAuthoringSession.js";
import { createEditorDocumentHistory } from "../tools/scene-host/editor/js/editorDocumentHistory.js";
import { sceneToStandardJsonSimple } from "../core/util/sceneToJson.js";

const source = () => ({ threeJsonId: "editor-document", label: "Keep metadata", metadata: { custom: "kept" }, sceneConfig: { background: "#001122", lights: [{ type: "ambient", intensity: 0.7 }] },
  objectList: [{ objType: "box", threeJsonId: "moving", position: [0,0,0], material: { color: "red" } }, { objType: "sphere", threeJsonId: "animated", rotation: [0,0,0], material: { color: "blue" } }] });

test("queued Editor field edits use the latest document, without losing other material edits", async (t) => {
  const { controller, host, history } = await createHost(t);
  const runtime = host.getSceneRuntime(), object = getObjectByThreeJsonId("moving", runtime.scene);
  await Promise.all([
    controller.mutateObject("moving", (record) => { record.material.color = "green"; }),
    controller.mutateObject("moving", (record) => { record.material.roughness = 0.3; })
  ]);
  const material = controller.export().objectList.find((record) => record.threeJsonId === "moving").material;
  assert.equal(material.color, "green"); assert.equal(material.roughness, 0.3);
  assert.equal(host.getSceneRuntime(), runtime); assert.equal(getObjectByThreeJsonId("moving", runtime.scene), object);
  assert.equal((await history.undo()).ok, true);
  assert.equal(controller.export().objectList.find((record) => record.threeJsonId === "moving").material.color, "green");
});

async function createHost(t, payload = source()) {
  let runtime = await createJsonScene(payload), selected = null, history, controller;
  const config = { jsonData: payload }, messages = [];
  const oldDocument = globalThis.document; globalThis.document = { getElementById: () => null };
  const host = { getScene: () => runtime.scene, getSceneRuntime: () => runtime, getSysConfig: () => config,
    getEditorSettings: () => ({ editing: { historyMaxDepth: 50 } }), getSelectedObject: () => selected, setSelectedObject: (object) => { selected = object; },
    getAuthoringSession: () => controller, getEditorHistory: () => history, buildSceneToJsonOptions: () => ({ basePayload: config.jsonData, state: "authoring" }),
    buildAuthoringRuntimeOptions: () => ({ createRuntime: createJsonScene, onRuntimeChanged: (next) => { runtime = next; } }),
    showMessage: (message) => messages.push(message) };
  controller = createEditorAuthoringSession(host); controller.attach(payload, runtime);
  history = createEditorDocumentHistory(host); history.resetForFullSceneLoad(controller.export());
  t.after(() => { controller.dispose(); runtime.dispose(); globalThis.document = oldDocument; });
  return { host, controller, history, config, messages };
}

test("Editor parameters, derived field preservation and explicit detach share the undo timeline", async (t) => {
  const payload = source();
  payload.design = { parameters: { offset: { value: 150, unit: "cm" } },
    bindings: [{ object: "moving", path: "/position/x", value: { param: "offset" } }] };
  const { host, controller, history } = await createHost(t, payload);
  const read = () => getObjectByThreeJsonId("moving", host.getScene());
  assert.equal(read().position.x, 1.5);
  const descriptor = structuredClone(read().userData.objJson); descriptor.label = "Preserve source";
  await controller.replaceObject("moving", descriptor);
  assert.equal(controller.export().objectList.find((r) => r.threeJsonId === "moving").position.x, 0);
  await controller.setDesignParameter("offset", 250);
  assert.equal(read().position.x, 2.5);
  await controller.detachDesignObject("moving");
  assert.equal(read().position.x, 2.5); assert.equal(controller.export().design.bindings.length, 0);
  await controller.mutateObject("moving", (record) => { record.position = [4,0,0]; });
  assert.equal(read().position.x, 4);
  await history.undo(); await history.undo();
  assert.equal(controller.export().design.bindings.length, 1); assert.equal(read().position.x, 2.5);
  await history.undo(); assert.equal(read().position.x, 1.5);
});

test("a drag cannot leave an uncommitted runtime pose on a relation-controlled object", async (t) => {
  const payload = source(); payload.design = { relations: [{ type: "attach", object: "moving", target: "animated", offset: [0,3,0] }] };
  const { host, controller } = await createHost(t, payload);
  const moved = getObjectByThreeJsonId("moving", host.getScene());
  assert.equal(moved.position.y, 3);
  moved.position.y = 99; syncBoxModelTransformFromObject3D(moved);
  await controller.recordRuntimeEdit("drag preview");
  assert.equal(getObjectByThreeJsonId("moving", host.getScene()).position.y, 3);
  assert.equal(controller.export().objectList.find((r) => r.threeJsonId === "moving").position.y, 0);
});

test("Editor save/undo uses authored poses, never unrelated animation frames or camera motion", async (t) => {
  const { host, controller, history } = await createHost(t);
  const scene = host.getScene(), moving = getObjectByThreeJsonId("moving", scene), animated = getObjectByThreeJsonId("animated", scene);
  const before = controller.export();
  animated.rotation.y = 1.37; host.getSceneRuntime().camera.position.x = 500;
  moving.position.x = 4; syncBoxModelTransformFromObject3D(moving);
  history.pushTransformDelta("moving", {}, {}, "移动"); await controller.flush();
  const after = controller.export();
  const get = (payload, id) => payload.objectList.find((record) => record.threeJsonId === id);
  assert.equal(get(after, "moving").position.x, 4);
  assert.deepEqual(get(after, "animated").rotation, get(before, "animated").rotation);
  assert.equal(after.label, "Keep metadata"); assert.deepEqual(after.metadata, { custom: "kept" });
  assert.equal(animated.rotation.y, 1.37);
  assert.equal((await history.undo()).ok, true);
  assert.equal(moving.position.x, 0); assert.equal(animated.rotation.y, 1.37);
  assert.equal((await history.redo()).ok, true); assert.equal(moving.position.x, 4);
  const explicit = sceneToStandardJsonSimple(scene, { basePayload: after, state: "runtime" });
  assert.equal(get(explicit, "animated").rotation.y, 1.37);
});

test("Editor keeps 50 delta undo steps and commands share the same timeline", async (t) => {
  const { host, controller, history } = await createHost(t);
  for (let index = 1; index <= 52; index++) {
    const result = await controller.execute([{ op: "object.patch", args: { id: "moving", partial: { position: { x: index } } } }]);
    assert.equal(result.ok, true);
  }
  for (let index = 0; index < 50; index++) assert.equal((await history.undo()).ok, true);
  assert.equal(history.hasUndo(), false);
  assert.equal(getObjectByThreeJsonId("moving", host.getScene()).position.x, 2);
  assert.equal((await history.redo()).ok, true);
  const previous = controller.session.document, runtime = host.getSceneRuntime();
  const failed = await controller.execute([{ op: "object.add", args: { descriptor: { objType: "not-a-builder", threeJsonId: "invalid" } } }]);
  assert.equal(failed.ok, false); assert.equal(controller.session.document, previous);
  assert.equal(host.getSceneRuntime(), runtime); assert.equal(history.hasRedo(), true);
});

test("same texture-enrichment group is one inverse transaction, without scene checkpoints per slot", async (t) => {
  const { controller, history } = await createHost(t);
  const session = controller.session;
  for (let index = 1; index <= 3; index++) await session.dispatch({ historyGroup: "texture-enrichment", operations: [{ op: "object.patch", id: "moving", patch: { position: { x: index } } }] });
  assert.equal((await history.undo()).ok, true); assert.equal(session.canUndo, false);
  assert.equal((await history.redo()).ok, true);
  assert.equal(session.document.root.objectList.find((record) => record.threeJsonId === "moving").position.x, 3);
});

test("saving an unchanged Editor scene creates no undo operation", async (t) => {
  const { controller, history } = await createHost(t);
  const result = await controller.recordRuntimeEdit("save");
  assert.equal(result.changed, false, JSON.stringify(result.operations));
  assert.equal(history.hasUndo(), false);
});

test("object import prepares the replacement before clearing existing objects and is undoable", async (t) => {
  const { host, controller, history } = await createHost(t);
  const previous = host.getSceneRuntime(), document = controller.session.document;
  await assert.rejects(controller.importRecord({ objType: "missing-builder" }, { replace: true }), /No object builder/);
  assert.equal(controller.session.document, document); assert.equal(host.getSceneRuntime(), previous);
  await controller.importRecord({ objType: "box", threeJsonId: "imported" }, { replace: true });
  assert.ok(getObjectByThreeJsonId("imported", host.getScene()));
  assert.equal(getObjectByThreeJsonId("moving", host.getScene()), null);
  assert.equal((await history.undo()).ok, true);
  assert.ok(getObjectByThreeJsonId("moving", host.getScene()));
});

test("property edits preserve object identity and hiding an object never hides its shared material", async (t) => {
  const { host, controller } = await createHost(t);
  const object = getObjectByThreeJsonId("moving", host.getScene()), runtime = host.getSceneRuntime();
  const descriptor = structuredClone(controller.session.document.root.objectList.find((record) => record.threeJsonId === "moving"));
  descriptor.position.x = 12; descriptor.visible = false; descriptor.castShadow = true; descriptor.label = "Changed";
  await controller.replaceObject("moving", descriptor);
  assert.equal(host.getSceneRuntime(), runtime); assert.equal(getObjectByThreeJsonId("moving", host.getScene()), object);
  assert.equal(object.position.x, 12); assert.equal(object.visible, false); assert.equal(object.castShadow, true);
  for (const material of Array.isArray(object.material) ? object.material : [object.material]) assert.equal(material.visible, true);
  await controller.execute([{ op: "object.patch", args: { id: "moving", partial: { visible: true } } }]);
  assert.equal(object.visible, true);
});

test("nested Domain authoring saves edits without capturing another part's playback or duplicating factory geometry", async (t) => {
  const { setDomainEditState } = await import("../core/handler/domainDeployDescriptor.js");
  const record = { objType: "domain", domain: "port", handler: "dockCrane", threeJsonId: "crane", geometry: { width: 70, length: 90, height: 280 } };
  const { host, controller, history } = await createHost(t, { objectList: [{ objType: "group", threeJsonId: "assembly", subScene: [record] }] });
  const root = getObjectByThreeJsonId("crane", host.getScene());
  const [edited, animated] = root.children.filter((object) => object.isMesh && object.userData?.objJson?.material);
  const original = edited.userData.objJson.material.color, id = edited.userData.objJson.domainPartId;
  edited.userData.objJson.material.color = "#fe2345";
  edited.position.x += 12; syncBoxModelTransformFromObject3D(edited);
  animated.rotation.y += 1;
  setDomainEditState(root, "bound");
  await controller.recordRuntimeEdit("Domain part");
  const saved = controller.export().objectList[0].subScene[0];
  assert.equal(saved.subScene?.length || 0, 0);
  assert.equal(saved.domainOverrides.parts.length, 1);
  assert.equal(saved.domainOverrides.parts[0].id, id);
  assert.equal((await history.undo()).ok, true);
  let restored;
  getObjectByThreeJsonId("crane", host.getScene()).traverse((object) => { if (object.userData?.objJson?.domainPartId === id) restored = object; });
  assert.equal(restored.userData.objJson.material.color, original);
  assert.equal((await history.redo()).ok, true);
  getObjectByThreeJsonId("crane", host.getScene()).traverse((object) => { if (object.userData?.objJson?.domainPartId === id) restored = object; });
  assert.equal(restored.material.color.getHexString(), "fe2345");
});
