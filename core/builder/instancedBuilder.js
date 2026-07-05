import { log } from "../util/logger.js";
/**
 * Explicit InstancedMesh JSON (internally reuses createInstanceBox).
 * Note: avoids circular dependency with modelBuilder; createInstanceBox injected by modelBuilder.
 */

/**
 * @param {typeof import("./modelBuilder.js").createInstanceBox} createInstanceBoxFn
 * @param {object} record
 * @param {THREE.Scene} scene
 * @returns {import("three").InstancedMesh|null|undefined}
 */
export function deployInstancedMeshWithFactory(createInstanceBoxFn, record, scene) {
  if (!record || !scene || typeof createInstanceBoxFn !== "function") {
    return null;
  }
  const transforms = Array.isArray(record.transforms) ? record.transforms : [];
  if (transforms.length === 0) {
    log.warn("[deployInstancedMesh] transforms is empty:", record?.name || "");
    return null;
  }
  const payload = {
    ...record,
    objType: "box",
    instance: true,
    transforms
  };
  const mesh = createInstanceBoxFn(payload);
  if (!mesh) {
    return null;
  }
  record.objType = "instanced";
  scene.add(mesh);
  return mesh;
}
