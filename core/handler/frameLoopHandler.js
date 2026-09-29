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
	const width = Math.max(0, Math.round(Number(canvas.clientWidth) || 0));
	const height = Math.max(0, Math.round(Number(canvas.clientHeight) || 0));
	if(width < 1 || height < 1){
		return false;
	}
	// canvas.width/height are drawing-buffer pixels, while clientWidth/clientHeight
	// are CSS pixels. Comparing them directly makes every frame look stale on a
	// high-DPI display and can leave a camera with an intermediate layout aspect.
	const pixelRatio = Math.max(0.01, Number(renderer.getPixelRatio?.()) || 1);
	const displayWidth = Math.max(1, Math.floor(width * pixelRatio));
	const displayHeight = Math.max(1, Math.floor(height * pixelRatio));
	const needResize = canvas.width !== displayWidth || canvas.height !== displayHeight;
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
		composer.render(config.frameDeltaSeconds);
		return;
	}
	renderer.render(scene, camera);
}

function resolveRequestFrame(requestFrame){
	if(typeof requestFrame === 'function'){
		return requestFrame;
	}
	if(typeof globalThis.requestAnimationFrame === 'function'){
		return globalThis.requestAnimationFrame.bind(globalThis);
	}
	return callback => globalThis.setTimeout(() => callback(Date.now()), 16);
}

function resolveCancelFrame(cancelFrame){
	if(typeof cancelFrame === 'function'){
		return cancelFrame;
	}
	if(typeof globalThis.cancelAnimationFrame === 'function'){
		return globalThis.cancelAnimationFrame.bind(globalThis);
	}
	return handle => globalThis.clearTimeout(handle);
}

function resolveScheduleMode(config){
	return getConfigValue(config, 'scheduleMode', 'continuous') === 'demand'
		? 'demand'
		: 'continuous';
}

/**
 * Create a start/stop render loop controller.
 * @param {object} [options]
 * @param {THREE.Scene} options.scene
 * @param {THREE.Camera} options.camera
 * @param {THREE.WebGLRenderer} options.renderer
 * @param {*} [options.controls] May include optional `update()`
 * @param {*} [options.composer] EffectComposer, etc.
 * @param {object} [options.config] fps, lowFps, autoResize, firstAutoResize, ratioRate, updateAnimations, renderMode, scheduleMode (`continuous` default or opt-in `demand`)
 * @param {(now:number)=>void} [options.beforeFrame]
 * @param {(now:number)=>void} [options.beforeRender]
 * @param {(now:number)=>void} [options.afterRender]
 * @param {(callback:(now:number)=>void)=>unknown} [options.requestFrame] Test/host scheduler override
 * @param {(handle:unknown)=>void} [options.cancelFrame] Test/host scheduler override
 * @returns {{ start: Function, stop: Function, resize: Function, setComposer: Function, invalidate: Function, renderOnce: Function, isRunning: Function, getAnimationFrameId: Function }}
 */
function createRenderLoop(options = {}){
	const { scene, camera, renderer, controls, composer, config = {}, beforeFrame, beforeRender, afterRender } = options;
	const requestFrame = resolveRequestFrame(options.requestFrame);
	const cancelFrame = resolveCancelFrame(options.cancelFrame);
	let activeComposer = composer;
	let animationFrameId = null;
	let running = false;
	let lastRenderTime = 0;
	let lastControlsStepTime = null;
	let fpsInterval = 1000 / (getConfigValue(config, 'fps', DEFAULT_FPS) || DEFAULT_FPS);
	let controlsChangeListener = null;
	let timeDriver = null;
	let lastDriverTime = null;

	// Manual export renders evaluated state without advancing any wall clocks.
	function renderCurrentFrame(frame = {}){
		if (frame.autoResize === true) autoResize();
		if (scene && camera) syncViewModelsToCamera(scene, camera);
		renderFrame(renderer, scene, camera, activeComposer, { ...config, frameDeltaSeconds: frame.deltaSeconds ?? 0 });
		return true;
	}

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

	function renderOnce(now = (typeof performance !== 'undefined' ? performance.now() : Date.now())){
		if(!running){
			return false;
		}
		beforeFrame?.(now);
		if (timeDriver) {
			const delta = lastDriverTime === null ? 0 : Math.max(0, (now - lastDriverTime) / 1000);
			lastDriverTime = now;
			timeDriver.advance(delta);
		} else if(scene && getConfigValue(config, 'updateAnimations', true)){
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
		if (controls && !timeDriver?.controlsLocked) {
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
			return false;
		}
		beforeRender?.(now);
		renderFrame(renderer, scene, camera, activeComposer, config);
		autoResize();
		afterRender?.(now);
		return true;
	}

	function scheduleNextFrame(){
		if(!running || animationFrameId !== null){
			return false;
		}
		animationFrameId = requestFrame(step);
		return true;
	}

	function step(now){
		animationFrameId = null;
		if(!running){
			return;
		}
		if(resolveScheduleMode(config) === 'continuous'){
			scheduleNextFrame();
		}
		renderOnce(now);
	}

	function resize(size = {}){
		if(!renderer || !camera){
			return;
		}
		const width = Math.max(1, Math.round(Number(size.width) || window.innerWidth || 1));
		const height = Math.max(1, Math.round(Number(size.height) || window.innerHeight || 1));
		const updateStyle = size.updateStyle !== false;
		const pixelRatio = Math.max(
			0.01,
			(Number(window.devicePixelRatio) || 1) * getConfigValue(config, 'ratioRate', 1)
		);
		// Set DPR first so this resize produces the final drawing-buffer dimensions.
		renderer.setPixelRatio(pixelRatio);
		renderer.setSize(width, height, updateStyle);
		if(activeComposer && typeof activeComposer.setSize === 'function'){
			activeComposer.setSize(width, height);
		}
		if (camera.isOrthographicCamera) {
			resizeOrthographicCameraToAspect(camera, width, height);
		} else if (Object.prototype.hasOwnProperty.call(camera, 'aspect')) {
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
		}
		invalidate();
	}

	function setComposer(nextComposer){
		activeComposer = nextComposer;
		invalidate();
	}

	function invalidate(){
		if(!running){
			return false;
		}
		if(resolveScheduleMode(config) === 'continuous'){
			return false;
		}
		return scheduleNextFrame();
	}

	function bindDemandControls(){
		if(resolveScheduleMode(config) !== 'demand' || !controls || typeof controls.addEventListener !== 'function' || controlsChangeListener){
			return;
		}
		controlsChangeListener = () => invalidate();
		controls.addEventListener('change', controlsChangeListener);
	}

	function unbindDemandControls(){
		if(!controlsChangeListener || !controls || typeof controls.removeEventListener !== 'function'){
			controlsChangeListener = null;
			return;
		}
		controls.removeEventListener('change', controlsChangeListener);
		controlsChangeListener = null;
	}

	function start(){
		if(running){
			return;
		}
		running = true;
		lastDriverTime = null;
		lastRenderTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
		bindDemandControls();
		scheduleNextFrame();
	}

	function stop(){
		running = false;
		lastDriverTime = null;
		unbindDemandControls();
		if(animationFrameId !== null){
			cancelFrame(animationFrameId);
			animationFrameId = null;
		}
	}

	return {
		start,
		stop,
		resize,
		setComposer,
		invalidate,
		renderOnce,
		renderCurrentFrame,
		setTimeDriver(driver) { timeDriver = driver; lastDriverTime = null; },
		isRunning: () => running,
		getAnimationFrameId: () => animationFrameId
	};
}

export {
	createRenderLoop,
	resizeRendererToDisplaySize,
	renderFrame
}
