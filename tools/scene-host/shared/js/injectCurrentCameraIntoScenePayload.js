function cloneJsonDeep(value) {
  if (value == null) {
    return value;
  }
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

export function injectCurrentCameraIntoScenePayload(sceneObj, camera, controls) {
  const next = cloneJsonDeep(sceneObj);
  if (!camera || !controls) {
    return next;
  }
  next.sceneConfig = next.sceneConfig && typeof next.sceneConfig === "object" ? next.sceneConfig : {};
  const p = camera.position;
  next.sceneConfig.camera = {
    ...(typeof next.sceneConfig.camera === "object" && next.sceneConfig.camera ? next.sceneConfig.camera : {}),
    position: { x: p.x, y: p.y, z: p.z },
    fov: Number.isFinite(camera.fov) ? camera.fov : 60,
    near: Number.isFinite(camera.near) ? camera.near : 0.1,
    far: Number.isFinite(camera.far) ? camera.far : 2500
  };
  const t = controls.target;
  next.sceneConfig.controls = {
    ...(typeof next.sceneConfig.controls === "object" && next.sceneConfig.controls ? next.sceneConfig.controls : {}),
    target: { x: t.x, y: t.y, z: t.z }
  };
  return next;
}
