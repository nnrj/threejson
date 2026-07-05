import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { buildInfoPanelObject, normalizeInfoPanelDescriptor } from "../core/builder/infoPanelBuilder.js";
import {
	isInfoPanelCarrierCompatible,
	applyInfoPanelMutation
} from "../core/handler/infoPanelMutation.js";
import {
	updateInfoPanel,
	updateInfoPanelContent,
	applyInfoPanelList
} from "../core/handler/infoPanelRuntime.js";
import { clearObjectRegistry, getObjectByThreeJsonId, registerObject } from "../core/handler/objectRegistry.js";

function withDocumentMock(run) {
	const prevDoc = globalThis.document;
	globalThis.document = {
		createElement() {
			return {
				width: 256,
				height: 128,
				style: {},
				getContext() {
					return {
						scale() {},
						font: "",
						fillStyle: "",
						textAlign: "",
						textBaseline: "",
						fillRect() {},
						fillText() {},
						measureText(text) {
							return { width: String(text).length * 10 };
						}
					};
				}
			};
		}
	};
	return Promise.resolve(run()).finally(() => {
		globalThis.document = prevDoc;
	});
}

/**
 * @param {THREE.Scene} scene
 * @param {object} raw
 * @returns {import("three").Object3D}
 */
function deployTestInfoPanel(scene, raw) {
	const descriptor = normalizeInfoPanelDescriptor(raw);
	const object3D = buildInfoPanelObject(descriptor, { isTexture: true });
	object3D.visible = descriptor.visible !== false;
	scene.add(object3D);
	registerObject(object3D, descriptor, { recursive: false });
	return object3D;
}

test("isInfoPanelCarrierCompatible matches panelBoxType", () => {
	const sprite = deployTestInfoPanel(new THREE.Scene(), {
		threeJsonId: "c-sprite",
		panelBoxType: "sprite",
		text: "s"
	});
	assert.equal(isInfoPanelCarrierCompatible(sprite, { panelBoxType: "sprite" }), true);
	assert.equal(isInfoPanelCarrierCompatible(sprite, { panelBoxType: "box" }), false);
});

test("updateInfoPanel keeps uuid on text change", () => withDocumentMock(async () => {
	clearObjectRegistry();
	const scene = new THREE.Scene();
	const panel = deployTestInfoPanel(scene, {
		threeJsonId: "panel-update-1",
		text: "hello",
		panelBoxType: "sprite"
	});
	const uuidBefore = panel.uuid;
	await updateInfoPanel("panel-update-1", { text: "world" }, { scene });
	const after = getObjectByThreeJsonId("panel-update-1");
	assert.ok(after);
	assert.equal(after.uuid, uuidBefore);
	assert.equal(after.userData.objJson.text, "world");
}));

test("updateInfoPanelContent delegates and updates content only path", () => withDocumentMock(async () => {
	clearObjectRegistry();
	const scene = new THREE.Scene();
	deployTestInfoPanel(scene, {
		threeJsonId: "panel-content-1",
		text: "a",
		panelBoxType: "box",
		panelWidth: 10,
		panelHeight: 5,
		panelDepth: 1
	});
	await updateInfoPanelContent("panel-content-1", { text: "b" }, { scene });
	const after = getObjectByThreeJsonId("panel-content-1");
	assert.equal(after?.userData?.objJson?.text, "b");
}));

test("updateInfoPanel redeploys on carrier mismatch", () => withDocumentMock(async () => {
	clearObjectRegistry();
	const scene = new THREE.Scene();
	const panel = deployTestInfoPanel(scene, {
		threeJsonId: "panel-redeploy-1",
		text: "x",
		panelBoxType: "sprite"
	});
	const uuidBefore = panel.uuid;
	await updateInfoPanel(
		"panel-redeploy-1",
		{ panelBoxType: "box", panelDepth: 2 },
		{ scene }
	);
	const after = getObjectByThreeJsonId("panel-redeploy-1");
	assert.ok(after);
	assert.notEqual(after.uuid, uuidBefore);
	assert.equal(after.isMesh, true);
	assert.equal(after.userData.objJson.panelBoxType, "box");
}));

test("applyInfoPanelMutation updates sprite scale from descriptor", () => {
	const descriptor = normalizeInfoPanelDescriptor({
		text: "s",
		panelBoxType: "sprite",
		panelWidth: 30,
		panelHeight: 12,
		panel: { position: { x: 1, y: 2, z: 3 } }
	});
	const sprite = buildInfoPanelObject(descriptor, { isTexture: true });
	applyInfoPanelMutation(sprite, descriptor, { isTexture: true });
	assert.equal(sprite.scale.x, 30);
	assert.equal(sprite.position.x, 1);
});

test("applyInfoPanelList updates existing and deploys missing", () => withDocumentMock(async () => {
	clearObjectRegistry();
	const scene = new THREE.Scene();
	deployTestInfoPanel(scene, {
		threeJsonId: "sync-existing",
		text: "old",
		panelBoxType: "sprite"
	});
	const result = await applyInfoPanelList(scene, [
		{ threeJsonId: "sync-existing", text: "new", panelBoxType: "sprite" },
		{ threeJsonId: "sync-new", text: "fresh", panelBoxType: "sprite" }
	]);
	assert.equal(result.updated, 1);
	assert.equal(result.deployed, 1);
	assert.equal(getObjectByThreeJsonId("sync-existing")?.userData?.objJson?.text, "new");
	assert.ok(getObjectByThreeJsonId("sync-new"));
}));
