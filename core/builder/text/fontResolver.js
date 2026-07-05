/**
 * text mode=sdf font URL and unicode fallback resolution.
 * Priority: per-object sdf → sceneConfig.textFont → troika built-in default.
 */
function trimOrNull(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/**
 * @param {object} [sceneConfig]
 * @returns {{
 *   fontUrl: string|null,
 *   unicodeFontsUrl: string|null,
 *   fontStyle: string,
 *   fontWeight: string|number,
 *   preloadCharacters: string
 * }}
 */
export function resolveSceneTextFont(sceneConfig) {
  const textFont =
    sceneConfig?.textFont && typeof sceneConfig.textFont === "object"
      ? sceneConfig.textFont
      : {};
  return {
    fontUrl: trimOrNull(textFont.fontUrl),
    unicodeFontsUrl: trimOrNull(textFont.unicodeFontsUrl),
    fontStyle: trimOrNull(textFont.fontStyle) ?? "normal",
    fontWeight: hasFontWeight(textFont.fontWeight) ? textFont.fontWeight : "normal",
    preloadCharacters: typeof textFont.preloadCharacters === "string" ? textFont.preloadCharacters : ""
  };
}

function hasFontWeight(value) {
  if (value === "normal" || value === "bold") {
    return true;
  }
  const n = Number(value);
  return Number.isFinite(n);
}

/**
 * @param {object} record
 * @param {object} [sceneConfig]
 * @returns {{
 *   fontUrl: string|null,
 *   unicodeFontsUrl: string|null,
 *   fontStyle: string,
 *   fontWeight: string|number
 * }}
 */
export function resolveTextFontConfig(record, sceneConfig) {
  const scene = resolveSceneTextFont(sceneConfig);
  const sdf = record?.sdf && typeof record.sdf === "object" ? record.sdf : {};
  return {
    fontUrl: trimOrNull(sdf.fontUrl) ?? scene.fontUrl,
    unicodeFontsUrl: trimOrNull(sdf.unicodeFontsUrl) ?? scene.unicodeFontsUrl,
    fontStyle: trimOrNull(sdf.fontStyle) ?? scene.fontStyle,
    fontWeight: hasFontWeight(sdf.fontWeight) ? sdf.fontWeight : scene.fontWeight
  };
}
