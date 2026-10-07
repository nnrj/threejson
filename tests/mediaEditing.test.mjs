import test from "node:test";
import assert from "node:assert/strict";
import { createMediaProjectSession, createMediaOperationService, snapMediaTime, validateMediaDocument, packMediaDocument, openMediaDocument } from "../packages/media-kit/js/index.js";
import { scopedVideoService, runEditorVideoAgent } from "../tools/scene-host/video-editor/js/agent.js";
import { sampleTimelineTrack } from "../core/timeline.js";
const scene = { version: "next", sceneConfig: {}, objectList: [{ objType: "box", threeJsonId: "box" }], timeline: { version: 1, duration: 10, tracks: [{ id: "move", target: "box", property: "position.x", keyframes: [{ time: 0, value: 0 }, { time: 10, value: 10 }] }] } };
const make = () => createMediaProjectSession({ documentType: "composition", compositionVersion: 1, scenes: { scene }, timeline: { version: 1, clips: [{ id: "a", source: "scene", start: 0, duration: 10 }], audio: [{ id: "voice", linkedClipId: "a", url: "voice.wav", start: 0, duration: 10 }], captions: [{ id: "caption", linkedClipId: "a", start: 2, duration: 6, text: "hello" }] } });
const op = (op, args) => ({ op, args });

test("splitting maps source offsets, linked records and copy-on-write scenes; undo is atomic", async () => {
  const session = make(), before = session.snapshot();
  await session.dispatch(op("media.clip.split", { id: "a", time: 4, newId: "b" }));
  const split = session.snapshot();
  assert.deepEqual(split.timeline.clips.map(c => [c.id, c.start, c.duration, c.sourceStart || 0]), [["a", 0, 4, 0], ["b", 4, 6, 4]]);
  assert.deepEqual(split.timeline.audio.map(c => [c.start, c.duration, c.sourceStart || 0]), [[0, 4, 0], [4, 6, 4]]);
  assert.deepEqual(split.timeline.captions.map(c => [c.start, c.duration]), [[2, 2], [4, 4]]);
  assert.equal(split.scenes.scene, before.scenes.scene);
  await session.dispatch(op("media.shot.edit", { id: "a", commands: [op("object.patch", { id: "box", partial: { position: { x: 8 } } })] }));
  const edited = session.snapshot(), a = edited.timeline.clips[0], b = edited.timeline.clips[1];
  assert.notEqual(a.source, b.source); assert.equal(edited.scenes[b.source], split.scenes.scene);
  await session.dispatch(op("media.shot.remove", { id: "a" }));
  assert.ok(session.snapshot().scenes[b.source]);
  await session.undo(); await session.undo(); assert.equal(session.snapshot(), split);
  await session.undo(); assert.equal(session.snapshot(), before); assert.equal(session.canUndo, false); assert.equal(session.canRedo, true);
});

test("linked trim, speed and move preserve source audio time", async () => {
  const session = make();
  await session.dispatch(op("media.clip.update", { id: "a", changes: { start: 5, sourceStart: 2, duration: 4, rate: 2 } }));
  const doc = session.snapshot();
  assert.deepEqual(doc.timeline.audio.map(c => [c.start, c.duration, c.sourceStart, c.rate]), [[5, 4, 2, 2]]);
  assert.deepEqual(doc.timeline.captions.map(c => [c.start, c.duration]), [[5, 3]]);
});

test("rolling, ripple and reorder have explicit gap and locked-track semantics", async () => {
  const session = make(); await session.dispatch(op("media.clip.split", { id: "a", time: 4, newId: "b" }));
  await session.dispatch(op("media.clip.roll", { id: "a", nextId: "b", time: 5 }));
  assert.equal(session.snapshot().timeline.clips[1].sourceStart, 5);
  await session.dispatch(op("media.clip.reorder", { id: "b", beforeId: "a" }));
  assert.equal(session.snapshot().timeline.clips.find(c => c.id === "a").start, 5);
  await session.dispatch(op("media.clip.remove", { id: "b", ripple: true }));
  assert.equal(session.snapshot().timeline.clips[0].start, 0);
  await session.dispatch([op("media.lanes.set", { lanes: [{ id: "v", kind: "visual", locked: true }] }), op("media.document.replace", { document: { ...session.snapshot(), timeline: { ...session.snapshot().timeline, lanes: [{ id: "v", kind: "visual", locked: true }], clips: [{ ...session.snapshot().timeline.clips[0], laneId: "v" }] } } })]);
  const before = session.snapshot();
  await assert.rejects(session.dispatch(op("media.clip.update", { id: "a", changes: { start: 10 } })), { code: "MEDIA_LANE_LOCKED" });
  assert.equal(session.snapshot(), before);
});

