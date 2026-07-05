import TWEEN, { Group, Tween } from "@tweenjs/tween.js";

/** Engine-level tween group; updated each frame by animationHandler. */
const engineTweenGroup = new Group();

/**
 * Create a Tween registered with the engine tween group (v25+ requires an explicit Group).
 * @param {object} target
 */
export function createTween(target) {
  return new Tween(target, engineTweenGroup);
}

/**
 * Drive all engine tweens (replaces the deprecated global TWEEN.update).
 * @param {number} [time]
 */
export function updateEngineTweens(time) {
  engineTweenGroup.update(time);
}

export default TWEEN;
