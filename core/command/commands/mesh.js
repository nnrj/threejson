import { buildCommandResult } from "../types.js";

function handler(op, exportName) {
  return async (ctx, args = {}) => {
    try {
      const runtime = await import("../../runtime/meshRuntime.js");
      const callback = runtime[exportName];
      const data = await callback(ctx, args);
      return buildCommandResult(op, { ok: true, mode: "runtime", data });
    } catch (error) {
      return buildCommandResult(op, { ok: false, mode: "runtime", error: String(error?.message || error), data: error?.code ? { code: error.code } : undefined });
    }
  };
}

export const handleMeshInspect = handler("mesh.inspect", "inspectRuntimeMesh");
export const handleMeshGetTopology = handler("mesh.getTopology", "getRuntimeMeshTopology");
export const handleMeshValidate = handler("mesh.validate", "validateRuntimeMesh");
export const handleMeshEdit = handler("mesh.edit", "editRuntimeMesh");
export const handleMeshBufferAppendAttribute = handler("mesh.buffer.appendAttribute", "appendRuntimeMeshAttribute");
export const handleMeshBufferSetAttributeRange = handler("mesh.buffer.setAttributeRange", "setRuntimeMeshAttributeRange");
export const handleMeshBufferAppendIndices = handler("mesh.buffer.appendIndices", "appendRuntimeMeshIndices");
export const handleMeshBufferSetIndexRange = handler("mesh.buffer.setIndexRange", "setRuntimeMeshIndexRange");
export const handleMeshBufferCommit = handler("mesh.buffer.commit", "commitRuntimeMeshBuffer");
export const handleMeshBufferCancel = handler("mesh.buffer.cancel", "cancelRuntimeMeshBuffer");
export const handleMeshBake = handler("mesh.bake", "bakeRuntimeEditableMesh");
export const handleMeshRenderViews = handler("mesh.renderViews", "renderRuntimeMeshViews");
