import { handleEditorExec } from "./commands/exec.js";
import { handleEditorIngest } from "./commands/ingest.js";
import { handleEditorHistoryRedo, handleEditorHistoryUndo } from "./commands/history.js";
import { handleEditorSelectionGet, handleEditorSelectionSet } from "./commands/selection.js";
import { handleEditorViewFit } from "./commands/view.js";
import { handleEditorAgentRun } from "./commands/agent.js";
import { EDITOR_COMMAND_SPECS } from "./specs.js";

/**
 * @param {ReturnType<import("../../../core/command/registry.js").createCommandRegistry>} registry
 * @param {import("./types.js").EditorApi} editorApi
 */
export function registerEditorCommands(registry, editorApi) {
  if (!registry || typeof registry.register !== "function") {
    throw new Error("registerEditorCommands requires a command registry.");
  }
  if (!editorApi || typeof editorApi.getCommandContext !== "function") {
    throw new Error("registerEditorCommands requires EditorApi.");
  }

  const wrap = (handler, spec) => {
    return async (ctx, args) => handler(ctx, args, editorApi);
  };

  for (const spec of EDITOR_COMMAND_SPECS) {
    const handlers = {
      "editor.exec": handleEditorExec,
      "editor.ingest": handleEditorIngest,
      "editor.selection.get": handleEditorSelectionGet,
      "editor.selection.set": handleEditorSelectionSet,
      "editor.history.undo": handleEditorHistoryUndo,
      "editor.history.redo": handleEditorHistoryRedo,
      "editor.view.fit": handleEditorViewFit,
      "editor.agent.run": handleEditorAgentRun
    };
    const handler = handlers[spec.op];
    if (handler) {
      registry.register(spec.op, wrap(handler, spec), spec);
    }
  }
}

export function getEditorCommandHelp() {
  return EDITOR_COMMAND_SPECS.map((spec) => `${spec.op}: ${spec.summary}`).join("\n");
}

export { EDITOR_COMMAND_SPECS };
