function hasOwn(source, key) {
  return Boolean(source) && Object.prototype.hasOwnProperty.call(source, key);
}

function normalizeFpsValue(value, fallback = 60) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function jsonSpecifiesFpsField(jsonRenderLoop = {}) {
  if (!jsonRenderLoop || typeof jsonRenderLoop !== "object") {
    return false;
  }
  return hasOwn(jsonRenderLoop, "fps") || hasOwn(jsonRenderLoop, "lowFps");
}

function resolveRenderLoopFpsPolicy(jsonRenderLoop = {}, userPolicy = {}) {
  const userFps = normalizeFpsValue(userPolicy.fps, 60);
  const userLowFps = userPolicy?.lowFps === true;
  const override = userPolicy?.overrideSceneRenderLoop === true;

  if (!jsonSpecifiesFpsField(jsonRenderLoop) || override) {
    return {
      fps: userFps,
      lowFps: userLowFps
    };
  }

  const sceneLowFps = hasOwn(jsonRenderLoop, "lowFps")
    ? jsonRenderLoop.lowFps === true
    : userLowFps;
  const sceneFps = hasOwn(jsonRenderLoop, "fps")
    ? normalizeFpsValue(jsonRenderLoop.fps, userFps)
    : userFps;

  return {
    fps: sceneFps,
    lowFps: sceneLowFps
  };
}

export {
  jsonSpecifiesFpsField,
  normalizeFpsValue,
  resolveRenderLoopFpsPolicy
};
