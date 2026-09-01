/**
 * Machine-readable ThreeJSON scene capability registry.
 *
 * This module intentionally has no Three.js, AI, DOM, network, archive, or host imports. It is
 * the shared source of truth used by runtime validation, prompts, documentation tests, and host
 * feature UIs. Optional adapters register their preview capabilities only when imported.
 */

export const SCENE_CAPABILITY_STATUS = Object.freeze({
  STABLE: "stable",
  PREVIEW: "preview",
  EXTENSION: "extension",
  UNAVAILABLE: "unavailable"
});

const VALID_STATUSES = new Set(Object.values(SCENE_CAPABILITY_STATUS));

const BUILTIN_CAPABILITIES = Object.freeze({
  rendererBackends: Object.freeze({
    webgl: Object.freeze({ status: "stable", async: false, entry: "threejson/core" }),
    webgpu: Object.freeze({
      status: "unavailable",
      async: true,
      entry: "threejson/webgpu",
      optionalEntries: Object.freeze(["threejson/webgpu", "threejson/tsl-code"]),
      reason: "Import threejson/webgpu (or the superset threejson/tsl-code) to register the preview renderer backend."
    })
  }),
  objects: Object.freeze({
    group: Object.freeze({ status: "stable" }),
    mesh: Object.freeze({ status: "stable" }),
    box: Object.freeze({ status: "stable" }),
    floor: Object.freeze({ status: "stable" }),
    wall: Object.freeze({ status: "stable" }),
    glass: Object.freeze({ status: "stable" }),
    door: Object.freeze({ status: "stable" }),
    cabinet: Object.freeze({ status: "stable" }),
    road: Object.freeze({ status: "stable" }),
    sphere: Object.freeze({ status: "stable" }),
    cylinder: Object.freeze({ status: "stable" }),
    cone: Object.freeze({ status: "stable" }),
    ring: Object.freeze({ status: "stable" }),
    torus: Object.freeze({ status: "stable" }),
    capsule: Object.freeze({ status: "stable" }),
    native: Object.freeze({ status: "stable" }),
    line: Object.freeze({ status: "stable" }),
    text: Object.freeze({ status: "stable" }),
    infoPanel: Object.freeze({ status: "stable" }),
    css3dPanel: Object.freeze({ status: "stable" }),
    heatMap: Object.freeze({ status: "stable" }),
    wind: Object.freeze({ status: "stable" }),
    shaderSurface: Object.freeze({ status: "stable", rendererBackends: ["webgl"] }),
    particleEmitter: Object.freeze({ status: "stable", rendererBackends: ["webgl"] }),
    plane: Object.freeze({ status: "stable" }),
    points: Object.freeze({ status: "stable" }),
    sprite: Object.freeze({ status: "stable" }),
    tube: Object.freeze({ status: "stable" }),
    shapePlane: Object.freeze({ status: "stable" }),
    bufferMesh: Object.freeze({ status: "stable" }),
    editableMesh: Object.freeze({ status: "stable", topology: "stable-id", runtimeCommands: true, lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/complex-mesh" }),
    parametricSurface: Object.freeze({ status: "stable", compactMesh: true, lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/complex-mesh" }),
    subdivisionSurface: Object.freeze({ status: "stable", representedBy: "editableMesh", lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/complex-mesh" }),
    nurbsSurface: Object.freeze({ status: "stable", compactMesh: true, lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/complex-mesh" }),
    bezierPatch: Object.freeze({ status: "stable", compactMesh: true, lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/complex-mesh" }),
    latheMesh: Object.freeze({ status: "stable", compactMesh: true, lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/complex-mesh" }),
    loftMesh: Object.freeze({ status: "stable", compactMesh: true, lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/complex-mesh" }),
    sweepMesh: Object.freeze({ status: "stable", compactMesh: true, lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/complex-mesh" }),
    implicitSurface: Object.freeze({ status: "stable", method: "marching-tetrahedra", compactMesh: true, lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/complex-mesh" }),
    irregularPlane: Object.freeze({ status: "stable" }),
    shapeExtrude: Object.freeze({ status: "stable" }),
    irregularGeometry: Object.freeze({ status: "stable" }),
    instanced: Object.freeze({ status: "stable" }),
    skinned: Object.freeze({ status: "stable" }),
    audio: Object.freeze({ status: "stable" }),
    externalModel: Object.freeze({
      status: "stable",
      materialBindings: Object.freeze({
        formats: Object.freeze(["gltf", "glb"]),
        modes: Object.freeze(["replace", "patch"])
      })
    }),
    domain: Object.freeze({ status: "stable" }),
    pass: Object.freeze({ status: "stable", rendererBackends: ["webgl"] }),
    scene: Object.freeze({ status: "stable" }),
    camera: Object.freeze({ status: "stable" }),
    renderer: Object.freeze({ status: "stable" }),
    controls: Object.freeze({ status: "stable" }),
    light: Object.freeze({ status: "stable" }),
    renderLoop: Object.freeze({ status: "stable" }),
    lod: Object.freeze({ status: "stable" })
  }),
  materials: Object.freeze({
    basic: Object.freeze({ status: "stable" }),
    lambert: Object.freeze({ status: "stable" }),
    phong: Object.freeze({ status: "stable" }),
    standard: Object.freeze({ status: "stable" }),
    physical: Object.freeze({ status: "stable" }),
    toon: Object.freeze({ status: "stable" }),
    matcap: Object.freeze({ status: "stable" }),
    normal: Object.freeze({ status: "stable" }),
    shader: Object.freeze({ status: "stable", rendererBackends: ["webgl"], mode: "registered-preset" }),
    tsl: Object.freeze({
      status: "unavailable",
      rendererBackends: ["webgpu"],
      modes: Object.freeze(["preset", "graph"]),
      entry: "threejson/webgpu",
      optionalEntries: Object.freeze(["threejson/webgpu", "threejson/tsl-code"]),
      codeEntry: "threejson/tsl-code",
      reason: "Import threejson/webgpu for preset/graph, or threejson/tsl-code for the full TSL module capability."
    })
  }),
  lightTypes: Object.freeze({
    ambient: Object.freeze({ status: "stable" }),
    hemisphere: Object.freeze({ status: "stable" }),
    directional: Object.freeze({ status: "stable" }),
    point: Object.freeze({ status: "stable" }),
    spot: Object.freeze({ status: "stable" }),
    rectArea: Object.freeze({ status: "stable", lazy: true, asyncRuntime: true })
  }),
  textureSlots: Object.freeze({
    baseColor: Object.freeze({ status: "stable" }),
    normal: Object.freeze({ status: "stable" }),
    roughness: Object.freeze({ status: "stable" }),
    metalness: Object.freeze({ status: "stable" }),
    ao: Object.freeze({ status: "stable" }),
    emissive: Object.freeze({ status: "stable" }),
    opacity: Object.freeze({ status: "stable" }),
    bump: Object.freeze({ status: "stable" }),
    displacement: Object.freeze({ status: "stable" }),
    clearcoat: Object.freeze({ status: "stable" }),
    clearcoatRoughness: Object.freeze({ status: "stable" }),
    clearcoatNormal: Object.freeze({ status: "stable" }),
    transmission: Object.freeze({ status: "stable" }),
    thickness: Object.freeze({ status: "stable" }),
    sheenColor: Object.freeze({ status: "stable" }),
    sheenRoughness: Object.freeze({ status: "stable" }),
    specularColor: Object.freeze({ status: "stable" }),
    specularIntensity: Object.freeze({ status: "stable" }),
    anisotropy: Object.freeze({ status: "stable" }),
    iridescence: Object.freeze({ status: "stable" }),
    iridescenceThickness: Object.freeze({ status: "stable" })
  }),
  passes: Object.freeze({
    render: Object.freeze({ status: "stable", rendererBackends: ["webgl"] }),
    outline: Object.freeze({ status: "stable", rendererBackends: ["webgl"] }),
    output: Object.freeze({ status: "stable", rendererBackends: ["webgl"] }),
    unrealBloom: Object.freeze({ status: "stable", rendererBackends: ["webgl"], lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/postprocessing-webgl" }),
    fxaa: Object.freeze({ status: "stable", rendererBackends: ["webgl"], lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/postprocessing-webgl" }),
    smaa: Object.freeze({ status: "stable", rendererBackends: ["webgl"], lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/postprocessing-webgl" }),
    shaderPreset: Object.freeze({ status: "stable", rendererBackends: ["webgl"], lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/postprocessing-webgl" }),
    bloom: Object.freeze({
      status: "unavailable",
      rendererBackends: ["webgpu"],
      entry: "threejson/webgpu",
      optionalEntries: Object.freeze(["threejson/webgpu", "threejson/tsl-code"]),
      reason: "Import threejson/webgpu (or threejson/tsl-code) to register the preview WebGPU bloom RenderPipeline."
    })
  }),
  modelFormats: Object.freeze({
    glb: Object.freeze({ status: "stable", import: true, export: true }),
    gltf: Object.freeze({ status: "stable", import: true, export: true }),
    obj: Object.freeze({ status: "stable", import: true, export: true }),
    stl: Object.freeze({ status: "stable", import: true, export: true }),
    ply: Object.freeze({ status: "stable", import: true, export: true }),
    fbx: Object.freeze({ status: "stable", import: true, export: "optional" }),
    usd: Object.freeze({ status: "stable", import: true, export: false, normalizedAs: "usdz" }),
    usdz: Object.freeze({ status: "stable", import: true, export: true })
  }),
  particleBackends: Object.freeze({
    cpu: Object.freeze({ status: "stable", rendererBackends: ["webgl"] }),
    "webgl-compute": Object.freeze({ status: "stable", rendererBackends: ["webgl"], requires: "webgl2" }),
    "webgpu-compute": Object.freeze({
      status: "unavailable",
      rendererBackends: ["webgpu"],
      entry: "threejson/webgpu",
      optionalEntries: Object.freeze(["threejson/webgpu", "threejson/tsl-code"]),
      reason: "Import threejson/webgpu (or threejson/tsl-code) to register the WebGPU compute particle backend."
    })
  }),
  particleSources: Object.freeze({
    positions: Object.freeze({ status: "stable" }),
    box: Object.freeze({ status: "stable" }),
    sphere: Object.freeze({ status: "stable" }),
    shell: Object.freeze({ status: "stable" }),
    disc: Object.freeze({ status: "stable" }),
    cone: Object.freeze({ status: "stable" }),
    line: Object.freeze({ status: "stable" }),
    curve: Object.freeze({ status: "stable" }),
    meshSurface: Object.freeze({ status: "stable" }),
    textMask: Object.freeze({ status: "stable", lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/particles-raster", browser: true }),
    imageMask: Object.freeze({ status: "stable", lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/particles-raster", browser: true })
  }),
  controlsTypes: Object.freeze({
    orbit: Object.freeze({ status: "stable" }),
    firstPerson: Object.freeze({ status: "stable" }),
    fly: Object.freeze({ status: "stable" }),
    map: Object.freeze({ status: "stable", lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/controls-extra" }),
    trackball: Object.freeze({ status: "stable", lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/controls-extra" }),
    arcball: Object.freeze({ status: "stable", lazy: true, asyncRuntime: true, activation: "descriptor", entry: "threejson/controls-extra" })
  })
});

const overridesByCategory = new Map();

function normalizeName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDefinition(definition = {}) {
  const status = VALID_STATUSES.has(definition.status) ? definition.status : SCENE_CAPABILITY_STATUS.STABLE;
  const next = { ...definition, status };
  if (Array.isArray(next.rendererBackends)) {
    next.rendererBackends = [...new Set(next.rendererBackends.map(normalizeName).filter(Boolean))];
  }
  return Object.freeze(next);
}

/** Register or replace a capability supplied by core, a domain, an extension, or a host. */
export function registerSceneCapability(category, id, definition = {}) {
  const categoryId = normalizeName(category);
  const capabilityId = normalizeName(id);
  if (!categoryId || !capabilityId) {
    throw new Error("[sceneCapabilities] category and id are required");
  }
  let categoryOverrides = overridesByCategory.get(categoryId);
  if (!categoryOverrides) {
    categoryOverrides = new Map();
    overridesByCategory.set(categoryId, categoryOverrides);
  }
  categoryOverrides.set(capabilityId, normalizeDefinition(definition));
}

/** Remove an optional registration and reveal the built-in declaration again. */
export function unregisterSceneCapability(category, id) {
  const categoryId = normalizeName(category);
  const capabilityId = normalizeName(id);
  const categoryOverrides = overridesByCategory.get(categoryId);
  const removed = categoryOverrides?.delete(capabilityId) === true;
  if (categoryOverrides?.size === 0) overridesByCategory.delete(categoryId);
  return removed;
}

function entryMatchesOptions(entry, options) {
  if (!options.includeUnavailable && entry.status === SCENE_CAPABILITY_STATUS.UNAVAILABLE) return false;
  if (!options.includePreview && entry.status === SCENE_CAPABILITY_STATUS.PREVIEW) return false;
  if (options.rendererBackend && Array.isArray(entry.rendererBackends)) {
    return entry.rendererBackends.includes(options.rendererBackend);
  }
  return true;
}

function buildCategory(categoryId, options) {
  const builtin = BUILTIN_CAPABILITIES[categoryId] || {};
  const overrides = overridesByCategory.get(categoryId);
  const ids = new Set([...Object.keys(builtin), ...(overrides ? overrides.keys() : [])]);
  const out = {};
  for (const id of ids) {
    const entry = overrides?.get(id) || builtin[id];
    if (!entry || !entryMatchesOptions(entry, options)) continue;
    out[id] = { ...entry };
  }
  return out;
}

/**
 * Return a detached capability snapshot suitable for prompts, UI, and serialization.
 * Unavailable features are hidden by default so consumers cannot accidentally advertise stubs.
 */
export function getSceneCapabilityManifest(options = {}) {
  const normalized = {
    rendererBackend: normalizeName(options.rendererBackend),
    includePreview: options.includePreview !== false,
    includeUnavailable: options.includeUnavailable === true
  };
  const categories = new Set([...Object.keys(BUILTIN_CAPABILITIES), ...overridesByCategory.keys()]);
  const manifest = {
    version: 1,
    rendererBackend: normalized.rendererBackend || null,
    categories: {}
  };
  for (const categoryId of categories) {
    manifest.categories[categoryId] = buildCategory(categoryId, normalized);
  }
  return manifest;
}

export function getSceneCapability(category, id, options = {}) {
  const categoryId = normalizeName(category);
  const capabilityId = normalizeName(id);
  const entry = overridesByCategory.get(categoryId)?.get(capabilityId)
    || BUILTIN_CAPABILITIES[categoryId]?.[capabilityId]
    || null;
  return entry ? { ...entry } : null;
}

export function isSceneCapabilityAvailable(category, id, options = {}) {
  const entry = getSceneCapability(category, id, options);
  if (!entry || entry.status === SCENE_CAPABILITY_STATUS.UNAVAILABLE) return false;
  const rendererBackend = normalizeName(options.rendererBackend);
  if (rendererBackend && Array.isArray(entry.rendererBackends)) {
    return entry.rendererBackends.includes(rendererBackend);
  }
  return true;
}

/** Test-only reset; optional adapters can register again after the reset. */
export function _clearSceneCapabilityRegistrationsForTests() {
  overridesByCategory.clear();
}
