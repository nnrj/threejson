import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import {
  parseCommandLine,
  parseCommandScript,
  parseMicroDslLine,
  formatCommandAsMicroDsl,
  createCommandContext,
  createCommandRegistry,
  executeCommand,
  executeCommands,
  getCommandSpec,
  getCommandHelp
} from "../core/command/index.js";
import {
  clearObjectRegistry,
  getObjectByThreeJsonId,
  registerObject
} from "../core/handler/objectRegistry.js";
import { attachRuntimeContext, createRuntimeContext } from "../core/runtime/runtimeContext.js";
import { createJsonSceneSimple } from "../core/handler/sceneLoadHandler.js";
import { sceneToStandardJsonSimple } from "../core/util/sceneToJson.js";

function buildBoxDescriptor(overrides = {}) {
  return {
    name: "cmd-box",
    objType: "box",
    geometry: { width: 1, height: 1, depth: 1 },
    position: { x: 0, y: 0, z: 0 },
    material: { type: "standard", color: "#336699" },
    ...overrides
  };
}

function buildMinimalScenePayload() {
  return {
    sceneConfig: {
      camera: {
        fov: 60,
        near: 0.1,
        far: 1000,
        position: { x: 5, y: 5, z: 5 }
      }
    },
    worldInfo: {
      boxModelList: [buildBoxDescriptor({ name: "load-box" })]
    }
  };
}

test("parseCommandLine accepts JSON object, JSONL, and micro DSL", () => {
  const fromObj = parseCommandLine({ op: "scene.list", args: {} });
  assert.equal(fromObj.op, "scene.list");

  const fromText = parseCommandLine('{"op":"object.get","args":{"id":"a"}}');
  assert.equal(fromText.op, "object.get");
  assert.equal(fromText.args.id, "a");

  const fromDsl = parseCommandLine('object.get id=obj-abc');
  assert.equal(fromDsl.op, "object.get");
  assert.equal(fromDsl.args.id, "obj-abc");

  const script = parseCommandScript('# comment\n{"op":"scene.validate","args":{"json":{}}}\n');
  assert.equal(script.length, 1);
  assert.equal(script[0].op, "scene.validate");
});

test("micro DSL parses nested JSON values and round-trips", () => {
  const partial = { position: { x: 2, y: 0, z: 0 } };
  const line = 'object.patch id=box-1 partial={"position":{"x":2,"y":0,"z":0}}';
  const parsed = parseMicroDslLine(line);
  assert.equal(parsed.op, "object.patch");
  assert.deepEqual(parsed.args.partial, partial);

  const formatted = formatCommandAsMicroDsl({
    op: "object.add",
    args: { descriptor: { objType: "box", name: "Cube1" } }
  });
  assert.match(formatted, /^object\.add /);
  const again = parseCommandLine(formatted);
  assert.equal(again.op, "object.add");
  assert.equal(again.args.descriptor.name, "Cube1");
});

test("parseCommandScript accepts mixed JSONL and micro DSL lines", () => {
  const script = parseCommandScript(`
scene.validate
object.add descriptor={"objType":"box","name":"mixed","geometry":{"width":1,"height":1,"depth":1}}
{"op":"scene.list","args":{}}
`);
  assert.equal(script.length, 3);
  assert.equal(script[0].op, "scene.validate");
  assert.equal(script[1].op, "object.add");
  assert.equal(script[2].op, "scene.list");
});

test("micro DSL parses Math.PI in partial JSON", () => {
  const line = 'object.patch id=box-1 partial={"position":{"y":Math.PI}}';
  const parsed = parseMicroDslLine(line);
  assert.equal(parsed.op, "object.patch");
  assert.ok(Math.abs(parsed.args.partial.position.y - Math.PI) < 1e-10);
});

test("micro DSL parses Math.PI / 2 rotation expressions", () => {
  const line =
    'object.patch id=box-1 partial={"rotation":{"rotationZ": Math.PI / 2}}';
  const parsed = parseMicroDslLine(line);
  assert.ok(Math.abs(parsed.args.partial.rotation.rotationZ - Math.PI / 2) < 1e-10);
});

