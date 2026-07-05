import {
  TEXTURE_EXPLICIT_PROP_KEYS,
  extractExplicitTextureProps,
  getDeployTextureContext,
  isRecordTextureSamplingOptOut,
  parseTextureQuality,
  resolveEffectiveTextureSummary,
  serializeTextureFilter
} from "../../../../core/util/textureSampling.js";

export const TEXTURE_QUALITY_INHERIT = "";

export const TEXTURE_QUALITY_OPTIONS = [
  { value: TEXTURE_QUALITY_INHERIT, label: "默认(继承场景)" },
  { value: "0", label: "关(0)" },
  { value: "1", label: "低(1)" },
  { value: "2", label: "中(2)" },
  { value: "3", label: "高(3)" }
];

export function buildTextureQualitySelectOptions(selectedValue) {
  const sel = selectedValue === null || selectedValue === undefined || selectedValue === ""
    ? TEXTURE_QUALITY_INHERIT
    : String(selectedValue);
  return TEXTURE_QUALITY_OPTIONS.map((opt) => {
    const picked = opt.value === sel ? " selected" : "";
    return `<option value="${opt.value.replace(/"/g, "&quot;")}"${picked}>${opt.label}</option>`;
  }).join("");
}

export function readTextureQualityFromMaterial(mat) {
  if (!mat || typeof mat !== "object" || !Object.prototype.hasOwnProperty.call(mat, "textureQuality")) {
    return TEXTURE_QUALITY_INHERIT;
  }
  const tier = parseTextureQuality(mat.textureQuality);
  return tier === null ? TEXTURE_QUALITY_INHERIT : String(tier);
}

export function writeTextureQualityToMaterial(mat, selectValue) {
  if (!mat || typeof mat !== "object") {
    return;
  }
  const raw = String(selectValue ?? "").trim();
  if (!raw.length || raw === TEXTURE_QUALITY_INHERIT) {
    delete mat.textureQuality;
    return;
  }
  const tier = parseTextureQuality(raw);
  if (tier === null) {
    delete mat.textureQuality;
    return;
  }
  mat.textureQuality = tier;
  if (tier === 0) {
    delete mat.textureSampling;
  }
}

export function materialHasExplicitSamplingOverrides(mat) {
  if (!mat || typeof mat !== "object") {
    return false;
  }
  if (Object.keys(extractExplicitTextureProps(mat)).length > 0) {
    return true;
  }
  return isRecordTextureSamplingOptOut(mat) && parseTextureQuality(mat.textureQuality) !== 0;
}

export function readExplicitSamplingFromMaterial(mat) {
  const out = {};
  if (!mat || typeof mat !== "object") {
    return out;
  }
  for (const key of TEXTURE_EXPLICIT_PROP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(mat, key)) {
      out[key] = mat[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(mat, "textureAnisotropy")) {
    out.anisotropy = mat.textureAnisotropy;
  }
  out._optOut = isRecordTextureSamplingOptOut(mat);
  return out;
}

export function clearExplicitSamplingFromMaterial(mat) {
  if (!mat || typeof mat !== "object") {
    return;
  }
  for (const key of TEXTURE_EXPLICIT_PROP_KEYS) {
    delete mat[key];
  }
  delete mat.textureAnisotropy;
  delete mat.textureSampling;
}

export function applyExplicitSamplingToMaterial(mat, form, profileName = "imageMap") {
  if (!mat || typeof mat !== "object") {
    return;
  }
  clearExplicitSamplingFromMaterial(mat);
  if (form.optOut === true) {
    mat.textureQuality = 0;
    return;
  }
  if (form.generateMipmaps === true || form.generateMipmaps === false) {
    mat.generateMipmaps = form.generateMipmaps === true;
  }
  if (form.minFilter) {
    mat.minFilter = form.minFilter;
  }
  if (form.magFilter) {
    mat.magFilter = form.magFilter;
  }
  if (form.anisotropy !== "" && form.anisotropy !== undefined && form.anisotropy !== null) {
    const n = Number(form.anisotropy);
    if (Number.isFinite(n)) {
      mat.anisotropy = n;
    }
  }
  if (form.colorSpace) {
    mat.colorSpace = form.colorSpace;
  }
  void profileName;
}

export function formatEffectiveSummaryForMaterial(mat, profileName = "imageMap") {
  const ctx = getDeployTextureContext();
  return resolveEffectiveTextureSummary(profileName, mat, ctx);
}

export function serializeFilterForForm(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return serializeTextureFilter(value) || "";
  }
  return "";
}
