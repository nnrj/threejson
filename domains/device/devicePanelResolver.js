/**
 * Device panel JSON resolution: method 1 (devicePanelRef) > 3 (info) > 2 (infoPanel).
 */
import { createInfoPanelDescriptor, normalizeInfoPanelDescriptor } from "../../core/builder/infoPanelBuilder.js";
import { getObjectByThreeJsonId } from "../../core/handler/objectRegistry.js";
import { cloneJson } from "../../core/util/cloneJson.js";
import { log } from "../../core/util/logger.js";
import { ensureThreeJsonIdOnRecord } from "../../core/util/util.js";

export const DEVICE_PANEL_NAME = "devicePanel";

const DEVICE_PANEL_SHOW_TRIGGERS = new Set(["none", "click", "dblclick", "hover"]);
const DEVICE_PANEL_HIDE_TRIGGERS = new Set([
	"none",
	"click",
	"dblclick",
	"mouseleave",
	"panel.click",
	"panel.dblclick"
]);

/**
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
function hasInfoShorthand(record) {
	if (!record || typeof record !== "object") {
		return false;
	}
	const info = record.info;
	if (typeof info === "string" && info.trim()) {
		return true;
	}
	if (info && typeof info === "object" && !Array.isArray(info)) {
		return Boolean(info.text || info.html || info.imgUrl);
	}
	return false;
}

function hasOwn(record, key) {
	return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

function normalizeTrigger(value, fallback, allowed) {
	const key = String(value == null || value === "" ? fallback : value).trim().toLowerCase();
	return allowed.has(key) ? key : fallback;
}

function readPanelDescriptor(deviceRecord) {
	const panel = deviceRecord?.infoPanel;
	return panel && typeof panel === "object" && !Array.isArray(panel) ? panel : null;
}

function readDevicePosition(deviceRecord) {
	const pos = deviceRecord?.position;
	if (!pos || typeof pos !== "object") {
		return { x: 0, y: 0, z: 0 };
	}
	return {
		x: Number(pos.x) || 0,
		y: Number(pos.y) || 0,
		z: Number(pos.z) || 0
	};
}

function readDeviceGeometryHeight(deviceRecord) {
	return Number(deviceRecord?.geometry?.height ?? deviceRecord?.geometry?.depth) || 10;
}

function readPanelVerticalOffset(infoPanel, deviceRecord) {
	const topDistance = Number(infoPanel?.topDistance);
	if (Number.isFinite(topDistance)) {
		return topDistance;
	}
	return 4;
}

/**
 * subScene devicePanel uses coordinates local to the device group.
 * Authors may copy world coords from infoPanelList; convert when detectable.
 * @param {object|null|undefined} panelPosition
 * @param {object} deviceRecord
 * @param {object} [infoPanel]
 * @returns {{ x: number, y: number, z: number }}
 */
function resolveDeviceSubScenePanelPosition(panelPosition, deviceRecord, infoPanel = {}) {
	const devicePos = readDevicePosition(deviceRecord);
	const height = readDeviceGeometryHeight(deviceRecord);
	const defaultLocal = {
		x: 0,
		y: height / 2 + readPanelVerticalOffset(infoPanel, deviceRecord),
		z: 0
	};
	if (!panelPosition || typeof panelPosition !== "object") {
		return defaultLocal;
	}
	const px = Number(panelPosition.x) || 0;
	const py = Number(panelPosition.y) || 0;
	const pz = Number(panelPosition.z) || 0;
	const localX = px - devicePos.x;
	const localY = py - devicePos.y;
	const localZ = pz - devicePos.z;

	const sameWorldXZ =
		Math.abs(px - devicePos.x) < 1e-6 &&
		Math.abs(pz - devicePos.z) < 1e-6 &&
		localY > 0;
	if (sameWorldXZ) {
		return { x: 0, y: localY, z: 0 };
	}

	const width = Number(deviceRecord?.geometry?.width) || 0;
	const depth = Number(deviceRecord?.geometry?.depth ?? deviceRecord?.geometry?.length) || 0;
	const maxFootprint = Math.max(width, depth, 1) * 3;
	if (
		Math.abs(localX) <= maxFootprint &&
		Math.abs(localZ) <= maxFootprint &&
		localY > 0 &&
		localY <= height * 4
	) {
		return { x: localX, y: localY, z: localZ };
	}

	return { x: px, y: py, z: pz };
}

