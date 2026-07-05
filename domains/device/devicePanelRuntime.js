/**
 * Device panel runtime API and pointer trigger bindings.
 */
import { deployInfoPanel } from "../../core/builder/infoPanelBuilder.js";
import {
	setInfoPanelVisibleByThreeJsonId,
	updateInfoPanelContent
} from "../../core/handler/infoPanelRuntime.js";
import { getObjectByThreeJsonId } from "../../core/handler/objectRegistry.js";
import { cloneJson } from "../../core/util/cloneJson.js";
import { ensureThreeJsonIdOnRecord } from "../../core/util/util.js";
import {
	DEVICE_PANEL_NAME,
	hasDevicePanelBinding,
	resolveDevicePanelBinding,
	resolveDevicePanelKeyboardTrigger,
	resolveDevicePanelRef,
	resolveDevicePanelTriggerConfig
} from "./devicePanelResolver.js";

/**
 * @param {string} key
 * @returns {string}
 */
function normalizeKeyboardTriggerKey(key) {
	return String(key || "").trim().toLowerCase();
}

/**
 * @param {import("three").Object3D|null|undefined} deviceRoot
 * @returns {import("three").Object3D|null}
 */
function findDevicePanelUnderRoot(deviceRoot) {
	if (!deviceRoot || typeof deviceRoot.traverse !== "function") {
		return null;
	}
	let found = null;
	deviceRoot.traverse((obj) => {
		if (found) {
			return;
		}
		const j = obj?.userData?.objJson;
		if (j && String(j.objType || "").toLowerCase() === "infopanel" && j.name === DEVICE_PANEL_NAME) {
			found = obj;
		}
	});
	return found;
}

/**
 * @param {import("three").Object3D|null|undefined} node
 * @returns {import("three").Object3D|null}
 */
export function resolveDevicePanelHostRoot(node) {
	let current = node;
	while (current) {
		const objJson = current.userData?.objJson;
		if (objJson?.objType === "domain" && String(objJson.domain || "").startsWith("device.")) {
			return current;
		}
		current = current.parent;
	}
	current = node;
	while (current) {
		if (hasDevicePanelBinding(current.userData?.objJson)) {
			return current;
		}
		current = current.parent;
	}
	return null;
}

/**
 * @param {import("three").Object3D} deviceRoot
 * @param {object} descriptor
 * @returns {object}
 */
function syncInlinePanelPositionFromHost(deviceRoot, descriptor) {
	const hostJson = deviceRoot?.userData?.objJson;
	const infoPanel = hostJson?.infoPanel;
	const topDistance = Number(infoPanel?.topDistance);
	const offset = Number.isFinite(topDistance) ? topDistance : 50;
	const panel = cloneJson(descriptor);
	panel.panel = panel.panel || {};
	const height = Number(
		deviceRoot.geometry?.parameters?.height
		?? hostJson?.geometry?.height
		?? 0
	);
	panel.panel.position = {
		x: deviceRoot.position.x,
		y: deviceRoot.position.y + height / 2 + offset,
		z: deviceRoot.position.z
	};
	return panel;
}

/**
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {import("three").Object3D} deviceRoot
 * @returns {Promise<string|null>}
 */
export async function ensureDevicePanelDeployed(scene, deviceRoot) {
	if (!scene || !deviceRoot) {
		return null;
	}
	const objJson = deviceRoot.userData?.objJson;
	if (!objJson) {
		return null;
	}
	const binding = resolveDevicePanelBinding(objJson);
	if (!binding) {
		return null;
	}
	objJson.devicePanelRef = binding.devicePanelRef;
	if (getObjectByThreeJsonId(binding.devicePanelRef)) {
		return binding.devicePanelRef;
	}
	if (binding.mode === "externalRef" || !binding.panelDescriptor) {
		return binding.devicePanelRef;
	}
	let descriptor = syncInlinePanelPositionFromHost(deviceRoot, binding.panelDescriptor);
	ensureThreeJsonIdOnRecord(descriptor);
	await deployInfoPanel(scene, descriptor);
	return descriptor.threeJsonId || binding.devicePanelRef;
}

/**
 * @param {string|import("three").Object3D} deviceIdOrRoot
 * @returns {string|null}
 */
export function resolveDevicePanelRefFromRoot(deviceIdOrRoot) {
	const deviceRoot = typeof deviceIdOrRoot === "string"
		? getObjectByThreeJsonId(deviceIdOrRoot)
		: deviceIdOrRoot;
	const objJson = deviceRoot?.userData?.objJson;
	const panelId = resolveDevicePanelRef(objJson);
	if (panelId && getObjectByThreeJsonId(panelId)) {
		return panelId;
	}
	const panelObject = findDevicePanelUnderRoot(deviceRoot);
	return panelObject?.userData?.objJson?.threeJsonId || panelId || null;
}

