/**
 * Mesh-level CSG: build Brush from Object3D world matrices via three-bvh-csg and evaluate boolean ops.
 */
import * as THREE from "three";
import {
  ADDITION,
  Brush,
  DIFFERENCE,
  Evaluator,
  INTERSECTION,
  SUBTRACTION
} from "three-bvh-csg";

const meshEvaluator = new Evaluator();

/** @type {Record<string, symbol|number>} */
const MESH_BOOLEAN_OPS = Object.freeze({
  union: ADDITION,
  add: ADDITION,
  subtract: SUBTRACTION,
  sub: SUBTRACTION,
  intersect: INTERSECTION,
  inter: INTERSECTION,
  difference: DIFFERENCE,
  diff: DIFFERENCE
});

/**
 * @param {import("three").Mesh} mesh
 * @param {{ material?: import("three").Material|import("three").Material[] }} [options]
 * @returns {Brush}
 */
export function createBrushFromMesh(mesh, options = {}) {
  const material = options.material ?? mesh.material;
  const brush = new Brush(mesh.geometry, material);
  mesh.updateMatrixWorld(true);
  brush.matrix.copy(mesh.matrixWorld);
  brush.matrix.decompose(brush.position, brush.quaternion, brush.scale);
  brush.updateMatrixWorld(true);
  return brush;
}

/**
 * @param {import("three").Mesh} masterMesh
 * @param {import("three").Mesh} slaveMesh
 * @param {keyof typeof MESH_BOOLEAN_OPS} [operation='union']
 * @returns {Brush|undefined}
 */
export function evaluateMeshBoolean(masterMesh, slaveMesh, operation = "union") {
  if (!masterMesh?.geometry || !slaveMesh?.geometry) {
    return undefined;
  }
  const op = MESH_BOOLEAN_OPS[operation] ?? ADDITION;
  const masterBrush = createBrushFromMesh(masterMesh);
  const slaveBrush = createBrushFromMesh(slaveMesh, { material: masterMesh.material });
  return meshEvaluator.evaluate(masterBrush, slaveBrush, op);
}
