const ADVANCED_WEBGL_PASS_TYPES = new Set(["unrealbloom", "fxaa", "smaa", "shader", "shaderpreset"]);
const RASTER_PARTICLE_SOURCES = new Set(["textmask", "imagemask"]);
const EXTRA_CONTROLS_TYPES = new Set(["map", "mapcontrols", "trackball", "trackballcontrols", "arcball", "arcballcontrols"]);
const COMPLEX_MESH_TYPES = new Set([
  "editablemesh",
  "parametricsurface",
  "bezierpatch",
  "nurbssurface",
  "lathemesh",
  "loftmesh",
  "sweepmesh",
  "implicitsurface",
  "sdfmesh"
]);

function collectBufferMeshRecords(value, out = [], seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectBufferMeshRecords(entry, out, seen);
    return out;
  }
  if (String(value.objType || "").trim().toLowerCase() === "buffermesh") out.push(value);
  for (const entry of Object.values(value)) collectBufferMeshRecords(entry, out, seen);
  return out;
}

function collectBufferReferenceUrls(record) {
  const geometry = record?.geometry;
  if (!geometry || typeof geometry !== "object") return [];
  const refs = [];
  const add = (key, declared) => {
    const url = typeof declared === "string" ? declared : declared?.url;
    if (typeof url === "string" && url.trim()) refs.push({ key, url: url.trim() });
  };
  for (const [key, declared] of Object.entries(geometry.buffers || {})) add(key, declared);
  const visitAttribute = (descriptor) => {
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor) || ArrayBuffer.isView(descriptor)) return;
    const reference = descriptor.ref ?? descriptor.bufferRef ?? (typeof descriptor.buffer === "string" ? descriptor.buffer : null);
    if (reference == null) return;
    const key = typeof reference === "string" ? reference : reference?.id || reference?.buffer;
    add(key, geometry.buffers?.[key] ?? reference);
  };
  for (const descriptor of Object.values(geometry.attributes || {})) visitAttribute(descriptor);
  visitAttribute(geometry.index);
  for (const targets of Object.values(geometry.morphAttributes || {})) {
    for (const descriptor of Array.isArray(targets) ? targets : []) visitAttribute(descriptor);
  }
  return refs;
}

async function resolveBufferMeshReferences(payload) {
  const records = collectBufferMeshRecords(payload);
  const fetched = new Map();
  for (const record of records) {
    const geometry = record.geometry;
    const refs = collectBufferReferenceUrls(record);
    if (refs.length === 0) continue;
    const resolved = new Map();
    for (const { key, url } of refs) {
      let buffer = fetched.get(url);
      if (!buffer) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`bufferMesh binary reference fetch failed (${response.status}): ${url}`);
        buffer = await response.arrayBuffer();
        fetched.set(url, buffer);
      }
      resolved.set(url, buffer);
      if (key) resolved.set(key, buffer);
    }
    Object.defineProperty(geometry, "__threeJsonResolvedBuffers", {
      configurable: true,
      enumerable: false,
      value: resolved
    });
  }
}

function containsAdvancedPass(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => containsAdvancedPass(entry, seen));
  const passType = typeof value.passType === "string" ? value.passType.trim().toLowerCase() : "";
  if (ADVANCED_WEBGL_PASS_TYPES.has(passType)) return true;
  return Object.values(value).some((entry) => containsAdvancedPass(entry, seen));
}

function containsRasterParticleSource(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => containsRasterParticleSource(entry, seen));
  const objType = typeof value.objType === "string" ? value.objType.trim().toLowerCase() : "";
  const sourceType = typeof value.source?.type === "string" ? value.source.type.trim().toLowerCase() : "";
  if (objType === "particleemitter" && RASTER_PARTICLE_SOURCES.has(sourceType)) return true;
  return Object.values(value).some((entry) => containsRasterParticleSource(entry, seen));
}

function containsExtraControls(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => containsExtraControls(entry, seen));
  const objType = typeof value.objType === "string" ? value.objType.trim().toLowerCase() : "";
  const controlsType = typeof value.type === "string" ? value.type.trim().toLowerCase().replace(/[\s_-]/g, "") : "";
  if (objType === "controls" && EXTRA_CONTROLS_TYPES.has(controlsType)) return true;
  const sceneControlsType = typeof value.sceneConfig?.controls?.type === "string"
    ? value.sceneConfig.controls.type.trim().toLowerCase().replace(/[\s_-]/g, "")
    : "";
  if (EXTRA_CONTROLS_TYPES.has(sceneControlsType)) return true;
  return Object.values(value).some((entry) => containsExtraControls(entry, seen));
}

function containsComplexMesh(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => containsComplexMesh(entry, seen));
  const objType = typeof value.objType === "string" ? value.objType.trim().toLowerCase() : "";
  if (COMPLEX_MESH_TYPES.has(objType)) return true;
  return Object.values(value).some((entry) => containsComplexMesh(entry, seen));
}

/** Load optional Three.js modules only when the descriptor actually references them. */
export async function ensureOptionalSceneCapabilitiesForPayload(payload) {
  await resolveBufferMeshReferences(payload);
  if (containsAdvancedPass(payload)) {
    const module = await import("../builder/postprocess/webglAdvancedPasses.js");
    module.ensureWebglAdvancedPassesRegistered();
  }
  if (containsRasterParticleSource(payload)) {
    const module = await import("../builder/particle/particlesRaster.js");
    module.ensureParticlesRasterRegistered();
  }
  if (containsExtraControls(payload)) {
    const module = await import("../builder/controls/extraControls.js");
    module.ensureExtraControlsRegistered();
  }
  if (containsComplexMesh(payload)) {
    const module = await import("../builder/complexMeshCapability.js");
    module.ensureComplexMeshCapabilityRegistered();
  }
}

export function sceneUsesAdvancedWebglPass(payload) {
  return containsAdvancedPass(payload);
}

export function sceneUsesRasterParticleSource(payload) {
  return containsRasterParticleSource(payload);
}

export function sceneUsesExtraControls(payload) {
  return containsExtraControls(payload);
}

export function sceneUsesComplexMesh(payload) {
  return containsComplexMesh(payload);
}
