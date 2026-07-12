import TWEEN, { Group, Tween } from "@tweenjs/tween.js";
import { resolveRuntimeContext } from "../../runtime/runtimeContext.js";

/**
 * Engine-level tween group, per RuntimeContext (see core/runtime/runtimeContext.js), so
 * each canvas's render loop only advances its own tweens instead of every canvas's on
 * every frame. `createTween` auto-resolves its scope from an optional trailing
 * `runtimeScope` (the animated object, when passed); `updateEngineTweens` takes an
 * explicit trailing `runtimeScope` (the scene, already available in the per-canvas
 * animation driver). Omitting either preserves today's shared-global behavior.
 */
export function createTweenGroupStore() {
  const engineTweenGroup = new Group();
  return {
    group: engineTweenGroup,
    dispose() {
      engineTweenGroup.removeAll();
    }
  };
}

function resolveStore(runtimeScope) {
  return resolveRuntimeContext(runtimeScope).tweenGroup;
}

/**
 * Create a Tween registered with the engine tween group (v25+ requires an explicit Group).
 * @param {object} target
 * @param {*} [runtimeScope] The animated object (or scene/RuntimeContext) to scope this tween to.
 */
export function createTween(target, runtimeScope) {
  return new Tween(target, resolveStore(runtimeScope).group);
}

/**
 * Drive all engine tweens (replaces the deprecated global TWEEN.update).
 * @param {number} [time]
 * @param {*} [runtimeScope]
 */
export function updateEngineTweens(time, runtimeScope) {
  resolveStore(runtimeScope).group.update(time);
}

export default TWEEN;
