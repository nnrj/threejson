/**
 * Resolve whether createJsonScene should enable per-object lifecycle (interaction.enableObjectLifecycle).
 * JSON declarative opt-in; caller options override JSON. Default false (unlike bindSceneEvents).
 */

const ENGINE_DEFAULT_ENABLE_OBJECT_LIFECYCLE = false;

/**
 * @param {object|null|undefined} payload
 * @param {object|null|undefined} sceneConfig
 * @returns {boolean|undefined}
 */
function readJsonEnableObjectLifecycle(payload, sceneConfig) {
  const interaction =
    sceneConfig?.interaction ??
    payload?.sceneConfig?.interaction ??
    payload?.worldInfo?.interaction ??
    null;
  if (!interaction || typeof interaction !== "object") {
    return undefined;
  }
  if (typeof interaction.enableObjectLifecycle === "boolean") {
    return interaction.enableObjectLifecycle;
  }
  return undefined;
}

/**
 * @param {object} [payload]
 * @param {object|null} [sceneConfig]
 * @param {object} [callerOptions]
 * @returns {boolean}
 */
export function resolveEnableObjectLifecycle(payload = {}, sceneConfig = null, callerOptions = {}) {
  let value = ENGINE_DEFAULT_ENABLE_OBJECT_LIFECYCLE;
  const fromJson = readJsonEnableObjectLifecycle(payload, sceneConfig);
  if (typeof fromJson === "boolean") {
    value = fromJson;
  }
  if (typeof callerOptions.enableObjectLifecycle === "boolean") {
    value = callerOptions.enableObjectLifecycle;
  }
  return value;
}

export { ENGINE_DEFAULT_ENABLE_OBJECT_LIFECYCLE };
