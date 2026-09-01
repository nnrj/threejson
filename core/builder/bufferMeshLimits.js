/**
 * Objective BufferGeometry validation plus an optional host-owned budget.
 *
 * ThreeJSON deliberately has no built-in vertex, triangle, byte, or build-time ceiling. A host
 * may pass a meshBudget when it needs a product policy, but an omitted/empty budget is unlimited.
 */

function optionalPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

/**
 * @param {{
 *   vertexCount: number,
 *   triangleCount: number,
 *   maxIndex: number,
 *   minIndex?: number,
 *   byteLength?: number,
 *   buildTimeMs?: number
 * }} stats
 * @param {{ maxVertices?: number, maxTriangles?: number, maxBytes?: number, maxBuildTimeMs?: number }} [meshBudget]
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
export function validateBufferMeshStats(stats, meshBudget = {}) {
  const vertexCount = Number(stats?.vertexCount);
  const triangleCount = Number(stats?.triangleCount);
  const maxIndex = Number(stats?.maxIndex);
  const minIndex = stats?.minIndex == null ? 0 : Number(stats.minIndex);
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 0) {
    return { ok: false, code: "E_BUFFER_MESH_INVALID_VERTEX_COUNT", message: "vertexCount must be a non-negative safe integer" };
  }
  if (!Number.isFinite(triangleCount) || triangleCount < 0) {
    return { ok: false, code: "E_BUFFER_MESH_INVALID_TRIANGLE_COUNT", message: "triangleCount must be non-negative" };
  }
  if (vertexCount > 0 && (!Number.isSafeInteger(maxIndex) || !Number.isSafeInteger(minIndex) || minIndex < 0 || maxIndex >= vertexCount)) {
    return {
      ok: false,
      code: "E_BUFFER_MESH_INDEX_OUT_OF_RANGE",
      message: `index out of range (minIndex=${minIndex}, maxIndex=${maxIndex}, vertices=${vertexCount})`
    };
  }

  const checks = [
    ["maxVertices", vertexCount, "vertices"],
    ["maxTriangles", triangleCount, "triangles"],
    ["maxBytes", Number(stats?.byteLength) || 0, "bytes"],
    ["maxBuildTimeMs", Number(stats?.buildTimeMs) || 0, "build milliseconds"]
  ];
  for (const [key, actual, label] of checks) {
    const limit = optionalPositiveNumber(meshBudget?.[key]);
    if (limit !== undefined && actual > limit) {
      return {
        ok: false,
        code: "E_BUFFER_MESH_BUDGET_EXCEEDED",
        message: `${label} ${actual} exceeds host meshBudget.${key} ${limit}`
      };
    }
  }
  return { ok: true };
}
