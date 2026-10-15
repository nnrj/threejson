import { buildCommandResult } from "../types.js";
import { handleSceneLoad } from "./scene.js";

/** Legacy command hosts share the document planner; session hosts retain atomic undo. */
export function visualCommandHandler(op) {
  return async (ctx, args) => {
    const { planSceneCommands, executeSceneSessionCommands } = await import("../../document/sceneCommandPlan.js");
    if (ctx.options?.session) return (await executeSceneSessionCommands(ctx.options.session, [{ op, args }], ctx.options)).results.at(-1);
    const { compileAuthoring } = await import("../../document/authoringAdapters.js");
    const result = await planSceneCommands(compileAuthoring(ctx.document || ctx.runtime?.normalizedPayload || { objectList: [] }), [{ op, args }], ctx.options);
    if (!result.ok) return result.results.at(-1);
    if (ctx.runtime) {
      const applied = await handleSceneLoad(ctx, { json: result.document.root });
      if (!applied.ok) return buildCommandResult(op, { ...applied, op });
    } else ctx.document = result.document.root;
    return result.results.at(-1);
  };
}
