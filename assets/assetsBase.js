/**
 * 静态资源 URL 基址（本地 demo 默认 `/assets`；发布后可改为 jsDelivr 等 CDN）。
 */
export const DEFAULT_ASSETS_BASE = "/assets";

/**
 * @param {string} relativePath 如 `textures/device/cabinet/cabinet_left_door.png`
 * @returns {string}
 */
export function assetUrl(relativePath) {
  const segment = String(relativePath || "").replace(/^\/+/, "");
  return `${DEFAULT_ASSETS_BASE}/${segment}`;
}
