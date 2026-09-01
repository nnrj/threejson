import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  buildBufferMeshGeometry,
  createCommandContext,
  executeCommand
} from "../core/index.js";
import {
  applyEditableMeshOperations,
  buildEditableMeshGeometry,
  buildProceduralMeshGeometry,
  loopSubdivisionEditableTopology,
  validateEditableMeshTopology
} from "threejson/complex-mesh";
import { clearObjectRegistry } from "../core/handler/objectRegistry.js";
import { ensureOptionalSceneCapabilitiesForPayload } from "../core/capabilities/optionalCapabilityLoader.js";
import { packPayloadToTjz } from "../core/util/archiveExportUtil.js";
import { parseTjzArchiveForScene } from "../core/archive/tjzArchive.js";

function cubeEditable(id = "editable-1") {
  return {
    threeJsonId: id,
    objType: "editableMesh",
    topology: {
      revision: 0,
      vertices: [
        ["v0", [-1, -1, -1]], ["v1", [1, -1, -1]], ["v2", [1, 1, -1]], ["v3", [-1, 1, -1]],
        ["v4", [-1, -1, 1]], ["v5", [1, -1, 1]], ["v6", [1, 1, 1]], ["v7", [-1, 1, 1]]
      ].map(([vertexId, position]) => ({ id: vertexId, position })),
      faces: [
        ["back", ["v0", "v3", "v2", "v1"]], ["front", ["v4", "v5", "v6", "v7"]],
        ["bottom", ["v0", "v1", "v5", "v4"]], ["right", ["v1", "v2", "v6", "v5"]],
        ["top", ["v3", "v7", "v6", "v2"]], ["left", ["v0", "v4", "v7", "v3"]]
      ].map(([faceId, vertices]) => ({ id: faceId, vertices, part: "body", smooth: true }))
    },
    modifiers: [{ type: "catmullClark", levels: 2 }],
    material: { type: "standard", color: "#6699cc" }
  };
}

test("bufferMesh accepts more than 200,000 vertices and Uint32 indices without a core ceiling", () => {
  const vertexCount = 200_001;
  const positions = new Float32Array(vertexCount * 3);
  positions[3] = 1;
  positions[7] = 1;
  const built = buildBufferMeshGeometry({
    objType: "bufferMesh",
    geometry: {
      attributes: { position: { array: positions, itemSize: 3, type: "Float32Array" } },
      index: { array: [0, 100_000, 200_000], type: "Uint32Array" }
    }
  }, { computeMissingNormals: false });
  assert.ok(built.geometry, built.error);
  assert.equal(built.stats.vertexCount, vertexCount);
  assert.equal(built.geometry.index.array.constructor.name, "Uint32Array");
  built.geometry.dispose();
});

test("compact parametric, NURBS, Bezier, loft, sweep, and SDF descriptors produce real meshes", () => {
  const records = [
    { objType: "parametricSurface", geometry: { uSegments: 8, vSegments: 6, expressions: { x: "(u-0.5)*4", y: "0.4*sin(u*PI*4)*cos(v*PI*2)", z: "(v-0.5)*3" } } },
    { objType: "bezierPatch", geometry: { uSegments: 6, vSegments: 6, controlPoints: [[[0,0,0],[1,1,0],[2,0,0]], [[0,1,1],[1,2,1],[2,1,1]], [[0,0,2],[1,1,2],[2,0,2]]] } },
    { objType: "nurbsSurface", geometry: { uSegments: 6, vSegments: 6, degreeU: 2, degreeV: 2, controlPoints: [[[0,0,0,1],[1,1,0,1],[2,0,0,1]], [[0,1,1,1],[1,2,1,0.5],[2,1,1,1]], [[0,0,2,1],[1,1,2,1],[2,0,2,1]]] } },
    { objType: "loftMesh", geometry: { sections: [[[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1]], [[-0.5,2,-0.5],[0.5,2,-0.5],[0.5,2,0.5],[-0.5,2,0.5]]] } },
    { objType: "sweepMesh", geometry: { profile: [[-0.2,-0.2],[0.2,-0.2],[0.2,0.2],[-0.2,0.2]], path: [[0,0,0],[0,1,1],[1,2,2]], segments: 8 } },
    { objType: "implicitSurface", geometry: { resolution: 10, bounds: { min: [-1.5,-1.5,-1.5], max: [1.5,1.5,1.5] }, sdf: { type: "smoothUnion", smoothness: 0.25, children: [{ type: "sphere", center: [-0.45,0,0], radius: 0.8 }, { type: "sphere", center: [0.45,0,0], radius: 0.8 }] } } }
  ];
  for (const record of records) {
    const built = buildProceduralMeshGeometry(record);
    assert.ok(built.geometry, `${record.objType}: ${built.error}`);
    assert.ok(built.stats.triangleCount > 0, record.objType);
    if (!["implicitSurface", "latheMesh"].includes(record.objType)) {
      assert.ok(built.geometry.index?.isBufferAttribute, `${record.objType} should produce a valid index BufferAttribute`);
    }
    built.geometry.dispose();
  }
});

