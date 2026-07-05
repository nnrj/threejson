/** postMessage protocol between editor and player preview window. */

export const SCENE_PREVIEW_CHANNEL = "threejson:scene-preview";
export const SCENE_PREVIEW_VERSION = 1;

/**
 * @param {MessageEvent} event
 * @returns {boolean}
 */
export function isScenePreviewMessageEvent(event) {
  if (!event || typeof event.data !== "object" || event.data === null) {
    return false;
  }
  if (event.origin && event.origin !== window.location.origin) {
    return false;
  }
  const data = event.data;
  return data.channel === SCENE_PREVIEW_CHANNEL && data.version === SCENE_PREVIEW_VERSION;
}

/**
 * @param {object} data
 * @returns {boolean}
 */
export function isScenePreviewMessage(data) {
  return Boolean(
    data &&
      typeof data === "object" &&
      data.channel === SCENE_PREVIEW_CHANNEL &&
      data.version === SCENE_PREVIEW_VERSION
  );
}

/**
 * @param {Window|null|undefined} target
 * @param {object} message
 * @param {string} [targetOrigin]
 */
export function postScenePreviewMessage(target, message, targetOrigin = window.location.origin) {
  if (!target || target.closed) {
    return false;
  }
  target.postMessage(
    {
      channel: SCENE_PREVIEW_CHANNEL,
      version: SCENE_PREVIEW_VERSION,
      ...message
    },
    targetOrigin
  );
  return true;
}

export function isEditorPreviewUrl(locationLike = window.location) {
  const params = new URLSearchParams(locationLike.search || "");
  return params.get("editorPreview") === "1";
}