test("ripple overlap and invalid source bounds cannot partially mutate a transaction", async () => {
  const session = make(); await session.dispatch(op("media.clip.insert", { clip: { id: "overlap", source: "scene", start: 5, duration: 10 } }));
  const before = session.snapshot();
  await assert.rejects(session.dispatch(op("media.clip.remove", { id: "a", ripple: true })), { code: "MEDIA_RIPPLE_OVERLAP" });
  assert.equal(session.snapshot(), before);
  await assert.rejects(session.dispatch([op("media.asset.put", { id: "video", asset: { kind: "video", url: "clip.mp4", duration: 5 } }), op("media.clip.insert", { clip: { id: "video", source: { type: "media", assetId: "video" }, duration: 8 } })]), { code: "MEDIA_SOURCE_BOUNDS" });
  assert.equal(session.snapshot(), before);
});

test("project JSON applies through revision/history; empty project can be saved and reopened", async () => {
  const session = make(), service = createMediaOperationService({ session }), before = session.snapshot();
  const empty = { documentType: "composition", compositionVersion: 1, scenes: {}, timeline: { version: 1, clips: [] } };
  assert.ok(validateMediaDocument(empty));
  assert.equal((await service.execute(op("media.document.replace", { document: empty }), { baseRevision: 0 })).ok, true);
  assert.equal((await service.execute(op("media.document.replace", { document: before }), { baseRevision: 0 })).code, "STALE_MEDIA_REVISION");
  const archive = await openMediaDocument(await packMediaDocument(session.snapshot())); assert.equal(archive.document.timeline.clips.length, 0); archive.dispose();
  await session.undo(); assert.equal(session.snapshot(), before);
});

test("editor agent cannot overwrite the whole project or escape selected-shot scope", async () => {
  const session = make(), service = createMediaOperationService({ session }), scoped = scopedVideoService(service, "a");
  assert.equal((await scoped.execute(op("media.shot.remove", { id: "a" }))).code, "MEDIA_EDIT_SCOPE");
  assert.equal((await scoped.execute(op("media.document.replace", { document: session.snapshot() }))).ok, false);
  assert.equal((await scoped.execute(op("timeline.edit", { section: "captions", upsert: [] }))).ok, false);
  assert.equal((await scoped.execute(op("timeline.inspect", { shotId: "a" }))).ok, true);
  assert.equal((await scoped.execute(op("media.shot.edit", { id: "other", commands: [] }))).ok, false);
  assert.equal((await scoped.execute(op("media.shot.narrate", { id: "a", text: "too long", extend: true }))).code, "MEDIA_EDIT_SCOPE");
  assert.equal((await scoped.execute(op("media.clip.update", { id: "a", changes: { duration: 20 } }))).code, "MEDIA_EDIT_SCOPE");
});

test("snapping prefers nearby boundaries, otherwise quantizes to output frame", () => {
  assert.equal(snapMediaTime(2.93, { clips: [{ id: "a", start: 3, duration: 2 }] }, { threshold: .1 }), 3);
  assert.equal(snapMediaTime(2.41, { clips: [] }, { fps: 30 }), 2.4);
});

test("linked root automation survives split/copy/move and is removed with its target", async () => {
  const session = make();
  const track = { id: "voice-gain", target: "$audio:voice", property: "gain", keyframes: [{ time: 0, value: 0 }, { time: 10, value: 1 }] };
  await session.dispatch(op("timeline.edit", { section: "tracks", upsert: [track] }));
  await session.dispatch(op("media.clip.split", { id: "a", time: 4, newId: "b" }));
  const right = session.document.timeline.audio.find(a => a.linkedClipId === "b");
  const automation = doc => doc.timeline.tracks.find(t => t.target === `$audio:${right.id}`);
  assert.equal(sampleTimelineTrack(automation(session.document), 5), .5);
  await session.dispatch(op("media.clip.update", { id: "b", changes: { start: 7, duration: 3, rate: 2 } }));
  assert.equal(sampleTimelineTrack(automation(session.document), 7.5), .5);
  await session.dispatch(op("media.item.duplicate", { section: "clips", id: "b", newId: "copy" }));
  const copied = session.document.timeline.audio.find(a => a.linkedClipId === "copy");
  assert.equal(sampleTimelineTrack(session.document.timeline.tracks.find(t => t.target === `$audio:${copied.id}`), 10.5), .5);
  await session.dispatch(op("media.clip.remove", { id: "b" }));
  assert.equal(automation(session.document), undefined);
  assert.ok(session.document.timeline.tracks.some(t => t.target === `$audio:${copied.id}`));
  await session.dispatch(op("timeline.edit", { section: "audio", remove: [copied.id] }));
  assert.equal(session.document.timeline.tracks.some(t => t.target === `$audio:${copied.id}`), false);
});

