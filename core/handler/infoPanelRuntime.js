/**
 * Info panel runtime: registry visibility, update by threeJsonId, list sync.
 */
import {
	deployInfoPanel,
	normalizeInfoPanelDescriptor,
	resolveInfoPanelTexture
} from "../builder/infoPanelBuilder.js";
import { ensureThreeJsonIdOnRecord } from "../util/util.js";
import { setUserDataObjJson } from "./objectDescriptorAttach.js";
import {
	applyInfoPanelLayoutToObject,
	applyInfoPanelMutation,
	isInfoPanelCarrierCompatible,
	redeployInfoPanelByThreeJsonId
} from "./infoPanelMutation.js";
import { getObjectByThreeJsonId } from "./objectRegistry.js";
import {
	applyObjectVisibility,
	setObjectVisibleByThreeJsonId,
	setObjectsVisibleByName
} from "./objectVisibility.js";
import {
	getActiveEventListenerManager,
	getActiveEventSceneToken
} from "../runtime/eventMechanism/bindEventRuntime.js";
import { wireInfoPanelDismissTriggerForObject } from "../runtime/eventMechanism/wireInfoPanelDismissTriggers.js";

const CONTENT_PARTIAL_KEYS = new Set([
	"type",
	"text",
	"html",
	"imgUrl",
	"textureWidth",
	"textureHeight",
	"textureQuality",
	"generateMipmaps",
	"minFilter",
	"magFilter",
	"colorSpace",
	"textureSampling",
	"textureAnisotropy",
	"anisotropy",
	"html2canvasScale",
	"backColor",
	"borderRadius",
	"textStyle",
	"contentScale",
	"font",
	"textAlign",
	"textVerticalAlign",
	"color",
	"transparent",
	"opacity"
]);

const LAYOUT_PARTIAL_KEYS = new Set([
	"panel",
	"panelWidth",
	"panelHeight",
	"panelDepth",
	"panelBoxType",
	"boxType",
	"name",
	"visible"
]);

/**
 * @param {object|null|undefined} partial
 * @returns {boolean}
 */
function partialTouchesContent(partial) {
	if (!partial || typeof partial !== "object") {
		return false;
	}
	for (const key of CONTENT_PARTIAL_KEYS) {
		if (Object.prototype.hasOwnProperty.call(partial, key)) {
			return true;
		}
	}
	return false;
}

const GEOMETRY_LAYOUT_KEYS = new Set([
	"panelWidth",
	"panelHeight",
	"panelDepth",
	"textFace"
]);

/**
 * @param {object|null|undefined} partial
 * @returns {boolean}
 */
function partialTouchesLayout(partial) {
	if (!partial || typeof partial !== "object") {
		return false;
	}
	for (const key of LAYOUT_PARTIAL_KEYS) {
		if (Object.prototype.hasOwnProperty.call(partial, key)) {
			return true;
		}
	}
	return false;
}

/**
 * @param {object|null|undefined} partial
 * @returns {boolean}
 */
function partialTouchesGeometry(partial) {
	if (!partial || typeof partial !== "object") {
		return false;
	}
	for (const key of GEOMETRY_LAYOUT_KEYS) {
		if (Object.prototype.hasOwnProperty.call(partial, key)) {
			return true;
		}
	}
	if (partial.panel && typeof partial.panel === "object") {
		if (partial.panel.material || partial.panel.scale) {
			return true;
		}
	}
	return false;
}

/**
 * @param {import("three").Object3D} object3D
 * @returns {import("three").Texture|null}
 */
function resolveExistingPanelTexture(object3D) {
	if (object3D.isSprite) {
		return object3D.material?.map || null;
	}
	if (object3D.isMesh) {
		const mat = object3D.material;
		if (Array.isArray(mat)) {
			for (let i = 0; i < mat.length; i++) {
				if (mat[i]?.map) {
					return mat[i].map;
				}
			}
			return null;
		}
		return mat?.map || null;
	}
	return null;
}

/**
 * @param {object|null|undefined} partial
 * @returns {object}
 */
export function filterInfoPanelContentPartial(partial) {
	if (!partial || typeof partial !== "object") {
		return {};
	}
	const filtered = {};
	for (const key of Object.keys(partial)) {
		if (CONTENT_PARTIAL_KEYS.has(key)) {
			filtered[key] = partial[key];
		}
	}
	if (partial.threeJsonId !== undefined) {
		filtered.threeJsonId = partial.threeJsonId;
	}
	return filtered;
}

/**
 * @param {string} threeJsonId
 * @param {boolean} visible
 * @returns {boolean}
 */
export function setInfoPanelVisibleByThreeJsonId(threeJsonId, visible) {
	return setObjectVisibleByThreeJsonId(threeJsonId, visible);
}

/**
 * @param {import("three").Object3D|null|undefined} object3D
 * @param {object} descriptor
 */