/**
 * @param {string|import("three").Object3D} deviceIdOrRoot
 * @param {boolean} [visible=true]
 * @returns {boolean}
 */
export function showDevicePanel(deviceIdOrRoot, visible = true) {
	const panelId = resolveDevicePanelRefFromRoot(deviceIdOrRoot);
	if (!panelId) {
		return false;
	}
	const ok = setInfoPanelVisibleByThreeJsonId(panelId, visible);
	if (ok) {
		const panel = getObjectByThreeJsonId(panelId);
		if (panel?.userData?.objJson && typeof panel.userData.objJson === "object") {
			panel.userData.objJson.visible = visible;
		}
	}
	return ok;
}

/**
 * @param {string|import("three").Object3D} deviceIdOrRoot
 * @returns {boolean}
 */
export function hideDevicePanel(deviceIdOrRoot) {
	return showDevicePanel(deviceIdOrRoot, false);
}

/**
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {import("three").Object3D} deviceRoot
 * @returns {Promise<boolean>}
 */
export async function toggleDevicePanel(scene, deviceRoot) {
	await ensureDevicePanelDeployed(scene, deviceRoot);
	const panelId = resolveDevicePanelRefFromRoot(deviceRoot);
	const panel = panelId ? getObjectByThreeJsonId(panelId) : null;
	if (panel?.visible) {
		return hideDevicePanel(deviceRoot);
	}
	return showDevicePanel(deviceRoot, true);
}

/**
 * @param {string|import("three").Object3D} deviceIdOrRoot
 * @param {object} partial
 * @param {{ scene?: import("three").Scene|import("three").Object3D }} [options]
 * @returns {Promise<import("three").Object3D|null>}
 */
export async function updateDevicePanelContent(deviceIdOrRoot, partial, options = {}) {
	const panelId = resolveDevicePanelRefFromRoot(deviceIdOrRoot);
	if (!panelId || !options.scene) {
		return null;
	}
	return updateInfoPanelContent(panelId, partial, options);
}

/**
 * @param {import("three").Object3D|null|undefined} panelObject
 * @returns {boolean}
 */
function isDevicePanelVisible(panelObject) {
	return Boolean(panelObject?.visible);
}

/**
 * @param {import("three").Scene} scene
 * @param {import("three").Object3D} deviceRoot
 * @param {{
 *   domElement?: HTMLElement,
 *   onBeforeShow?: () => void,
 *   onAfterDoor?: () => void
 * }} [options]
 * @returns {(() => void)|null}
 */
