import test from "node:test";
import assert from "node:assert/strict";
import { createMediaProjectSession, createMediaOperationService, diagnoseMediaDocument } from "../packages/media-kit/js/index.js";
const scene = () => ({ version: "next", sceneConfig: {}, objectList: [{ objType: "box", threeJsonId: "box", position: { x: 0, y: 0, z: 0 }, material: { color: "red" } }], timeline: { duration: 12, tracks: [] } });

test("media storyboard keeps timing in clips and failed batches leave completed shots unchanged", async () => {
  const session = createMediaProjectSession(), service = createMediaOperationService({ session });
  assert.equal((await service.execute({ op: "media.plan.set", args: { shots: [{ id: "intro", title: "引子", duration: 12 }, { id: "explain", title: "解释", duration: 100 }] } })).ok, true);
  assert.equal(session.inspect().duration, 112); assert.equal(diagnoseMediaDocument(session.document).satisfied, false);
  const planned = session.document;
  const put = { op: "media.shot.put", args: { id: "intro", scene: scene() } };
  const receipt = await service.execute(put, { baseRevision: 1, requestId: "draft" });
  assert.equal(receipt.ok, true, receipt.error); assert.equal(session.document.scenes.explain, planned.scenes.explain);
  assert.equal(session.document.production.shots.intro.duration, undefined);
  assert.deepEqual(await service.execute(put, { baseRevision: 1, requestId: "draft" }), receipt);
  const before = session.document;
  const invalid = await service.execute([put, { op: "timeline.edit", args: { shotId: "intro", section: "tracks", upsert: [{ id: "bad", target: "box", property: "position" }] } }], { baseRevision: 2 });
  assert.equal(invalid.ok, false); assert.equal(session.document, before);
  assert.equal((await service.execute(put, { baseRevision: 1 })).code, "STALE_MEDIA_REVISION");
  assert.equal((await service.execute({ op: "media.project.set", args: { state: "complete" } })).ok, false);
  await session.undo(); assert.equal(session.document, planned); await session.redo(); assert.equal(session.document, before);
  assert.equal(before.production.shots.intro.stage, "draft"); session.dispose();
});

test("shot edits reuse scene operations and do not publish on cancellation", async () => {
  const session = createMediaProjectSession(scene()), service = createMediaOperationService({ session });
  const result = await service.execute({ op: "media.shot.edit", args: { id: "scene", commands: [{ op: "object.patch", args: { id: "box", partial: { position: { x: 5, y: 0, z: 0 } } } }] } });
  assert.equal(result.ok, true, result.error);
  assert.equal(session.document.scenes.scene.objectList[0].position.x, 5);
  const before = session.document, controller = new AbortController(); controller.abort();
  assert.equal((await service.execute({ op: "media.shot.remove", args: { id: "scene" } }, { signal: controller.signal })).status, "cancelled");
  assert.equal(session.document, before);
  const capture = await service.execute({ op: "media.captureFrames", args: { times: [0, 3, 7] } });
  assert.equal(capture.code, "MEDIA_CAPTURE_UNAVAILABLE");
  const read = await service.execute({ op: "media.inspect" });
  assert.equal(read.results[0].data.shots[0].objects, 1); assert.equal(JSON.stringify(read).includes('"material"'), false);
  session.dispose();
});

test("film completion rejects unintentional duration clipping and reports exact clip timing", async () => {
  const session = createMediaProjectSession(scene()), service = createMediaOperationService({ session });
  try {
    assert.equal((await service.execute({ op: "media.duration.set", args: { duration: 12 } })).ok, true);
    assert.equal((await service.execute({ op: "media.shot.put", args: { id: "scene", clip: { duration: 14 }, metadata: { id: "wrong", duration: 99 } } })).ok, true);
    assert.equal(session.inspect().shots[0].id, "scene"); assert.equal(session.inspect().shots[0].duration, 14);
    const diagnostic = diagnoseMediaDocument(session.snapshot());
    assert.equal(diagnostic.satisfied, false); assert.ok(diagnostic.diagnostics.some(d => d.code === "MEDIA_CLIPS_EXCEED_DURATION"));
    assert.equal((await service.execute({ op: "media.project.set", args: { state: "complete" } })).ok, false);
    await service.execute({ op: "media.duration.set", args: { duration: 14 } });
    assert.equal((await service.execute({ op: "media.project.set", args: { state: "complete" } })).ok, true);
  } finally { session.dispose(); }
});

test("metadata alone cannot complete empty shots; deliberate blanks and caption-only shots remain valid", async () => {
  const session = createMediaProjectSession(), service = createMediaOperationService({ session });
  await service.execute({ op: "media.plan.set", args: { shots: [{ id: "a", title: "Intro", duration: 3 }] } });
  await service.execute({ op: "media.shot.put", args: { id: "a", metadata: { stage: "complete" } } });
  assert.equal(session.inspect().shots[0].hasContent, false);
  assert.ok(diagnoseMediaDocument(session.document).diagnostics.some(d => d.code === "MEDIA_SHOT_EMPTY"));
  assert.equal((await service.execute({ op: "media.project.set", args: { state: "complete" } })).ok, false);
  await service.execute({ op: "timeline.edit", args: { shotId: "a", section: "captions", upsert: [{ id: "title", text: "Hello", start: 0, duration: 3 }] } });
  assert.equal(session.inspect().shots[0].hasContent, true);
  assert.equal((await service.execute({ op: "media.project.set", args: { state: "complete" } })).ok, true);
  await service.execute({ op: "media.shot.put", args: { id: "a", scene: { objectList: [] }, metadata: { stage: "complete", intentionalBlank: true } } });
  assert.equal(diagnoseMediaDocument(session.document).satisfied, true);
  session.dispose();
});

test("incremental shot edits promote planned placeholders to actual drafts", async () => {
  const session = createMediaProjectSession(), service = createMediaOperationService({ session });
  await service.execute({ op: "media.plan.set", args: { shots: [{ id: "a", title: "Intro", duration: 3 }] } });
  const receipt = await service.execute({ op: "media.shot.edit", args: { id: "a", commands: [{ op: "object.add", args: { descriptor: { objType: "box", threeJsonId: "actor" } } }] } });
  assert.equal(receipt.ok, true, receipt.error); assert.equal(session.inspect().shots[0].stage, "draft"); assert.equal(session.inspect().shots[0].hasContent, true);
  session.dispose();
});
