import test from "node:test";
import assert from "node:assert/strict";
import { synthesizeNarration, createMediaProjectSession, createMediaOperationService } from "../packages/media-kit/js/index.js";
import { getCompositeAlphas, layoutCaptionLines } from "../packages/media-kit/js/captions.js";
import { getBuiltinAudioModels, validateAudioModelManifest } from "../packages/audio-kit/js/models.js";

test("caption wrapping preserves Chinese/words and crossfades do not darken or delay incoming shots", () => {
  const text = "中文标题 and English words";
  const lines = layoutCaptionLines(text, s => Array.from(s).length, 8);
  assert.ok(lines.every(s => Array.from(s).length <= 8)); assert.equal(lines.join("").replaceAll(" ", ""), text.replaceAll(" ", ""));
  assert.deepEqual(getCompositeAlphas([{ opacity: .5 }, { opacity: .5 }]), [1, .5]);
  assert.deepEqual(getCompositeAlphas([{ opacity: 1 }, { opacity: .5 }]), [1, .5]);
  assert.deepEqual(getCompositeAlphas([{ opacity: 1 }, { opacity: 1 }]), [1, 1]);
});
test("narration uses measured sentence durations, durable data, and atomic explicit retiming", async () => {
  const producer = { capabilities: { model: "fixture" }, synthesize: async () => ({ sampleRate: 8000, channels: [new Float32Array(8000).fill(.01)] }) };
  const narration = await synthesizeNarration("第一句。第二句！", producer);
  assert.equal(narration.duration, 2); assert.deepEqual(narration.cues.map(c => c.start), [0, 1]); assert.match(narration.cues[0].url, /^data:audio\/wav;base64,/);
  const session = createMediaProjectSession(), service = createMediaOperationService({ session, adapters: { narrate: async () => narration } });
  await service.execute({ op: "media.plan.set", args: { shots: [{ id: "a", title: "A", duration: 1 }, { id: "b", title: "B", duration: 3 }] } });
  const before = session.document;
  assert.equal((await service.execute({ op: "media.shot.narrate", args: { id: "a", text: "第一句。第二句！" } })).code, "NARRATION_EXCEEDS_SHOT");
  assert.equal(session.document, before);
  const receipt = await service.execute({ op: "media.shot.narrate", args: { id: "a", text: "第一句。第二句！", extend: true } });
  assert.equal(receipt.ok, true, receipt.error); assert.equal(session.inspect().duration, 5); assert.equal(session.inspect().shots[1].start, 2);
  assert.equal(session.document.scenes.a.timeline.audio.length, 2); assert.equal(session.document.scenes.a.timeline.captions[1].start, 1);
  await session.undo(); assert.equal(session.document, before); session.dispose();
});
test("bundled Chinese voice catalog is pinned data, not an implicit model download", () => {
  const model = validateAudioModelManifest(getBuiltinAudioModels()[0]);
  assert.ok(model.files.reduce((sum, f) => sum + f.bytes, 0) > 60000000);
  assert.ok(model.files.every(f => /\/resolve\/[a-f0-9]{40}\//.test(f.url)));
});
