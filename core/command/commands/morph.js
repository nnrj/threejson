import { getObjectByThreeJsonId } from "../../handler/objectRegistry.js";
import { listMorphTargets, setMorphTargetInfluence } from "../../handler/morphTargetRuntime.js";
import { buildCommandResult } from "../types.js";

function find(ctx, args, op) {
  const id = String(args.id ?? "").trim();
  if (!ctx.scene?.isScene || !id) {
    return { error: buildCommandResult(op, { ok: false, mode: "runtime", error: `${op} requires ctx.scene and args.id.` }) };
  }
  const object = getObjectByThreeJsonId(id, ctx.scene);
  if (!object) return { error: buildCommandResult(op, { ok: false, mode: "runtime", error: `Object not found for threeJsonId "${id}".` }) };
  return { id, object };
}

export function handleMorphList(ctx, args = {}) {
  const found = find(ctx, args, "morph.list");
  if (found.error) return found.error;
  const meshes = listMorphTargets(found.object, { mesh: args.mesh });
  return buildCommandResult("morph.list", { ok: true, mode: "runtime", data: { threeJsonId: found.id, meshes } });
}

export function handleMorphSet(ctx, args = {}) {
  const found = find(ctx, args, "morph.set");
  if (found.error) return found.error;
  if (args.target == null || !Number.isFinite(Number(args.value))) {
    return buildCommandResult("morph.set", { ok: false, mode: "runtime", error: "morph.set requires args.target and finite args.value." });
  }
  const changed = setMorphTargetInfluence(found.object, args.target, args.value, {
    mesh: args.mesh,
    clamp: args.clamp !== false
  });
  return buildCommandResult("morph.set", {
    ok: changed.length > 0,
    mode: "runtime",
    data: changed.length ? { threeJsonId: found.id, changed } : undefined,
    error: changed.length ? null : `Morph target "${args.target}" was not found.`
  });
}
