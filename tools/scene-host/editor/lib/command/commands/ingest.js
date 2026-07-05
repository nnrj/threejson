import { buildCommandResult } from "../../../../../../core/command/types.js";

function isObjectRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * @param {import("../types.js").EditorApi} editorApi
 * @param {import("../../../../core/command/types.js").CommandContext} ctx
 * @param {object} args
 */
export async function handleEditorIngest(ctx, args, editorApi) {
  const payload = isObjectRecord(args.json)
    ? args.json
    : isObjectRecord(ctx.document)
      ? ctx.document
      : null;
  if (!payload) {
    return buildCommandResult("editor.ingest", {
      ok: false,
      mode: "runtime",
      error: "editor.ingest requires args.json or ctx.document."
    });
  }
  const label = typeof args.label === "string" ? args.label : "命令载入";
  const ingestOptions = isObjectRecord(args.options) ? args.options : {};
  const res = await editorApi.ingest(payload, { ...ingestOptions, label });
  return buildCommandResult("editor.ingest", {
    ok: Boolean(res.ok),
    mode: "runtime",
    error: res.ok ? null : res.error || "ingest failed"
  });
}
