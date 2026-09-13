import * as THREE from "three";
import { getObjectByThreeJsonId } from "../handler/objectRegistry.js";
import { documentError } from "../document/sceneDocument.js";
import { planSceneDesignRelations } from "../document/sceneDesign.js";
import { shouldSkipSceneExportNode } from "../util/sceneExportNode.js";

const anchors = Object.freeze({ center: [0.5,0.5,0.5], top: [0.5,1,0.5], bottom: [0.5,0,0.5],
  left: [0,0.5,0.5], right: [1,0.5,0.5], front: [0.5,0.5,1], back: [0.5,0.5,0] });
function vector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw documentError("DESIGN_VECTOR_INVALID", `${label} requires three finite components.`);
  return new THREE.Vector3(...value);
}

/** Bounding anchors are model-local, then transformed to world space. Rotating a
 * model does not silently change its named front/top into a world-axis face. */
export function getSceneObjectAnchor(object, name = "origin", descriptor = object?.userData?.objJson || {}) {
  if (!object) throw documentError("DESIGN_REFERENCE_MISSING", "Anchor object is missing.");
  object.updateWorldMatrix(true, true);
  if (Array.isArray(name)) return vector(name, "Anchor").applyMatrix4(object.matrixWorld);
  const custom = descriptor.anchors?.[name];
  if (custom) return vector(custom.position || custom, `Anchor ${name}`).applyMatrix4(object.matrixWorld);
  if (name === "origin") return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
  const weights = anchors[name];
  if (!weights) throw documentError("DESIGN_ANCHOR_MISSING", `Unknown anchor: ${name}.`);
  if (object.matrixWorld.determinant() === 0) throw documentError("DESIGN_SINGULAR_TRANSFORM", "Cannot resolve bounds under a singular transform.");
  const inverse = object.matrixWorld.clone().invert(), bounds = new THREE.Box3(), box = new THREE.Box3(), matrix = new THREE.Matrix4();
  const pending = [object], vertex = new THREE.Vector3();
  while (pending.length) {
    const child = pending.pop();
    if (child !== object && shouldSkipSceneExportNode(child) && child.name !== "__threejson_native_scene__") continue;
    for (const nested of child.children) pending.push(nested);
    if (!child.geometry) continue;
    if (child.isInstancedMesh || child.isSkinnedMesh) { child.computeBoundingBox(); box.copy(child.boundingBox); }
    else if (child.morphTargetInfluences?.some((value) => value !== 0) && child.getVertexPosition) {
      box.makeEmpty();
      for (let i = 0; i < child.geometry.attributes.position.count; i++) box.expandByPoint(child.getVertexPosition(i, vertex));
    } else {
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      if (!child.geometry.boundingBox) continue;
      box.copy(child.geometry.boundingBox);
    }
    if (box.isEmpty()) continue;
    matrix.multiplyMatrices(inverse, child.matrixWorld);
    box.applyMatrix4(matrix); bounds.union(box);
  }
  if (bounds.isEmpty()) throw documentError("DESIGN_BOUNDS_UNAVAILABLE", `No geometric bounds for anchor ${name}.`);
  return new THREE.Vector3(bounds.min.x + (bounds.max.x - bounds.min.x) * weights[0], bounds.min.y + (bounds.max.y - bounds.min.y) * weights[1], bounds.min.z + (bounds.max.z - bounds.min.z) * weights[2])
    .applyMatrix4(object.matrixWorld);
}

/** Evaluate static authoring relationships after geometry is ready, before exposing
 * the runtime. Animation remains a separate playback layer; no per-frame solver. */
export function applySceneDesignRelations(scene, payload, relations = payload.design?.relations || []) {
  if (!relations.length) return { relations: [] };
  const { index, bySource, order } = planSceneDesignRelations(payload, relations);
  const snapshots = new Map(), results = [];
  try {
    for (const id of order) {
      for (const relation of bySource.get(id) || []) {
        const object = getObjectByThreeJsonId(id, scene);
        let target = getObjectByThreeJsonId(relation.target, scene);
        if (!object || !target) throw documentError("DESIGN_REFERENCE_MISSING", `Relation object was not built: ${id}/${relation.target}.`);
        if (relation.targetPart) {
          const matches = [];
          target.traverse((part) => { if (part.userData?.objJson?.domainPartId === relation.targetPart || part.userData?.domainPartId === relation.targetPart) matches.push(part); });
          if (matches.length !== 1) throw documentError("DESIGN_REFERENCE_MISSING", `Missing or ambiguous stable Domain part: ${relation.targetPart}.`);
          target = matches[0];
        }
        if (!snapshots.has(object)) snapshots.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone() });
        let destination = getSceneObjectAnchor(target, relation.targetAnchor || "origin", relation.targetPart ? target.userData?.objJson : index.get(relation.target).record);
        if (relation.offset) {
          const offset = vector(relation.offset, "Relation offset");
          if (relation.offsetSpace === "world") destination.add(offset);
          else if (relation.offsetSpace == null || relation.offsetSpace === "target") {
            destination.add(offset.applyMatrix4(target.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(target.matrixWorld)));
          } else throw documentError("DESIGN_SPACE_INVALID", `Unknown offsetSpace: ${relation.offsetSpace}.`);
        }
        if (relation.type === "lookAt") {
          // Solve the aiming direction in parent-local space. Object3D.lookAt's
          // world-quaternion shortcut is wrong under a nonuniformly scaled parent.
          const localTarget = destination.clone(), localUp = object.up.clone();
          if (object.parent) {
            if (object.parent.matrixWorld.determinant() === 0) throw documentError("DESIGN_SINGULAR_TRANSFORM", "Cannot aim through a singular parent transform.");
            const inverse = object.parent.matrixWorld.clone().invert();
            localTarget.applyMatrix4(inverse); localUp.transformDirection(inverse);
          }
          const aim = new THREE.Matrix4();
          if (object.isCamera || object.isLight) aim.lookAt(object.position, localTarget, localUp);
          else aim.lookAt(localTarget, object.position, localUp);
          object.quaternion.setFromRotationMatrix(aim);
        }
        else {
          if (relation.orientation === "target") {
            const targetRotation = target.getWorldQuaternion(new THREE.Quaternion());
            object.quaternion.copy(object.parent ? object.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(targetRotation) : targetRotation);
            object.updateWorldMatrix(true, true);
          } else if (relation.orientation != null && relation.orientation !== "preserve") throw documentError("DESIGN_ORIENTATION_INVALID", `Unknown orientation: ${relation.orientation}.`);
          const origin = getSceneObjectAnchor(object), self = getSceneObjectAnchor(object, relation.anchor || "origin", index.get(id).record);
          destination.sub(self).add(origin);
          if (object.parent) {
            if (object.parent.matrixWorld.determinant() === 0) throw documentError("DESIGN_SINGULAR_TRANSFORM", "Cannot attach through a singular parent transform.");
            object.parent.worldToLocal(destination);
          }
          object.position.copy(destination);
        }
        object.updateMatrix(); object.updateWorldMatrix(false, true);
        results.push({ ...relation, position: object.position.toArray(), quaternion: object.quaternion.toArray() });
      }
    }
  } catch (error) {
    for (const [object, prior] of snapshots) { object.position.copy(prior.position); object.quaternion.copy(prior.quaternion); object.updateMatrix(); }
    scene.updateMatrixWorld(true); throw error;
  }
  return { relations: results };
}
