[中文](../zh/complex-mesh.md) | [English](./complex-mesh.md)

# Complex Meshes, Control Cages, and Progressive Modeling

ThreeJSON can describe a complete `BufferGeometry` directly, or compactly express free-form models with stable-ID control cages, parametric surfaces, NURBS, Bezier patches, lofts, sweeps, and SDFs. These are engine capabilities and do not depend on an external model search or 3D-generation service.

The advanced modeling module is descriptor-activated. Async `createJsonScene()` loads it when one of its object types is first used. A synchronous host can opt in explicitly:

```js
import "threejson/complex-mesh";
```

An ordinary cube does not load this module or issue an extra network request.

## Complete coordinates with `bufferMesh`

`bufferMesh` maps to Three.js `BufferGeometry`. It supports arbitrary attributes, Uint16/Uint32 indices, material groups, draw ranges, and morph targets:

```json
{
  "threeJsonId": "raw-model",
  "objType": "bufferMesh",
  "geometry": {
    "attributes": {
      "position": { "array": [0, 0, 0, 1, 0, 0, 0, 1, 0], "itemSize": 3, "type": "Float32Array" },
      "uv": { "array": [0, 0, 1, 0, 0, 1], "itemSize": 2, "type": "Float32Array" },
      "customWeight": { "array": [0.2, 0.6, 1], "itemSize": 1, "type": "Float32Array" }
    },
    "index": { "array": [0, 1, 2], "type": "Uint16Array" },
    "groups": [{ "start": 0, "count": 3, "materialIndex": 0 }],
    "morphAttributes": {
      "position": [{ "array": [0, 0, 0, 1, 0.2, 0, 0, 1.2, 0], "itemSize": 3, "type": "Float32Array" }]
    },
    "morphTargetsRelative": false
  },
  "morphInfluences": [0.4],
  "materials": [{ "type": "physical", "color": "#38bdf8" }]
}
```

The `positions`, `indices`, `normals`, and `uvs` shorthands remain valid. Position, normal, tangent, color, multiple UV sets, skin indices/weights, and custom attributes all use the same generic descriptor.

### Binary data and `.tjz`

Large arrays can live in named buffers:

```json
{
  "geometry": {
    "buffers": {
      "positions": "https://example.com/model.positions.bin",
      "indices": { "base64": "..." }
    },
    "attributes": {
      "position": { "ref": "positions", "itemSize": 3, "type": "Float32Array", "length": 600000 }
    },
    "index": { "ref": "indices", "type": "Uint32Array", "length": 1200000 }
  }
}
```

`.tjz` `tryPack` discovers these references and attempts to archive them. The engine has no vertex, triangle, or JSON-byte ceiling. It rejects only objective errors such as invalid indices, non-finite values, and mismatched attribute counts. A host may supply an optional `meshBudget`; every field is `undefined` by default:

```js
const options = {
  meshBudget: {
    maxVertices: undefined,
    maxTriangles: undefined,
    maxBytes: undefined,
    maxBuildTimeMs: undefined
  }
};
```

## Editable control cages with `editableMesh`

`editableMesh` stores low-density source topology. Modifiers deterministically regenerate the evaluated runtime geometry:

```json
{
  "threeJsonId": "chair-shell",
  "objType": "editableMesh",
  "topology": {
    "revision": 0,
    "vertices": [
      { "id": "v-a", "position": [-1, 0, 0] },
      { "id": "v-b", "position": [1, 0, 0] },
      { "id": "v-c", "position": [1, 1, 0] },
      { "id": "v-d", "position": [-1, 1, 0] }
    ],
    "faces": [
      { "id": "f-seat", "vertices": ["v-a", "v-b", "v-c", "v-d"], "part": "seat", "materialIndex": 0, "smooth": true }
    ],
    "edges": [{ "vertices": ["v-a", "v-b"], "crease": 0.5 }]
  },
  "modifiers": [
    { "id": "subdivision", "type": "catmullClark", "levels": 2 },
    { "id": "thickness", "type": "solidify", "thickness": 0.12 }
  ],
  "material": { "type": "physical", "color": "#d97757" }
}
```

Faces may be triangles, quads, or n-gons and are triangulated at runtime. Vertices, faces, and semantic `part` values use stable IDs; array positions are not identities for cross-turn editing.

Available modifiers include Mirror, Catmull-Clark, Loop, Smooth, Bevel, Solidify, Triangulate, Tessellate, EdgeSplit/crease normals, Simplify, planar/box/cylindrical/spherical/triplanar UV projection, and normal/tangent recomputation. Simplify runs only when the descriptor or host explicitly requests it; the engine never simplifies a model automatically.

## Compact surfaces

Choose an object type that matches the shape:

- `parametricSurface`: `expressions: {x,y,z}`, parameter ranges, and sampling segments.
- `nurbsSurface`: weighted controls, degrees, knot vectors, and sampling segments.
- `bezierPatch`: a rectangular control-point grid.
- `latheMesh`: revolve a 2D profile.
- `loftMesh`: loft between multiple sections.
- `sweepMesh`: sweep a 2D profile along a 3D path.
- `implicitSurface`: compose an SDF or provide a scalar field and evaluate it with Marching Tetrahedra.

These descriptors complement rather than replace `bufferMesh`. Evaluated output can be baked when complete coordinates are needed, and users can always provide raw vertices and indices directly.