function applyInfoPanelVisibilityFromDescriptor(object3D, descriptor) {
	if (!object3D) {
		return;
	}
	const visible = descriptor.visible !== false;
	applyObjectVisibility(object3D, visible, { applyToSubtree: false });
}

/**
 * @param {string} threeJsonId
 * @param {object|null|undefined} partial
 * @param {{ scene?: import("three").Scene|import("three").Object3D, deployOptions?: object }} [options]
 * @returns {Promise<import("three").Object3D|null>}
 */
export async function updateInfoPanel(threeJsonId, partial, options = {}) {
	const existing = getObjectByThreeJsonId(threeJsonId);
	if (!existing || !options.scene) {
		return null;
	}
	const base = existing.userData?.objJson && typeof existing.userData.objJson === "object"
		? existing.userData.objJson
		: {};
	const merged = normalizeInfoPanelDescriptor({
		...base,
		...(partial && typeof partial === "object" ? partial : {}),
		threeJsonId: base.threeJsonId || threeJsonId
	});

	if (!isInfoPanelCarrierCompatible(existing, merged)) {
		const redeployed = await redeployInfoPanelByThreeJsonId(
			options.scene,
			threeJsonId,
			merged,
			{ deployOptions: options.deployOptions }
		);
		applyInfoPanelVisibilityFromDescriptor(redeployed, merged);
		syncInfoPanelDismissBinding(merged);
		return redeployed;
	}

	const touchesContent = partialTouchesContent(partial);
	const touchesLayout = partialTouchesLayout(partial);
	let updated = existing;

	if (touchesContent) {
		const texture = await resolveInfoPanelTexture(merged);
		updated = applyInfoPanelMutation(existing, merged, texture);
	} else if (touchesLayout) {
		if (partialTouchesGeometry(partial)) {
			const texture = resolveExistingPanelTexture(existing);
			if (texture) {
				updated = applyInfoPanelMutation(existing, merged, texture);
			} else {
				applyInfoPanelLayoutToObject(existing, merged);
			}
		} else {
			applyInfoPanelLayoutToObject(existing, merged);
		}
	} else {
		setUserDataObjJson(existing, merged);
	}

	applyInfoPanelVisibilityFromDescriptor(updated, merged);
	if (partialTouchesDismissBehavior(partial)) {
		syncInfoPanelDismissBinding(merged);
	}
	return updated;
}

/**
 * @param {string} threeJsonId
 * @param {object|null|undefined} partial
 * @param {{ scene?: import("three").Scene|import("three").Object3D }} [options]
 * @returns {Promise<import("three").Object3D|null>}
 */
export async function updateInfoPanelContent(threeJsonId, partial, options = {}) {
	return updateInfoPanel(
		threeJsonId,
		filterInfoPanelContentPartial(partial),
		options
	);
}

const DISMISS_PARTIAL_KEYS = new Set(["fix", "dismissTrigger"]);

/**
 * @param {object|null|undefined} partial
 * @returns {boolean}
 */
function partialTouchesDismissBehavior(partial) {
	if (!partial || typeof partial !== "object") {
		return false;
	}
	for (const key of DISMISS_PARTIAL_KEYS) {
		if (Object.prototype.hasOwnProperty.call(partial, key)) {
			return true;
		}
	}
	return false;
}

/**
 * @param {object|null|undefined} descriptor
 */
function syncInfoPanelDismissBinding(descriptor) {
	const manager = getActiveEventListenerManager();
	if (!manager || !descriptor?.threeJsonId) {
		return;
	}
	const object3D = getObjectByThreeJsonId(descriptor.threeJsonId);
	if (!object3D) {
		return;
	}
	wireInfoPanelDismissTriggerForObject(object3D, {
		manager,
		sceneToken: getActiveEventSceneToken() ?? ""
	});
}

export async function applyInfoPanelList(scene, infoPanelList, options = {}) {
	if (!scene || !Array.isArray(infoPanelList)) {
		return { updated: 0, deployed: 0 };
	}
	let updated = 0;
	let deployed = 0;
	for (let i = 0; i < infoPanelList.length; i++) {
		const descriptor = normalizeInfoPanelDescriptor(infoPanelList[i]);
		ensureThreeJsonIdOnRecord(descriptor);
		const existing = descriptor.threeJsonId
			? getObjectByThreeJsonId(descriptor.threeJsonId)
			: null;
		if (existing) {
			await updateInfoPanel(descriptor.threeJsonId, descriptor, { scene });
			updated += 1;
		} else {
			await deployInfoPanel(scene, descriptor, options.deployOptions);
			deployed += 1;
		}
		syncInfoPanelDismissBinding(descriptor);
	}
	return { updated, deployed };
}

/**
 * @param {string[]} names
 * @param {boolean} visible
 * @returns {number}
 */
export function hideInfoPanelsByNames(names, visible) {
	if (!Array.isArray(names) || names.length === 0) {
		return 0;
	}
	let count = 0;
	for (let i = 0; i < names.length; i++) {
		count += setObjectsVisibleByName(names[i], visible);
	}
	return count;
}
