/** bufferMesh hard limits (not configurable via JSON). */

export const BUFFER_MESH_MAX_VERTICES = 65536;
export const BUFFER_MESH_MAX_TRIANGLES = 131072;
export const BUFFER_MESH_MAX_INDEX_VALUE = 65536;

/**
 * @param {{ vertexCount: number, triangleCount: number, maxIndex: number }} stats
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
export function validateBufferMeshStats(stats) {
  if (stats.vertexCount > BUFFER_MESH_MAX_VERTICES) {
    return {
      ok: false,
      code: "E_BUFFER_MESH_LIMIT_EXCEEDED",
      message: `vertex count ${stats.vertexCount} exceeds ${BUFFER_MESH_MAX_VERTICES}`
    };
  }
  if (stats.triangleCount > BUFFER_MESH_MAX_TRIANGLES) {
    return {
      ok: false,
      code: "E_BUFFER_MESH_LIMIT_EXCEEDED",
      message: `triangle count ${stats.triangleCount} exceeds ${BUFFER_MESH_MAX_TRIANGLES}`
    };
  }
  if (stats.maxIndex >= stats.vertexCount || stats.maxIndex >= BUFFER_MESH_MAX_INDEX_VALUE) {
    return {
      ok: false,
      code: "E_BUFFER_MESH_LIMIT_EXCEEDED",
      message: `index out of range (maxIndex=${stats.maxIndex}, vertices=${stats.vertexCount})`
    };
  }
  return { ok: true };
}
