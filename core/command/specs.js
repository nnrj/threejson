import { COMMAND_API_VERSION } from "./types.js";

/** @type {import("./types.js").CommandSpec[]} */
export const CORE_COMMAND_SPECS = [
  {
    op: "scene.load",
    mode: "runtime",
    summary: "Load a scene JSON payload into the command context runtime.",
    args: {
      json: "Scene payload object (worldInfo and/or objectList).",
      sync: "Optional boolean; use sync loader in Node/tests when true.",
      options: "Optional createJsonScene options object."
    },
    example: {
      v: COMMAND_API_VERSION,
      op: "scene.load",
      args: { sync: true, json: { worldInfo: { boxModelList: [] } } }
    }
  },
  {
    op: "scene.validate",
    mode: "document",
    summary: "Validate scene JSON structure without a live THREE.Scene.",
    args: {
      json: "Scene payload object to validate."
    },
    example: {
      v: COMMAND_API_VERSION,
      op: "scene.validate",
      args: { json: { worldInfo: { boxModelList: [{ objType: "box", name: "b1" }] } } }
    },
    microDslExample: "scene.validate"
  },
  {
    op: "scene.applyPatch",
    mode: "document",
    summary: "Apply RFC6902 patch to scene JSON document (no live runtime required).",
    args: {
      json: "Scene payload object; defaults to ctx.document.",
      patch: "RFC6902 operation array."
    },
    example: {
      v: COMMAND_API_VERSION,
      op: "scene.applyPatch",
      args: {
        json: { objectList: [{ objType: "box", name: "a" }] },
        patch: [{ op: "replace", path: "/objectList/0/name", value: "b" }]
      }
    }
  },
  {
    op: "scene.export",
    mode: "runtime",
    summary: "Export the current runtime scene to standard JSON.",
    args: {
      format: 'Export format; currently "standard" only.',
      options: "Optional sceneToStandardJson options."
    },
    example: { v: COMMAND_API_VERSION, op: "scene.export", args: { format: "standard" } }
  },
  {
    op: "scene.list",
    mode: "runtime",
    summary: "List deployable objects in the current scene (id, name, objType).",
    args: {},
    example: { v: COMMAND_API_VERSION, op: "scene.list", args: {} },
    microDslExample: "scene.list"
  },
  {
    op: "object.add",
    mode: "runtime",
    summary:
      "Deploy an object descriptor into the scene. For assemblies: add group with threeJsonId first, then parts with parent=<group id>.",
    args: {
      descriptor: "Object descriptor with objType.",
      parent: "Optional parent threeJsonId (assembly group id) or omit for scene root.",
      options: "Optional addObjectFromDescriptor options."
    },
    example: {
      v: COMMAND_API_VERSION,
      op: "object.add",
      args: {
        parent: "female-robot-grp",
        descriptor: {
          objType: "box",
          name: "female-robot-body",
          geometry: { width: 1, height: 1, depth: 1 }
        }
      }
    },
    microDslExample:
      'object.add parent=female-robot-grp descriptor={"objType":"box","name":"female-robot-body","geometry":{"width":1,"height":1,"depth":1}}'
  },
  {
    op: "object.remove",
    mode: "runtime",
    summary: "Remove an object by threeJsonId.",
    args: {
      id: "threeJsonId to remove.",
      options: "Optional removeObjectById options."
    },
    example: { v: COMMAND_API_VERSION, op: "object.remove", args: { id: "obj-1" } },
    microDslExample: "object.remove id=obj-1"
  },
  {
    op: "object.patch",
    mode: "runtime",
    summary: "Patch an object descriptor (partial) or set a JSON path.",
    args: {
      id: "threeJsonId.",
      partial: "Nested partial descriptor object; omitted nested fields are preserved.",
      path: "Dot-path for applyObjectChange.",
      value: "Value for applyObjectChange path.",
      options: "Optional mutation options."
    },
    example: {
      v: COMMAND_API_VERSION,
      op: "object.patch",
      args: { id: "obj-1", partial: { position: { x: 2, y: 0, z: 0 } } }
    },
    microDslExample: 'object.patch id=obj-1 partial={"geometry":{"height":12}}'
  },
  {
    op: "object.get",
    mode: "runtime",
    summary: "Read an object descriptor or a path within it.",
    args: {
      id: "threeJsonId.",
      path: "Optional dot-path; omit for full descriptor."
    },
    example: { v: COMMAND_API_VERSION, op: "object.get", args: { id: "obj-1", path: "position" } }
  },
  {
    op: "object.reconcile",
    mode: "runtime",
    summary: "Write live Object3D position/rotation/scale back into objJson (one id or whole scene).",
    args: {
      id: "Optional threeJsonId; omit to reconcile all deployable objects.",
      options: "Optional { markBindingDirty?: boolean }."
    },
    example: { v: COMMAND_API_VERSION, op: "object.reconcile", args: { id: "obj-1" } },
    microDslExample: "object.reconcile id=obj-1"
  },
  {
    op: "material.patch",
    mode: "runtime",
    summary: "Patch material fields (color, textureUrl, opacity, etc.) on one object.",
    args: {
      id: "threeJsonId.",
      partial: "Material partial object (same fields as descriptor.material).",
      options: "Optional object.patch options (deferAsync, markBindingDirty, …)."
    },
    example: {
      v: COMMAND_API_VERSION,
      op: "material.patch",
      args: { id: "obj-1", partial: { color: "#336699" } }
    },
    microDslExample: 'material.patch id=obj-1 partial={"color":"#336699"}'
  },
  {
    op: "camera.fit",
    mode: "runtime",
    summary: "Fit perspective camera and orbit controls to scene content or a specific object.",
    args: {
      target: '"scene" (default), "id", or "selection" (requires ctx.options.selectionId).',
      id: "threeJsonId when target is id.",
      aspectHints: "Optional aspect ratio hints for editor viewport.",
      viewDirection: "Optional Vector3-like direction override."
    },
    example: { v: COMMAND_API_VERSION, op: "camera.fit", args: { target: "scene" } },
    microDslExample: "camera.fit target=scene"
  },
  {
    op: "morph.list",
    mode: "runtime",
    summary: "List morph targets and current influences for a loaded model.",
    args: { id: "Root model threeJsonId.", mesh: "Optional child mesh name, uuid, or threeJsonId." },
    example: { v: COMMAND_API_VERSION, op: "morph.list", args: { id: "character" } },
    microDslExample: "morph.list id=character"
  },
  {
    op: "morph.set",
    mode: "runtime",
    summary: "Set a named or indexed morph influence on matching meshes.",
    args: { id: "Root model threeJsonId.", target: "Morph name or index.", value: "Influence (clamped to 0..1 by default).", mesh: "Optional child mesh selector.", clamp: "Set false to allow values outside 0..1." },
    example: { v: COMMAND_API_VERSION, op: "morph.set", args: { id: "character", target: "Smile", value: 0.8 } },
    microDslExample: "morph.set id=character target=Smile value=0.8"
  },
  {
    op: "mesh.inspect",
    mode: "runtime",
    summary: "Inspect mesh statistics, semantic parts, modifiers and current revision.",
    args: { id: "Mesh threeJsonId." },
    example: { v: COMMAND_API_VERSION, op: "mesh.inspect", args: { id: "model-1" } }
  },
  {
    op: "mesh.getTopology",
    mode: "runtime",
    summary: "Read editableMesh control topology by part, IDs, bounds, or page without echoing a whole dense mesh.",
    args: { id: "editableMesh threeJsonId.", part: "Optional semantic part.", vertexIds: "Optional vertex ID array.", faceIds: "Optional face ID array.", bounds: "Optional {min,max} spatial bounds.", page: "One-based page.", pageSize: "Page size." },
    example: { v: COMMAND_API_VERSION, op: "mesh.getTopology", args: { id: "model-1", part: "body", page: 1, pageSize: 200 } }
  },
  {
    op: "mesh.validate",
    mode: "runtime",
    summary: "Validate topology/index ranges and report degenerates, duplicate faces, winding, boundaries and non-manifold edges.",
    args: { id: "Mesh threeJsonId.", checkSelfIntersectionRisk: "Optional broad-phase warning pass for non-adjacent faces with overlapping bounds." },
    example: { v: COMMAND_API_VERSION, op: "mesh.validate", args: { id: "model-1" } }
  },
  {
    op: "mesh.edit",
    mode: "runtime",
    summary: "Atomically edit stable-ID editableMesh topology and modifiers, guarded by baseRevision.",
    args: { id: "editableMesh threeJsonId.", baseRevision: "Revision returned by mesh.inspect/getTopology.", operations: "Array of add/set/remove vertex/face, assignPart, crease, extrude, inset, bevel, bridge, loopCut, mirror, or modifier operations." },
    example: { v: COMMAND_API_VERSION, op: "mesh.edit", args: { id: "model-1", baseRevision: 0, operations: [{ type: "setVertex", id: "v-1", position: [0, 1.2, 0] }] } }
  },
  {
    op: "mesh.buffer.appendAttribute",
    mode: "runtime",
    summary: "Append values to a pending raw bufferMesh attribute transaction.",
    args: { id: "bufferMesh threeJsonId.", baseRevision: "Current meshRevision.", name: "Attribute name.", itemSize: "Attribute itemSize.", values: "Numeric values." },
    example: { v: COMMAND_API_VERSION, op: "mesh.buffer.appendAttribute", args: { id: "raw-1", baseRevision: 0, name: "position", itemSize: 3, values: [0, 0, 0] } }
  },
  {
    op: "mesh.buffer.setAttributeRange",
    mode: "runtime",
    summary: "Replace a numeric range in a pending raw bufferMesh attribute transaction.",
    args: { id: "bufferMesh threeJsonId.", baseRevision: "Current meshRevision.", name: "Attribute name.", offset: "Scalar offset.", values: "Replacement values.", expand: "Allow growing the array." },
    example: { v: COMMAND_API_VERSION, op: "mesh.buffer.setAttributeRange", args: { id: "raw-1", baseRevision: 0, name: "position", offset: 0, values: [0, 1, 0] } }
  },
  {
    op: "mesh.buffer.appendIndices",
    mode: "runtime",
    summary: "Append triangle indices to a pending raw bufferMesh transaction.",
    args: { id: "bufferMesh threeJsonId.", baseRevision: "Current meshRevision.", values: "Non-negative integer indices." },
    example: { v: COMMAND_API_VERSION, op: "mesh.buffer.appendIndices", args: { id: "raw-1", baseRevision: 0, values: [0, 1, 2] } }
  },
  {
    op: "mesh.buffer.setIndexRange",
    mode: "runtime",
    summary: "Replace indices in a pending raw bufferMesh transaction.",
    args: { id: "bufferMesh threeJsonId.", baseRevision: "Current meshRevision.", offset: "Index offset.", values: "Replacement indices.", expand: "Allow growing the index." },
    example: { v: COMMAND_API_VERSION, op: "mesh.buffer.setIndexRange", args: { id: "raw-1", baseRevision: 0, offset: 0, values: [0, 2, 1] } }
  },
  {
    op: "mesh.buffer.commit",
    mode: "runtime",
    summary: "Validate and atomically publish a pending bufferMesh transaction.",
    args: { id: "bufferMesh threeJsonId.", baseRevision: "Revision on which the transaction is based." },
    example: { v: COMMAND_API_VERSION, op: "mesh.buffer.commit", args: { id: "raw-1", baseRevision: 0 } }
  },
  {
    op: "mesh.buffer.cancel",
    mode: "runtime",
    summary: "Discard a pending bufferMesh transaction.",
    args: { id: "bufferMesh threeJsonId." },
    example: { v: COMMAND_API_VERSION, op: "mesh.buffer.cancel", args: { id: "raw-1" } }
  },
  {
    op: "mesh.bake",
    mode: "runtime",
    summary: "Bake evaluated editableMesh output into a complete raw bufferMesh descriptor.",
    args: { id: "editableMesh threeJsonId.", includeDescriptor: "Return the full descriptor when true." },
    example: { v: COMMAND_API_VERSION, op: "mesh.bake", args: { id: "model-1" } }
  },
  {
    op: "mesh.renderViews",
    mode: "runtime",
    summary: "Ask an injected host renderer for orthographic/perspective model review views.",
    args: { id: "Mesh threeJsonId.", views: "Optional view-name array.", size: "Optional output size." },
    example: { v: COMMAND_API_VERSION, op: "mesh.renderViews", args: { id: "model-1", views: ["front", "right", "top", "perspective"] } }
  }
];

/**
 * @param {string} [namespace]
 * @returns {import("./types.js").CommandSpec[]}
 */
export function getCoreCommandSpecs(namespace) {
  const prefix = namespace ? `${String(namespace).trim()}.` : "";
  if (!prefix) {
    return CORE_COMMAND_SPECS.slice();
  }
  return CORE_COMMAND_SPECS.filter((spec) => spec.op.startsWith(prefix));
}
