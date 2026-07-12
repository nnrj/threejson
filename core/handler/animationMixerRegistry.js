/**
 * glTF AnimationMixer registry: parallel to declarative `animations`, coordinated by `animationMode`.
 * Uses the state machine when animationGraph is present; otherwise plays all clips (legacy behavior).
 *
 * Registered mixers live inside `createAnimationMixerStore()` instances, one per
 * RuntimeContext (see core/runtime/runtimeContext.js), so each canvas's render loop
 * only advances its own mixers (previously an O(N²) cost across N concurrently-mounted
 * scenes, since `updateRegisteredAnimationMixers` received `scene` but ignored it).
 * `tryRegisterGltfAnimationMixers`/`unregisterAnimationMixerForRoot` auto-resolve their
 * scope from `root`; `updateRegisteredAnimationMixers` takes an explicit trailing
 * `runtimeScope` via its existing `scene` parameter. Omitting either preserves today's
 * shared-global behavior.
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
import { resolveRuntimeContext } from '../runtime/runtimeContext.js';

export function createAnimationMixerStore() {
	/** @type {Map<string, { root: import("three").Object3D, mixer: THREE.AnimationMixer }>} */
	const mixersByRootUuid = new Map();

	function unregisterAnimationMixerForRoot(root) {
		if (!root) {
			return;
		}
		unregisterAnimationStateMachine(root, root);
		const hit = mixersByRootUuid.get(root.uuid);
		if (!hit) {
			return;
		}
		hit.mixer.stopAllAction();
		mixersByRootUuid.delete(root.uuid);
	}

	function tryRegisterGltfAnimationMixers(root, gltf, descriptor = null) {
		if (!root || !gltf || !Array.isArray(gltf.animations) || gltf.animations.length === 0) {
			return null;
		}
		const record = descriptor && typeof descriptor === 'object' ? descriptor : root?.userData?.objJson;
		if (resolveAnimationGraph(record)) {
			unregisterAnimationMixerForRoot(root);
			return registerAnimationStateMachine(root, gltf, record, root);
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

	function updateRegisteredAnimationMixers(scene, deltaSeconds) {
		if (!scene || mixersByRootUuid.size === 0) {
			return;
		}
		const delta = Number.isFinite(deltaSeconds)
			? deltaSeconds
			: computeSceneAnimationDelta(scene, undefined);
		for (const { root, mixer } of mixersByRootUuid.values()) {
			if (isAnimationStateMachineRoot(root, scene)) {
				continue;
			}
			const mode = getAnimationMode(root);
			if (mode === 'basic') {
				continue;
			}
			mixer.update(delta);
		}
	}

	function dispose() {
		for (const { mixer } of mixersByRootUuid.values()) {
			mixer.stopAllAction();
		}
		mixersByRootUuid.clear();
	}

	return {
		tryRegisterGltfAnimationMixers,
		unregisterAnimationMixerForRoot,
		updateRegisteredAnimationMixers,
		dispose
	};
}

function resolveStore(runtimeScope) {
	return resolveRuntimeContext(runtimeScope).animationMixer;
}

/**
 * When glTF has animation clips, create and register an AnimationMixer for `root`.
 * Enables the state machine when animationGraph is present; otherwise plays all clips (legacy behavior).
 * @param {import("three").Object3D} root
 * @param {{ animations?: THREE.AnimationClip[] }} gltf
 * @param {object} [descriptor]
 * @param {*} [runtimeScope]
 * @returns {THREE.AnimationMixer|null}
 */
function tryRegisterGltfAnimationMixers(root, gltf, descriptor = null, runtimeScope) {
	return resolveStore(runtimeScope ?? root).tryRegisterGltfAnimationMixers(root, gltf, descriptor);
}

/**
 * @param {import("three").Object3D|null|undefined} root
 * @param {*} [runtimeScope]
 */
function unregisterAnimationMixerForRoot(root, runtimeScope) {
	return resolveStore(runtimeScope ?? root).unregisterAnimationMixerForRoot(root);
}

/**
 * Call after `updateAnimationStateMachines`: run `mixer.update` on registered roots with `animationMode !== 'basic'`.
 * State-machine roots are updated separately by `updateAnimationStateMachines` and are skipped here.
 * @param {import("three").Object3D|null|undefined} scene
 * @param {number} [deltaSeconds] Shared time step with declarative animations (from frame loop; avoids duplicate Clock.getDelta)
 */
function updateRegisteredAnimationMixers(scene, deltaSeconds) {
	return resolveStore(scene).updateRegisteredAnimationMixers(scene, deltaSeconds);
}

export {
	tryRegisterGltfAnimationMixers,
	unregisterAnimationMixerForRoot,
	updateRegisteredAnimationMixers
};
