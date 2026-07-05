import { buildCommandResult } from "../../../../../../core/command/types.js";

/**
 * @param {import("../types.js").EditorApi} editorApi
 * @param {import("../../../../core/command/types.js").CommandContext} _ctx
 * @param {object} args
 */
export async function handleEditorAgentRun(_ctx, args, editorApi) {
  if (typeof editorApi?.runAgent !== "function") {
    return buildCommandResult("editor.agent.run", {
      ok: false,
      mode: "runtime",
      error: "EditorApi.runAgent is not implemented."
    });
  }
  const input = isObjectRecord(args?.input) ? args.input : args;
  const agentOptions = isObjectRecord(args?.options) ? args.options : {};
  try {
    const result = await editorApi.runAgent(input, agentOptions);
    return buildCommandResult("editor.agent.run", {
      ok: true,
      mode: "runtime",
      data: result
    });
  } catch (err) {
    return buildCommandResult("editor.agent.run", {
      ok: false,
      mode: "runtime",
      error: String(err?.message || err)
    });
  }
}

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
