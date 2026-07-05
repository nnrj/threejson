/**
 * Info panel opacity helpers: `htmlOpacity` (html only), `opacityByPanel` (text/html/img).
 */
import { applyOpacityToColor } from "../util/textureUtils.js";

/** Whether to inject opacity into HTML inline background (type: html only, default true). */
export function resolveHtmlOpacity(infoPanel) {
	return infoPanel.htmlOpacity !== false;
}

/** Whether to fade entire panel content with opacity (text/html/img, default false). */
export function resolveOpacityByPanel(infoPanel) {
	return infoPanel.opacityByPanel === true;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isSimpleBackgroundColor(value) {
	const normalized = String(value || "").trim();
	if (!normalized || normalized === "transparent" || normalized === "none") {
		return false;
	}
	if (/url\(|gradient\(/i.test(normalized)) {
		return false;
	}
	return true;
}

/**
 * Inject panel opacity into HTML element inline background color; does not modify text `color`.
 * @param {HTMLElement} root
 * @param {number} opacity
 */
export function injectOpacityIntoHtmlBackgrounds(root, opacity) {
	if (!root || opacity >= 1) {
		return;
	}
	const nodes = [root, ...root.querySelectorAll("*")];
	for (let i = 0; i < nodes.length; i++) {
		const el = nodes[i];
		if (!el?.style) {
			continue;
		}
		const backgroundColor = el.style.backgroundColor;
		if (isSimpleBackgroundColor(backgroundColor)) {
			el.style.backgroundColor = applyOpacityToColor(backgroundColor, opacity);
			continue;
		}
		const background = el.style.background;
		if (isSimpleBackgroundColor(background) && !/\s/.test(background.trim())) {
			el.style.background = applyOpacityToColor(background, opacity);
		}
	}
}
