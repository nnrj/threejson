import * as THREE from 'three';
import { updateEngineTweens } from '../compat/adapters/tween.js';
import { getAnimationMode } from '../util/animationMode.js';
import { updatePointsMotion } from '../builder/pointsMotion.js';
import { updateParticleGpuCompute } from '../builder/particle/particleGpuCompute.js';
import { updatePlaneScrollMotion } from '../builder/planeScrollMotion.js';
import { updateShaderMotion } from '../builder/shader/shaderMotion.js';

/**
 * Scene animation driver: per-frame updates from JSON `animations` (e.g. rotate) and unified updateEngineTweens.
 */

const DEFAULT_MAX_DELTA_SECONDS = 0.1;
const sceneAnimationStateMap = new WeakMap();
const ROTATION_AXIS_MAP = {
	x: 'x',
	y: 'y',
	z: 'z',
	rotationX: 'x',
	rotationY: 'y',
	rotationZ: 'z'
};

/** One Clock per scene; used for frame delta when deltaSeconds is not passed explicitly. */
function getSceneAnimationState(scene){
	if(!sceneAnimationStateMap.has(scene)){
		sceneAnimationStateMap.set(scene, {
			clock: new THREE.Clock()
		});
	}
	return sceneAnimationStateMap.get(scene);
}

/**
 * Frame delta in seconds: use deltaSeconds when finite, otherwise read from the scene Clock.
 */
function getDeltaSeconds(scene, deltaSeconds){
	if(Number.isFinite(deltaSeconds)){
		return deltaSeconds;
	}
	return getSceneAnimationState(scene).clock.getDelta();
}

/** Normalize a single animation config or array into an array. */
function normalizeAnimations(animationConfig){
	if(!animationConfig){
		return [];
	}
	return Array.isArray(animationConfig) ? animationConfig : [animationConfig];
}

/** Read the animations list from the object's userData.objJson. */
function getAnimationList(currObj){
	const j = currObj?.userData?.objJson;
	if(!currObj || !currObj.userData || !j){
		return [];
	}
	return normalizeAnimations(j.animations);
}

/** Continuous rotation around x/y/z (angular speed * seconds). */
function applyRotateAnimation(currObj, animation, deltaSeconds){
	const axis = ROTATION_AXIS_MAP[animation.axis || 'y'];
	const speed = Number(animation.speed);
	if(!axis || !Number.isFinite(speed)){
		return;
	}
	currObj.rotation[axis] += speed * deltaSeconds;
}

/** Apply all enabled animations configured on a single Object3D. */
function updateObjectAnimations(currObj, deltaSeconds){
	const mode = getAnimationMode(currObj);
	if(mode === 'mixer'){
		return;
	}
	const animations = getAnimationList(currObj);
	for(let i = 0; i < animations.length; i++){
		const animation = animations[i];
		if(!animation || false === animation.enabled){
			continue;
		}
		if('rotate' === animation.type){
			applyRotateAnimation(currObj, animation, deltaSeconds);
		}
	}
}

/**
 * Update continuous animations declared in JSON across the scene subtree and refresh TWEEN.
 * @param {THREE.Object3D} scene Usually Scene; traverses the full subtree
 * @param {number} [deltaSeconds] Seconds since last frame; defaults to internal Clock.getDelta()
 * @param {object} [options={}] May include maxDeltaSeconds to cap per-frame step after stalls
 */
function updateSceneAnimations(scene, deltaSeconds, options = {}){
	if(!scene){
		return;
	}
	const currentDeltaSeconds = getDeltaSeconds(scene, deltaSeconds);
	const maxDeltaSeconds = Number.isFinite(options.maxDeltaSeconds) ? options.maxDeltaSeconds : DEFAULT_MAX_DELTA_SECONDS;
	const safeDeltaSeconds = Math.min(currentDeltaSeconds, maxDeltaSeconds);
	scene.traverse(function(currObj){
		updateObjectAnimations(currObj, safeDeltaSeconds);
	});
	const animCtx = { scene, deltaSeconds: safeDeltaSeconds };
	updatePointsMotion(safeDeltaSeconds);
	updateParticleGpuCompute(safeDeltaSeconds);
	updatePlaneScrollMotion(safeDeltaSeconds);
	updateShaderMotion(safeDeltaSeconds, animCtx);
	updateEngineTweens();
}

/**
 * Shared time step for `AnimationMixer` and declarative animations; same Clock as {@link updateSceneAnimations}.
 * @param {import("three").Object3D|null|undefined} scene
 * @param {number} [deltaSeconds]
 * @param {object} [options]
 * @param {number} [options.maxDeltaSeconds]
 */
function computeSceneAnimationDelta(scene, deltaSeconds, options = {}){
	if(!scene){
		return 0;
	}
	const currentDeltaSeconds = getDeltaSeconds(scene, deltaSeconds);
	const maxDeltaSeconds = Number.isFinite(options.maxDeltaSeconds) ? options.maxDeltaSeconds : DEFAULT_MAX_DELTA_SECONDS;
	return Math.min(currentDeltaSeconds, maxDeltaSeconds);
}

export {
	updateSceneAnimations,
	computeSceneAnimationDelta,
	getAnimationMode
}
