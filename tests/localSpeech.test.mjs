import test from "node:test";
import assert from "node:assert/strict";
import { createLocalNarrationHost, prepareDefaultLocalNarrationHost } from "../packages/host-kit/js/localSpeech.js";

function fixture({ status = "missing", selected = null, downloadError, statusError } = {}) {
  const calls = { download: 0, close: 0, producer: 0, dispose: 0, load: 0 };
  const model = { id: "default-voice", files: [{ role: "a", bytes: 40 }, { role: "b", bytes: 60 }] };
  const manager = {
    async status() { if (statusError) throw statusError; return { status }; },
    async download(value, { signal, onProgress }) {
      calls.download++; assert.equal(value, model); signal?.throwIfAborted();
      if (downloadError) throw downloadError;
      onProgress({ role: "a", loaded: 40, total: 40 });
      onProgress({ role: "b", loaded: 30, total: 60 });
      onProgress({ role: "b", loaded: 60, total: 60 });
    }, close() { calls.close++; }
  };
  const sdk = { getBuiltinAudioModels: () => [model], async createLocalSpeechProducer() { calls.producer++; return { dispose() { calls.dispose++; } }; } };
  return { calls, options: {
    loadModels: async () => { calls.load++; return sdk; }, createManager: async () => manager,
    getPreference: () => selected, synthesizeNarration: async (text, producer, options) => ({ text, speed: options.speed })
  } };
}

test("explicit export prepares a missing default voice without an Enable preference", async () => {
  const { calls, options } = fixture(), progress = [];
  const host = await prepareDefaultLocalNarrationHost({ ...options, onProgress: value => progress.push(value) });
  assert.equal(host.available, true); assert.equal(host.model, "default-voice");
  assert.equal(calls.download, 1); assert.equal(calls.producer, 0);
  assert.deepEqual(progress.map(value => value.progress), [0, .4, .7, 1]);
  assert.deepEqual(await host.narrate({ text: "你好", speed: 1.2 }, {}), { text: "你好", speed: 1.2 });
  assert.equal(calls.producer, 1);
  host.dispose(); host.dispose(); assert.equal(calls.close, 1); assert.equal(calls.dispose, 1);
  await assert.rejects(host.narrate({ text: "closed" }, {}), /disposed/);
});

test("warm exports reuse installed resources, stale preferences fall back to the built-in voice", async () => {
  const { calls, options } = fixture({ status: "ready", selected: "removed-voice" });
  const host = await prepareDefaultLocalNarrationHost(options);
  assert.equal(calls.download, 0); assert.equal(host.model, "default-voice"); host.dispose();
  assert.equal(calls.close, 1);
});

test("Agent availability remains opt-in and never implicitly downloads a voice", async () => {
  const cold = fixture(); const disabled = await createLocalNarrationHost(cold.options);
  assert.equal(disabled.available, false); assert.equal(cold.calls.load, 0);
  const missing = fixture({ selected: "default-voice" });
  assert.equal((await createLocalNarrationHost(missing.options)).available, false);
  assert.equal(missing.calls.download, 0); assert.equal(missing.calls.close, 1);
  const warm = fixture({ selected: "default-voice", status: "ready" });
  const host = await createLocalNarrationHost(warm.options); assert.equal(host.available, true);
  assert.equal(warm.calls.download, 0); assert.equal(warm.calls.producer, 0); host.dispose();
});

test("download/storage failures and cancellation close resources without returning a silent host", async () => {
  const failed = fixture({ downloadError: new Error("fixture network") });
  await assert.rejects(prepareDefaultLocalNarrationHost(failed.options), { code: "LOCAL_NARRATION_DOWNLOAD_FAILED" });
  assert.equal(failed.calls.close, 1); assert.equal(failed.calls.producer, 0);
  const aborted = fixture({ downloadError: new DOMException("cancel", "AbortError") });
  await assert.rejects(prepareDefaultLocalNarrationHost(aborted.options), { name: "AbortError" });
  assert.equal(aborted.calls.close, 1);
  const controller = new AbortController(); controller.abort();
  const untouched = fixture();
  await assert.rejects(prepareDefaultLocalNarrationHost({ ...untouched.options, signal: controller.signal }), { name: "AbortError" });
  assert.equal(untouched.calls.load, 0);
  const broken = fixture({ selected: "default-voice", statusError: new Error("storage failed") });
  await assert.rejects(createLocalNarrationHost(broken.options), /storage failed/);
  assert.equal(broken.calls.close, 1);
});
