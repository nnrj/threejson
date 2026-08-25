import * as THREE from "three";
import { createGeometryFromDescriptor, resolveGeometryType } from "./geometry/geometryFactory.js";
import { createMaterialFromDescriptor } from "./material/materialFactory.js";
import { trackDisposableResource } from "../handler/trackedResourceRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
/** Explicit InstancedMesh JSON. The legacy six-face box path remains injectable. */

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
    throw Object.assign(new Error("instanced.transforms must contain at least one instance"), {
      code: "E_INSTANCED_TRANSFORMS_REQUIRED"
    });
  }
  const geometryType = resolveGeometryType(record, "box");
  // Preserve the established six-face box path, whose material-array semantics cannot be
  // represented by one InstancedMesh material.
  if (geometryType === "box" && Array.isArray(record.materials) && record.materials.length > 1) {
    const legacyMesh = createInstanceBoxFn({ ...record, objType: "box", instance: true, transforms });
    if (legacyMesh) {
      record.objType = "instanced";
      scene.add(legacyMesh);
    }
    return legacyMesh;
  }

  let geometry;
  let material;
  try {
    geometry = createGeometryFromDescriptor(record, { type: geometryType });
    const materialDescriptor = record.material
      || (Array.isArray(record.materials) ? record.materials[0] : null)
      || { type: "standard", color: "#cccccc" };
    material = createMaterialFromDescriptor(materialDescriptor, {
      fallbackType: "standard",
      defaultColor: "#cccccc",
      visible: record.visible !== false
    });
  } catch (error) {
    geometry?.dispose?.();
    throw error;
  }
  trackDisposableResource(geometry);
  trackDisposableResource(material);
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  trackDisposableResource(mesh);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const matrix = new THREE.Matrix4();
  let hasInstanceColor = false;
  transforms.forEach((transform = {}, index) => {
    position.set(Number(transform.position?.x) || 0, Number(transform.position?.y) || 0, Number(transform.position?.z) || 0);
    euler.set(Number(transform.rotation?.x) || 0, Number(transform.rotation?.y) || 0, Number(transform.rotation?.z) || 0, "XYZ");
    quaternion.setFromEuler(euler);
    scale.set(
      Number.isFinite(Number(transform.scale?.x)) ? Number(transform.scale.x) : 1,
      Number.isFinite(Number(transform.scale?.y)) ? Number(transform.scale.y) : 1,
      Number.isFinite(Number(transform.scale?.z)) ? Number(transform.scale.z) : 1
    );
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    const color = transform.color ?? record.colors?.[index];
    if (color !== undefined && color !== null) {
      mesh.setColorAt(index, new THREE.Color(color));
      hasInstanceColor = true;
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (hasInstanceColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = record.castShadow === true;
  mesh.receiveShadow = record.receiveShadow !== false;
  mesh.visible = record.visible !== false;
  mesh.name = record.name || record.threeJsonId || "instanced";
  if (record.position) mesh.position.set(Number(record.position.x) || 0, Number(record.position.y) || 0, Number(record.position.z) || 0);
  if (record.rotation) mesh.rotation.set(Number(record.rotation.x) || 0, Number(record.rotation.y) || 0, Number(record.rotation.z) || 0);
  if (record.scale) mesh.scale.set(Number(record.scale.x) || 1, Number(record.scale.y) || 1, Number(record.scale.z) || 1);
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  setUserDataObjJson(mesh, record);
  record.objType = "instanced";
  scene.add(mesh);
  return mesh;
}
