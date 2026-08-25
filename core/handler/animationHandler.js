import * as THREE from 'three';
import { updateEngineTweens } from '../compat/adapters/tween.js';
import { getAnimationMode } from '../util/animationMode.js';
import { updatePointsMotion } from '../builder/pointsMotion.js';
import { updateParticleGpuCompute } from '../builder/particle/particleGpuCompute.js';
import { updateParticleCpuSimulation } from '../builder/particle/particleCpuSimulation.js';
import { updateParticleSimulationExtensions } from '../builder/particle/particleSimulationBackendRegistry.js';
import { updatePlaneScrollMotion } from '../builder/planeScrollMotion.js';
import { updateShaderMotion } from '../builder/shader/shaderMotion.js';
import { evaluateNumericExpression } from '../util/numericExpression.js';
import { resolvePosition, resolveRotation, resolveScale } from '../util/vectorValue.js';
import { createCurveFromDescriptor } from '../builder/curve/curveFactory.js';

/**
 * Scene animation driver: per-frame updates from JSON `animations` (e.g. rotate) and unified updateEngineTweens.
 */

const DEFAULT_MAX_DELTA_SECONDS = 0.1;
const sceneAnimationStateMap = new WeakMap();
const objectAnimationStateMap = new WeakMap();
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

function getObjectAnimationState(object3D, animation, index){
	let byObject = objectAnimationStateMap.get(object3D);
	if(!byObject){
		byObject = new Map();
		objectAnimationStateMap.set(object3D, byObject);
	}
	const key = animation.id || animation.name || index;
	if(!byObject.has(key)) byObject.set(key, { elapsed: 0, from: null });
	return byObject.get(key);
}

function readObjectVector(object3D, property){
	const source = object3D?.[property];
	return { x: Number(source?.x) || 0, y: Number(source?.y) || 0, z: Number(source?.z) || 0 };
}

function resolveAnimationVector(value, property, fallback){
	if(property === 'rotation') return resolveRotation(value, fallback);
	if(property === 'scale') return resolveScale(value, fallback);
	return resolvePosition(value, fallback);
}

function applyTransformAnimation(object3D, animation, deltaSeconds, index){
	const property = ['position', 'rotation', 'scale'].includes(animation.property) ? animation.property : 'position';
	const state = getObjectAnimationState(object3D, animation, index);
	state.elapsed += deltaSeconds * 1000;
	const delay = Math.max(0, Number(animation.delay) || 0);
	if(state.elapsed < delay) return;
	const duration = Math.max(1, Number(animation.duration) || 1000);
	const localElapsed = state.elapsed - delay;
	const cycle = Math.floor(localElapsed / duration);
	const repeat = animation.repeat === true || animation.repeat === 'infinite'
		? Infinity
		: Math.max(0, Math.floor(Number(animation.repeat) || 0));
	const finished = Number.isFinite(repeat) && cycle > repeat;
	const activeCycle = finished ? repeat : cycle;
	let progress = finished ? 1 : Math.min(1, (localElapsed % duration) / duration);
	if(localElapsed > 0 && localElapsed % duration === 0) progress = 1;
	if(animation.yoyo === true && activeCycle % 2 === 1) progress = 1 - progress;
	if(!state.from) state.from = resolveAnimationVector(animation.from, property, readObjectVector(object3D, property));
	const to = resolveAnimationVector(animation.to ?? animation.value, property, state.from);
	const target = object3D[property];
	target.set(
		state.from.x + (to.x - state.from.x) * progress,
		state.from.y + (to.y - state.from.y) * progress,
		state.from.z + (to.z - state.from.z) * progress
	);
}

function applyExpressionAnimation(object3D, animation, deltaSeconds, index){
	const property = ['position', 'rotation', 'scale'].includes(animation.property) ? animation.property : 'position';
	const state = getObjectAnimationState(object3D, animation, index);
	state.elapsed += deltaSeconds;
	const expressions = animation.expressions ?? animation.value ?? {};
	const current = readObjectVector(object3D, property);
	const variables = {
		t: state.elapsed,
		time: state.elapsed,
		delta: deltaSeconds,
		progress: Number(animation.duration) > 0 ? (state.elapsed * 1000 % Number(animation.duration)) / Number(animation.duration) : 0
	};
	const evaluateAxis = (axis) => {
		const expression = Array.isArray(expressions) ? expressions[['x','y','z'].indexOf(axis)] : expressions?.[axis];
		if(typeof expression === 'number') return expression;
		if(typeof expression !== 'string' || !expression.trim()) return current[axis];
		try { return evaluateNumericExpression(expression, variables); } catch (_error) { return current[axis]; }
	};
	object3D[property].set(evaluateAxis('x'), evaluateAxis('y'), evaluateAxis('z'));
}

