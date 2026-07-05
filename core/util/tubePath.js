/**
 * Tube path curve resolution (no Three dependency; usable from unit tests).
 * @param {object} pathDef
 * @param {typeof import("three")} THREE
 * @returns {import("three").Curve|null}
 */
export function buildCurveFromPathDef(pathDef, THREE) {
  if (!pathDef || typeof pathDef !== "object" || !THREE) {
    return null;
  }
  const type = typeof pathDef.type === "string" ? pathDef.type.trim().toLowerCase() : "catmullrom";
  const pointsRaw = pathDef.points;
  if (!Array.isArray(pointsRaw) || pointsRaw.length < 2) {
    return null;
  }
  const points = [];
  for (let i = 0; i < pointsRaw.length; i++) {
    const p = pointsRaw[i];
    if (Array.isArray(p) && p.length >= 3) {
      points.push(new THREE.Vector3(Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0));
    } else if (p && typeof p === "object") {
      points.push(new THREE.Vector3(Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0));
    }
  }
  if (points.length < 2) {
    return null;
  }
  if (type === "catmullrom" || type === "catmull" || type === "spline") {
    const closed = Boolean(pathDef.closed);
    return new THREE.CatmullRomCurve3(points, closed, "centripetal", Number(pathDef.tension) || 0.5);
  }
  if (type === "line" || type === "linear") {
    return new THREE.CatmullRomCurve3(points, false, "centripetal", 0);
  }
  return new THREE.CatmullRomCurve3(points, Boolean(pathDef.closed), "centripetal", 0.5);
}
