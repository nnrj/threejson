import { buildCommandResult } from "../../../../../core/command/types.js";

/**
 * @param {import("../types.js").EditorApi} editorApi
 * @param {import("../../../../../../core/command/types.js").CommandContext} _ctx
 * @param {object} args
 */
export function handleEditorViewFit(_ctx, args, editorApi) {
  const target = args.target === "selection" ? "selection" : "scene";
  const res = editorApi.fitView(target);
  return buildCommandResult("editor.view.fit", {
    ok: Boolean(res.ok),
    mode: "runtime",
    data: { target },
    error: res.ok ? null : "fitView failed"
  });
}
