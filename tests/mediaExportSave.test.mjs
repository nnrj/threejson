import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderVideo, prepareProjectAudio } from "../packages/media-kit/js/export.js";

const film = JSON.parse(fs.readFileSync(new URL("./fixtures/media-export-relativity.json", import.meta.url), "utf8"));
const audioProject = { getAudioClips: () => film.timeline.audio };
test("reported 150-second film contains only 66.75 seconds of score audio", async () => {
  await assert.rejects(prepareProjectAudio(audioProject), error => {
    assert.match(error.message, /exceeds source duration/);
    assert.equal(error.code, "AUDIO_CLIP_EXCEEDS_SOURCE");
    assert.equal(error.clipId, "score");
    assert.ok(Math.abs(error.availableDuration - 66.7466666667) < 1e-6);
    assert.equal(error.requestedDuration, 150);
    return true;
  });
});
test("explicit export-only audio choices preserve the original score", async () => {
  const before = JSON.stringify(film);
  const loop = await prepareProjectAudio(audioProject, { audioClipOverrides: { score: { loop: true } } });
  assert.equal(loop.duration, 150);
  assert.ok(loop.render(100 * 48000, 100).channels[0].some(value => value !== 0));
  const silence = await prepareProjectAudio(audioProject, { audioClipOverrides: { score: { padSilence: true } } });
  assert.ok(silence.render(100 * 48000, 100).channels[0].every(value => value === 0));
  assert.equal(JSON.stringify(film), before);
});

function fixture({ failFrame, empty = false, writeError, closeError, finalizeError, controller } = {}) {
  const state = { committed: 0, aborted: 0, writes: 0, events: [], samples: 0 };
  const writable = new WritableStream({
    write() { state.writes++; if (writeError) throw writeError; },
    close() { if (closeError) throw closeError; state.committed++; },
    abort() { state.aborted++; }
  });
  const project = { width: 16, height: 16, duration: .2, document: {}, canvas: {},
    renderAt(time) { if (time >= failFrame) throw new Error("Scene resource failed"); }, getAudioClips: () => [] };
  class StreamTarget { constructor(stream) { this.stream = stream; } }
  class BufferTarget { buffer = null; }
  class Output {
    constructor({ target }) { this.target = target; }
    addVideoTrack() {} addAudioTrack() {}
    async start() { this.writer = this.target.stream?.getWriter(); }
    async finalize() {
      if (!empty) { await this.writer?.write({ type: "write", position: 0, data: new Uint8Array([1,2,3,4]) }); this.target.buffer = this.writer ? undefined : new ArrayBuffer(4); }
      if (finalizeError) throw finalizeError;
      await this.writer?.close(); this.writer?.releaseLock();
    }
    // Mediabunny closes its target during cancellation. A file transaction must
    // not interpret that cleanup as permission to commit an unfinished video.
    async cancel() { await this.writer?.close().catch(() => {}); this.writer?.releaseLock(); }
  }
  class CanvasSource { async add() { state.samples++; if (controller) controller.abort(); } close() {} }
  const codecs = { canEncodeVideo: async () => true, Output, StreamTarget, BufferTarget, CanvasSource,
    Mp4OutputFormat: class {}, WebMOutputFormat: class {} };
  return { state, writable, project, options: { codecs, fps: 10, signal: controller?.signal, onProgress: event => state.events.push(event) } };
}
test("file stream commits once, only after encoding and finalizing", async () => {
  const f = fixture(); const result = await renderVideo(f.project, { ...f.options, writable: f.writable });
  assert.equal(result.blob, null); assert.equal(result.bytesWritten, 4);
  assert.equal(f.state.committed, 1); assert.equal(f.state.aborted, 0); assert.equal(f.writable.locked, false);
  assert.deepEqual(f.state.events.filter(e => e.stage !== "encoding").map(e => e.stage), ["preparing", "audio", "rendering", "finalizing", "saving", "complete"]);
});
for (const [name, failure] of [["render failure", { failFrame: .1 }], ["muxer failure", { finalizeError: new Error("Muxer failed") }], ["cancel", { controller: new AbortController() }]]) {
  test(`${name} aborts instead of committing an empty or partial file`, async () => {
    const f = fixture(failure);
    await assert.rejects(renderVideo(f.project, { ...f.options, writable: f.writable }));
    assert.equal(f.state.committed, 0); assert.equal(f.state.aborted, 1); assert.equal(f.writable.locked, false);
    assert.ok(!f.state.events.some(e => e.stage === "complete"));
  });
}
test("empty stream and buffer outputs are errors, not successful exports", async () => {
  for (const useStream of [true, false]) {
    const f = fixture({ empty: true });
    await assert.rejects(renderVideo(f.project, { ...f.options, ...(useStream ? { writable: f.writable } : {}) }), { code: "MEDIA_EMPTY_OUTPUT" });
    assert.equal(f.state.committed, 0);
  }
});
test("file commit failures are surfaced and never report complete", async () => {
  const f = fixture({ closeError: new Error("Disk full") });
  await assert.rejects(renderVideo(f.project, { ...f.options, writable: f.writable }), /Disk full/);
  assert.ok(!f.state.events.some(e => e.stage === "complete"));
});

test("file write failures propagate without committing or retaining a writer lock", async () => {
  const f = fixture({ writeError: new Error("File write denied") });
  await assert.rejects(renderVideo(f.project, { ...f.options, writable: f.writable }), /File write denied/);
  assert.equal(f.state.committed, 0); assert.equal(f.writable.locked, false);
  assert.ok(!f.state.events.some(e => e.stage === "complete"));
});
test("the file stream is opened only after audio and the first frame are ready", async () => {
  const f = fixture({ failFrame: 0 }); let opened = false;
  await assert.rejects(renderVideo(f.project, { ...f.options, openWritable: () => { opened = true; return f.writable; } }), /Scene resource failed/);
  assert.equal(opened, false);
});

test("a broken later draft shot fails before opening a writable or encoding frames", async () => {
  const f = fixture({ failFrame: 1 }); let opened = false;
  f.project.duration = 2;
  f.project.document = { documentType: "composition", production: { state: "paused" }, timeline: { clips: [
    { id: "a", start: 0, duration: 1 }, { id: "b", start: 1, duration: 1 }
  ] } };
  await assert.rejects(renderVideo(f.project, { ...f.options, openWritable: () => { opened = true; return f.writable; } }), /Scene resource failed/);
  assert.equal(opened, false); assert.equal(f.state.samples, 0);
});

test("valid paused drafts and trimmed/disabled shots remain exportable", async () => {
  for (const ignored of [{ start: 1, duration: 1 }, { start: .1, duration: 1, enabled: false }, { start: .1, duration: 1, laneId: "hidden" }]) {
    const f = fixture({ failFrame: .2 });
    f.project.document = { documentType: "composition", production: { state: "paused" }, timeline: {
      lanes: [{ id: "hidden", enabled: false }], clips: [{ id: "ok", start: 0, duration: .2 }, { id: "ignore", ...ignored }]
    } };
    const result = await renderVideo(f.project, f.options);
    assert.ok(result.blob.size > 0); assert.equal(f.state.samples, 2);
  }
});