test("micro DSL does not replace Math.PI inside JSON string values", () => {
  const line =
    'object.patch id=box-1 partial={"note":"use Math.PI","rotationZ": Math.PI / 2}';
  const parsed = parseMicroDslLine(line);
  assert.equal(parsed.args.partial.note, "use Math.PI");
  assert.ok(Math.abs(parsed.args.partial.rotationZ - Math.PI / 2) < 1e-10);
});

test("parseCommandScript accepts JSONL with Math.PI in args", () => {
  const script = parseCommandScript(
    '{"op":"object.patch","args":{"id":"a","partial":{"position":{"y":Math.PI}}}}'
  );
  assert.equal(script.length, 1);
  assert.equal(script[0].op, "object.patch");
  assert.ok(Math.abs(script[0].args.partial.position.y - Math.PI) < 1e-10);
});

test("scene.validate runs in document mode without scene", async () => {
  const ctx = createCommandContext();
  const res = await executeCommand(ctx, {
    op: "scene.validate",
    args: { json: buildMinimalScenePayload() }
  });
  assert.equal(res.ok, true);
  assert.equal(res.mode, "document");
  assert.ok(res.data.objectCount >= 0 || res.data.friendlyCount >= 1);
});

test("object.add and object.patch require runtime scene", async () => {
  clearObjectRegistry();
  const ctx = createCommandContext();
  const blocked = await executeCommand(ctx, {
    op: "object.add",
    args: { descriptor: buildBoxDescriptor() }
  });
  assert.equal(blocked.ok, false);
  assert.match(String(blocked.error), /requires ctx\.scene/i);

  const scene = new THREE.Scene();
  ctx.scene = scene;
  const added = await executeCommand(ctx, {
    op: "object.add",
    args: { descriptor: buildBoxDescriptor({ name: "patch-me" }) }
  });
  assert.equal(added.ok, true);
  assert.ok(added.data.threeJsonId);

  const patched = await executeCommand(ctx, {
    op: "object.patch",
    args: {
      id: added.data.threeJsonId,
      partial: { position: { x: 3, y: 0, z: 0 } }
    }
  });
  assert.equal(patched.ok, true);

  const got = await executeCommand(ctx, {
    op: "object.get",
    args: { id: added.data.threeJsonId, path: "position.x" }
  });
  assert.equal(got.ok, true);
  assert.equal(got.data.value, 3);
  clearObjectRegistry();
});

test("executeCommands runs JSONL script sequentially", async () => {
  clearObjectRegistry();
  const ctx = createCommandContext({ scene: new THREE.Scene() });
  const script = [
    '{"op":"object.add","args":{"descriptor":{"objType":"box","name":"a","geometry":{"width":1,"height":1,"depth":1}}}}',
    '{"op":"scene.list","args":{}}'
  ].join("\n");
  const batch = await executeCommands(ctx, script);
  assert.equal(batch.ok, true);
  assert.equal(batch.results.length, 2);
  assert.equal(batch.results[1].data.count, 1);
  clearObjectRegistry();
});

test("scene.load sync populates context scene", async () => {
  clearObjectRegistry();
  const ctx = createCommandContext();
  const loaded = await executeCommand(ctx, {
    op: "scene.load",
    args: { sync: true, json: buildMinimalScenePayload() }
  });
  assert.equal(loaded.ok, true);
  assert.ok(ctx.scene?.isScene);
  assert.ok(ctx.scene.children.length >= 1);

  const listed = await executeCommand(ctx, { op: "scene.list", args: {} });
  assert.equal(listed.ok, true);
  assert.ok(listed.data.count >= 1);
  clearObjectRegistry();
});