## Mesh runtime commands

Use the unified executor from `threejson/commands`:

- `mesh.inspect`: statistics, bounds, material slots, parts, modifiers, and revision.
- `mesh.getTopology`: retrieve source topology by part, IDs, bounds, and page.
- `mesh.validate`: degenerates, duplicate faces, dangling vertices, boundaries, non-manifold edges, and winding; `checkSelfIntersectionRisk:true` adds a broad-phase overlapping-bounds risk pass for non-adjacent faces.
- `mesh.edit`: an atomic stable-ID control-topology transaction guarded by `baseRevision`.
- `mesh.buffer.*`: append or replace raw attributes/indices across responses, then atomically `commit` or `cancel`.
- `mesh.bake`: convert evaluated editable geometry into a complete `bufferMesh` descriptor.
- `mesh.renderViews`: call a host-injected multi-view renderer.

`mesh.edit.operations` includes vertex/face add, set, and remove, `assignPart`, `setEdgeCrease`, `extrudeFaces`, `insetFaces`, `bevelEdges`, `bridgeLoops`, `loopCut`, `mirror`, and modifier updates/reordering. If any operation fails, the transaction publishes nothing. A replacement geometry is installed only after it builds successfully, preserving the original Object3D, materials, parent, and identity.

```json
{
  "op": "mesh.edit",
  "args": {
    "id": "chair-shell",
    "baseRevision": 8,
    "operations": [
      { "type": "setVertex", "id": "v-a", "position": [-1.1, 0.1, 0] },
      { "type": "assignPart", "faceIds": ["f-seat"], "part": "seat-cushion" }
    ]
  }
}
```

Position-only edits can update the Position BufferAttribute directly when no modifier changes the geometry semantics. Topology changes re-evaluate that object. Commands return reversible diffs so an editor can record a single undo transaction.

When ThreeBox uses diff-only turn caching, progressive edits are stored as a command log with a full checkpoint every 12 command turns by default. Hosts can change `io.turnDiffCheckpointInterval`, or set it to `0` to disable periodic checkpoints. Recovery replays only from the nearest checkpoint, so the command chain does not grow without bound.

## AI and host policy

Complex generation has two equally supported paths:

- `full-coordinates`: author a complete `bufferMesh`, optionally through `mesh.buffer.*` across any number of responses.
- `progressive`: publish a recognizable control cage first, then inspect, edit, validate, and refine semantic parts.

### A draft is not necessarily disposable scaffolding

The default free-form draft is a low-density `editableMesh` or compact surface. It provides an immediate view of silhouette, proportions, orientation, and color while remaining the control source for subsequent refinement. There is no need to assemble a disposable proxy from boxes and cylinders and then rebuild the same subject as a vertex mesh.

Primitive blockouts still have specific uses: whole-scene spatial composition, objects whose final form really is a regular/hard-surface assembly, and expensive workflows in which the user explicitly wants to approve composition first. This is an AI-selectable strategy, not a mandatory confirmation gate before every complex model.

Representation follows the least complex form that is still faithful. A primitive, Three.js-native parametric geometry, instanced set, or CSG result does not become an `editableMesh` merely because the user asks for “high quality.” Complex meshes are for irregular silhouettes, free-form curvature, topology, morphing, or local surface features that those exact representations cannot express.

### Prefer local refinement over redundant coordinates

When the control cage already has the right shape and only looks faceted or undersampled, the AI should set deterministic local modifiers rather than authoring more control vertices:

- Catmull–Clark for quad/n-gon cages;
- Loop for all-triangle cages;
- Smooth only when it preserves the intended silhouette.

`mesh.inspect` reports triangle, quad, and n-gon control-face statistics, so the AI can choose without reading the full topology. The user's browser evaluates the modifier locally while the low-density cage remains the JSON source. Control vertices are added or moved only when silhouette, features, or deformation actually require a topology change.

### Non-shape edits use compact spatial context

Position, rotation, scale, parenting/layout, visibility, material, animation, and camera changes do not require dense coordinates to be sent to the model. Default spatial cards contain stable IDs, exact local/world transforms, geometry statistics, and bounds; `bufferMesh` attributes, `editableMesh` vertices/faces, and surface control points are omitted. Nested transforms are composed.

Only requests that actually change shape, topology, semantic parts, modifiers, or morphs use `mesh.inspect`, paged/part-filtered `mesh.getTopology`, or optional multi-view review. Explicitly opting into full-scene JSON still sends the full descriptor as requested.

`complexModelStrategy` defaults to `auto`, and `modelQuality` defaults to `balanced`. ThreeJSON core has no fixed round, token, cost, or time ceiling; these apply only when the user or host explicitly supplies `modelBudget`. Token budgets prefer provider-reported usage and otherwise use an explicitly marked completion-content estimate. Cost budgets require provider-reported cost or a host `estimateModelCost` / `providerAdapter.estimateCost` callback; the engine never guesses model pricing. Normal completion follows model `done`, a passed quality check, or user pause. Repeated commands, no progress, and invalid results are abnormal stop conditions rather than quality-round limits.

## Examples

The website's “Complex Models and Surfaces” gallery covers furniture, a vehicle shell, a mechanical part, a plant, an animal, a humanoid form, an asymmetric organic object, a free-form product, and raw BufferGeometry/Morph. Sources are under `assets/json/demo-show/complex-modeling/`.