/**
 * @param {object|null|undefined} deviceRecord
 * @returns {string|null}
 */
export function resolveDevicePanelRef(deviceRecord) {
	if (!deviceRecord || typeof deviceRecord !== "object") {
		return null;
	}
	if (typeof deviceRecord.devicePanelRef === "string" && deviceRecord.devicePanelRef.trim()) {
		return deviceRecord.devicePanelRef.trim();
	}
	return resolveDevicePanelBinding(deviceRecord)?.devicePanelRef || null;
}

/**
 * @param {object|null|undefined} deviceRecord
 * @returns {object|null}
 */
export function resolveDevicePanelBinding(deviceRecord) {
	if (!deviceRecord || typeof deviceRecord !== "object") {
		return null;
	}
	const deviceThreeJsonId = typeof deviceRecord.threeJsonId === "string" && deviceRecord.threeJsonId.trim()
		? deviceRecord.threeJsonId.trim()
		: null;

	const ref = deviceRecord.devicePanelRef;
	if (typeof ref === "string" && ref.trim()) {
		const refId = ref.trim();
		if (!getObjectByThreeJsonId(refId)) {
			log.warn(`[device] devicePanelRef not found: ${refId}`);
		}
		return {
			devicePanelRef: refId,
			mode: "externalRef"
		};
	}

	if (hasInfoShorthand(deviceRecord)) {
		const panelId = deviceThreeJsonId ? `${deviceThreeJsonId}__infoPanel` : null;
		const panelDescriptor = buildDefaultInfoPanelFromInfo(deviceRecord, panelId);
		return {
			devicePanelRef: panelDescriptor.threeJsonId,
			mode: "infoShorthand",
			panelDescriptor
		};
	}

	if (deviceRecord.infoPanel && typeof deviceRecord.infoPanel === "object") {
		const panelId = typeof deviceRecord.infoPanel.threeJsonId === "string" && deviceRecord.infoPanel.threeJsonId.trim()
			? deviceRecord.infoPanel.threeJsonId.trim()
			: (deviceThreeJsonId ? `${deviceThreeJsonId}__infoPanel` : null);
		const panelDescriptor = prepareDevicePanelDescriptor(deviceRecord.infoPanel, deviceRecord, panelId);
		return {
			devicePanelRef: panelDescriptor.threeJsonId,
			mode: "inline",
			panelDescriptor
		};
	}

	return null;
}

/**
 * @param {object} infoPanel
 * @param {object} deviceRecord
 * @param {string|null} threeJsonId
 * @returns {object}
 */
function prepareDevicePanelDescriptor(infoPanel, deviceRecord, threeJsonId) {
	const panel = cloneJson(infoPanel);
	panel.objType = "infoPanel";
	panel.name = DEVICE_PANEL_NAME;
	if (threeJsonId) {
		panel.threeJsonId = threeJsonId;
	}
	ensureThreeJsonIdOnRecord(panel);
	panel.panel = panel.panel || {};
	panel.panel.position = resolveDeviceSubScenePanelPosition(
		panel.panel.position,
		deviceRecord,
		panel
	);
	return normalizeInfoPanelDescriptor(panel);
}

/**
 * @param {object} deviceRecord
 * @param {string|null} threeJsonId
 * @returns {object}
 */
export function buildDefaultInfoPanelFromInfo(deviceRecord, threeJsonId) {
	const info = deviceRecord.info;
	let text = "";
	let type = "html";
	if (typeof info === "string") {
		text = info;
	} else if (info && typeof info === "object") {
		if (info.html) {
			text = info.html;
			type = "html";
		} else if (info.text) {
			text = info.text;
			type = "text";
		} else if (info.imgUrl) {
			text = info.imgUrl;
			type = "img";
		}
	}
	const height = readDeviceGeometryHeight(deviceRecord);
	const panel = createInfoPanelDescriptor(text, {
		x: 0,
		y: height / 2 + readPanelVerticalOffset({}, deviceRecord),
		z: 0
	}, {
		type,
		panelBoxType: "sprite"
	});
	panel.visible = true;
	panel.objType = "infoPanel";
	panel.name = DEVICE_PANEL_NAME;
	if (threeJsonId) {
		panel.threeJsonId = threeJsonId;
	}
	ensureThreeJsonIdOnRecord(panel);
	return normalizeInfoPanelDescriptor(panel);
}

