import { buildCommandResult } from "../types.js";
import { handleObjectPatch } from "./object.js";

/**
 * Patch material fields on an object (shorthand for object.patch partial.material).
 * @param {import("../types.js").CommandContext} ctx
 * @param {object} args
 */
export async function handleMaterialPatch(ctx, args = {}) {
  const id = String(args.id ?? "").trim();
  const partial = args.partial ?? args.material ?? null;
  if (!id) {
    return buildCommandResult("material.patch", {
      ok: false,
      mode: "runtime",
      error: "material.patch requires args.id."
    });
  }
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) {
    return buildCommandResult("material.patch", {
      ok: false,
      mode: "runtime",
      error: "material.patch requires args.partial (material fields object)."
    });
  }
  const result = await handleObjectPatch(ctx, {
    id,
    partial: { material: partial },
    options: args.options
  });
  if (result.op === "object.patch") {
    return { ...result, op: "material.patch" };
  }
  return result;
}
