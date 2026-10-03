import { parseCommandScript } from "../command/parser.js";
import { requestChatCompletion } from "./sceneAiService.js";
import { stripMarkdownCodeFence } from "../util/sceneJsonSanitize.js";

/** Provider functions and JSONL use the same service contracts and executor. */
export function createSceneAgentTools(service) {
  const specs = service.discover().commands;
  const operations = new Map(specs.map((spec, i) => [`scene_${i}_${spec.op.replace(/[^A-Za-z0-9_-]/g, "_")}`, spec.op]));
  return { operations, tools: specs.map((spec, i) => ({ type: "function", function: { name: [...operations.keys()][i], description: `${spec.summary} Category:${spec.category}; targets:${spec.targets.join(",") || "any"}; prerequisites:${spec.requirements.join(",") || "none"}.`, parameters: spec.inputSchema } })) };
}

export async function runSceneOperationAgent({ service, prompt, protocol = "jsonl", assertions, signal, request, modelBudget = {}, onProgress, systemInstructions, onReceipt, completionCheck, contextCheckpoint, visionAvailable = true, ...transport } = {}) {
  if (!service?.execute || !prompt) throw new TypeError("A scene operation service and prompt are required.");
  if (!["jsonl", "native"].includes(protocol)) throw new TypeError("protocol must be jsonl or native.");
  for (const [name, value] of Object.entries(modelBudget)) if (value != null && (!Number.isFinite(value) || value <= 0)) throw new TypeError(`Invalid explicit budget ${name}.`);
  for (const name of Object.keys(modelBudget)) if (!["maxRequests", "maxTokens", "maxTimeMs"].includes(name)) throw new TypeError(`This operation agent cannot account for budget ${name}; configure provider-side billing or a supported budget instead.`);
  const discovery = service.discover(), catalog = createSceneAgentTools(service), startedAt = Date.now(), turnId = globalThis.crypto.randomUUID();
  const deadline = modelBudget.maxTimeMs ? startedAt + modelBudget.maxTimeMs : undefined;
  const receipts = [], steps = [], seen = new Set(); let requests = 0, tokens = 0;
  const controller = new AbortController(), abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timer = deadline ? setTimeout(() => controller.abort(Object.assign(new Error("Explicit time budget exhausted."), { code: "AI_BUDGET_EXCEEDED" })), modelBudget.maxTimeMs) : null;
  const messages = [{ role: "system", content: `You operate a versioned ThreeJSON scene through tools, not by guessing runtime state. Start with compact scene.query/scene.observe. Read controls before edits. Use model.inspect for modeledMesh, mesh.getTopology only for editableMesh. No geometry data is needed for object placement. Regular primitives remain appropriate for regular shapes; use control meshes, graphs or surfaces where the shape requires them. Prefer parameter/operator edits and deterministic local refinement over rewriting dense geometry. Use preconditions/revisions and verify scene.check/scene.capture when available. A diagnostic relit view is not evidence that actual scene lighting works. Unchecked is not passed. Never invent resources or claim visual verification without rendering. Each response is one atomic authoring batch; runtime-only actions must be separate. Stop after fulfilling the request, without a fixed quality-round count. ${protocol === "native" ? "Use the supplied functions; finish with a concise result once verified." : `Return only JSONL commands {"op":"...","args":{...}}; after completion return # done. Contracts: ${JSON.stringify(discovery.commands)}`}\nSession: ${JSON.stringify({ sessionId: discovery.sessionId, revision: discovery.revision, capabilities: discovery.capabilities })}` }, { role: "user", content: prompt }];
  const finish = (completed, stopReason, message = "") => ({ agentUsed: true, completed, stopReason, message, receipts, steps, requests, tokens, revision: service.revision });
  if (systemInstructions) messages[0].content = `${systemInstructions}\n${protocol === "native" ? "Use supplied functions. After verified completion return a concise result." : `Return only JSONL commands {"op":"...","args":{...}}; finish with # done. Contracts: ${JSON.stringify(discovery.commands)}`}\nSession: ${JSON.stringify({ sessionId: discovery.sessionId, revision: discovery.revision, capabilities: discovery.capabilities })}`;
  try {
    while (true) {
      controller.signal.throwIfAborted();
      if (modelBudget.maxRequests && requests >= modelBudget.maxRequests || modelBudget.maxTokens && tokens >= modelBudget.maxTokens) return finish(false, "budget_exhausted");
      const baseRevision = service.revision;
      onProgress?.({ stage: "reasoning", requests, revision: baseRevision });
      const response = await (request || requestChatCompletion)({ ...transport, messages, tools: protocol === "native" ? catalog.tools : undefined, returnMessage: true, stream: false, signal: controller.signal, turnDeadlineAt: deadline,
        ...(modelBudget.maxTokens ? { maxTokens: Math.max(1, modelBudget.maxTokens - tokens) } : {}) });
      requests++;
      const usage = response.usage?.total_tokens;
      if (modelBudget.maxTokens && !Number.isFinite(usage)) return finish(false, "budget_usage_unavailable");
      if (Number.isFinite(usage)) tokens += usage;
      const message = typeof response === "string" ? { role: "assistant", content: response } : response.message && { ...response.message };
      if (!message) throw new Error("Provider returned no assistant message.");
      if (Array.isArray(message.content)) message.content = message.content.filter((part) => part.type === "text").map((part) => part.text || "").join("\n");
      if (response.finishReason === "length") return finish(false, "provider_output_truncated", "The provider truncated the operation batch; no incomplete commands were applied.");
      if (!message.content?.trim() && !message.tool_calls?.length) return finish(false, "empty_provider_output");
      messages.push(message);
      let commands;
      const calls = protocol === "native" ? message.tool_calls || [] : [];
      try {
        commands = protocol === "native" ? calls.map((call) => {
          const op = catalog.operations.get(call.function?.name);
          if (!op) throw new Error(`Unknown function: ${call.function?.name}`);
          return { op, args: JSON.parse(call.function.arguments || "{}") };
        }) : /^\s*#\s*done\s*$/i.test(stripMarkdownCodeFence(message.content || "")) ? [] : parseCommandScript(message.content || "");
      } catch (error) {
        steps.push({ kind: "invalid_command_output", ok: false, error: error.message, request: requests, revision: baseRevision });
        onProgress?.({ stage: "invalid_output", revision: baseRevision, diagnostics: [{ code: "INVALID_COMMAND_OUTPUT", message: error.message }] });
        const key = `invalid:${baseRevision}:${message.content || JSON.stringify(calls)}`;
        if (seen.has(key)) return finish(false, "repeated_invalid_output", error.message);
        seen.add(key);
        const feedback = JSON.stringify({ ok: false, code: "INVALID_COMMAND_OUTPUT", error: error.message,
          recovery: 'Nothing in this response was applied. Return one complete command object {"op":"<discovered operation>","args":{...}} or a JSON array of such objects, not a scene/document or prose. Use the exact discovered argument names. Keep the next batch small; do not repeat the invalid response.' });
        if (calls.length) for (const call of calls) messages.push({ role: "tool", tool_call_id: call.id, content: feedback });
        else messages.push({ role: "user", content: feedback });
        continue;
      }
      if (!commands.length) {
        if (completionCheck) {
          const check = await completionCheck({ service, signal: controller.signal });
          if (!check.ok) {
            const key = `completion:${baseRevision}:${JSON.stringify(check)}`;
            if (seen.has(key)) return finish(false, "postconditions_not_satisfied", check.message || "Completion checks failed.");
            seen.add(key); messages.push({ role: "user", content: JSON.stringify(check) }); continue;
          }
        }
        if (assertions?.length) {
          const check = await service.execute({ op: "scene.check", args: { assertions } }, { signal: controller.signal }); receipts.push(check);
          if (!check.ok || !check.results[0]?.data?.satisfied) return finish(false, "postconditions_not_satisfied");
        }
        return finish(true, "model_done", message.content || "");
      }
      const readOnly = commands.every((command) => discovery.commands.find((spec) => spec.op === command.op)?.category === "read");
      const key = JSON.stringify({ commands, ...(readOnly ? { revision: baseRevision } : {}) });
      if (seen.has(key)) return finish(false, "repeated_operations");
      seen.add(key);
      onProgress?.({ stage: "preparing", operations: commands.map((command) => command.op), revision: baseRevision });
      const receipt = await service.execute(commands, { baseRevision, requestId: `${turnId}:${requests}`, signal: controller.signal }); receipts.push(receipt);
      steps.push({ kind: commands.map(command => command.op).join(", "), ok: receipt.ok, revision: service.revision, ...(receipt.ok ? {} : { error: receipt.error || receipt.diagnostics?.[0]?.message }) });
      onProgress?.({ stage: receipt.status, revision: service.revision, diagnostics: receipt.diagnostics });
      const action = await onReceipt?.(receipt, { service, commands, signal: controller.signal });
      if (action?.pause) return finish(false, action.reason || "paused");
      // Image data is sent as image input, never repeated as thousands of text tokens.
      const images = [];
      const content = JSON.stringify(receipt, (key, value) => {
        if (key === "dataUrl" && typeof value === "string" && value.startsWith("data:image/")) { if (visionAvailable) images.push(value); return visionAvailable ? "[image attached]" : "[image not supplied: provider has no declared vision support]"; }
        return value;
      });
      if (calls.length) for (const call of calls) messages.push({ role: "tool", tool_call_id: call.id, content });
      else messages.push({ role: "user", content });
      if (images.length) messages.push({ role: "user", content: [{ type: "text", text: "Scene feedback; preserve each receipt's scene/diagnostic lighting distinction." }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] });
      if (contextCheckpoint && receipt.ok && receipt.status === "committed") {
        const checkpoint = await contextCheckpoint({ service, receipt, commands, signal: controller.signal });
        if (checkpoint) {
          // Complete native tool exchanges are retired together, never leave an
          // orphaned tool_call_id. Receipts remain available to the host/audit log.
          messages.splice(2);
          messages.push({ role: "user", content: `Committed state checkpoint (not a new request): ${JSON.stringify(checkpoint)}. Continue the original request; inspect a shot when its detailed data is needed.` });
        }
      }
    }
  } catch (error) {
    if (controller.signal.aborted) return finish(false, controller.signal.reason?.code === "AI_BUDGET_EXCEEDED" ? "budget_exhausted" : "cancelled");
    return { ...finish(false, "provider_or_execution_failed", error.message), error: { code: error.code || "AI_OPERATION_FAILED", message: error.message } };
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}
