import { evaluateEditableMeshGeometry } from "./editableMeshGeometry.js";
import { evaluateProceduralMeshGeometry } from "./proceduralMeshGeometry.js";
import { serializeGeometryResult } from "./geometryTransfer.js";

/** Pure worker endpoint; browser/Node transports share identical computation. */
export function attachGeometryWorkerHost(port) {
  port.addEventListener("message", ({ data }) => {
    if (data?.type !== "compile") return;
    let built;
    try {
      built = data.record.objType === "editablemesh"
        ? evaluateEditableMeshGeometry(data.record, data.options)
        : evaluateProceduralMeshGeometry(data.record, data.options);
      const packet = serializeGeometryResult(built);
      port.postMessage({ type: "result", id: data.id, result: packet.result }, packet.transfers);
    } catch (error) {
      port.postMessage({ type: "error", id: data.id, error: { message: String(error?.message || error), code: error?.code } });
    } finally { built?.geometry?.dispose(); }
  });
  port.postMessage({ type: "ready" });
}