test("bufferMesh supports arbitrary attributes, groups, morph targets, and drawRange", () => {
  const built = buildBufferMeshGeometry({
    objType: "bufferMesh",
    geometry: {
      attributes: {
        position: { array: [0, 0, 0, 1, 0, 0, 0, 1, 0], itemSize: 3 },
        color: { array: [1, 0, 0, 0, 1, 0, 0, 0, 1], itemSize: 3 },
        customWeight: { array: [0.1, 0.5, 1], itemSize: 1 }
      },
      index: { array: [0, 1, 2], type: "Uint16Array" },
      groups: [{ start: 0, count: 3, materialIndex: 1 }],
      drawRange: { start: 0, count: 3 },
      morphAttributes: {
        position: [{ array: [0, 0, 0, 1.1, 0, 0, 0, 1.1, 0], itemSize: 3 }]
      },
      morphTargetsRelative: false
    }
  });
  assert.ok(built.geometry, built.error);
  assert.equal(built.geometry.getAttribute("customWeight").count, 3);
  assert.equal(built.geometry.groups[0].materialIndex, 1);
  assert.equal(built.geometry.morphAttributes.position.length, 1);
  built.geometry.dispose();
});

test("bufferMesh rejects objective typed-index overflow instead of wrapping it", () => {
  const built = buildBufferMeshGeometry({
    objType: "bufferMesh",
    geometry: {
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      index: { array: [0, 1, 65_536], type: "Uint16Array" }
    }
  });
  assert.equal(built.geometry, null);
  assert.equal(built.code, "E_BUFFER_MESH_INDEX_TYPE_RANGE");
});

test("bufferMesh binary references survive .tjz tryPack and rebuild", async () => {
  const positionBytes = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const indexBytes = new Uint8Array(new Uint16Array([0, 1, 2]).buffer);
  const positionUrl = "https://mesh.test/positions.bin";
  const indexUrl = "https://mesh.test/indices.bin";
  const payload = {
    objectList: [{
      threeJsonId: "packed-buffer",
      objType: "bufferMesh",
      geometry: {
        buffers: { positions: positionUrl, indices: indexUrl },
        attributes: {
          position: { ref: "positions", itemSize: 3, type: "Float32Array", length: 9 }
        },
        index: { ref: "indices", type: "Uint16Array", length: 3 }
      }
    }]
  };
  const archive = await packPayloadToTjz(payload, {
    assetPolicy: "tryPack",
    outputType: "bytes",
    resolveAsset(ref) {
      if (ref === positionUrl) return positionBytes;
      if (ref === indexUrl) return indexBytes;
      return null;
    }
  });
  const parsed = await parseTjzArchiveForScene(archive);
  try {
    await ensureOptionalSceneCapabilitiesForPayload(parsed.payload);
    const built = buildBufferMeshGeometry(parsed.payload.objectList[0]);
    assert.ok(built.geometry, built.error);
    assert.deepEqual(Array.from(built.geometry.getAttribute("position").array), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
    assert.deepEqual(Array.from(built.geometry.index.array), [0, 1, 2]);
    built.geometry.dispose();
  } finally {
    parsed.dispose();
  }
});

test("bufferMesh resolves named inline base64 buffers", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const base64 = Buffer.from(positions.buffer).toString("base64");
  const built = buildBufferMeshGeometry({
    objType: "bufferMesh",
    geometry: {
      buffers: { triangle: { base64 } },
      attributes: {
        position: { ref: "triangle", itemSize: 3, type: "Float32Array", length: positions.length }
      }
    }
  });
  assert.ok(built.geometry, built.error);
  assert.deepEqual(Array.from(built.geometry.getAttribute("position").array), Array.from(positions));
  built.geometry.dispose();
});

test("editableMesh deterministically evaluates a control cage through Catmull-Clark", () => {
  const first = buildEditableMeshGeometry(cubeEditable());
  const second = buildEditableMeshGeometry(cubeEditable());
  assert.ok(first.geometry, first.error);
  assert.ok(second.geometry, second.error);
  assert.ok(first.stats.vertexCount > 8);
  assert.deepEqual(Array.from(first.geometry.getAttribute("position").array), Array.from(second.geometry.getAttribute("position").array));
  assert.deepEqual(Array.from(first.geometry.index.array), Array.from(second.geometry.index.array));
  first.geometry.dispose();
  second.geometry.dispose();
});

