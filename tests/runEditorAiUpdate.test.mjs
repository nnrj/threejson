import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveUpdateRoute } from "../tools/common/editor-single/ai/runEditorAiUpdate.js";

test("resolveUpdateRoute uses agent for commands/auto/json-full when agent enabled", () => {
  assert.equal(resolveUpdateRoute({ outputMode: "commands", agentEnabled: true }), "agent");
  assert.equal(resolveUpdateRoute({ outputMode: "auto", agentEnabled: true }), "agent");
  assert.equal(resolveUpdateRoute({ outputMode: "json-full", agentEnabled: true }), "agent");
});

test("resolveUpdateRoute uses single round when agent disabled or incremental", () => {
  assert.equal(resolveUpdateRoute({ outputMode: "commands", agentEnabled: false }), "single");
  assert.equal(resolveUpdateRoute({ outputMode: "auto", agentEnabled: false }), "single");
  assert.equal(resolveUpdateRoute({ outputMode: "json-incremental", agentEnabled: true }), "single");
  assert.equal(resolveUpdateRoute({ outputMode: "json-incremental", agentEnabled: false }), "single");
});
