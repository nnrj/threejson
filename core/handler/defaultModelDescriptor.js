/**
 * enableDefaultModel fallback descriptor builder (pure logic; no modelBuilder dependency).
 */

export const CORE_MESH_PRIMITIVE_OBJ_TYPES = new Set([
  "box",
  "sphere",
  "cylinder",
  "cone",
  "ring",
  "torus",
  "capsule"
]);

function normalizeObjType(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function isDefaultModelEnabled(ctx) {
  const root = ctx?.sceneJsonRoot ?? ctx?.jsonData;
  const sceneConfig = root?.sceneConfig;
  return Boolean(sceneConfig && sceneConfig.enableDefaultModel === true);
}

/**
 * @param {object} record
 * @returns {boolean}
 */
export function isCoreMeshPrimitiveObjType(record) {
  return CORE_MESH_PRIMITIVE_OBJ_TYPES.has(normalizeObjType(record?.objType));
}

/**
 * @param {object} [ctx]
 * @returns {object|null}
 */
export function getDefaultModelTemplate(ctx) {
  if (ctx?.defaultModelTemplate && typeof ctx.defaultModelTemplate === "object") {
    return ctx.defaultModelTemplate;
  }
  const root = ctx?.sceneJsonRoot ?? ctx?.jsonData;
  const worldInfo = root?.worldInfo;
  const sceneConfig = root?.sceneConfig;
  if (worldInfo?.defaultModel && typeof worldInfo.defaultModel === "object") {
    return worldInfo.defaultModel;
  }
  if (sceneConfig?.defaultModel && typeof sceneConfig.defaultModel === "object") {
    return sceneConfig.defaultModel;
  }
  return null;
}

/**
 * @returns {object}
 */
export function buildBuiltinFallbackDefaultDescriptor() {
  return {
    objType: "default",
    name: "__threejson_builtin_default__",
    geometry: { width: 1, height: 1, depth: 1 },
    material: {
      type: "standard",
      color: "#DC2800",
      metalness: 0,
      roughness: 0.9
    },
    position: { x: 0, y: 0.5, z: 0 }
  };
}

/**
 * @param {object} sourceRecord
 * @param {object|null} template
 * @returns {object}
 */
export function buildDefaultDeployDescriptor(sourceRecord, template) {
  const base = template && typeof template === "object"
    ? JSON.parse(JSON.stringify(template))
    : buildBuiltinFallbackDefaultDescriptor();
  const src = sourceRecord && typeof sourceRecord === "object" ? sourceRecord : {};
  const rawType = typeof src.objType === "string" ? src.objType.trim() : "";
  const businessInfo = {
    ...(base.businessInfo && typeof base.businessInfo === "object" ? base.businessInfo : {}),
    ...(src.businessInfo && typeof src.businessInfo === "object" ? src.businessInfo : {})
  };
  const normalizedRaw = normalizeObjType(rawType);
  const sourceObjType =
    rawType && normalizedRaw !== "default" ? rawType : undefined;
  return {
    ...base,
    ...src,
    objType: "default",
    ...(sourceObjType ? { sourceObjType } : {}),
    name: src.name || base.name || "default-object",
    geometry: src.geometry || base.geometry,
    material: src.material || base.material,
    materials: src.materials || base.materials,
    position: src.position || base.position,
    rotation: src.rotation || base.rotation,
    scale: src.scale || base.scale,
    businessInfo
  };
}

/**
 * Extract the default template from scene JSON (not deployed via the regular objectList content path).
 * @param {object} payload
 * @returns {{ template: object|null, payload: object }}
 */
export function extractDefaultModelFromScenePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { template: null, payload };
  }
  const next = JSON.parse(JSON.stringify(payload));
  let template = null;

  const tryPick = (record) => {
    if (record && typeof record === "object" && normalizeObjType(record.objType) === "default") {
      template = record;
      return true;
    }
    return false;
  };

  if (next.worldInfo?.defaultModel && typeof next.worldInfo.defaultModel === "object") {
    template = next.worldInfo.defaultModel;
    delete next.worldInfo.defaultModel;
  }
  if (next.sceneConfig?.defaultModel && typeof next.sceneConfig.defaultModel === "object") {
    template = template || next.sceneConfig.defaultModel;
    delete next.sceneConfig.defaultModel;
  }

  const filterList = (list) => {
    if (!Array.isArray(list)) {
      return list;
    }
    const kept = [];
    for (let i = 0; i < list.length; i++) {
      if (tryPick(list[i])) {
        continue;
      }
      kept.push(list[i]);
    }
    return kept;
  };

  if (next.worldInfo && typeof next.worldInfo === "object") {
    next.worldInfo.objModelList = filterList(next.worldInfo.objModelList);
    next.worldInfo.boxModelList = filterList(next.worldInfo.boxModelList);
    next.worldInfo.meshList = filterList(next.worldInfo.meshList);
  }
  if (Array.isArray(next.objectList)) {
    next.objectList = filterList(next.objectList);
  }

  return { template, payload: next };
}