function resolveLoopedProgress(state, animation, deltaSeconds){
	state.elapsed += deltaSeconds * 1000;
	const delay = Math.max(0, Number(animation.delay) || 0);
	if(state.elapsed < delay) return null;
	const duration = Math.max(1, Number(animation.duration) || 1000);
	const elapsed = state.elapsed - delay;
	const cycle = Math.floor(elapsed / duration);
	const repeat = animation.repeat === true || animation.repeat === 'infinite'
		? Infinity
		: Math.max(0, Math.floor(Number(animation.repeat) || 0));
	const finished = Number.isFinite(repeat) && cycle > repeat;
	let progress = finished ? 1 : (elapsed % duration) / duration;
	if(elapsed > 0 && elapsed % duration === 0) progress = 1;
	if(animation.yoyo === true && (finished ? repeat : cycle) % 2 === 1) progress = 1 - progress;
	return Math.max(0, Math.min(1, progress));
}

function applyPathAnimation(object3D, animation, deltaSeconds, index){
	const state = getObjectAnimationState(object3D, animation, index);
	if(!state.curve){
		state.curve = createCurveFromDescriptor(animation.path ?? animation.curve ?? animation, THREE);
	}
	if(!state.curve) return;
	const progress = resolveLoopedProgress(state, animation, deltaSeconds);
	if(progress === null) return;
	const point = animation.spaced === false ? state.curve.getPoint(progress) : state.curve.getPointAt(progress);
	object3D.position.copy(point);
	if(animation.lookAhead === true){
		const lookProgress = Math.min(1, progress + Math.max(0.0001, Number(animation.lookAheadStep) || 0.002));
		const target = animation.spaced === false ? state.curve.getPoint(lookProgress) : state.curve.getPointAt(lookProgress);
		object3D.lookAt(target);
	}
}

function resolveMorphIndex(object3D, target){
	if(Number.isInteger(target)) return target;
	if(typeof target === 'string' && object3D.morphTargetDictionary && Object.hasOwn(object3D.morphTargetDictionary, target)){
		return object3D.morphTargetDictionary[target];
	}
	return -1;
}

function applyMorphAnimation(object3D, animation, deltaSeconds, index){
	const state = getObjectAnimationState(object3D, animation, index);
	const progress = resolveLoopedProgress(state, animation, deltaSeconds);
	if(progress === null) return;
	const from = Number.isFinite(Number(animation.from)) ? Number(animation.from) : 0;
	const to = Number.isFinite(Number(animation.to ?? animation.value)) ? Number(animation.to ?? animation.value) : 1;
	const target = animation.target ?? animation.morph ?? animation.name;
	object3D.traverse((candidate) => {
		if(!Array.isArray(candidate.morphTargetInfluences)) return;
		if(animation.mesh && animation.mesh !== candidate.name && animation.mesh !== candidate.uuid) return;
		const morphIndex = resolveMorphIndex(candidate, target);
		if(morphIndex < 0 || morphIndex >= candidate.morphTargetInfluences.length) return;
		candidate.morphTargetInfluences[morphIndex] = from + (to - from) * progress;
	});
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
		} else if('transform' === animation.type || 'tween' === animation.type){
			applyTransformAnimation(currObj, animation, deltaSeconds, i);
		} else if('expression' === animation.type){
			applyExpressionAnimation(currObj, animation, deltaSeconds, i);
		} else if('path' === animation.type){
			applyPathAnimation(currObj, animation, deltaSeconds, i);
		} else if('morph' === animation.type){
			applyMorphAnimation(currObj, animation, deltaSeconds, i);
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
	updatePointsMotion(safeDeltaSeconds, scene);
	updateParticleCpuSimulation(safeDeltaSeconds, scene);
	updateParticleSimulationExtensions(safeDeltaSeconds, scene);
	updateParticleGpuCompute(safeDeltaSeconds, scene);
	updatePlaneScrollMotion(safeDeltaSeconds, scene);
	updateShaderMotion(safeDeltaSeconds, animCtx);
	updateEngineTweens(undefined, scene);
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
