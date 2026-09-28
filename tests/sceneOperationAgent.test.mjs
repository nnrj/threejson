import test from "node:test";
import assert from "node:assert/strict";
import { createSceneSession, createSceneOperationService } from "../core/session.js";
import { runSceneOperationAgent, createSceneAgentTools } from "../core/ai/sceneOperationAgent.js";
import { requestChatCompletion } from "../core/ai/sceneAiService.js";

const scene = () => createSceneSession({ objectList: [{ objType: "box", threeJsonId: "b" }] });
test("native functions and JSONL execute identical scene transactions and final postconditions", async () => {
  for (const protocol of ["jsonl", "native"]) {
    const session = scene(), service = createSceneOperationService({ session }); let round = 0;
    const name = [...createSceneAgentTools(service).operations].find(([, op]) => op === "object.transform")[0];
    const args = { id: "b", frame: "parent", position: [1, 2, 3] };
    const result = await runSceneOperationAgent({ service, prompt: "Move b to (1,2,3)", protocol, assertions: [{ type: "position", id: "b", value: [1, 2, 3] }], request: async ({ messages, tools }) => {
      assert.equal(Boolean(tools), protocol === "native"); round++;
      if (round === 2) { assert.equal(session.revision, 1); assert.ok(messages.some((m) => m.content?.includes?.('"status":"committed"'))); return { message: { role: "assistant", content: "# done" } }; }
      return { message: protocol === "native" ? { role: "assistant", tool_calls: [{ id: "call1", type: "function", function: { name, arguments: JSON.stringify(args) } }] } : { role: "assistant", content: JSON.stringify({ op: "object.transform", args }) } };
    } });
    assert.equal(result.completed, true); assert.equal(result.receipts[0].status, "committed");
    await service.undo(); assert.equal(session.document.root.objectList[0].position, undefined); session.dispose();
  }
});
test("agent stops repeated writes and reports unverified completion/budgets without losing completed edits", async () => {
  const session = scene(), service = createSceneOperationService({ session });
  const request = async () => ({ message: { role: "assistant", content: '{"op":"object.transform","args":{"id":"b","frame":"parent","mode":"delta","position":[1,0,0]}}' } });
  assert.equal((await runSceneOperationAgent({ service, prompt: "move", request })).stopReason, "repeated_operations");
  assert.equal(session.document.root.objectList[0].position.x, 1);
  assert.equal((await runSceneOperationAgent({ service, prompt: "move", request, modelBudget: { maxRequests: 1 } })).stopReason, "budget_exhausted");
  assert.equal((await runSceneOperationAgent({ service, prompt: "move", request, modelBudget: { maxTokens: 200 } })).stopReason, "budget_usage_unavailable");
  await assert.rejects(runSceneOperationAgent({ service, prompt: "move", request, modelBudget: { maxCost: 1 } }), /cannot account/);
  const result = await runSceneOperationAgent({ service, prompt: "verify", assertions: [{ type: "photorealism" }], request: async () => ({ message: { role: "assistant", content: "# done" } }) });
  assert.equal(result.completed, false); assert.equal(result.stopReason, "postconditions_not_satisfied"); session.dispose();
});
test("opt-in compatible transport preserves tool-only assistant messages without changing ordinary text calls", async () => {
  const fetch = globalThis.fetch;
  try {
    let body;
    globalThis.fetch = async (_, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "scene_query", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { total_tokens: 25 } }) }; };
    const result = await requestChatCompletion({ apiKey: "fixture", messages: [{ role: "user", content: "query" }], tools: [{ type: "function", function: { name: "scene_query", parameters: { type: "object" } } }], returnMessage: true, stream: true });
    assert.equal(body.stream, false); assert.equal(body.tools.length, 1); assert.equal(result.message.tool_calls[0].id, "a");
  } finally { globalThis.fetch = fetch; }
});

test("provider failure returns earlier receipts instead of hiding a committed partial result", async () => {
  const session = scene(), service = createSceneOperationService({ session }); let calls = 0;
  const result = await runSceneOperationAgent({ service, prompt: "move", request: async () => {
    if (++calls > 1) throw new Error("Provider offline");
    return { message: { role: "assistant", content: [{ type: "text", text: '{"op":"object.transform","args":{"id":"b","frame":"parent","position":[3,0,0]}}' }] } };
  } });
  assert.equal(result.completed, false); assert.equal(result.stopReason, "provider_or_execution_failed");
  assert.equal(result.receipts.length, 1); assert.equal(result.revision, 1);
  assert.equal(session.document.root.objectList[0].position.x, 3); session.dispose();
});
