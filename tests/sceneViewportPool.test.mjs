import test from "node:test";
import assert from "node:assert/strict";
import { createSceneViewportPool } from "../packages/host-kit/js/sceneViewportPool.js";
import { createSceneCardSession } from "../packages/host-kit/js/sceneCardSession.js";
import { createJsonScene } from "../core/handler/sceneLoadHandler.js";

test("host pool serializes use, evicts least-recently used cards and supports comparison", async () => {
  const pool = createSceneViewportPool(), events = [];
  const a = {}, b = {}, c = {};
  const unregister = [a, b, c].map((key, i) => pool.register(key, () => events.push(`suspend${i}`)));
  await pool.run(a, () => events.push("a"));
  await pool.run(b, () => events.push("b"));
  assert.deepEqual(events, ["a", "suspend0", "b"]);
  await pool.setLimit(2);
  await pool.run(a, () => events.push("a"));
  await pool.run(c, () => events.push("c"));
  assert.deepEqual(events.slice(-3), ["a", "suspend1", "c"]);
  assert.equal(pool.inspect().active, 2);
  await pool.setLimit(1); assert.equal(pool.inspect().active, 1);
  unregister.forEach((fn) => fn()); assert.equal(pool.inspect().registered, 0);
});

test("history cards keep independent documents with zero dormant renderer loads and resume after eviction", async () => {
  let loads = 0;
  const pool = createSceneViewportPool();
  const scene = (color) => ({ objectList: [{ objType: "box", threeJsonId: "box", material: { color } }] });
  const make = () => createSceneCardSession({ viewportPool: pool, createRuntime: (...args) => { loads++; return createJsonScene(...args); } });
  const a = make(), b = make();
  try {
    await a.render(scene("red"), { defer: true });
    await b.render(scene("blue"), { defer: true });
    assert.equal(loads, 0); assert.equal(a.runtime, null);
    await b.resume(); assert.equal(loads, 1);
    const before = b.document;
    await a.resume(); assert.equal(loads, 2); assert.equal(b.runtime, null); assert.equal(b.document, before);
    await b.update(scene("green")); assert.equal(loads, 2, "inactive authoring edits must not start a renderer");
    const result = await b.execute([{ op: "object.patch", args: { id: "box", partial: { position: { x: 3 } } } }]);
    assert.equal(result.ok, true); assert.equal(loads, 3); assert.equal(a.runtime, null);
    assert.equal(a.export().objectList[0].material.color, "red");
    assert.equal(b.export().objectList[0].material.color, "green");
    assert.equal(pool.inspect().active, 1);
  } finally { a.dispose(); b.dispose(); }
  assert.equal(pool.inspect().registered, 0);
});

test("failed activation releases its pool claim and a later retry succeeds", async () => {
  const pool = createSceneViewportPool(), key = {};
  pool.register(key, () => {});
  await assert.rejects(pool.run(key, () => { throw new Error("injected"); }), /injected/);
  assert.equal(pool.inspect().active, 0);
  await pool.run(key, () => {}); assert.equal(pool.inspect().active, 1);
});
