/**
 * nature.water quality tiers: JSON `quality` (entry or uniforms.quality) → shading and geometry params.
 *
 * Higher tiers increase vertex/fragment work and (ultra) extra scene reflection rendering; higher GPU cost.
 */

/** @typedef {"low"|"medium"|"high"|"ultra"} WaterQualityLabel */

/** @type {Record<WaterQualityLabel, number>} */
export const WATER_QUALITY_TIER = {
  low: 0,
  medium: 1,
  high: 2,
  ultra: 3
};

/** @type {WaterQualityLabel} */
export const DEFAULT_WATER_QUALITY = "medium";

const LABEL_ALIASES = {
  low: "low",
  lite: "low",
  simple: "low",
  fast: "low",
  0: "low",
  medium: "medium",
  med: "medium",
  normal: "medium",
  default: "medium",
  1: "medium",
  high: "high",
  hq: "high",
  realistic: "high",
  2: "high",
  ultra: "ultra",
  max: "ultra",
  mirror: "ultra",
  3: "ultra"
};

/** @type {Record<WaterQualityLabel, object>} */
export const WATER_QUALITY_PROFILES = {
  low: {
    tier: 0,
    label: "low",
    geometrySegments: 32,
    waveLayers: 2,
    normalOctaves: 0,
    useMirror: false,
    mirrorResolution: 256,
    distortionScale: 0,
    fresnelStrength: 0.25,
    specularPower: 48,
    summary: "双正弦顶点位移 + 简单泡沫，最省算力。"
  },
  medium: {
    tier: 1,
    label: "medium",
    geometrySegments: 96,
    waveLayers: 3,
    normalOctaves: 2,
    useMirror: false,
    mirrorResolution: 512,
    distortionScale: 2.4,
    fresnelStrength: 0.55,
    specularPower: 96,
    summary: "Gerstner 波 + Fresnel + 程序化法线 + 天空渐变假反射。"
  },
  high: {
    tier: 2,
    label: "high",
    geometrySegments: 160,
    waveLayers: 4,
    normalOctaves: 4,
    useMirror: false,
    mirrorResolution: 512,
    distortionScale: 3.2,
    fresnelStrength: 0.72,
    specularPower: 128,
    summary: "更多波浪层与法线细节，接近 Three.js Water 观感（无 RT）。"
  },
  ultra: {
    tier: 3,
    label: "ultra",
    geometrySegments: 192,
    waveLayers: 4,
    normalOctaves: 4,
    useMirror: true,
    mirrorResolution: 512,
    distortionScale: 3.7,
    fresnelStrength: 0.85,
    specularPower: 160,
    summary: "high 基础上增加平面反射 RT（每帧额外渲染场景），最耗算力。"
  }
};

/**
 * @param {unknown} raw
 * @returns {WaterQualityLabel}
 */
export function normalizeWaterQualityLabel(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const idx = Math.max(0, Math.min(3, Math.floor(raw)));
    return /** @type {WaterQualityLabel[]} */ (["low", "medium", "high", "ultra"])[idx];
  }
  if (typeof raw !== "string") {
    return DEFAULT_WATER_QUALITY;
  }
  const key = raw.trim().toLowerCase();
  return LABEL_ALIASES[key] ?? DEFAULT_WATER_QUALITY;
}

/**
 * @param {object} [source]
 * @returns {{ label: WaterQualityLabel, profile: object, tier: number }}
 */
export function parseWaterQuality(source = {}) {
  const fromRecord = source.quality ?? source.realism ?? source.waterQuality;
  const fromUniforms =
    source.uniforms && typeof source.uniforms === "object" && !Array.isArray(source.uniforms)
      ? source.uniforms.quality ?? source.uniforms.realism
      : undefined;
  const label = normalizeWaterQualityLabel(fromRecord ?? fromUniforms);
  const profile = { ...WATER_QUALITY_PROFILES[label] };
  const mirrorResolution = Number(
    source.uniforms?.mirrorResolution ?? source.mirrorResolution ?? profile.mirrorResolution
  );
  if (Number.isFinite(mirrorResolution) && mirrorResolution > 0) {
    profile.mirrorResolution = Math.min(2048, Math.max(128, Math.floor(mirrorResolution)));
  }
  const geometrySegments = Number(source.geometry?.widthSegments ?? source.geometry?.segments);
  if (Number.isFinite(geometrySegments) && geometrySegments > 0) {
    profile.geometrySegments = Math.min(512, Math.max(8, Math.floor(geometrySegments)));
  }
  return { label, profile, tier: profile.tier };
}

/**
 * @param {object} record
 * @returns {object}
 */
export function applyWaterQualityToRecord(record) {
  const { label, profile } = parseWaterQuality(record);
  const geometry = record.geometry && typeof record.geometry === "object" ? { ...record.geometry } : {};
  if (!Number.isFinite(Number(geometry.widthSegments)) && !Number.isFinite(Number(geometry.segments))) {
    geometry.widthSegments = profile.geometrySegments;
    geometry.heightSegments = profile.geometrySegments;
  } else if (Number.isFinite(Number(geometry.segments))) {
    const seg = Math.floor(Number(geometry.segments));
    geometry.widthSegments = geometry.widthSegments ?? seg;
    geometry.heightSegments = geometry.heightSegments ?? seg;
    delete geometry.segments;
  }
  const uniforms =
    record.uniforms && typeof record.uniforms === "object" && !Array.isArray(record.uniforms)
      ? { ...record.uniforms }
      : {};
  uniforms.quality = label;
  uniforms.distortionScale =
    uniforms.distortionScale ?? profile.distortionScale;
  return {
    ...record,
    quality: label,
    geometry,
    uniforms
  };
}
