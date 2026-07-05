import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import { createCommandContext, createCommandRegistry, executeCommand } from "../core/command/index.js";
import { registerEditorCommands } from "../tools/common/editor-single/command/index.js";
import { clearObjectRegistry } from "../core/handler/objectRegistry.js";

test("registerEditorCommands adds editor.exec and routes through EditorApi", async () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const history = [];
  const registry = createCommandRegistry();
  const editorApi = {
    getCommandContext: () => createCommandContext({ scene }),
    ingest: async () => ({ ok: true }),
    getSelection: () => null,
    setSelection: () => ({ ok: true }),
    undo: async () => ({ ok: false }),
    redo: async () => ({ ok: false }),
    fitView: () => ({ ok: true }),
    execCoreCommands: async (input) => {
      history.push(input);
      return {
        ok: true,
        results: [{ ok: true, op: "object.add", data: { threeJsonId: "mock-1" } }]
      };
    }
  };
  registerEditorCommands(registry, editorApi);
  const ctx = editorApi.getCommandContext();
  const res = await executeCommand(
    ctx,
    {
      op: "editor.exec",
      args: {
        label: "test",
        commands: [{ op: "object.add", args: { descriptor: { objType: "box", name: "x" } } }]
      }
    },
    { registry }
  );
  assert.equal(res.ok, true);
  assert.equal(history.length, 1);
  clearObjectRegistry();
});

test("editor.selection.get/set via mock EditorApi", async () => {
  const registry = createCommandRegistry();
  let selected = "a";
  const editorApi = {
    getCommandContext: () => createCommandContext(),
    ingest: async () => ({ ok: true }),
    getSelection: () => selected,
    setSelection: (id) => {
      selected = id || "";
      return { ok: true };
    },
    undo: async () => ({ ok: false }),
    redo: async () => ({ ok: false }),
    fitView: () => ({ ok: true }),
    execCoreCommands: async () => ({ ok: true, results: [] })
  };
  registerEditorCommands(registry, editorApi);
  const ctx = editorApi.getCommandContext();
  const got = await executeCommand(ctx, { op: "editor.selection.get", args: {} }, { registry });
  assert.equal(got.data.id, "a");
  const set = await executeCommand(
    ctx,
    { op: "editor.selection.set", args: { id: "b" } },
    { registry }
  );
  assert.equal(set.ok, true);
  assert.equal(selected, "b");
});

test("editor.agent.run delegates to EditorApi.runAgent", async () => {
  const registry = createCommandRegistry();
  const editorApi = {
    getCommandContext: () => createCommandContext(),
    ingest: async () => ({ ok: true }),
    getSelection: () => null,
    setSelection: () => ({ ok: true }),
    undo: async () => ({ ok: false }),
    redo: async () => ({ ok: false }),
    fitView: () => ({ ok: true }),
    execCoreCommands: async () => ({ ok: true, results: [] }),
    runAgent: async (input) => ({ sceneJsonString: "{}", input })
  };
  registerEditorCommands(registry, editorApi);
  const ctx = editorApi.getCommandContext();
  const res = await executeCommand(
    ctx,
    {
      op: "editor.agent.run",
      args: { input: { mode: "generate", prompt: "room" } }
    },
    { registry }
  );
  assert.equal(res.ok, true);
  assert.equal(res.data.input.mode, "generate");
});

test("editor.view.fit selection delegates to EditorApi.fitView", async () => {
  const registry = createCommandRegistry();
  const calls = [];
  const editorApi = {
    getCommandContext: () => createCommandContext(),
    ingest: async () => ({ ok: true }),
    getSelection: () => "sel-1",
    setSelection: () => ({ ok: true }),
    undo: async () => ({ ok: false }),
    redo: async () => ({ ok: false }),
    fitView: (target) => {
      calls.push(target);
      return { ok: true, target };
    },
    execCoreCommands: async () => ({ ok: true, results: [] })
  };
  registerEditorCommands(registry, editorApi);
  const ctx = editorApi.getCommandContext();
  const res = await executeCommand(
    ctx,
    { op: "editor.view.fit", args: { target: "selection" } },
    { registry }
  );
  assert.equal(res.ok, true);
  assert.deepEqual(calls, ["selection"]);
  assert.equal(res.data.target, "selection");
});

test("wrapAsEditorExec wraps core commands for editor.exec", async () => {
  const { wrapAsEditorExec } = await import("../tools/common/editor-single/ai/wrapCoreCommandsForEditor.js");
  const wrapped = wrapAsEditorExec(
    [{ op: "object.patch", args: { id: "a", partial: { position: { x: 1 } } } }],
    "移动"
  );
  assert.equal(wrapped.op, "editor.exec");
  assert.equal(wrapped.args.label, "移动");
  assert.equal(wrapped.args.commands.length, 1);
  assert.equal(wrapped.args.commands[0].op, "object.patch");
});
