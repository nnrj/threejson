/**
 * Info panel runtime mutations: adapted from builder updateInfo*Mesh / applyTransform; in-place changes by threeJsonId.
 */
import * as THREE from "three";

import {
	infoPanelCreateBoxGeometry,
	infoPanelCreatePlaneGeometry,
	infoPanelCreatePlaneMaterial,
	infoPanelCreateTextureMaterials,
	infoPanelResolveMaterialColor,
	infoPanelResolveMaterialTransparency,
	infoPanelResolveRecordName,
	deployInfoPanel
} from "../builder/infoPanelBuilder.js";
import { trackDisposableResource } from "./trackedResourceRegistry.js";
import { setUserDataObjJson } from "./objectDescriptorAttach.js";
import { getObjectByThreeJsonId, unregisterObject } from "./objectRegistry.js";
import { detachObjectTree, disposeObjectTree } from "./disposeObjectTree.js";
import { ensureThreeJsonIdOnRecord } from "../util/util.js";

const DEFAULT_INFO_PANEL_NAME = "infoPanel";

/** @param {import("three").Object3D|null|undefined} object3D */
function resolveExistingCarrierType(object3D) {
	if (!object3D) {
		return null;
	}
	if (object3D.isSprite) {
		return "sprite";
	}
	const fromJson = object3D.userData?.objJson?.panelBoxType;
	if (fromJson === "sprite" || fromJson === "plane" || fromJson === "box") {
		return fromJson;
	}
	return object3D.isMesh ? "box" : null;
}

/**
 * @param {import("three").Object3D} object3D
 * @param {object} descriptor
 * @returns {boolean}
 */
export function isInfoPanelCarrierCompatible(object3D, descriptor) {
	const desired = descriptor.panelBoxType || "box";
	const current = resolveExistingCarrierType(object3D);
	return Boolean(current) && current === desired;
}

/** Apply panel position/rotation/name and write userData.objJson. */
function applyInfoPanelTransform(object3D, infoPanel) {
	object3D.position.set(
		infoPanel.panel.position.x,
		infoPanel.panel.position.y,
		infoPanel.panel.position.z
	);
	object3D.rotation.set(
		infoPanel.panel.rotation.rotationX,
		infoPanel.panel.rotation.rotationY,
		infoPanel.panel.rotation.rotationZ
	);
	const name = infoPanelResolveRecordName(infoPanel) || DEFAULT_INFO_PANEL_NAME;
	infoPanel.name = name;
	object3D.name = name;
	setUserDataObjJson(object3D, infoPanel);
}

/**
 * @param {object} infoPanel
 * @param {THREE.Texture} texture
 * @param {THREE.Mesh} boxMesh
 * @returns {THREE.Mesh}
 */
function mutateInfoBoxMesh(infoPanel, texture, boxMesh) {
	boxMesh.geometry = infoPanelCreateBoxGeometry(infoPanel);
	boxMesh.material = infoPanelCreateTextureMaterials(infoPanel, texture);
	applyInfoPanelTransform(boxMesh, infoPanel);
	boxMesh.scale.set(
		infoPanel.panel.scale.scaleX,
		infoPanel.panel.scale.scaleY,
		infoPanel.panel.scale.scaleZ
	);
	return boxMesh;
}

/**
 * @param {object} infoPanel
 * @param {THREE.Texture} texture
 * @param {THREE.Mesh} planeMesh
 * @returns {THREE.Mesh}
 */
function mutateInfoPlaneMesh(infoPanel, texture, planeMesh) {
	planeMesh.geometry = infoPanelCreatePlaneGeometry(infoPanel);
	planeMesh.material = infoPanelCreatePlaneMaterial(infoPanel, texture);
	applyInfoPanelTransform(planeMesh, infoPanel);
	planeMesh.scale.set(
		infoPanel.panel.scale.scaleX,
		infoPanel.panel.scale.scaleY,
		infoPanel.panel.scale.scaleZ
	);
	return planeMesh;
}

/**
 * @param {object} infoPanel
 * @param {THREE.Texture} texture
 * @param {THREE.Sprite} sprite
 * @returns {THREE.Sprite}
 */
function mutateInfoSpriteMesh(infoPanel, texture, sprite) {
	if (!sprite.material) {
		sprite.material = trackDisposableResource(new THREE.SpriteMaterial());
	}

	const color = infoPanelResolveMaterialColor(infoPanel);
	const transparency = infoPanelResolveMaterialTransparency(infoPanel);
	sprite.material.color.set(color);
	sprite.material.map = texture || null;
	sprite.material.alphaTest = 0.1;
	sprite.material.transparent = transparency.transparent;
	sprite.material.opacity = transparency.opacity;
	sprite.material.needsUpdate = true;

	applyInfoPanelTransform(sprite, infoPanel);
	sprite.scale.set(infoPanel.panelWidth, infoPanel.panelHeight, 1);
	return sprite;
}

/**
 * @param {import("three").Object3D} object3D
 * @param {object} descriptor
 * @param {THREE.Texture} texture
 * @returns {import("three").Object3D}
 */
export function applyInfoPanelMutation(object3D, descriptor, texture) {
	const carrier = descriptor.panelBoxType || "box";
	if (carrier === "sprite") {
		return mutateInfoSpriteMesh(descriptor, texture, /** @type {THREE.Sprite} */ (object3D));
	}
	if (carrier === "plane") {
		return mutateInfoPlaneMesh(descriptor, texture, /** @type {THREE.Mesh} */ (object3D));
	}
	return mutateInfoBoxMesh(descriptor, texture, /** @type {THREE.Mesh} */ (object3D));
}

/**
 * @param {import("three").Object3D} object3D
 * @param {object} descriptor
 */
export function applyInfoPanelLayoutToObject(object3D, descriptor) {
	applyInfoPanelTransform(object3D, descriptor);
	if (object3D.isSprite) {
		object3D.scale.set(descriptor.panelWidth, descriptor.panelHeight, 1);
		return;
	}
	if (object3D.isMesh) {
		object3D.scale.set(
			descriptor.panel.scale.scaleX,
			descriptor.panel.scale.scaleY,
			descriptor.panel.scale.scaleZ
		);
	}
}

/**
 * @param {import("three").Scene|import("three").Object3D} scene
 * @param {string} threeJsonId
 * @param {object} descriptor
 * @param {{ deployOptions?: object }} [options]
 * @returns {Promise<import("three").Object3D>}
 */
export async function redeployInfoPanelByThreeJsonId(scene, threeJsonId, descriptor, options = {}) {
	const existing = getObjectByThreeJsonId(threeJsonId);
	if (existing) {
		detachObjectTree(existing);
		unregisterObject(existing, { recursive: false, keepDescriptor: false });
		disposeObjectTree(existing);
	}
	const merged = {
		...descriptor,
		threeJsonId: descriptor.threeJsonId || threeJsonId
	};
	ensureThreeJsonIdOnRecord(merged);
	return deployInfoPanel(scene, merged, options.deployOptions || {});
}
