const ADVANCED_WEBGL_PASS_TYPES = new Set(["unrealbloom", "fxaa", "smaa", "shader", "shaderpreset"]);
const RASTER_PARTICLE_SOURCES = new Set(["textmask", "imagemask"]);
const EXTRA_CONTROLS_TYPES = new Set(["map", "mapcontrols", "trackball", "trackballcontrols", "arcball", "arcballcontrols"]);

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

/** Load optional Three.js modules only when the descriptor actually references them. */
export async function ensureOptionalSceneCapabilitiesForPayload(payload) {
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
