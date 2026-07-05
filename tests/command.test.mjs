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
import { clearObjectRegistry } from "../core/handler/objectRegistry.js";

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
