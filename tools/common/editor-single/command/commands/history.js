import { buildCommandResult } from "../../../../../core/command/types.js";

/**
 * @param {import("../types.js").EditorApi} editorApi
 */
export async function handleEditorHistoryUndo(_ctx, _args, editorApi) {
  const res = await editorApi.undo();
  return buildCommandResult("editor.history.undo", {
    ok: Boolean(res.ok),
    mode: "runtime",
    error: res.ok ? null : "nothing to undo"
  });
}

/**
 * @param {import("../types.js").EditorApi} editorApi
 */
export async function handleEditorHistoryRedo(_ctx, _args, editorApi) {
  const res = await editorApi.redo();
  return buildCommandResult("editor.history.redo", {
    ok: Boolean(res.ok),
    mode: "runtime",
    error: res.ok ? null : "nothing to redo"
  });
}
