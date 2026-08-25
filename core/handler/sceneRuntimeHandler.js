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
import { attachRuntimeContext, detachRuntimeContext, isRuntimeContext } from '../runtime/runtimeContext.js';
import {
	applyRendererDescriptor,
	buildWebGLRendererConstructorOptions
} from './rendererConfig.js';
import {
	containsRectAreaLightDescriptor,
	createLightBundleFromDescriptor,
	ensureRectAreaLightSupport
} from '../builder/lightFactory.js';
import { createRendererFromRegisteredBackend } from './rendererBackendRegistry.js';

/**
 * One-shot scene runtime assembly: Scene, Camera, WebGLRenderer, OrbitControls, lights, and render loop.
 */

const RECT_AREA_LIGHT_READY = Symbol("threeJsonRectAreaLightReady");

/** @param {object|null} source @param {string} key @param {*} defaultValue */
function getValue(source, key, defaultValue){
	return source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : defaultValue;
}

function toColor(value, defaultValue){
	return new THREE.Color(value || defaultValue);
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
	const renderer = new THREE.WebGLRenderer(
		buildWebGLRendererConstructorOptions(canvas, rendererConfig)
	);
	applyRendererDescriptor(renderer, rendererConfig);
	// updateStyle=false: the host owns the canvas' responsive CSS sizing (width:100%/height:100%).
	// Letting WebGLRenderer write an inline pixel width/height here bakes in whatever size the
	// canvas happened to have at scene-load time; later resizes that correctly pass
	// updateStyle:false (e.g. the editor's Code-mode PiP) only skip touching style, they don't
	// clear a stale one, so the canvas would stay pinned to its load-time size forever and just
	// get clipped by a shrunk container instead of actually shrinking.
	renderer.setSize(width, height, false);
	if(Number.isFinite(rendererConfig.clearAlpha)){
		renderer.setClearAlpha(rendererConfig.clearAlpha);
	}
	const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
	renderer.setPixelRatio(devicePixelRatio * getValue(rendererConfig, 'ratioRate', 1));
	return renderer;
}

function createControls(camera, canvas, controlsConfig = {}, scene = null){
	return createControlsFromDescriptor(camera, canvas, controlsConfig, { scene });
}

function createLight(lightConfig){
	const bundle = createLightBundleFromDescriptor(lightConfig || {});
	if (bundle.light && bundle.attachments.length > 0) {
		bundle.light.userData.__threeJsonLightAttachments = bundle.attachments;
	}
	return bundle.light;
}

