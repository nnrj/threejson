import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createEditorHistory } from "../tools/scene-host/editor/js/editorHistory.js";

function makeHistory(overrides = {}) {
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  const scene = new THREE.Scene();
  const messages = [], replayed = [];
  const host = {
    getScene: () => scene,
    showMessage: (text, type) => messages.push({ text, type }),
    getSceneManagePanel: () => null,
    getSceneTree: () => null,
    getSelectedObject: () => null,
    getSceneReserialize: () => null,
    async ingestScenePayload(payload) { replayed.push(payload); return true; },
    ...overrides
  };
  const history = createEditorHistory(host);
  return { history, messages, replayed, cleanup() { globalThis.document = oldDocument; } };
}

test("failed scene undo preserves the undo entry and does not manufacture a redo entry", async () => {
  let calls = 0;
  const env = makeHistory({ ingestScenePayload: async () => ++calls > 1 });
  try {
    env.history.pushCapturedSceneSnapshot({ objectList: [] }, "before");
    const result = await env.history.undo();
    assert.equal(result.ok, false);
    assert.equal(result.rollbackFailed, false);
    assert.equal(env.history.hasUndo(), true);
    assert.equal(env.history.hasRedo(), false);
    assert.equal(calls, 2, "the second replay is rollback, not success");
    assert.ok(!env.messages.some(({ type }) => type === "info"));
  } finally { env.cleanup(); }
});

test("a thrown undo leaves the original entry available for retry", async () => {
  let fail = true;
  const env = makeHistory({ ingestScenePayload: async () => { if (fail) throw new Error("injected failure"); return true; } });
  try {
    env.history.pushCapturedSceneSnapshot({ objectList: [] }, "before");
    assert.equal((await env.history.undo()).ok, false);
    assert.equal(env.history.hasUndo(), true);
    fail = false;
    assert.equal((await env.history.undo()).ok, true);
    assert.equal(env.history.hasUndo(), false);
    assert.equal(env.history.hasRedo(), true);
  } finally { env.cleanup(); }
});

test("history rejects overlapping undo attempts without losing entries", async () => {
  let finish;
  const env = makeHistory({ ingestScenePayload: () => new Promise((resolve) => { finish = resolve; }) });
  try {
    env.history.pushCapturedSceneSnapshot({ objectList: [] }, "before");
    const pending = env.history.undo();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await env.history.undo()).ok, false);
    finish(true);
    assert.equal((await pending).ok, true);
    assert.equal(env.history.hasRedo(), true);
  } finally { env.cleanup(); }
});

test("missing object undo reports failure instead of replaying the current scene as success", async () => {
  const env = makeHistory();
  try {
    env.history.pushObjectObjJsonSnapshot("missing", { position: { x: 1 } }, { position: { x: 2 } }, "edit");
    const result = await env.history.undo();
    assert.equal(result.ok, false);
    assert.equal(env.history.hasUndo(), true);
    assert.equal(env.history.hasRedo(), false);
    assert.ok(env.messages.every(({ type }) => type !== "info"));
  } finally { env.cleanup(); }
});
