import test from "node:test";
import assert from "node:assert/strict";
import { createSceneToolHost } from "../packages/scene-tools/js/index.js";
test("timeline authoring uses the existing atomic patch and undo transaction", async () => {
  const host = createSceneToolHost();
  try {
    const { sessionId } = await host.open({ json: { objectList: [] } });
    const before = (await host.export({ sessionId })).json;
    const timeline = { version: 1, duration: 2, tracks: [], captions: [{ id: "caption", text: "Title", duration: 2 }] };
    const result = await host.apply({ sessionId, commands: [{ op: "scene.applyPatch", args: { patch: [{ op: "add", path: "/timeline", value: timeline }] } }] });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual((await host.export({ sessionId })).json.timeline, timeline);
    assert.equal((await host.undo({ sessionId })).ok, true);
    assert.deepEqual((await host.export({ sessionId })).json, before);
  } finally { await host.dispose(); }
});
test("media jobs use immutable session input and existing job progress/cancellation", async () => {
  let captured, finish;
  const host = createSceneToolHost({ mediaRenderer: async (options) => {
    captured = options.json; options.onProgress({ stage: "encoding", progress: .5 });
    return new Promise((resolve) => { finish = resolve; options.signal.addEventListener("abort", () => resolve({ ok: false, status: "cancelled" }), { once: true }); });
  } });
  try {
    const { sessionId } = await host.open({ json: { objectList: [{ objType: "box", threeJsonId: "box" }] } });
    const task = host.startMediaJob({ sessionId, output: "test.mp4" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(host.job(task).progress.progress, .5);
    await host.apply({ sessionId, commands: [{ op: "object.add", args: { descriptor: { objType: "box", threeJsonId: "later" } } }] });
    assert.ok(!JSON.stringify(captured).includes("later"));
    assert.equal(host.cancel(task).cancellationRequested, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(host.job(task).status, "cancelled");
    assert.equal(typeof finish, "function");
  } finally { await host.dispose(); }
});
