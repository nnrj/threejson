import { buildCommandResult } from "../../../../../../core/command/types.js";

/**
 * @param {import("../types.js").EditorApi} editorApi
 * @param {import("../../../../core/command/types.js").CommandContext} _ctx
 * @param {object} args
 */
export async function handleEditorExec(_ctx, args, editorApi) {
  if (typeof editorApi?.execCoreCommands !== "function") {
    return buildCommandResult("editor.exec", {
      ok: false,
      mode: "runtime",
      error: "EditorApi.execCoreCommands is not implemented."
    });
  }
  const input = args.commands ?? args.script ?? args.command ?? null;
  if (input == null) {
    return buildCommandResult("editor.exec", {
      ok: false,
      mode: "runtime",
      error: "editor.exec requires args.commands, args.script, or args.command."
    });
  }
  const batch = await editorApi.execCoreCommands(input, {
    label: typeof args.label === "string" ? args.label : "AI 命令"
  });
  return buildCommandResult("editor.exec", {
    ok: Boolean(batch.ok),
    mode: "runtime",
    data: { results: batch.results },
    error: batch.ok ? null : batch.results?.find((item) => !item.ok)?.error || "editor.exec failed"
  });
}