test("Loop subdivision uses the Loop boundary and edge-point rules", () => {
  const result = loopSubdivisionEditableTopology({
    vertices: [
      { id: "a", position: [0, 0, 0] },
      { id: "b", position: [1, 0, 0] },
      { id: "c", position: [1, 1, 0] },
      { id: "d", position: [0, 1, 0] }
    ],
    faces: [
      { id: "lower", vertices: ["a", "b", "c"] },
      { id: "upper", vertices: ["a", "c", "d"] }
    ]
  });
  assert.equal(result.vertices.length, 9);
  assert.equal(result.faces.length, 8);
  const a = result.vertices.find((vertex) => vertex.id === "a");
  assert.deepEqual(a.position.map((value) => Number(value.toFixed(6))), [0.125, 0.125, 0]);
  assert.ok(result.vertices.some((vertex) =>
    Math.abs(vertex.position[0] - 0.5) < 1e-9 && Math.abs(vertex.position[1] - 0.5) < 1e-9
  ));
});

test("editableMesh validation reports winding and optional self-intersection risks", () => {
  const validation = validateEditableMeshTopology({
    vertices: [
      { id: "a", position: [0, 0, 0] }, { id: "b", position: [1, 0, 0] },
      { id: "c", position: [0, 1, 0] }, { id: "d", position: [1, 1, 0] },
      { id: "e", position: [0.25, 0.25, -1] }, { id: "f", position: [0.75, 0.25, 1] },
      { id: "g", position: [0.5, 0.75, 0] }
    ],
    faces: [
      { id: "one", vertices: ["a", "b", "c"] },
      { id: "two", vertices: ["a", "b", "d"] },
      { id: "cross", vertices: ["e", "f", "g"] }
    ]
  }, { checkSelfIntersectionRisk: true });
  assert.ok(validation.warnings.some((item) => item.code === "W_EDITABLE_MESH_WINDING"));
  assert.ok(validation.warnings.some((item) => item.code === "W_EDITABLE_MESH_SELF_INTERSECTION_RISK"));
  assert.equal(validation.statistics.triangleFaceCount, 3);
  assert.equal(validation.statistics.quadFaceCount, 0);
  assert.equal(validation.statistics.ngonFaceCount, 0);
  assert.equal(validation.statistics.allControlFacesTriangles, true);
});

test("editableMesh inspection exposes face arity so AI can choose local subdivision without reading all topology", async () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const ctx = createCommandContext({ scene });
  assert.equal((await executeCommand(ctx, {
    op: "object.add",
    args: { descriptor: cubeEditable("local-refine-cage") }
  })).ok, true);
  const inspected = await executeCommand(ctx, { op: "mesh.inspect", args: { id: "local-refine-cage" } });
  assert.equal(inspected.ok, true, inspected.error);
  assert.equal(inspected.data.controlTopology.quadFaceCount, 6);
  assert.equal(inspected.data.controlTopology.allControlFacesTriangles, false);
  assert.ok(inspected.data.geometry.vertexCount > inspected.data.controlTopology.vertexCount);
  clearObjectRegistry();
});

test("editableMesh extrude replaces the source cap by default", () => {
  const source = cubeEditable();
  const result = applyEditableMeshOperations(source, [{ type: "extrudeFaces", faceIds: ["front"], distance: 0.4 }]);
  assert.equal(result.topology.faces.some((face) => face.id === "front"), false);
  assert.equal(result.topology.faces.length, 10);
});

test("editableMesh loopCut traverses a quad ring instead of aliasing face inset", () => {
  const source = cubeEditable();
  const result = applyEditableMeshOperations(source, [{
    type: "loopCut",
    faceId: "front",
    edgeIndex: 0,
    position: 0.25
  }]);
  assert.equal(result.validation.ok, true);
  assert.equal(result.topology.vertices.length, 12);
  assert.equal(result.topology.faces.length, 10);
  assert.ok(result.topology.faces.every((face) => face.vertices.length === 4));
  const added = result.topology.vertices.filter((vertex) => !source.topology.vertices.some((item) => item.id === vertex.id));
  assert.equal(added.length, 4);
  assert.ok(added.every((vertex) => Math.abs(vertex.position[0] + 0.5) < 1e-9));
  assert.ok(added.every((vertex) => vertex.id.includes("cut")));
});

test("editableMesh bevelEdges creates a two-sided chamfer for an explicit manifold edge", () => {
  const source = cubeEditable();
  const result = applyEditableMeshOperations(source, [{
    type: "bevelEdges",
    edges: [["v4", "v5"]],
    amount: 0.1
  }]);
  assert.equal(result.validation.ok, true);
  assert.equal(result.topology.vertices.length, 12);
  assert.equal(result.topology.faces.length, 9);
  assert.ok(result.topology.faces.some((face) => face.id.startsWith("f-bevel-strip")));
  assert.ok(result.topology.faces.filter((face) => face.id.startsWith("f-bevel-cap")).length === 2);
  assert.ok(result.topology.faces.every((face) => {
    for (let index = 0; index < face.vertices.length; index += 1) {
      if (new Set([face.vertices[index], face.vertices[(index + 1) % face.vertices.length]]).size < 2) return false;
    }
    return true;
  }));
});

