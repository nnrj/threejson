/**
 * Default object deploy for unrecognized objType (requires sceneConfig.enableDefaultModel === true).
 * Pure descriptor logic is in defaultModelDescriptor.js.
 */
import { deployMesh } from "../builder/modelBuilder.js";
import { log } from "../util/logger.js";
import {
  buildDefaultDeployDescriptor,
  getDefaultModelTemplate
} from "./defaultModelDescriptor.js";

export {
  CORE_MESH_PRIMITIVE_OBJ_TYPES,
  buildBuiltinFallbackDefaultDescriptor,
  buildDefaultDeployDescriptor,
  extractDefaultModelFromScenePayload,
  getDefaultModelTemplate,
  isCoreMeshPrimitiveObjType,
  isDefaultModelEnabled
} from "./defaultModelDescriptor.js";

/**
 * @param {import("three").Object3D|null} object3D
 * @param {object} descriptor
 * @returns {string}
 */
function formatObjectIdentity(object3D, descriptor) {
  const parts = [];
  const id = descriptor?.threeJsonId;
  if (typeof id === "string" && id.trim()) {
    parts.push(`threeJsonId=${id.trim()}`);
  }
  if (object3D?.uuid) {
    parts.push(`uuid=${object3D.uuid}`);
  }
  return parts.length > 0 ? parts.join(", ") : "uuid=unknown";
}

/**
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {object} sourceRecord
 * @param {object} [ctx]
 * @returns {import("three").Object3D|null}
 */
export function deployAsDefaultModel(scene, sourceRecord, ctx) {
  if (!scene || !sourceRecord) {
    return null;
  }
  const template = getDefaultModelTemplate(ctx);
  const descriptor = buildDefaultDeployDescriptor(sourceRecord, template);
  const childCountBefore = scene.children.length;
  deployMesh(descriptor, scene);
  let mesh = null;
  if (scene.children.length > childCountBefore) {
    mesh = scene.children[scene.children.length - 1];
  }
  const identity = formatObjectIdentity(mesh, descriptor);
  const templateHint = template ? "scene defaultModel / objType=default template" : "built-in red 1×1×1 cube";
  log.warn(
    `[deployMeshWithDomains] unrecognized objType "${sourceRecord?.objType ?? ""}" (${sourceRecord?.name || ""})` +
      `${descriptor.sourceObjType ? `, sourceObjType=${descriptor.sourceObjType}` : ""}` +
      `; rendered as default object via enableDefaultModel (${templateHint}); ${identity}`
  );
  return mesh;
}
