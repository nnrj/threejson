/**
 * Render loop: requestAnimationFrame, EffectComposer or direct WebGLRenderer, optional low FPS, auto canvas resize.
 */
import { computeSceneAnimationDelta, updateSceneAnimations } from './animationHandler.js';
import { updateRegisteredAnimationMixers } from './animationMixerRegistry.js';
import { updateAnimationStateMachines } from './animationStateMachine.js';
import { syncViewModelsToCamera } from './controls/viewModelFollowCamera.js';
import { resizeOrthographicCameraToAspect } from '../util/cameraFactory.js';

const DEFAULT_FPS = 60;

/**
 * Safely read a key from config; returns defaultValue when missing.
 * @param {object} config
 * @param {string} key
 * @param {*} defaultValue
 */
function getConfigValue(config, key, defaultValue){
	return Object.prototype.hasOwnProperty.call(config, key) ? config[key] : defaultValue;
}

/**
 * Resize renderer (and optional composer) and camera.aspect from canvas clientWidth/Height.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Camera} camera
 * @param {import('three/examples/jsm/postprocessing/EffectComposer.js').EffectComposer} [composer]
 * @returns {boolean} Whether the size changed
 */
function resizeRendererToDisplaySize(renderer, camera, composer){
	const canvas = renderer.domElement;
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	const needResize = canvas.width !== width || canvas.height !== height;
	if(needResize){
		renderer.setSize(width, height, false);
		if(composer && typeof composer.setSize === 'function'){
			composer.setSize(width, height);
		}
	}
	if(needResize && camera){
		if (camera.isOrthographicCamera) {
			resizeOrthographicCameraToAspect(camera, width, height);
		} else if (Object.prototype.hasOwnProperty.call(camera, 'aspect')) {
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
		}
	}
	return needResize;
}

/**
 * Render one frame: `composer.render()` or `renderer.render(scene,camera)`.
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {*} composer
 * @param {object} config Includes renderMode: with `'auto'`, uses composer when present
 */
function renderFrame(renderer, scene, camera, composer, config){
	const renderMode = getConfigValue(config, 'renderMode', 'auto');
	if(composer && renderMode !== 'rendererOnly'){
		composer.render();
		return;
	}
	renderer.render(scene, camera);
}

/**
 * Create a start/stop render loop controller.
 * @param {object} [options]
 * @param {THREE.Scene} options.scene
 * @param {THREE.Camera} options.camera
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {*} [options.controls] May include optional `update()`
 * @param {*} [options.composer] EffectComposer, etc.
 * @param {object} [options.config] fps, lowFps, autoResize, firstAutoResize, ratioRate, updateAnimations, renderMode
 * @param {(now:number)=>void} [options.beforeFrame]
 * @param {(now:number)=>void} [options.beforeRender]
 * @param {(now:number)=>void} [options.afterRender]
 * @returns {{ start: Function, stop: Function, resize: Function, setComposer: Function, isRunning: Function, getAnimationFrameId: Function }}
 */
function createRenderLoop(options = {}){
	const { scene, camera, renderer, controls, composer, config = {}, beforeFrame, beforeRender, afterRender } = options;
	let activeComposer = composer;
	let animationFrameId = null;
	let running = false;
	let lastRenderTime = 0;
	let lastControlsStepTime = null;
	let fpsInterval = 1000 / (getConfigValue(config, 'fps', DEFAULT_FPS) || DEFAULT_FPS);

	function shouldRender(now){
		if(!getConfigValue(config, 'lowFps', false)){
			return true;
		}
		const fps = getConfigValue(config, 'fps', DEFAULT_FPS) || DEFAULT_FPS;
		fpsInterval = 1000 / fps;
		const elapsed = now - lastRenderTime;
		if(elapsed <= fpsInterval){
			return false;
		}
		lastRenderTime = now - (elapsed % fpsInterval);
		return true;
	}

	function autoResize(){
		if(!renderer || !camera){
			return;
		}
		const firstAutoResize = getConfigValue(config, 'firstAutoResize', true);
		const autoResizeEnabled = getConfigValue(config, 'autoResize', true);
		if(!firstAutoResize && !autoResizeEnabled){
			return;
		}
		resizeRendererToDisplaySize(renderer, camera, activeComposer);
		config.firstAutoResize = false;
	}

	function step(now){
		if(!running){
			return;
		}
		animationFrameId = requestAnimationFrame(step);
		beforeFrame?.(now);
		if(scene && getConfigValue(config, 'updateAnimations', true)){
			const animOpts = {};
			const md = getConfigValue(config, 'maxDeltaSeconds', undefined);
			if(Number.isFinite(md)){
				animOpts.maxDeltaSeconds = md;
			}
			const animDelta = computeSceneAnimationDelta(scene, undefined, animOpts);
			updateSceneAnimations(scene, animDelta, animOpts);
			updateAnimationStateMachines(scene, animDelta);
			updateRegisteredAnimationMixers(scene, animDelta);
		}
		if (controls) {
			let deltaSec = 0;
			if (lastControlsStepTime !== null && Number.isFinite(now)) {
				deltaSec = Math.min((now - lastControlsStepTime) / 1000, 0.25);
			}
			lastControlsStepTime = now;
			if (controls.threeJsonControlsKind === 'fly') {
				controls.update(deltaSec);
			} else {
				controls.update?.();
			}
		}
		if (scene && camera) {
			syncViewModelsToCamera(scene, camera);
		}
		if(!shouldRender(now)){
			return;
		}
		beforeRender?.(now);
		renderFrame(renderer, scene, camera, activeComposer, config);
		autoResize();
		afterRender?.(now);
	}

	function resize(size = {}){
		if(!renderer || !camera){
			return;
		}
		const width = size.width || window.innerWidth;
		const height = size.height || window.innerHeight;
		renderer.setSize(width, height);
		renderer.setPixelRatio(window.devicePixelRatio * getConfigValue(config, 'ratioRate', 1));
		if(activeComposer && typeof activeComposer.setSize === 'function'){
			activeComposer.setSize(width, height);
		}
		if (camera.isOrthographicCamera) {
			resizeOrthographicCameraToAspect(camera, width, height);
		} else if (Object.prototype.hasOwnProperty.call(camera, 'aspect')) {
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
		}
	}

	function setComposer(nextComposer){
		activeComposer = nextComposer;
	}

	function start(){
		if(running){
			return;
		}
		running = true;
		lastRenderTime = performance.now();
		animationFrameId = requestAnimationFrame(step);
	}

	function stop(){
		running = false;
		if(animationFrameId){
			cancelAnimationFrame(animationFrameId);
			animationFrameId = null;
		}
	}

	return {
		start,
		stop,
		resize,
		setComposer,
		isRunning: () => running,
		getAnimationFrameId: () => animationFrameId
	};
}

export {
	createRenderLoop,
	resizeRendererToDisplaySize,
	renderFrame
}
