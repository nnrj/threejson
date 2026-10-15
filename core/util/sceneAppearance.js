/** Non-resource scene appearance. Shared by loading, mutation and capture. */
export function applySceneAppearance(scene, hints = {}) {
  for (const key of ["environmentIntensity", "backgroundIntensity", "backgroundBlurriness"]) {
    if (hints[key] === undefined) continue;
    const value = Number(hints[key]);
    if (!Number.isFinite(value) || value < 0 || key === "backgroundBlurriness" && value > 1) throw new TypeError(`Invalid scene.${key}`);
    scene[key] = value;
  }
  for (const key of ["environmentRotation", "backgroundRotation"]) {
    if (hints[key] !== undefined) applyEulerDescriptor(scene[key], hints[key], `scene.${key}`);
  }
}

export function applyEulerDescriptor(euler, value, label = "rotation") {
  const axes = Array.isArray(value) ? value.slice(0, 3) : [value?.x ?? 0, value?.y ?? 0, value?.z ?? 0];
  const order = (Array.isArray(value) ? value[3] : value?.order) || "XYZ";
  if (axes.length !== 3 || !axes.every(Number.isFinite) || !["XYZ", "YXZ", "ZXY", "ZYX", "YZX", "XZY"].includes(order)) throw new TypeError(`Invalid ${label}`);
  euler?.set(...axes, order);
}

export function captureSceneAppearance(scene) {
  const hints = {};
  for (const key of ["environmentIntensity", "backgroundIntensity", "backgroundBlurriness"]) if (Number.isFinite(scene?.[key])) hints[key] = scene[key];
  for (const key of ["environmentRotation", "backgroundRotation"]) if (scene?.[key]?.isEuler) {
    const { x, y, z, order } = scene[key]; hints[key] = { x, y, z, order };
  }
  return hints;
}
