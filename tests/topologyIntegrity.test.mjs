import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { simplifyEditableTopology, bevelEditableTopology, edgeSplitEditableTopology, triangulateEditableTopology } from "../core/builder/editableMesh/editableMeshModifiers.js";
import { validateEditableMeshTopology, buildTopologyIndexes } from "../core/builder/editableMesh/editableMeshTopology.js";
import { applyEditableMeshOperations } from "../core/runtime/editableMeshOperations.js";

function closedBox() {
  return {
    vertices: [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map((position, i) => ({ id: `v${i}`, position })),
    faces: [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[3,7,6,2],[0,4,7,3]].map((vertices, i) => ({ id: `f${i}`, vertices: vertices.map((v) => `v${v}`), part: "shell" })), edges: []
  };
}
function assertClosed(topology) {
  const validation = validateEditableMeshTopology(topology);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.equal(validation.statistics.boundaryEdgeCount, 0);
  assert.equal(validation.statistics.windingWarningCount, 0);
  const indexes = buildTopologyIndexes(topology);
  assert.equal(topology.vertices.length - indexes.edgeFaces.size + topology.faces.length, 2, "closed genus-zero surface keeps Euler characteristic");
}
function sphere() {
  const geometry = new THREE.IcosahedronGeometry(2, 2), attribute = geometry.getAttribute("position"), keys = new Map(), vertices = [], faces = [];
  const ids = [];
  for (let i = 0; i < attribute.count; i++) {
    const position = [attribute.getX(i), attribute.getY(i), attribute.getZ(i)], key = position.map((v) => v.toFixed(6)).join(",");
    if (!keys.has(key)) { const id = `v${keys.size}`; keys.set(key, id); vertices.push({ id, position }); }
    ids.push(keys.get(key));
  }
  for (let i = 0; i < ids.length; i += 3) faces.push({ id: `f${i / 3}`, vertices: ids.slice(i, i + 3), part: "shell" });
  geometry.dispose(); return { vertices, faces, edges: [] };
}

test("simplify contracts edges without holes, flipped faces or topology changes", () => {
  const original = sphere(), frozenCopy = structuredClone(original);
  const simplified = simplifyEditableTopology(original, { ratio: 0.5 });
  assert.ok(simplified.faces.length <= original.faces.length * 0.55);
  assertClosed(simplified); assert.deepEqual(original, frozenCopy);
  assert.deepEqual(simplified, simplifyEditableTopology(original, { ratio: 0.5 }));
  for (const vertex of simplified.vertices) assert.ok(new THREE.Vector3(...vertex.position).length() > 1.6);
});

test("bevel modifier and edge commands create consistently wound closed chamfers", () => {
  const source = closedBox(), options = { edges: [["v4", "v5"]], amount: 0.1 };
  const chamfer = bevelEditableTopology(source, options); assertClosed(chamfer);
  const edited = applyEditableMeshOperations({ topology: source }, [{ type: "bevelEdges", ...options }]);
  assertClosed(edited.topology); assert.equal(chamfer.faces.length, 9);
  assertClosed(bevelEditableTopology(source, { faceIds: ["f1"], amount: 0.06 }));
  assertClosed(bevelEditableTopology(source, { amount: 0.04 }));
});

test("EdgeSplit separates smoothing fans only; unaffected shared corners stay shared", () => {
  const source = {
    vertices: [[0,0,0],[1,0,0],[0,1,0],[-1,0,0],[0,-1,0]].map((position, i) => ({ id: `v${i}`, position })),
    faces: [[0,1,2],[0,2,3],[0,3,4],[0,4,1]].map((vertices, i) => ({ id: `f${i}`, vertices: vertices.map((v) => `v${v}`) })),
    edges: [{ vertices: ["v0", "v1"], crease: 1 }, { vertices: ["v0", "v3"], crease: 1 }]
  };
  const split = edgeSplitEditableTopology(source);
  assert.equal(split.vertices.length, 8);
  assert.equal(split.faces[0].vertices[0], split.faces[1].vertices[0]);
  assert.equal(split.faces[2].vertices[0], split.faces[3].vertices[0]);
  assert.notEqual(split.faces[1].vertices[0], split.faces[2].vertices[0]);
  assert.equal(split.faces[0].vertices[2], split.faces[1].vertices[1]);
});

test("concave n-gon triangulation preserves area rather than fanning outside the polygon", () => {
  const source = { vertices: [[0,0,0],[3,0,0],[3,3,0],[2,3,0],[2,1,0],[1,1,0],[1,3,0],[0,3,0]].map((position, i) => ({ id: `v${i}`, position })), faces: [{ id: "concave", vertices: ["v0","v1","v2","v3","v4","v5","v6","v7"] }] };
  const triangulated = triangulateEditableTopology(source), index = buildTopologyIndexes(triangulated);
  const area = triangulated.faces.reduce((sum, face) => {
    const [a,b,c] = face.vertices.map((id) => new THREE.Vector3(...index.vertexById.get(id).vertex.position));
    return sum + b.sub(a).cross(c.sub(a)).length() / 2;
  }, 0);
  assert.equal(area, 7);
});
