/**
 * Pure spatial-query helpers (no Three dependency; shared by unit tests and spatialQuery.js).
 */

/**
 * @param {unknown} userData
 * @returns {object|null}
 */
export function readObjJsonFromUserData(userData) {
  if (!userData || typeof userData !== "object") {
    return null;
  }
  const objJson = userData.objJson;
  return objJson && typeof objJson === "object" ? objJson : null;
}

/**
 * @param {string} objType
 * @param {Iterable<string>|Set<string>|null|undefined} skipTypes
 * @returns {boolean}
 */
export function shouldSkipObjType(objType, skipTypes) {
  if (!skipTypes) {
    return false;
  }
  const s = typeof objType === "string" ? objType : "";
  if (skipTypes instanceof Set) {
    return skipTypes.has(s);
  }
  for (const t of skipTypes) {
    if (t === s) {
      return true;
    }
  }
  return false;
}

/**
 * @param {number} minA
 * @param {number} maxA
 * @param {number} minB
 * @param {number} maxB
 * @returns {boolean}
 */
export function intervalsOverlap(minA, maxA, minB, maxB) {
  return minA <= maxB && minB <= maxA;
}

/**
 * @param {{ minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number }} a
 * @param {{ minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number }} b
 * @returns {boolean}
 */
export function aabbOverlaps(a, b) {
  return (
    intervalsOverlap(a.minX, a.maxX, b.minX, b.maxX)
    && intervalsOverlap(a.minY, a.maxY, b.minY, b.maxY)
    && intervalsOverlap(a.minZ, a.maxZ, b.minZ, b.maxZ)
  );
}

/**
 * @param {number} value
 * @param {number} margin
 * @returns {number}
 */
export function expandScalarByMargin(value, margin) {
  const m = Number.isFinite(margin) ? margin : 0;
  return value + m;
}
