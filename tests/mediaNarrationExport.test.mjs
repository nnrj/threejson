import test from "node:test";
import assert from "node:assert/strict";
import { collectExportNarration, synthesizeExportNarration } from "../packages/host-kit/js/mediaNarrationExport.js";

const caption = (id, text, start, duration) => ({ id, text, start, duration });
test("export narration reads timed captions without reading every 3D label or changing JSON", async () => {
  const document = { objectList: [{ objType: "sdfText", text: "A title, not narration" }], timeline: { captions: [caption("a", "第一句。", 1, 3), caption("b", "第二句。", 5, 3), { ...caption("off", "隐藏", 0, 1), enabled: false }] } };
  const before = structuredClone(document);
  const plan = await collectExportNarration(document, { duration: 8 });
  assert.deepEqual(plan.cues.map(c => [c.text, c.start, c.duration]), [["第一句。", 1, 3], ["第二句。", 5, 3]]);
  assert.deepEqual(document, before);
  const custom = await collectExportNarration(document, { duration: 8, mode: "custom", text: "自填旁白。" });
  assert.deepEqual(custom.cues, [{ id: "custom", text: "自填旁白。", start: 0, duration: 8 }]);
});

test("composition captions resolve per-shot trim/rate and narration metadata remains a fallback", async () => {
  const document = { documentType: "composition", scenes: { a: { timeline: { captions: [caption("c", "剪辑后的字幕", 2, 6)] } } },
    timeline: { clips: [{ id: "shot", source: "a", start: 4, duration: 5, sourceStart: 4, rate: 2 }] }, production: { shots: { shot: { narration: "分镜台词" } } } };
  const auto = await collectExportNarration(document, { duration: 12 });
  assert.deepEqual(auto.cues.map(c => [c.start, c.duration]), [[4, 2]]);
  const shots = await collectExportNarration(document, { duration: 12, mode: "shots" });
  assert.deepEqual(shots.cues.map(c => [c.text, c.start, c.duration]), [["分镜台词", 4, 5]]);
  delete document.scenes;
  const remote = await collectExportNarration(document, { duration: 12, loadScene: async () => ({ timeline: { captions: [caption("c", "外部片段", 4, 4)] } }) });
  assert.equal(remote.cues[0].text, "外部片段");
});

test("existing authored narration is not doubled; music alone never suppresses speech", async () => {
  const document = { timeline: { captions: [caption("a", "一句", 0, 3), caption("b", "二句", 4, 3)] } };
  const plan = await collectExportNarration(document, { duration: 8, audioClips: [{ narration: true, start: 0, duration: 3 }, { start: 0, duration: 8, recipe: { kind: "score" } }] });
  assert.equal(plan.skipped, 1);assert.equal(plan.cues.length, 1);assert.equal(plan.cues[0].text, "二句");
});

const voice = duration => ({ available: true, async narrate() { return { duration, cues: [{ start: 0, duration, url: "data:audio/wav;base64,fixture" }] }; } });
test("export TTS is measured PCM audio, aligned with source cues and atomic on failure", async () => {
  const plan = { cues: [caption("a", "一句", 1, 2), caption("b", "二句", 4, 2)] };
  const clips = await synthesizeExportNarration(plan, voice(1.5));
  assert.deepEqual(clips.map(c => [c.start, c.duration]), [[1, 1.5], [4, 1.5]]);
  assert.ok(clips.every(c => c.narration && c.url.startsWith("data:audio/")));
  await assert.rejects(synthesizeExportNarration(plan, voice(3)), { code: "NARRATION_EXCEEDS_CUE" });
  await assert.rejects(synthesizeExportNarration({ cues: [plan.cues[0], plan.cues[0]] }, voice(1)), { code: "NARRATION_CUES_OVERLAP" });
  await assert.rejects(synthesizeExportNarration(plan, { available: false }), { code: "LOCAL_NARRATION_UNAVAILABLE" });
  const controller = new AbortController();controller.abort();
  await assert.rejects(synthesizeExportNarration(plan, voice(1), { signal: controller.signal }), { name: "AbortError" });
  let count = 0;
  await assert.rejects(synthesizeExportNarration(plan, { available: true, async narrate() { if (++count === 2) throw new Error("fixture failed"); return voice(1).narrate(); } }), /fixture failed/);
});