export function bindDevicePanelTriggers(scene, deviceRoot, options = {}) {
	if (!scene || !deviceRoot) {
		return null;
	}
	const objJson = deviceRoot.userData?.objJson;
	if (!hasDevicePanelBinding(objJson)) {
		return null;
	}
	const triggers = resolveDevicePanelTriggerConfig(objJson);
	if (triggers.show === "none" && triggers.hide === "none") {
		return null;
	}
	const domElement = options.domElement || (typeof document !== "undefined" ? document : null);
	if (!domElement) {
		return null;
	}

	let hideTimer = null;

	const clearHideTimer = () => {
		if (hideTimer != null) {
			clearTimeout(hideTimer);
			hideTimer = null;
		}
	};

	const getPanel = () => {
		const panelId = resolveDevicePanelRefFromRoot(deviceRoot);
		return panelId ? getObjectByThreeJsonId(panelId) : null;
	};

	const scheduleHide = () => {
		clearHideTimer();
		if (triggers.hide !== "mouseleave") {
			return;
		}
		hideTimer = setTimeout(() => {
			hideDevicePanel(deviceRoot);
		}, triggers.hideDelayMs);
	};

	const tryShow = () => {
		void (async () => {
			if (typeof options.onBeforeShow === "function") {
				options.onBeforeShow();
			}
			await ensureDevicePanelDeployed(scene, deviceRoot);
			const panel = getPanel();
			if (!isDevicePanelVisible(panel)) {
				showDevicePanel(deviceRoot, true);
			}
		})();
	};

	const tryHide = () => {
		const panel = getPanel();
		if (isDevicePanelVisible(panel)) {
			hideDevicePanel(deviceRoot);
		}
	};

	const onPointerOver = () => {
		if (triggers.show === "hover") {
			clearHideTimer();
			tryShow();
		}
	};

	const onPointerOut = () => {
		if (triggers.hide === "mouseleave") {
			scheduleHide();
		}
	};

	const onClick = (event) => {
		if (event.detail === 2) {
			return;
		}
		void (async () => {
			await ensureDevicePanelDeployed(scene, deviceRoot);
			const panel = getPanel();
			if (triggers.show === "click" && !isDevicePanelVisible(panel)) {
				if (typeof options.onBeforeShow === "function") {
					options.onBeforeShow();
				}
				showDevicePanel(deviceRoot, true);
			} else if (triggers.hide === "click" && isDevicePanelVisible(panel)) {
				tryHide();
			}
		})();
	};

	const onDblClick = () => {
		if (typeof options.onAfterDoor === "function") {
			options.onAfterDoor();
		}
		void (async () => {
			await ensureDevicePanelDeployed(scene, deviceRoot);
			const panel = getPanel();
			if (triggers.show === "dblclick" && !isDevicePanelVisible(panel)) {
				showDevicePanel(deviceRoot, true);
			} else if (triggers.hide === "dblclick" && isDevicePanelVisible(panel)) {
				hideDevicePanel(deviceRoot);
			}
		})();
	};

	deviceRoot.addEventListener("pointerover", onPointerOver);
	deviceRoot.addEventListener("pointerout", onPointerOut);
	deviceRoot.addEventListener("click", onClick);
	deviceRoot.addEventListener("dblclick", onDblClick);

	return () => {
		clearHideTimer();
		deviceRoot.removeEventListener("pointerover", onPointerOver);
		deviceRoot.removeEventListener("pointerout", onPointerOut);
		deviceRoot.removeEventListener("click", onClick);
		deviceRoot.removeEventListener("dblclick", onDblClick);
	};
}

/**
 * @param {import("three").Scene} scene
 * @param {{
 *   target?: EventTarget,
 *   shouldIgnore?: (event: KeyboardEvent) => boolean
 * }} [options]
 * @returns {(() => void)|null}
 */
export function bindDevicePanelKeyboardTriggers(scene, options = {}) {
	if (!scene?.traverse) {
		return null;
	}
	const target = options.target || (typeof document !== "undefined" ? document : null);
	if (!target) {
		return null;
	}

	/** @type {{ root: import("three").Object3D, key: string }[]} */
	const hosts = [];
	scene.traverse((obj) => {
		const objJson = obj?.userData?.objJson;
		const key = resolveDevicePanelKeyboardTrigger(objJson);
		if (!key || !hasDevicePanelBinding(objJson)) {
			return;
		}
		hosts.push({ root: obj, key: normalizeKeyboardTriggerKey(key) });
	});
	if (!hosts.length) {
		return null;
	}

	const onKeyDown = (event) => {
		if (typeof options.shouldIgnore === "function" && options.shouldIgnore(event)) {
			return;
		}
		const pressed = normalizeKeyboardTriggerKey(event.key);
		if (!pressed) {
			return;
		}
		for (let i = 0; i < hosts.length; i++) {
			if (hosts[i].key === pressed) {
				void toggleDevicePanel(scene, hosts[i].root);
			}
		}
	};

	target.addEventListener("keydown", onKeyDown);
	return () => {
		target.removeEventListener("keydown", onKeyDown);
	};
}

/**
 * On double-click: open door first, then device panel (for host unified handler).
 * @param {import("three").Scene} scene
 * @param {import("three").Object3D} deviceRoot
 * @param {{ openDoor?: () => void }} [options]
 * @returns {Promise<void>}
 */
export async function handleDevicePanelDblClick(scene, deviceRoot, options = {}) {
	if (typeof options.openDoor === "function") {
		options.openDoor();
	}
	const objJson = deviceRoot?.userData?.objJson;
	if (!objJson) {
		return;
	}
	await ensureDevicePanelDeployed(scene, deviceRoot);
	const triggers = resolveDevicePanelTriggerConfig(objJson);
	const panelId = resolveDevicePanelRefFromRoot(deviceRoot);
	if (!panelId) {
		return;
	}
	const panel = getObjectByThreeJsonId(panelId);
	if (triggers.show === "dblclick" && !isDevicePanelVisible(panel)) {
		showDevicePanel(deviceRoot, true);
	} else if (triggers.hide === "dblclick" && isDevicePanelVisible(panel)) {
		hideDevicePanel(deviceRoot);
	}
}

export { resolveDevicePanelBinding, resolveDevicePanelRef };