function addLights(scene, lightsConfig = []){
	for(let i = 0; i < lightsConfig.length; i++){
		const light = createLight(lightsConfig[i]);
		if(light){
			scene.add(light);
			const attachments = light.userData?.__threeJsonLightAttachments || [];
			for (const attachment of attachments) {
				scene.add(attachment);
			}
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
 * @param {import('../runtime/runtimeContext.js').RuntimeContext} [options.runtimeContext] Optional caller-owned per-scene runtime state.
 * @param {boolean} [options.disposeRuntimeContext=false] Dispose the supplied runtime context with this runtime.
 * @returns {{ scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, controls, renderLoop, runtimeContext: object|null, setComposer: Function, start: Function, stop: Function, resize: Function, invalidate: Function, renderOnce: Function, dispose: Function }}
 */
function assembleSceneRuntime(options, prepared){
	const canvas = options.canvas;
	const config = options.config || {};
	const fallbackWidth = typeof window !== 'undefined' ? window.innerWidth : 1;
	const fallbackHeight = typeof window !== 'undefined' ? window.innerHeight : 1;
	const width = prepared?.width ?? getValue(config, 'canvasWidth', fallbackWidth);
	const height = prepared?.height ?? getValue(config, 'canvasHeight', fallbackHeight);
	const scene = prepared?.scene ?? createScene(config.scene);
	const camera = prepared?.camera ?? createCamera(config.camera, width, height);
	const renderer = prepared?.renderer;
	let activeComposer = prepared?.composer ?? options.composer ?? null;
	const controls = createControls(camera, canvas, config.controls, scene);
	const runtimeContext = isRuntimeContext(options.runtimeContext) ? options.runtimeContext : null;
	if(runtimeContext){
		attachRuntimeContext(scene, runtimeContext);
	}
	if (config.camera && typeof config.camera === 'object') {
		applyCameraOrientation(camera, config.camera);
	}
	addLights(scene, config.lights);
	const renderLoop = createRenderLoop({
		scene,
		camera,
		renderer,
		controls,
		composer: activeComposer,
		config: buildRenderLoopConfig(config),
		beforeFrame: options.beforeFrame,
		beforeRender: options.beforeRender,
		afterRender: options.afterRender
	});

	const innerDispose = () => {
		renderLoop.stop();
		controls?.dispose?.();
		activeComposer?.dispose?.();
		renderer?.dispose?.();
		if(runtimeContext){
			detachRuntimeContext(scene);
			if(options.disposeRuntimeContext === true){
				runtimeContext.dispose();
			}
		}
	};

	const runtime = {
		scene,
		camera,
		renderer,
		composer: activeComposer,
		controls,
		renderLoop,
		runtimeContext,
		setComposer: composer => {
			activeComposer = composer;
			runtime.composer = composer;
			renderLoop.setComposer(composer);
		},
		start: () => renderLoop.start(),
		stop: () => renderLoop.stop(),
		resize: size => renderLoop.resize(size),
		invalidate: () => renderLoop.invalidate(),
		renderOnce: now => renderLoop.renderOnce(now),
		dispose: () => {
			disposeThreeJsonSceneBackdrop(scene);
			innerDispose();
		}
	};
	return runtime;
}

function createSceneRuntime(options = {}){
	const config = options.config || {};
	const backend = String(config.renderer?.backend || 'webgl').trim().toLowerCase();
	if (backend !== 'webgl') {
		const error = new Error(`Renderer backend "${backend}" requires createSceneRuntimeAsync()`);
		error.code = 'E_RENDERER_ASYNC_REQUIRED';
		error.backend = backend;
		throw error;
	}
	if (containsRectAreaLightDescriptor(config.lights) && options[RECT_AREA_LIGHT_READY] !== true) {
		const error = new Error('RectAreaLight requires createSceneRuntimeAsync() so renderer LTC data can be initialized lazily');
		error.code = 'E_RECT_AREA_LIGHT_ASYNC_REQUIRED';
		throw error;
	}
	const fallbackWidth = typeof window !== 'undefined' ? window.innerWidth : 1;
	const fallbackHeight = typeof window !== 'undefined' ? window.innerHeight : 1;
	const width = getValue(config, 'canvasWidth', fallbackWidth);
	const height = getValue(config, 'canvasHeight', fallbackHeight);
	return assembleSceneRuntime(options, {
		width,
		height,
		scene: createScene(config.scene),
		camera: createCamera(config.camera, width, height),
		renderer: createRenderer(options.canvas, config.renderer, width, height),
		composer: options.composer ?? null
	});
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
	const backend = String(config.renderer?.backend || 'webgl').trim().toLowerCase();
	await ensureRectAreaLightSupport(config.lights, backend);
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

	let runtime;
	if (backend === 'webgl') {
		runtime = createSceneRuntime({
			...options,
			[RECT_AREA_LIGHT_READY]: true,
			config: { ...config, scene: strippedScene }
		});
	} else {
		const fallbackWidth = typeof window !== 'undefined' ? window.innerWidth : 1;
		const fallbackHeight = typeof window !== 'undefined' ? window.innerHeight : 1;
		const width = getValue(config, 'canvasWidth', fallbackWidth);
		const height = getValue(config, 'canvasHeight', fallbackHeight);
		const scene = createScene(strippedScene);
		const camera = createCamera(config.camera, width, height);
		const preparedRenderer = await createRendererFromRegisteredBackend(backend, {
			canvas: options.canvas,
			descriptor: config.renderer || {},
			config,
			width,
			height,
			scene,
			camera
		});
		runtime = assembleSceneRuntime({
			...options,
			config: { ...config, scene: strippedScene },
			composer: options.composer ?? preparedRenderer.composer ?? null
		}, {
			width,
			height,
			scene,
			camera,
			renderer: preparedRenderer.renderer,
			composer: options.composer ?? preparedRenderer.composer ?? null
		});
	}

	if (sceneConfigNeedsAsyncBackdrop(sceneCfg) && runtime.renderer) {
		await applySceneBackdropFromHints(runtime.scene, sceneCfg, runtime.renderer, {});
	} else if (sceneConfigNeedsAsyncBackdrop(sceneCfg) && !runtime.renderer) {
		log.warn('createSceneRuntimeAsync: missing renderer; cannot load typed background or environment');
	}

	return runtime;
}

export {
	createSceneRuntime,
	createSceneRuntimeAsync
};
