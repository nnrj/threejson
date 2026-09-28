import { buildCommandResult } from "../types.js";

export function modelingCommandHandler(op) {
  return async (ctx, args = {}) => {
    const { planSceneCommands, executeSceneSessionCommands } = await import("../../document/sceneCommandPlan.js");
    if (ctx.options?.session) {
      const result = await executeSceneSessionCommands(ctx.options.session, [{ op, args }], ctx.options);
      return result.results.at(-1);
    }
    if (["model.patch", "model.bake"].includes(op) && ctx.scene) return buildCommandResult(op, { ok: false, mode: "document", error: "Live model writes require executeSceneSessionCommands or ctx.options.session to preserve atomic authoring and undo.", data: { code: "MODEL_SESSION_REQUIRED" } });
    const { compileAuthoring } = await import("../../document/authoringAdapters.js");
    const result = await planSceneCommands(compileAuthoring(ctx.document || ctx.runtime?.normalizedPayload || { objectList: [] }), [{ op, args }], ctx.options);
    if (result.ok && result.operations.length) ctx.document = result.document.root;
    return result.results.at(-1);
  };
}