test("scene.load reuses an owned runtime instead of detaching the hosted canvas", async () => {
  clearObjectRegistry();
  const runtime = createJsonSceneSimple(buildMinimalScenePayload());
  const originalScene = runtime.scene;
  const ctx = createCommandContext({
    runtime,
    scene: runtime.scene,
    camera: runtime.camera,
    renderer: runtime.renderer,
    controls: runtime.controls,
    document: buildMinimalScenePayload()
  });
  const replacement = buildMinimalScenePayload();
  replacement.worldInfo.boxModelList[0].threeJsonId = "replacement-box";
  replacement.sceneConfig.lights = [
    { type: "ambient", color: "#ddeeff", intensity: 0.42 },
    {
      type: "directional",
      color: "#ffffff",
      intensity: 1.1,
      position: { x: 4, y: 7, z: 3 }
    }
  ];

  const loaded = await executeCommand(ctx, {
    op: "scene.load",
    args: { sync: true, json: replacement }
  });

  assert.equal(loaded.ok, true);
  assert.equal(ctx.runtime, runtime);
  assert.equal(ctx.scene, originalScene);
  let replacementObject = null;
  ctx.scene.traverse((child) => {
    if (child.userData?.objJson?.threeJsonId === "replacement-box") replacementObject = child;
  });
  assert.ok(replacementObject);
  const saved = sceneToStandardJsonSimple(runtime.scene, {
    merge: false,
    runtimeTarget: runtime,
    basePayload: ctx.document
  });
  assert.deepEqual(
    saved.sceneConfig.lights.map(({ type, color, intensity }) => ({ type, color, intensity })),
    [
      { type: "ambient", color: "#ddeeff", intensity: 0.42 },
      { type: "directional", color: "#ffffff", intensity: 1.1 }
    ]
  );
  runtime.dispose();
  clearObjectRegistry();
});

test("scene.applyPatch mutates document without scene", async () => {
  const ctx = createCommandContext({
    document: {
      objectList: [{ objType: "box", name: "before", threeJsonId: "box-1" }]
    }
  });
  const res = await executeCommand(ctx, {
    op: "scene.applyPatch",
    args: {
      patch: [{ op: "replace", path: "/objectList/0/name", value: "after" }]
    }
  });
  assert.equal(res.ok, true);
  assert.equal(res.mode, "document");
  assert.equal(ctx.document.objectList[0].name, "after");
});

test("executeCommands dryRun plans commands without mutating scene", async () => {
  clearObjectRegistry();
  const ctx = createCommandContext({ scene: new THREE.Scene() });
  const batch = await executeCommands(
    ctx,
    'object.add descriptor={"objType":"box","name":"dry","geometry":{"width":1,"height":1,"depth":1}}',
    { dryRun: true }
  );
  assert.equal(batch.dryRun, true);
  assert.equal(batch.ok, true);
  assert.equal(batch.results.length, 1);
  assert.equal(batch.results[0].data?.dryRun, true);
  assert.equal(ctx.scene.children.length, 0);
  clearObjectRegistry();
});

test("material.patch updates descriptor material color", async () => {
  clearObjectRegistry();
  const ctx = createCommandContext({ scene: new THREE.Scene() });
  const added = await executeCommand(ctx, {
    op: "object.add",
    args: {
      descriptor: buildBoxDescriptor({
        name: "mat-box",
        material: { type: "standard", color: "#ffffff" }
      })
    }
  });
  assert.equal(added.ok, true);
  const patched = await executeCommand(ctx, {
    op: "material.patch",
    args: { id: added.data.threeJsonId, partial: { color: "#112233" } }
  });
  assert.equal(patched.ok, true);
  const got = await executeCommand(ctx, {
    op: "object.get",
    args: { id: added.data.threeJsonId, path: "material.color" }
  });
  assert.equal(got.data.value, "#112233");
  clearObjectRegistry();
});

