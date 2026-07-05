import * as THREE from 'three';
import { log } from "../util/logger.js";
import { createControlsFromDescriptor } from '../builder/controlsBuilder.js';
import { createRenderLoop } from './frameLoopHandler.js';
import {
  createCameraFromDescriptor,
  applyCameraOrientation
} from '../util/cameraFactory.js';
import {
	applySceneBackdropFromHints,
	disposeThreeJsonSceneBackdrop,
	sceneConfigNeedsAsyncBackdrop
} from './sceneBackdropResolver.js';

/**
 * One-shot scene runtime assembly: Scene, Camera, WebGLRenderer, OrbitControls, lights, and render loop.
 */

/** @param {object|null} source @param {string} key @param {*} defaultValue */
function getValue(source, key, defaultValue){
	return source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : defaultValue;
}

function toColor(value, defaultValue){
	return new THREE.Color(value || defaultValue);
}

function toVector3(value, defaultValue = {x: 0, y: 0, z: 0}){
	return {
		x: getValue(value, 'x', defaultValue.x),
		y: getValue(value, 'y', defaultValue.y),
		z: getValue(value, 'z', defaultValue.z)
	};
}

function createScene(sceneConfig = {}){
	const scene = new THREE.Scene();
	const bg = sceneConfig.background;
	if (typeof bg === 'string' && bg) {
		scene.background = toColor(bg, 0x000000);
	} else if (bg && typeof bg === 'object' && String(bg.type || '').trim().toLowerCase() === 'color' && bg.value != null && bg.value !== '') {
		scene.background = toColor(bg.value, 0x000000);
	}
	return scene;
}

function createCamera(cameraConfig = {}, width, height){
	return createCameraFromDescriptor(cameraConfig, width, height);
}

function createRenderer(canvas, rendererConfig = {}, width, height){
	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: getValue(rendererConfig, 'antialias', true),
		precision: rendererConfig.precision,
		preserveDrawingBuffer: rendererConfig.preserveDrawingBuffer,
		stencil: rendererConfig.stencil,
		alpha: rendererConfig.alpha
	});
	if (THREE.SRGBColorSpace !== undefined) {
		renderer.outputColorSpace = THREE.SRGBColorSpace;
	}
	if(rendererConfig.shadowMapEnabled){
		renderer.shadowMap.enabled = true;
	}
	renderer.setSize(width, height);
	if(Number.isFinite(rendererConfig.clearAlpha)){
		renderer.setClearAlpha(rendererConfig.clearAlpha);
	}
	renderer.setPixelRatio(window.devicePixelRatio * getValue(rendererConfig, 'ratioRate', 1));
	return renderer;
}

function createControls(camera, canvas, controlsConfig = {}, scene = null){
	return createControlsFromDescriptor(camera, canvas, controlsConfig, { scene });
}

function createLight(lightConfig){
	if(!lightConfig){
		return null;
	}
	if(lightConfig.type === 'ambient'){
		return new THREE.AmbientLight(
			lightConfig.color || 0xffffff,
			getValue(lightConfig, 'intensity', 1)
		);
	}
	if(lightConfig.type === 'directional'){
		const light = new THREE.DirectionalLight(
			lightConfig.color || 0xffffff,
			getValue(lightConfig, 'intensity', 1)
		);
		const position = toVector3(lightConfig.position, {x: 0, y: 1, z: 0});
		light.position.set(position.x, position.y, position.z);
		return light;
	}
	return null;
}

function addLights(scene, lightsConfig = []){
	for(let i = 0; i < lightsConfig.length; i++){
		const light = createLight(lightsConfig[i]);
		if(light){
			scene.add(light);
		}
	}
}

function buildRenderLoopConfig(config = {}){
	return {
		...config.renderer,
		...config.renderLoop
	};
}

/**
 * Create a full runtime from config to drive sample pages (includes dispose).
 * @param {object} [options]
 * @param {HTMLCanvasElement} options.canvas
 * @param {object} [options.config] canvasWidth/Height, scene, camera, renderer, controls, lights, renderLoop, etc.
 * @param {*} [options.composer] Post-processing Composer; render loop uses it when provided
 * @param {(now:number)=>void} [options.beforeFrame]
 * @param {(now:number)=>void} [options.beforeRender]
 * @param {(now:number)=>void} [options.afterRender]
 * @returns {{ scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, controls, renderLoop, setComposer: Function, start: Function, stop: Function, resize: Function, dispose: Function }}
 */
function createSceneRuntime(options = {}){
	const canvas = options.canvas;
	const config = options.config || {};
	const width = getValue(config, 'canvasWidth', window.innerWidth);
	const height = getValue(config, 'canvasHeight', window.innerHeight);
	const scene = createScene(config.scene);
	const camera = createCamera(config.camera, width, height);
	const renderer = createRenderer(canvas, config.renderer, width, height);
	const controls = createControls(camera, canvas, config.controls, scene);
	if (config.camera && typeof config.camera === 'object') {
		applyCameraOrientation(camera, config.camera);
	}
	addLights(scene, config.lights);
	const renderLoop = createRenderLoop({
		scene,
		camera,
		renderer,
		controls,
		composer: options.composer,
		config: buildRenderLoopConfig(config),
		beforeFrame: options.beforeFrame,
		beforeRender: options.beforeRender,
		afterRender: options.afterRender
	});

	const innerDispose = () => {
		renderLoop.stop();
		controls?.dispose?.();
		renderer.dispose();
	};

	return {
		scene,
		camera,
		renderer,
		controls,
		renderLoop,
		setComposer: composer => renderLoop.setComposer(composer),
		start: () => renderLoop.start(),
		stop: () => renderLoop.stop(),
		resize: size => renderLoop.resize(size),
		dispose: () => {
			disposeThreeJsonSceneBackdrop(scene);
			innerDispose();
		}
	};
}

/**
 * Same as {@link createSceneRuntime}, but when `scene.background` / `scene.environment` contain declarative values
 * that need async loading, awaits resource resolution after `renderer` is ready (see `sceneBackdropResolver.js`).
 * @param {object} [options]
 * @param {HTMLCanvasElement} options.canvas
 * @param {object} [options.config]
 * @returns {Promise<ReturnType<typeof createSceneRuntime>>}
 */
async function createSceneRuntimeAsync(options = {}){
	const config = options.config || {};
	const sceneCfg = config.scene && typeof config.scene === 'object' ? { ...config.scene } : {};
	const stripAsyncFields = (cfg) => {
		if (!sceneConfigNeedsAsyncBackdrop(cfg)) {
			return cfg;
		}
		const next = { ...cfg };
		delete next.background;
		delete next.environment;
		return next;
	};
	const strippedScene = stripAsyncFields(sceneCfg);

	const runtime = createSceneRuntime({
		...options,
		config: { ...config, scene: strippedScene }
	});

	if (sceneConfigNeedsAsyncBackdrop(sceneCfg) && runtime.renderer) {
		await applySceneBackdropFromHints(runtime.scene, sceneCfg, runtime.renderer, {});
	} else if (sceneConfigNeedsAsyncBackdrop(sceneCfg) && !runtime.renderer) {
		log.warn('createSceneRuntimeAsync: missing WebGLRenderer; cannot load typed background or environment');
	}

	return runtime;
}

export {
	createSceneRuntime,
	createSceneRuntimeAsync
};
