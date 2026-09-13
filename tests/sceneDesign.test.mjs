import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { compileAuthoring, formatAuthoring, evaluateSceneDesign, orderSceneDependencies } from "../core/document.js";
import { createRuntimeSceneSession, captureSceneSession } from "../core/session.js";
import { createJsonScene, createJsonSceneSimple } from "../core/handler/sceneLoadHandler.js";
import { getObjectByThreeJsonId } from "../core/handler/objectRegistry.js";
import { applySceneDesignRelations, getSceneObjectAnchor } from "../core/runtime/sceneDesignRuntime.js";
import { sceneToStandardJsonSimple } from "../core/util/sceneToJson.js";
import { readFileSync } from "node:fs";
import { buildAgentCapabilityIndex } from "../core/ai/sceneCapabilityIndex.js";

const box = (id, other = {}) => ({ objType: "box", threeJsonId: id, geometry: { width: 1, height: 1, depth: 1 }, material: { color: "#4488aa" }, ...other });
const scene = () => ({ sceneConfig: { lights: [] }, objectList: [box("table"), box("lamp")], design: {
  version: 1, units: { length: "m" }, parameters: {
    half: { op: "div", args: [{ param: "width" }, 2] }, width: { value: 180, unit: "cm" },
    turn: { value: 90, unit: "deg" }
  }, bindings: [{ object: "table", path: "/geometry/width", value: { param: "width" } }]
} });
// Runtime bounds are based on Float32 BufferAttributes, unlike the numeric AST.
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const closeVector = (a, b) => a.toArray().forEach((n, i) => close(n, b.toArray()[i]));

test("published design example loads and the AI contract is detailed only on selection", async () => {
  const example = JSON.parse(readFileSync(new URL("../assets/json/demo-show/design/parameterized-table.json", import.meta.url), "utf8"));
  const runtime = await createJsonScene(example);
  try {
    const top = getObjectByThreeJsonId("top", runtime.scene), ornament = getObjectByThreeJsonId("ornament", runtime.scene);
    close(getSceneObjectAnchor(ornament, "bottom").y, getSceneObjectAnchor(top, "top").y);
  } finally { runtime.dispose(); }
  assert.match(buildAgentCapabilityIndex({ selectedCapabilityIds: ["sceneDesign"] }), /design\.bindings/);
  assert.doesNotMatch(buildAgentCapabilityIndex({ selectedCapabilityIds: [] }), /Optional parameter\/relationship authoring/);
  assert.match(buildAgentCapabilityIndex({ promptPurpose: "negotiation" }), /sceneDesign/);
});

test("design units and dependencies are optional, deterministic, typed and never rescale bare legacy fields", () => {
  const legacy = { objectList: [box("plain", { position: [123,0,0] })] };
  assert.equal(evaluateSceneDesign(legacy).payload, legacy);
  const source = scene(), serialized = JSON.stringify(source), document = compileAuthoring(source);
  const result = evaluateSceneDesign(document);
  close(result.parameters.half.value, 0.9); close(result.parameters.turn.value, Math.PI / 2);
  close(result.payload.objectList[0].geometry.width, 1.8);
  assert.equal(document.root.objectList[0].geometry.width, 1);
  assert.equal(JSON.stringify(source), serialized);
  source.design.units.length = "mm";
  const millimeters = evaluateSceneDesign(compileAuthoring(source));
  close(millimeters.parameters.width.value, 1800);
  assert.equal(millimeters.payload.objectList[0].geometry.height, 1);
  const friendly = formatAuthoring(document, { format: "friendly" });
  assert.deepEqual(compileAuthoring(friendly).root.design, document.root.design);
});

test("compound units support area, velocity, dimensionless ratios and square roots", () => {
  const source = scene();
  Object.assign(source.design.parameters, {
    area: { op: "mul", args: [{ param: "width" }, { param: "width" }] },
    root: { op: "sqrt", args: [{ param: "area" }] },
    ratio: { op: "div", args: [{ param: "width" }, { param: "half" }] },
    velocity: { op: "div", args: [{ param: "width" }, { value: 2, unit: "s" }] }
  });
  const { parameters } = evaluateSceneDesign(source);
  assert.equal(parameters.area.dimension, "length^2"); close(parameters.root.value, 1.8);
  assert.equal(parameters.root.dimension, "length"); assert.equal(parameters.ratio.dimension, "scalar");
  assert.equal(parameters.velocity.dimension, "length*time^-1");
});