test("material.patch stays inside ctx.scene when concurrent scenes reuse one threeJsonId", async () => {
  const sceneA = new THREE.Scene();
  const sceneB = new THREE.Scene();
  const runtimeA = createRuntimeContext();
  const runtimeB = createRuntimeContext();
  attachRuntimeContext(sceneA, runtimeA);
  attachRuntimeContext(sceneB, runtimeB);
  const ctxA = createCommandContext({ scene: sceneA });
  const descriptor = (color) => buildBoxDescriptor({
    threeJsonId: "shared-cube",
    name: "shared-cube",
    material: { type: "standard", color }
  });
  const mount = (scene, color) => {
    const record = descriptor(color);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color })
    );
    mesh.name = record.name;
    scene.add(mesh);
    registerObject(mesh, record, { recursive: false }, scene);
    return mesh;
  };
  try {
    const meshA = mount(sceneA, "#0000ff");
    const meshB = mount(sceneB, "#00ff00");

    const patched = await executeCommand(ctxA, {
      op: "material.patch",
      args: { id: "shared-cube", partial: { color: "#ff0000" } }
    });
    assert.equal(patched.ok, true);
    assert.equal(meshA.userData.objJson.material.color, "#ff0000");
    assert.equal(meshA.material.color.getHexString(), "ff0000");
    assert.equal(meshB.userData.objJson.material.color, "#00ff00");
    assert.equal(meshB.material.color.getHexString(), "00ff00");
  } finally {
    runtimeA.dispose();
    runtimeB.dispose();
  }
});

test("object.add registers in ctx.scene even when a newer scene already owns the same id", async () => {
  const sceneA = new THREE.Scene();
  const sceneB = new THREE.Scene();
  const runtimeA = createRuntimeContext();
  const runtimeB = createRuntimeContext();
  attachRuntimeContext(sceneA, runtimeA);
  attachRuntimeContext(sceneB, runtimeB); // Deliberately make B the global fallback.
  const existingRecord = buildBoxDescriptor({
    threeJsonId: "same-new-id",
    name: "existing-in-b",
    material: { type: "standard", color: "#00ff00" }
  });
  const existingInB = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: "#00ff00" })
  );
  sceneB.add(existingInB);
  registerObject(existingInB, existingRecord, { recursive: false }, sceneB);

  try {
    const added = await executeCommand(createCommandContext({ scene: sceneA }), {
      op: "object.add",
      args: {
        descriptor: buildBoxDescriptor({
          threeJsonId: "same-new-id",
          name: "new-in-a",
          material: { type: "standard", color: "#ff0000" }
        })
      }
    });
    assert.equal(added.ok, true);
    const addedInA = getObjectByThreeJsonId("same-new-id", sceneA);
    assert.ok(addedInA);
    assert.notEqual(addedInA, existingInB);
    assert.equal(addedInA.userData.objJson.name, "new-in-a");
    assert.equal(getObjectByThreeJsonId("same-new-id", sceneB), existingInB);
  } finally {
    runtimeA.dispose();
    runtimeB.dispose();
  }
});

test("object.reconcile writes transform back to descriptor", async () => {
  clearObjectRegistry();
  const ctx = createCommandContext({ scene: new THREE.Scene() });
  const added = await executeCommand(ctx, {
    op: "object.add",
    args: { descriptor: buildBoxDescriptor({ name: "rec-box" }) }
  });
  assert.equal(added.ok, true);
  const id = added.data.threeJsonId;
  const obj = ctx.scene.children.find(
    (node) => node?.userData?.objJson?.threeJsonId === id
  );
  assert.ok(obj);
  obj.position.x = 9;
  const reconciled = await executeCommand(ctx, {
    op: "object.reconcile",
    args: { id }
  });
  assert.equal(reconciled.ok, true);
  const got = await executeCommand(ctx, {
    op: "object.get",
    args: { id, path: "position.x" }
  });
  assert.equal(got.data.value, 9);
  clearObjectRegistry();
});

test("getCommandSpec and getCommandHelp expose registered ops", () => {
  const registry = createCommandRegistry();
  const spec = getCommandSpec(registry);
  assert.equal(spec.v, 1);
  assert.ok(spec.commands.some((item) => item.op === "object.add"));
  assert.ok(spec.commands.some((item) => item.op === "material.patch"));
  const help = getCommandHelp(registry, "object");
  assert.match(help, /object\.add/);
  assert.match(help, /object\.patch/);
});
