import test from "node:test";
import assert from "node:assert/strict";
import { createMediaProjectSession, createMediaOperationService } from "../packages/media-kit/js/index.js";
import { defaultSceneOperationRegistry } from "../core/session.js";
import { readFile } from "node:fs/promises";

const scene = () => ({ objectList: [{ objType: "box", threeJsonId: "box" }], timeline: { duration: 4, tracks: [] } });
const command = (op, args = {}) => ({ op, args });
const nested = (op, commands) => command(op, { id: "scene", commands });

test("shot contracts are discoverable without a runtime, with exact schemas on demand", async () => {
  const session = createMediaProjectSession(scene()), service = createMediaOperationService({ session });
  try {
    const specs = service.discover().commands;
    assert.ok(specs.some(s => s.op === "media.shot.discover"));
    const schema = specs.find(s => s.op === "media.shot.query").inputSchema.properties.commands;
    assert.equal(schema.minItems, 1);
    assert.ok(schema.items.properties.op.enum.includes("scene.query"));
    assert.ok(!schema.items.properties.op.enum.includes("object.patch"));
    const index = await service.execute(command("media.shot.discover"));
    assert.equal(index.ok, true, index.error);
    assert.equal(index.results[0].data.commands.find(s => s.op === "object.patch").wrapper, "media.shot.edit");
    assert.equal(index.results[0].data.commands.find(s => s.op === "scene.query").inputSchema, undefined);
    const detail = await service.execute(command("media.shot.discover", { ops: ["scene.query", "object.patch", "object.add"] }));
    for (const spec of detail.results[0].data.commands) assert.deepEqual(spec.inputSchema, defaultSceneOperationRegistry.getSpec(spec.op).inputSchema);
    assert.equal(session.revision, 0); assert.equal(session.canUndo, false);
  } finally { session.dispose(); }
});

test("unknown queries are not misreported as forbidden writes and have a concrete discovery path", async () => {
  const session = createMediaProjectSession(scene()), service = createMediaOperationService({ session });
  try {
    const result = await service.execute(nested("media.shot.query", [command("scene.inspect")]));
    assert.equal(result.code, "UNKNOWN_SCENE_OPERATION");
    assert.equal(result.diagnostics[0].shotId, "scene");
    assert.equal(result.diagnostics[0].operation, "scene.inspect");
    assert.match(result.error, /scene\.inspect/);
    assert.equal(result.recovery.discovery.op, "media.shot.discover");
    assert.equal((await service.execute(result.recovery.discovery)).ok, true);
    const read = await service.execute(nested("media.shot.query", [command("scene.query", { projection: ["identity"] })]));
    assert.equal(read.ok, true, read.error);
    assert.equal(session.revision, 0); assert.equal(session.canUndo, false);
  } finally { session.dispose(); }
});

test("mixed query batches never mutate and identify the nested write and the edit entry point", async () => {
  const session = createMediaProjectSession(scene()), service = createMediaOperationService({ session });
  try {
    const before = session.snapshot();
    const commands = [command("scene.list"), command("object.patch", { id: "box", partial: { name: "Renamed" } })];
    const result = await service.execute(nested("media.shot.query", commands));
    assert.equal(result.code, "MEDIA_QUERY_READ_ONLY");
    assert.equal(result.diagnostics[0].commandIndex, 1);
    assert.equal(result.recovery.expectedWrapper, "media.shot.edit");
    assert.equal(session.snapshot(), before); assert.equal(session.canUndo, false);
    assert.equal((await service.execute(nested("media.shot.edit", [commands[1]]))).ok, true);
    assert.equal(session.document.scenes.scene.objectList[0].name, "Renamed");
    await session.undo(); assert.equal(session.snapshot(), before);
  } finally { session.dispose(); }
});

test("invalid nested arguments expose their actual contract and leave the entire edit atomic", async () => {
  const session = createMediaProjectSession(scene()), service = createMediaOperationService({ session });
  try {
    const before = session.snapshot();
    const result = await service.execute(nested("media.shot.edit", [
      command("object.patch", { id: "box", partial: { name: "Must roll back" } }), command("object.add", { json: { objType: "sphere" } })
    ]));
    assert.equal(result.code, "INVALID_COMMAND_ARGUMENTS"); assert.match(result.error, /descriptor/);
    assert.equal(result.diagnostics[0].commandIndex, 1);
    assert.ok(result.recovery.inputSchema.required.includes("descriptor"));
    assert.equal(session.snapshot(), before); assert.equal(session.canUndo, false);
    for (const commands of [null, [], [null], [{ args: {} }]]) {
      const rejected = await service.execute(nested("media.shot.query", commands));
      assert.equal(rejected.ok, false); assert.notEqual(rejected.code, "MEDIA_QUERY_READ_ONLY");
      assert.ok(rejected.recovery); assert.equal(session.snapshot(), before);
    }
  } finally { session.dispose(); }
});

test("runtime-only nested calls report capability limitations rather than pretending to query or edit", async () => {
  const session = createMediaProjectSession(scene()), service = createMediaOperationService({ session });
  try {
    for (const wrapper of ["media.shot.query", "media.shot.edit"]) {
      const result = await service.execute(nested(wrapper, [command("scene.capture")]));
      assert.equal(result.code, "MEDIA_SHOT_RUNTIME_UNAVAILABLE");
      assert.match(result.recovery.message, /media\.captureFrames/);
    }
    const result = await service.execute(nested("media.shot.query", [command("scene.query", { state: "runtime" })]));
    assert.equal(result.code, "MEDIA_SHOT_RUNTIME_UNAVAILABLE");
    assert.equal(session.revision, 0);
  } finally { session.dispose(); }
});

test("static media hosts resolve the neutral operation contract entry without a bundler", async () => {
  for (const page of ["tools/scene-host/threebox/index.html", "tools/scene-host/editor/index.html", "tools/scene-host/editor/index.template.html",
    "tools/scene-host/shower/index.html", "tools/scene-host/player/index.html", "tools/scene-host/video-editor/index.html", "examples/html-demo/track-08-media/08-01-media-studio.html"]) {
    const url = new URL(`../${page}`, import.meta.url), html = await readFile(url, "utf8");
    const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
    assert.equal(new URL(imports["threejson/operations"], url).href, new URL("../core/operations.js", import.meta.url).href, page);
  }
});
