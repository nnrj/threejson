function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vector(value, fallback = { x: 0, y: 0, z: 0 }) {
  return {
    x: finite(value?.x, fallback.x),
    y: finite(value?.y, fallback.y),
    z: finite(value?.z, fallback.z)
  };
}

function range(value, fallbackMin, fallbackMax = fallbackMin) {
  if (Array.isArray(value)) {
    const min = finite(value[0], fallbackMin);
    const max = finite(value[1], min);
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  if (value && typeof value === "object") {
    const min = finite(value.min, fallbackMin);
    const max = finite(value.max, min);
    return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  const exact = finite(value, fallbackMin);
  return { min: exact, max: exact };
}

function normalizeBackend(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[_\s]/g, "-") : "cpu";
  return raw || "cpu";
}

function normalizeMode(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "static";
  return ["static", "continuous", "burst"].includes(raw) ? raw : "static";
}

export const PARTICLE_ATTRACTOR_LIMIT = 16;

function normalizeCount(record, emission) {
  const explicit = finite(emission.count, NaN);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const rate = Math.max(0, finite(emission.rate, 0));
  const duration = Math.max(0, finite(emission.duration, 0));
  if (rate > 0 && duration > 0) return Math.max(1, Math.ceil(rate * duration));
  const sourcePositions = Array.isArray(record.source?.positions) ? record.source.positions.length : 0;
  return Math.max(1, sourcePositions || 1000);
}

export class ParticleDescriptorError extends Error {
  constructor(message, code = "E_PARTICLE_DESCRIPTOR_INVALID", details = {}) {
    super(message);
    this.name = "ParticleDescriptorError";
    this.code = code;
    Object.assign(this, details);
  }
}

/** Normalize the V2 descriptor only. Removed V1 fields are rejected with a migration diagnostic. */
export function normalizeParticleEmitterV2(record = {}, options = {}) {
  if (!record || typeof record !== "object") {
    throw new ParticleDescriptorError("particleEmitter descriptor must be an object");
  }
  const retiredFields = ["distribution", "count", "motion", "material", "provider", "particleProvider"]
    .filter((key) => Object.prototype.hasOwnProperty.call(record, key));
  if (retiredFields.length > 0) {
    throw new ParticleDescriptorError(
      `Particle V1 fields were removed; migrate to source/emission/particle/simulation/render: ${retiredFields.join(", ")}`,
      "E_PARTICLE_SCHEMA_V1_REMOVED",
      { fields: retiredFields }
    );
  }
  if (record.source !== undefined && (!record.source || typeof record.source !== "object" || Array.isArray(record.source))) {
    throw new ParticleDescriptorError("particle source must be an object");
  }
  if (record.emission !== undefined && (!record.emission || typeof record.emission !== "object" || Array.isArray(record.emission))) {
    throw new ParticleDescriptorError("particle emission must be an object");
  }
  if (record.particle !== undefined && (!record.particle || typeof record.particle !== "object" || Array.isArray(record.particle))) {
    throw new ParticleDescriptorError("particle block must be an object");
  }
  if (record.simulation !== undefined && (!record.simulation || typeof record.simulation !== "object" || Array.isArray(record.simulation))) {
    throw new ParticleDescriptorError("particle simulation must be an object");
  }
  if (record.render !== undefined && (!record.render || typeof record.render !== "object" || Array.isArray(record.render))) {
    throw new ParticleDescriptorError("particle render must be an object");
  }

  const source = record.source ? { ...record.source } : { type: "box" };
  source.type = typeof source.type === "string" && source.type.trim() ? source.type.trim() : "box";
  const emissionInput = record.emission || {};
  if (emissionInput.mode !== undefined && !["static", "continuous", "burst"].includes(String(emissionInput.mode).trim().toLowerCase())) {
    throw new ParticleDescriptorError(`Unsupported particle emission mode: ${String(emissionInput.mode)}`, "E_PARTICLE_EMISSION_MODE_UNAVAILABLE");
  }
  const emission = {
    ...emissionInput,
    mode: normalizeMode(emissionInput.mode),
    rate: Math.max(0, finite(emissionInput.rate, 0)),
    duration: Math.max(0, finite(emissionInput.duration, 0)),
    seed: Math.trunc(finite(emissionInput.seed, 1)) >>> 0
  };
  emission.count = normalizeCount(record, emission);
  emission.loop = emissionInput.loop === true || (emission.mode === "continuous" && emissionInput.loop !== false);

  const particleInput = record.particle || {};
  // A zero lifetime is the serialized sentinel for an infinite/static particle. It is safer
  // than Infinity because descriptors must survive JSON export.
  const lifetime = range(particleInput.lifetime, emission.mode === "static" ? 0 : 3);
  const particle = {
    ...particleInput,
    lifetime,
    velocity: particleInput.velocity ?? { x: 0, y: 0, z: 0 },
    acceleration: vector(particleInput.acceleration),
    rotation: range(particleInput.rotation, 0),
    angularVelocity: range(particleInput.angularVelocity, 0)
  };

  const simulationInput = record.simulation || {};
  const attractors = Array.isArray(simulationInput.attractors) ? simulationInput.attractors : [];
  if (attractors.length > PARTICLE_ATTRACTOR_LIMIT) {
    throw new ParticleDescriptorError(
      `Particle simulation has ${attractors.length} attractors; the shared backend limit is ${PARTICLE_ATTRACTOR_LIMIT}`,
      "E_PARTICLE_ATTRACTOR_LIMIT",
      { attractorCount: attractors.length, maxAttractors: PARTICLE_ATTRACTOR_LIMIT }
    );
  }
  const simulation = {
    ...simulationInput,
    backend: normalizeBackend(simulationInput.backend ?? options.defaultBackend ?? "cpu"),
    gravity: vector(simulationInput.gravity),
    acceleration: vector(simulationInput.acceleration),
    drag: Math.max(0, finite(simulationInput.drag, 0)),
    noise: simulationInput.noise && typeof simulationInput.noise === "object"
      ? {
        strength: Math.max(0, finite(simulationInput.noise.strength, 0)),
        frequency: Math.max(0.0001, finite(simulationInput.noise.frequency, 1))
      }
      : { strength: 0, frequency: 1 },
    attractors: [...attractors],
    boundary: simulationInput.boundary && typeof simulationInput.boundary === "object"
      ? { ...simulationInput.boundary, type: String(simulationInput.boundary.type || "none").toLowerCase() }
      : { type: "none" }
  };

  const renderInput = record.render || {};
  const render = {
    ...renderInput,
    type: String(renderInput.type || "points").toLowerCase(),
    size: finite(renderInput.size, 2),
    color: renderInput.color ?? "#ffffff",
    opacity: Math.max(0, Math.min(1, finite(renderInput.opacity, 1))),
    transparent: renderInput.transparent !== false,
    depthWrite: renderInput.depthWrite === true,
    depthTest: renderInput.depthTest !== false,
    blending: String(renderInput.blending || "normal").toLowerCase(),
    sizeAttenuation: renderInput.sizeAttenuation !== false
  };
  if (!["points", "billboard"].includes(render.type)) {
    throw new ParticleDescriptorError(`Unsupported particle render type: ${render.type}`, "E_PARTICLE_RENDER_UNAVAILABLE", { renderType: render.type });
  }
  return {
    ...record,
    objType: "particleEmitter",
    source,
    emission,
    particle,
    simulation,
    render
  };
}

export function assertParticleCountWithinBudget(descriptor, options = {}) {
  const count = descriptor?.emission?.count;
  if (!Number.isInteger(count) || count <= 0) {
    throw new ParticleDescriptorError("particle emission.count must be a positive integer");
  }
  const maxCount = Number(options.maxCount ?? options.particleBudget?.maxCount);
  if (Number.isFinite(maxCount) && maxCount > 0 && count > maxCount) {
    throw new ParticleDescriptorError(
      `Particle count ${count} exceeds the host performance budget ${Math.floor(maxCount)}`,
      "E_PARTICLE_HOST_BUDGET_EXCEEDED",
      { count, maxCount: Math.floor(maxCount) }
    );
  }
  return count;
}

export function sampleRange(rangeValue, random = Math.random) {
  const min = Number(rangeValue?.min);
  const max = Number(rangeValue?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  return min + (max - min) * random();
}