test("cycles, missing IDs, bad quantities, conflicting pointers and malformed expressions fail before runtime creation", () => {
  const run = (change, code) => { const source = scene(); change(source); assert.throws(() => compileAuthoring(source), { code }); };
  run((s) => { s.design.parameters.width = { param: "half" }; }, "DESIGN_DEPENDENCY_CYCLE");
  run((s) => { s.design.parameters.width = { param: "missing" }; }, "DESIGN_REFERENCE_MISSING");
  run((s) => { s.design.bindings[0].object = "absent"; }, "DESIGN_REFERENCE_MISSING");
  run((s) => { s.design.parameters.width = { value: 1, unit: "furlong" }; }, "DESIGN_UNIT_UNSUPPORTED");
  run((s) => { s.design.parameters.width = { op: "add", args: [{ value: 1, unit: "s" }, { value: 1, unit: "m" }] }; }, "DESIGN_UNIT_MISMATCH");
  run((s) => { s.design.parameters.width = { op: "div", args: [1,0] }; }, "DESIGN_NON_FINITE");
  run((s) => { s.design.parameters.width = { op: "sqrt", args: [-1] }; }, "DESIGN_NON_FINITE");
  run((s) => { s.design.parameters.width = { op: "add", args: 3 }; }, "DESIGN_EXPRESSION_INVALID");
  run((s) => { s.design.bindings.push({ object: "table", path: "/geometry", value: 1 }); }, "DESIGN_BINDING_CONFLICT");
  run((s) => { s.design.bindings[0].path = "/__proto__/oops"; }, "DESIGN_BINDING_PATH");
  run((s) => { s.design.bindings[0].path = "/threeJsonId"; }, "DESIGN_BINDING_PATH");
  run((s) => { s.design.relations = [{ type: "attach", object: "table", target: "lamp" }, { type: "attach", object: "lamp", target: "table" }]; }, "DESIGN_DEPENDENCY_CYCLE");
});

test("dependency traversal has no arbitrary graph size/round limit", () => {
  const dependencies = new Map();
  for (let i = 9999; i >= 0; i--) dependencies.set(String(i), new Set(i ? [String(i - 1)] : []));
  const order = orderSceneDependencies(dependencies);
  assert.equal(order.length, 10000); assert.equal(order[0], "0"); assert.equal(order.at(-1), "9999");
});

test("real async and sync runtimes compile parameters and attachments, without contaminating authoring saves", async () => {
  const source = scene();
  source.design.relations = [{ type: "attach", object: "lamp", anchor: "bottom", target: "table", targetAnchor: "top", offset: [0,{ value: 20, unit: "cm" },0], offsetSpace: "world" }];
  for (const create of [createJsonScene, createJsonSceneSimple]) {
    const runtime = await create(source);
    try {
      const table = getObjectByThreeJsonId("table", runtime.scene), lamp = getObjectByThreeJsonId("lamp", runtime.scene);
      close(table.geometry.boundingBox?.max.x ?? (table.geometry.computeBoundingBox(), table.geometry.boundingBox.max.x), 0.9);
      close(lamp.position.y, 1.2);
      assert.equal(runtime.normalizedPayload.objectList.find((r) => r.threeJsonId === "table").geometry.width, 1);
      const saved = sceneToStandardJsonSimple(runtime.scene, { state: "authoring", basePayload: runtime.normalizedPayload });
      assert.equal(saved.objectList.find((r) => r.threeJsonId === "table").geometry.width, 1);
      assert.deepEqual(saved.design, source.design);
      assert.equal(saved.objectList.find((r) => r.threeJsonId === "lamp").position?.y ?? 0, 0);
    } finally { runtime.dispose(); }
  }
});

test("parameter-only edits update dependent mesh geometry in place and undo restores the parameter, not a baked value", async () => {
  const session = await createRuntimeSceneSession(scene());
  try {
    const runtime = session.runtime, mesh = getObjectByThreeJsonId("table", runtime.scene), geometry = mesh.geometry;
    await session.dispatch({ operations: [{ op: "replace", path: "/design/parameters/width/value", value: 240 }] });
    assert.equal(session.runtime, runtime); assert.equal(mesh.geometry, geometry); close(mesh.geometry.boundingBox.max.x, 1.2);
    assert.equal(captureSceneSession(session).objectList.find((r) => r.threeJsonId === "table").geometry.width, 1);
    await session.undo(); close(mesh.geometry.boundingBox.max.x, 0.9);
    await session.redo(); close(mesh.geometry.boundingBox.max.x, 1.2);
    const snapshot = session.snapshot();
    await assert.rejects(session.dispatch({ operations: [{ op: "replace", path: "/design/parameters/width", value: { param: "half" } }] }), { code: "DESIGN_DEPENDENCY_CYCLE" });
    assert.equal(session.snapshot(), snapshot); assert.equal(session.runtime, runtime);
  } finally { session.dispose(); }
});