test("NLE root-item edits opt in to exact automation retiming; unsafe signal edits reject atomically", async () => {
  const session = make();
  await session.dispatch(op("timeline.edit", { section: "tracks", upsert: [{ id: "pulse", target: "$audio:voice", property: "gain", signal: { type: "sine", frequency: 2 } }] }));
  const before = session.snapshot();
  await assert.rejects(session.dispatch(op("media.clip.update", { id: "a", changes: { rate: 2 } })), { code: "MEDIA_AUTOMATION_RETIME" });
  assert.equal(session.snapshot(), before);
  await session.dispatch(op("timeline.edit", { section: "audio", upsert: [{ ...before.timeline.audio[0], start: 5 }], retimeAutomation: true }));
  assert.equal(session.document.timeline.tracks[0].start, 5);
  await session.dispatch(op("media.item.duplicate", { section: "audio", id: "voice", newId: "duplicate" }));
  assert.equal(session.document.timeline.tracks.find(t => t.target === "$audio:duplicate").start, 15);
  assert.equal(session.document.timeline.audio.find(t => t.id === "duplicate").linkedClipId, undefined);
});

test("video original audio retains trim handles through split, roll and re-extension", async () => {
  const session = make();
  await session.dispatch(op("timeline.edit", { section: "audio", upsert: [{ ...session.document.timeline.audio[0], linkedRange: "source", sourceDuration: 10 }] }));
  await session.dispatch(op("media.clip.split", { id: "a", time: 4, newId: "b" }));
  await session.dispatch(op("media.clip.roll", { id: "a", nextId: "b", time: 5 }));
  assert.deepEqual(session.document.timeline.audio.map(a => [a.start, a.duration, a.sourceStart]), [[0, 5, 0], [5, 5, 5]]);
  await session.dispatch(op("media.clip.roll", { id: "a", nextId: "b", time: 3 }));
  assert.deepEqual(session.document.timeline.audio.map(a => [a.start, a.duration, a.sourceStart]), [[0, 3, 0], [3, 7, 3]]);
  await session.dispatch(op("media.shot.put", { id: "b", clip: { start: 9 } }));
  assert.deepEqual(session.document.timeline.audio.map(a => [a.start, a.duration, a.sourceStart]), [[0, 3, 0], [9, 7, 3]]);
});

test("open-ended audio duplicates against project bounds and rejects ambiguous ripple timing", async () => {
  const session = make();
  await session.dispatch(op("timeline.edit", { section: "audio", upsert: [{ id: "background", url: "music.wav", start: 0 }] }));
  await session.dispatch(op("media.item.duplicate", { section: "audio", id: "background", newId: "music-copy" }));
  assert.equal(session.document.timeline.audio.find(a => a.id === "music-copy").duration, 10);
  const before = session.snapshot();
  await assert.rejects(session.dispatch(op("media.clip.remove", { id: "a", ripple: true })), { code: "MEDIA_RIPPLE_DURATION_REQUIRED" });
  assert.equal(session.snapshot(), before);
});

test("video editor Agent plans, pauses and resumes in the SAME persistent authoring session", async () => {
  const session = createMediaProjectSession(), service = createMediaOperationService({ session });
  const providerOptions = { provider: "custom", apiKey: "not-a-real-key", model: "fixture" };
  const request = list => async () => { assert.ok(list.length, "unexpected provider request"); return { message: { role: "assistant", content: list.shift() }, finishReason: "stop" }; };
  const first = await runEditorVideoAgent({ service, providerOptions, prompt: "制作视频", confirmStoryboard: true, request: request([JSON.stringify(op("media.plan.set", { shots: [{ id: "intro", title: "开场", duration: 10 }] }))]) });
  assert.equal(first.stopReason, "storyboard_approval_required");
  const planned = session.snapshot(); assert.equal(planned.production.shots.intro.stage, "planned");
  const next = await runEditorVideoAgent({ service, providerOptions, prompt: "继续制作", request: request([JSON.stringify(op("media.shot.put", { id: "intro", scene })), "# done"]) });
  assert.equal(next.completed, true); assert.equal(session.document.scenes.intro.objectList[0].threeJsonId, "box");
  await session.undo(); assert.equal(session.snapshot(), planned);
  session.dispose();
});
