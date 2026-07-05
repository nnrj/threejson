/**
 * Resolve whether createJsonScene should bind event runtime (§ P2 interaction.bindSceneEvents).
 */

const ENGINE_DEFAULT_BIND_SCENE_EVENTS = true;

function readJsonBindSceneEvents(payload, sceneConfig) {
  const interaction =
    sceneConfig?.interaction ??
    payload?.sceneConfig?.interaction ??
    payload?.worldInfo?.interaction ??
    null;
  if (!interaction || typeof interaction !== "object") {
    return undefined;
  }
  if (typeof interaction.bindSceneEvents === "boolean") {
    return interaction.bindSceneEvents;
  }
  return undefined;
}

/**
 * @param {object} [payload]
 * @param {object} [sceneConfig]
 * @param {object} [callerOptions]
 * @returns {boolean}
 */
export function resolveBindSceneEvents(payload = {}, sceneConfig = null, callerOptions = {}) {
  let value = ENGINE_DEFAULT_BIND_SCENE_EVENTS;
  const fromJson = readJsonBindSceneEvents(payload, sceneConfig);
  if (typeof fromJson === "boolean") {
    value = fromJson;
  }
  if (typeof callerOptions.bindSceneEvents === "boolean") {
    value = callerOptions.bindSceneEvents;
  }
  return value;
}

export { ENGINE_DEFAULT_BIND_SCENE_EVENTS };
