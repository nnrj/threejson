import test from "node:test";
import assert from "node:assert/strict";
import { createPcmMixer, analyzePcm } from "../packages/audio-kit/js/index.js";
import { prepareProjectAudio } from "../packages/media-kit/js/index.js";
import { sampleTimelineSignal, validateTimelineSignal } from "../core/timeline.js";

test("narration ducks music with attack/release, and seeking does not accumulate gain", () => {
  const pcm = { sampleRate: 100, channels: [new Float32Array(400).fill(1)] };
  const mixer = createPcmMixer([{ id: "music", pcm, ducking: { mode: "narration", gain: .25, attack: .5, release: .5 } },
    { id: "voice", narration: true, pcm, start: 1, duration: 1, gain: 0 }], { sampleRate: 100, channels: 1 });
  const frame = t => mixer.render(t * 100, 1).channels[0][0];
  assert.equal(frame(0), 1); assert.equal(frame(.75), .625); assert.equal(frame(1), .25); assert.equal(frame(1.5), .25);
  assert.equal(frame(2.25), .625); assert.equal(frame(3), 1); assert.equal(frame(1), .25);
});
test("audio timeline automation uses the clipped shot's source clock", async () => {
  const mixer = await prepareProjectAudio({ getAudioClips: async () => [{ id: "v", start: 10, duration: 1, pcm: { sampleRate: 100, channels: [new Float32Array(100).fill(1)] },
    automation: { start: 10, sourceStart: 2, rate: 2, tracks: [{ property: "gain", keyframes: [{ time: 2, value: 0 }, { time: 4, value: 1 }] }] } }] }, { sampleRate: 100 });
  assert.equal(mixer.render(1000, 1).channels[0][0], 0); assert.equal(mixer.render(1050, 1).channels[0][0], .5);
});
test("measured audio envelopes and beat signals are deterministic scalar animation data", () => {
  const measured = analyzePcm({ sampleRate: 100, channels: [new Float32Array([.5, -.5, 1.1, 0])] }, { interval: .02 });
  assert.equal(measured.clippedSamples, 1); assert.equal(measured.envelope.values[0], .5);
  validateTimelineSignal(measured.envelope); assert.equal(sampleTimelineSignal(measured.envelope, 0), .5);
  const beat = { type: "beat", bpm: 120 }; validateTimelineSignal(beat);
  assert.equal(sampleTimelineSignal(beat, 0), sampleTimelineSignal(beat, .5)); assert.ok(sampleTimelineSignal(beat, .25) < .1);
});
