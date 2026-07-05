const REDEPLOY_KEYS = new Set([
  "objType",
  "boxType",
  "geometry",
  "materials",
  "subScene",
  "joins",
  "inters",
  "holes"
]);

const TRANSFORM_PATHS = new Set([
  "position",
  "rotation",
  "scale",
  "position.x",
  "position.y",
  "position.z",
  "rotation.rotationX",
  "rotation.rotationY",
  "rotation.rotationZ",
  "scale.scaleX",
  "scale.scaleY",
  "scale.scaleZ"
]);

function normalizePath(path) {
  const raw = String(path ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) {
    return raw.slice(1).replaceAll("/", ".");
  }
  return raw;
}

function getTopLevelKey(path) {
  const normalized = normalizePath(path);
  if (!normalized) return "";
  return normalized.split(".")[0] || "";
}

function isRedeployTopLevelKey(key) {
  return REDEPLOY_KEYS.has(String(key ?? "").trim());
}

function classifyPath(path) {
  const normalized = normalizePath(path);
  if (!normalized) {
    return "unknown";
  }
  if (TRANSFORM_PATHS.has(normalized)) {
    return "transform";
  }
  if (normalized === "name") {
    return "name";
  }
  if (normalized === "visible") {
    return "visible";
  }
  if (normalized === "material" || normalized.startsWith("material.")) {
    if (normalized === "material.textureUrl") return "materialTexture";
    if (normalized === "material.color") return "materialColor";
    return "material";
  }
  if (normalized === "materials" || normalized.startsWith("materials.")) {
    return "material";
  }
  if (isRedeployTopLevelKey(getTopLevelKey(normalized))) {
    return "structural";
  }
  return "generic";
}

export {
  REDEPLOY_KEYS,
  normalizePath,
  getTopLevelKey,
  isRedeployTopLevelKey,
  classifyPath
};