/**
 * Write method 2/3 panels to groupObj.infoPanelList and binding metadata on deviceRecord.
 * @param {object} groupObj
 * @param {object} deviceRecord
 * @returns {object|null}
 */
export function appendDevicePanelSubScene(groupObj, deviceRecord) {
	const binding = resolveDevicePanelBinding(deviceRecord);
	if (!binding) {
		return null;
	}
	deviceRecord.devicePanelRef = binding.devicePanelRef;
	if (binding.mode === "externalRef" || !binding.panelDescriptor) {
		return binding;
	}
	const list = Array.isArray(groupObj.infoPanelList) ? groupObj.infoPanelList.slice() : [];
	const idx = list.findIndex((p) => p?.threeJsonId && p.threeJsonId === binding.devicePanelRef);
	if (idx >= 0) {
		list[idx] = binding.panelDescriptor;
	} else {
		list.push(binding.panelDescriptor);
	}
	groupObj.infoPanelList = list;
	return binding;
}

/**
 * @param {object|null|undefined} deviceRecord
 * @returns {{ show: string, hide: string, hideDelayMs: number }}
 */
export function resolveDevicePanelTriggerConfig(deviceRecord) {
	const behavior = resolveDevicePanelBehaviorConfig(deviceRecord);
	return {
		show: behavior.show,
		hide: behavior.hide,
		hideDelayMs: behavior.hideDelayMs
	};
}

/**
 * @param {object|null|undefined} deviceRecord
 * @returns {{
 *   initialVisible: boolean|undefined,
 *   show: string,
 *   hide: string,
 *   hideDelayMs: number,
 *   panelDismissTrigger: string|null,
 *   hasExplicitPanelShowTrigger: boolean,
 *   hasExplicitPanelHideTrigger: boolean,
 *   hasExplicitPanelDismissTrigger: boolean,
 *   hideFromPanel: boolean
 * }}
 */
export function resolveDevicePanelBehaviorConfig(deviceRecord) {
	const panel = readPanelDescriptor(deviceRecord);
	const hasExplicitPanelShowTrigger = hasOwn(deviceRecord, "panelShowTrigger");
	const hasExplicitPanelHideTrigger = hasOwn(deviceRecord, "panelHideTrigger");
	const show = normalizeTrigger(deviceRecord?.panelShowTrigger, "hover", DEVICE_PANEL_SHOW_TRIGGERS);
	const hide = normalizeTrigger(deviceRecord?.panelHideTrigger, "mouseleave", DEVICE_PANEL_HIDE_TRIGGERS);
	const rawDelay = Number(deviceRecord?.panelHideDelayMs ?? deviceRecord?.devicePanelHideDelayMs);
	const hideDelayMs = Number.isFinite(rawDelay) ? Math.max(0, rawDelay) : 200;
	const initialVisible = panel && typeof panel.visible === "boolean" ? panel.visible : undefined;
	const hasExplicitPanelDismissTrigger = hasOwn(panel, "dismissTrigger");
	const panelDismissTrigger = hasExplicitPanelDismissTrigger
		? String(panel.dismissTrigger == null ? "" : panel.dismissTrigger).trim().toLowerCase()
		: null;
	return {
		initialVisible,
		show,
		hide,
		hideDelayMs,
		panelDismissTrigger,
		hasExplicitPanelShowTrigger,
		hasExplicitPanelHideTrigger,
		hasExplicitPanelDismissTrigger,
		hideFromPanel: hide === "panel.click" || hide === "panel.dblclick"
	};
}

/**
 * @param {object|null|undefined} deviceRecord
 * @returns {string|null}
 */
export function resolveDevicePanelKeyboardTrigger(deviceRecord) {
	if (!deviceRecord || typeof deviceRecord !== "object") {
		return null;
	}
	const raw = deviceRecord.devicePanelKeyboardTrigger;
	if (raw == null || raw === "") {
		return null;
	}
	const key = String(raw).trim();
	return key || null;
}

/**
 * @param {object|null|undefined} deviceRecord
 * @returns {boolean}
 */
export function hasDevicePanelBinding(deviceRecord) {
	return Boolean(resolveDevicePanelBinding(deviceRecord));
}
