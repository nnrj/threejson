import { buildCommandResult } from "../../../../../../core/command/types.js";

/**
 * @param {import("../types.js").EditorApi} editorApi
 * @param {import("../../../../core/command/types.js").CommandContext} _ctx
 * @param {object} args
 */
export function handleEditorSelectionGet(_ctx, args, editorApi) {
  return buildCommandResult("editor.selection.get", {
    ok: true,
    mode: "runtime",
    data: { id: editorApi.getSelection() }
  });
}

/**
 * @param {import("../types.js").EditorApi} editorApi
 * @param {import("../../../../core/command/types.js").CommandContext} _ctx
 * @param {object} args
 */
export function handleEditorSelectionSet(_ctx, args, editorApi) {
  const id = args.id == null ? null : String(args.id).trim() || null;
  const res = editorApi.setSelection(id);
  return buildCommandResult("editor.selection.set", {
    ok: Boolean(res.ok),
    mode: "runtime",
    data: { id },
    error: res.ok ? null : res.error || "setSelection failed"
  });
}