test("mesh.edit uses revisions, preserves the Mesh object, and returns an undo diff", async () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const ctx = createCommandContext({ scene });
  const descriptor = cubeEditable("runtime-editable");
  descriptor.modifiers = [];
  const added = await executeCommand(ctx, { op: "object.add", args: { descriptor } });
  assert.equal(added.ok, true, added.error);
  const mesh = scene.children.find((child) => child.userData?.objJson?.threeJsonId === "runtime-editable");
  assert.ok(mesh?.isMesh);
  const edited = await executeCommand(ctx, {
    op: "mesh.edit",
    args: { id: "runtime-editable", baseRevision: 0, operations: [{ type: "setVertex", id: "v0", position: [-1.25, -1, -1] }] }
  });
  assert.equal(edited.ok, true, edited.error);
  assert.equal(edited.data.revision, 1);
  assert.equal(edited.data.strategy, "position-range-update");
  assert.equal(scene.children.find((child) => child.userData?.objJson?.threeJsonId === "runtime-editable"), mesh);
  assert.deepEqual(mesh.geometry.getAttribute("position").updateRanges, [{ start: 0, count: 3 }]);
  assert.equal(edited.data.undo.op, "mesh.edit");
  const conflict = await executeCommand(ctx, {
    op: "mesh.edit",
    args: { id: "runtime-editable", baseRevision: 0, operations: [{ type: "setVertex", id: "v1", position: [1.1, -1, -1] }] }
  });
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /revision conflict/i);
  clearObjectRegistry();
});

test("mesh.edit modifier and bevel operations are atomic and their diff is reversible", async () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const ctx = createCommandContext({ scene });
  assert.equal((await executeCommand(ctx, {
    op: "object.add",
    args: { descriptor: cubeEditable("modifier-editable") }
  })).ok, true);
  const mesh = scene.children.find((child) => child.userData?.objJson?.threeJsonId === "modifier-editable");
  const edited = await executeCommand(ctx, {
    op: "mesh.edit",
    args: {
      id: "modifier-editable",
      baseRevision: 0,
      operations: [{ type: "setModifiers", modifiers: [{ id: "smooth-1", type: "smooth", iterations: 1 }] }]
    }
  });
  assert.equal(edited.ok, true, edited.error);
  assert.equal(mesh.userData.objJson.modifiers[0].id, "smooth-1");
  assert.ok(edited.data.diff.modifiers);
  const undone = await executeCommand(ctx, edited.data.undo);
  assert.equal(undone.ok, true, undone.error);
  assert.equal(mesh.userData.objJson.topology.revision, 0);
  assert.equal(mesh.userData.objJson.modifiers[0].type, "catmullClark");
  const beveled = await executeCommand(ctx, {
    op: "mesh.edit",
    args: {
      id: "modifier-editable",
      baseRevision: 0,
      operations: [{ type: "bevelEdges", faceIds: ["front"], factor: 0.08 }]
    }
  });
  assert.equal(beveled.ok, true, beveled.error);
  assert.ok(mesh.userData.objJson.topology.faces.length > 6);
  clearObjectRegistry();
});

test("mesh.buffer transaction publishes only on commit", async () => {
  clearObjectRegistry();
  const scene = new THREE.Scene();
  const ctx = createCommandContext({ scene });
  const descriptor = {
    threeJsonId: "raw-runtime",
    objType: "bufferMesh",
    meshRevision: 0,
    geometry: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }
  };
  assert.equal((await executeCommand(ctx, { op: "object.add", args: { descriptor } })).ok, true);
  const mesh = scene.children.find((child) => child.userData?.objJson?.threeJsonId === "raw-runtime");
  const original = mesh.geometry.getAttribute("position").getX(1);
  assert.equal((await executeCommand(ctx, { op: "mesh.buffer.setAttributeRange", args: { id: "raw-runtime", baseRevision: 0, name: "position", offset: 3, values: [2, 0, 0] } })).ok, true);
  assert.equal(mesh.geometry.getAttribute("position").getX(1), original);
  const committed = await executeCommand(ctx, { op: "mesh.buffer.commit", args: { id: "raw-runtime", baseRevision: 0 } });
  assert.equal(committed.ok, true, committed.error);
  assert.equal(mesh.geometry.getAttribute("position").getX(1), 2);
  clearObjectRegistry();
});
