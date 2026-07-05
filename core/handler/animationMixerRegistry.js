/**
 * glTF AnimationMixer registry: parallel to declarative `animations`, coordinated by `animationMode`.
 * Uses the state machine when animationGraph is present; otherwise plays all clips (legacy behavior).
 */
import * as THREE from 'three';
import { computeSceneAnimationDelta } from './animationHandler.js';
import { getAnimationMode } from '../util/animationMode.js';
import { resolveAnimationGraph } from './animationGraphUtil.js';
import {
	isAnimationStateMachineRoot,
	registerAnimationStateMachine,
	unregisterAnimationStateMachine
} from './animationStateMachine.js';

/** @type {Map<string, { root: import("three").Object3D, mixer: THREE.AnimationMixer }>} */
const mixersByRootUuid = new Map();

/**
 * When glTF has animation clips, create and register an AnimationMixer for `root`.
 * Enables the state machine when animationGraph is present; otherwise plays all clips (legacy behavior).
 * @param {import("three").Object3D} root
 * @param {{ animations?: THREE.AnimationClip[] }} gltf
 * @param {object} [descriptor]
 * @returns {THREE.AnimationMixer|null}
 */
function tryRegisterGltfAnimationMixers(root, gltf, descriptor = null) {
	if (!root || !gltf || !Array.isArray(gltf.animations) || gltf.animations.length === 0) {
		return null;
	}
	const record = descriptor && typeof descriptor === 'object' ? descriptor : root?.userData?.objJson;
	if (resolveAnimationGraph(record)) {
		unregisterAnimationMixerForRoot(root);
		return registerAnimationStateMachine(root, gltf, record);
	}

	const uuid = root.uuid;
	unregisterAnimationMixerForRoot(root);
	const mixer = new THREE.AnimationMixer(root);
	for (let i = 0; i < gltf.animations.length; i++) {
		const clip = gltf.animations[i];
		if (!clip) {
			continue;
		}
		const action = mixer.clipAction(clip);
		action.setLoop(THREE.LoopRepeat, Infinity);
		action.play();
	}
	mixersByRootUuid.set(uuid, { root, mixer });
	return mixer;
}

/**
 * @param {import("three").Object3D|null|undefined} root
 */
function unregisterAnimationMixerForRoot(root) {
	if (!root) {
		return;
	}
	unregisterAnimationStateMachine(root);
	const hit = mixersByRootUuid.get(root.uuid);
	if (!hit) {
		return;
	}
	hit.mixer.stopAllAction();
	mixersByRootUuid.delete(root.uuid);
}

/**
 * Call after `updateAnimationStateMachines`: run `mixer.update` on registered roots with `animationMode !== 'basic'`.
 * State-machine roots are updated separately by `updateAnimationStateMachines` and are skipped here.
 * @param {import("three").Object3D|null|undefined} scene
 * @param {number} [deltaSeconds] Shared time step with declarative animations (from frame loop; avoids duplicate Clock.getDelta)
 */
function updateRegisteredAnimationMixers(scene, deltaSeconds) {
	if (!scene || mixersByRootUuid.size === 0) {
		return;
	}
	const delta = Number.isFinite(deltaSeconds)
		? deltaSeconds
		: computeSceneAnimationDelta(scene, undefined);
	for (const { root, mixer } of mixersByRootUuid.values()) {
		if (isAnimationStateMachineRoot(root)) {
			continue;
		}
		const mode = getAnimationMode(root);
		if (mode === 'basic') {
			continue;
		}
		mixer.update(delta);
	}
}

export {
	tryRegisterGltfAnimationMixers,
	unregisterAnimationMixerForRoot,
	updateRegisteredAnimationMixers
};
