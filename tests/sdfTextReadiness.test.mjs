import test from "node:test";
import assert from "node:assert/strict";
import { BufferGeometry } from "three";
import { waitForSdfText } from "../core/builder/text/sdfTextReadiness.js";

function fakeText(sync) {
  let disposed = 0;
  return { geometry: new BufferGeometry(), sync, dispose() { disposed++; this.geometry.dispose(); }, get disposed() { return disposed; } };
}

test("SDF readiness settles on success and removes cancellation/disposal listeners", async () => {
  const abort = new AbortController();
  const text = fakeText(ready => queueMicrotask(ready));
  assert.equal(await waitForSdfText(text, { signals: [abort.signal], timeoutMs: 20 }), text);
  abort.abort(); text.dispose(); assert.equal(text.disposed, 1);
  assert.equal(text.geometry._listeners?.dispose?.length || 0, 0);
});

test("callback-only font failures time out rather than blocking the resource barrier forever", async () => {
  let ready;
  const text = fakeText(callback => { ready = callback; });
  await assert.rejects(waitForSdfText(text, { timeoutMs: 5 }), { code: "TEXT_SDF_TIMEOUT" });
  ready(); assert.equal(text.disposed, 1, "late sync cannot retain geometry after replacement");
});

test("host abort and object disposal cancel pending SDF work, including a disabled deadline", async () => {
  for (const kind of ["abort", "dispose", "pre-abort"]) {
    const abort = new AbortController(), text = fakeText(() => {});
    if (kind === "pre-abort") abort.abort();
    const result = waitForSdfText(text, { timeoutMs: 0, signals: [abort.signal, abort.signal] });
    if (kind === "abort") abort.abort();
    if (kind === "dispose") text.dispose();
    await assert.rejects(result, { name: "AbortError" });
    assert.equal(text.geometry._listeners?.dispose?.length || 0, 0);
  }
});

test("synchronous SDF preparation errors also settle and release the watchdog", async () => {
  const text = fakeText(() => { throw new Error("worker unavailable"); });
  await assert.rejects(waitForSdfText(text), /worker unavailable/);
  assert.equal(text.geometry._listeners?.dispose?.length || 0, 0);
});

test("Troika reallocating glyph geometry during a successful sync is not cancellation", async () => {
  const text = fakeText(ready => queueMicrotask(() => { text.geometry.dispose(); ready(); }));
  assert.equal(await waitForSdfText(text), text);
});
