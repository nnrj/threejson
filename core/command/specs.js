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
      partial: "Top-level partial descriptor object.",
      path: "Dot-path for applyObjectChange.",
      value: "Value for applyObjectChange path.",
      options: "Optional mutation options."
    },
    example: {
      v: COMMAND_API_VERSION,
      op: "object.patch",
      args: { id: "obj-1", partial: { position: { x: 2, y: 0, z: 0 } } }
    },
    microDslExample: 'object.patch id=obj-1 partial={"position":{"x":2,"y":0,"z":0}}'
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