test("material edits in a constrained scene retain the renderer and attached pose", async () => {
  const source = scene(); source.design.relations = [{ type: "attach", object: "lamp", anchor: "bottom", target: "table", targetAnchor: "top" }];
  const session = await createRuntimeSceneSession(source);
  try {
    const runtime = session.runtime, lamp = getObjectByThreeJsonId("lamp", runtime.scene);
    await session.dispatch({ operations: [{ op: "object.patch", id: "lamp", patch: { material: { color: "#ff0000" } } }] });
    assert.equal(session.runtime, runtime); assert.equal(getObjectByThreeJsonId("lamp", runtime.scene), lamp); close(lamp.position.y, 1);
    const before = session.snapshot();
    await assert.rejects(session.dispatch({ operations: [{ op: "replace", path: "/design/relations/0/targetAnchor", value: "missing" }] }), { code: "DESIGN_ANCHOR_MISSING" });
    assert.equal(session.runtime, runtime); assert.equal(session.snapshot(), before); close(lamp.position.y, 1);
  } finally { session.dispose(); }
});

test("attachment and aim respect rotated/nonuniform parents and very small valid scales", async () => {
  const source = { objectList: [box("target", { position: [5,8,2], rotation: [0,0.7,0] }), {
    objType: "group", threeJsonId: "assembly", position: [2,3,1], rotation: [0,0.5,0.2], scale: [2,0.5,3], subScene: [box("attached"), box("aimed", { position: [-1,0,0] })]
  }], design: { relations: [
    { type: "attach", object: "attached", anchor: "bottom", target: "target", targetAnchor: "top" },
    { type: "lookAt", object: "aimed", target: "target" }
  ] } };
  const runtime = await createJsonScene(source);
  try {
    const target = getObjectByThreeJsonId("target", runtime.scene), attached = getObjectByThreeJsonId("attached", runtime.scene), aimed = getObjectByThreeJsonId("aimed", runtime.scene);
    closeVector(getSceneObjectAnchor(attached, "bottom"), getSceneObjectAnchor(target, "top"));
    const origin = getSceneObjectAnchor(aimed);
    const direction = new THREE.Vector3(0,0,1).applyMatrix4(aimed.matrixWorld).sub(origin).normalize();
    closeVector(direction, getSceneObjectAnchor(target).sub(origin).normalize());
    attached.scale.setScalar(1e-8);
    assert.doesNotThrow(() => getSceneObjectAnchor(attached, "top"));
  } finally { runtime.dispose(); }
});

test("bounds include instancing and actual morph positions but exclude runtime helpers", () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial();
  const instances = new THREE.InstancedMesh(geometry, material, 2);
  instances.setMatrixAt(0, new THREE.Matrix4()); instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(10,0,0)); root.add(instances);
  const helper = new THREE.Mesh(new THREE.BoxGeometry(1000,1000,1000), material); helper.userData.__threeJsonRuntimeOnly = true; root.add(helper);
  close(getSceneObjectAnchor(root, "right").x, 10.5);
  const triangle = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0],3));
  triangle.morphAttributes.position = [new THREE.Float32BufferAttribute([0,0,0, 9,0,0, 0,1,0],3)];
  const morphed = new THREE.Mesh(triangle, material); morphed.morphTargetInfluences[0] = 0.5;
  close(getSceneObjectAnchor(morphed, "right").x, 5);
  geometry.dispose(); helper.geometry.dispose(); triangle.dispose(); material.dispose();
});

test("relationship compilation rolls back earlier transforms on a later bounds failure", async () => {
  const source = { objectList: [box("a"), box("b"), box("c")] }, runtime = await createJsonScene(source);
  try {
    const b = getObjectByThreeJsonId("b", runtime.scene);
    assert.throws(() => applySceneDesignRelations(runtime.scene, source, [
      { type: "attach", object: "b", target: "a", offset: [5,0,0] },
      { type: "attach", object: "c", target: "b", targetAnchor: "no-such-anchor" }
    ]), { code: "DESIGN_ANCHOR_MISSING" });
    close(b.position.x, 0);
  } finally { runtime.dispose(); }
});
