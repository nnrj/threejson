/**
 * Resolve `userData.objJson.animationMode` (no TWEEN / frame-loop dependency; testable and tree-shakeable).
 * @param {import("three").Object3D|{ userData?: { objJson?: object } }|null|undefined} currObj
 * @returns {"mixer"|"basic"|"both"|undefined}
 */
function getAnimationMode(currObj) {
  const j = currObj?.userData?.objJson;
  if (!j || typeof j !== "object") {
    return undefined;
  }
  const m = j.animationMode;
  if (m === "mixer" || m === "basic" || m === "both") {
    return m;
  }
  return undefined;
}

export { getAnimationMode };
