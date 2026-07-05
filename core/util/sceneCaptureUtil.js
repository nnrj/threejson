/**
 * Scene screenshot and screen-recording utilities (browser only).
 *
 * Screenshot: `captureSceneFrame` — on-screen path (includes composer) + offscreen high-res path; returns `Promise<CaptureFrameResult>`
 * Recording: `recordSceneVideo` — MediaRecorder + captureStream; returns recorder controller `{ stop, pause, resume, mimeType, stream }`
 * Unified entry: `captureScene` — dispatches to the two methods above based on `options.mode`
 *
 * Requirements:
 * - Browser environment only; not available in Node.
 * - Screenshot (on-screen path): pass `preserveDrawingBuffer: true` when creating the renderer,
 *   otherwise the canvas may be cleared after WebGL double-buffer swap.
 * - Recording: browser must support `HTMLCanvasElement.captureStream` and `MediaRecorder`.
 */

import { renderFrame } from '../handler/frameLoopHandler.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * @param {*} v
 * @param {*} fallback
 */
function valueOr(v, fallback) {
	return v !== undefined && v !== null ? v : fallback;
}

/**
 * Render one frame using the same logic as frameLoopHandler (reuses exported renderFrame).
 * @param {object} ctx
 * @param {object} [renderConfig]
 */
function renderOneFrame(ctx, renderConfig) {
	const { scene, camera, renderer, composer } = ctx;
	if (!renderer || !scene || !camera) {
		throw new Error('[sceneCaptureUtil] ctx is missing required renderer / scene / camera');
	}
	renderFrame(renderer, scene, camera, valueOr(composer, null), renderConfig || {});
}

/**
 * Pick the first browser-supported mimeType, or return null if none match.
 * @param {string[]} candidates
 * @returns {string|null}
 */
function pickSupportedMimeType(candidates) {
	if (typeof MediaRecorder === 'undefined') return null;
	for (const t of candidates) {
		if (MediaRecorder.isTypeSupported(t)) return t;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------

/**
 * @typedef {object} CaptureFrameOptions
 * @property {'blob'|'dataUrl'} [as='blob']
 *   Return format: `'blob'` returns a `Blob`; `'dataUrl'` also includes a `dataUrl` string.
 * @property {string} [mimeType='image/png']
 *   Image MIME type (`image/png`, `image/jpeg`, `image/webp`).
 * @property {number} [quality]
 *   JPEG/WebP quality, 0–1; ignored for `image/png`.
 * @property {boolean} [forceRender=true]
 *   Whether to explicitly render one frame before capture (ensures buffer is the latest frame).
 * @property {object} [renderConfig]
 *   Config passed to renderFrame (e.g. renderMode); defaults to main loop behavior.
 * @property {boolean} [offscreen=false]
 *   Whether to use the offscreen high-resolution path (separate WebGLRenderTarget + readRenderTargetPixels).
 * @property {number} [offscreenWidth]
 *   Target width for the offscreen path; defaults to the renderer's current width.
 * @property {number} [offscreenHeight]
 *   Target height for the offscreen path; defaults to the renderer's current height.
 * @property {number} [offscreenMaxPixels=8192*8192]
 *   Maximum pixel count (width × height) allowed for the offscreen path; scaled down if exceeded.
 */

/**
 * @typedef {object} CaptureFrameResult
 * @property {Blob} blob            PNG/JPEG/WebP image Blob
 * @property {string|null} dataUrl  Present only when `as === 'dataUrl'`; otherwise `null`
 * @property {number} width         Screenshot pixel width
 * @property {number} height        Screenshot pixel height
 * @property {string} mimeType      MIME type actually used
 * @property {'screen'|'offscreen'} path  Which capture path was used
 */

/**
 * Capture the current scene frame (on-screen path or offscreen high-resolution path).
 *
 * @param {object} ctx         Scene runtime context (`{ renderer, scene, camera, composer? }`)
 * @param {CaptureFrameOptions} [options]
 * @returns {Promise<CaptureFrameResult>}
 */
async function captureSceneFrame(ctx, options = {}) {
	const {
		as = 'blob',
		mimeType = 'image/png',
		quality,
		forceRender = true,
		renderConfig,
		offscreen = false,
		offscreenWidth,
		offscreenHeight,
		offscreenMaxPixels = 8192 * 8192,
	} = options;

	if (!ctx || !ctx.renderer) {
		throw new Error('[captureSceneFrame] ctx.renderer does not exist');
	}

	if (offscreen) {
		return captureSceneFrameOffscreen(ctx, {
			mimeType,
			quality,
			as,
			renderConfig,
			offscreenWidth,
			offscreenHeight,
			offscreenMaxPixels,
		});
	}

	// --- On-screen path ---
	const { renderer } = ctx;
	const canvas = renderer.domElement;

	if (forceRender) {
		renderOneFrame(ctx, renderConfig);
	}

	const blob = await new Promise((resolve, reject) => {
		canvas.toBlob(
			(b) => {
				if (b) resolve(b);
				else reject(new Error('[captureSceneFrame] canvas.toBlob returned null (preserveDrawingBuffer may be disabled)'));
			},
			mimeType,
			quality
		);
	});

	const dataUrl = as === 'dataUrl' ? await blobToDataUrl(blob) : null;

	return {
		blob,
		dataUrl,
		width: canvas.width,
		height: canvas.height,
		mimeType,
		path: 'screen',
	};
}

/**
 * Offscreen high-resolution screenshot (separate WebGLRenderTarget + readRenderTargetPixels + OffscreenCanvas encode).
 * @param {object} ctx
 * @param {object} opts
 * @returns {Promise<CaptureFrameResult>}
 */
async function captureSceneFrameOffscreen(ctx, opts) {
	const { renderer, scene, camera, composer } = ctx;
	if (!renderer || !scene || !camera) {
		throw new Error('[captureSceneFrameOffscreen] ctx is missing required fields');
	}

	// Dynamic THREE import (avoids errors on the Node side)
	const THREE = await import('three');

	const srcCanvas = renderer.domElement;
	let targetW = valueOr(opts.offscreenWidth, srcCanvas.width);
	let targetH = valueOr(opts.offscreenHeight, srcCanvas.height);
	const maxPx = valueOr(opts.offscreenMaxPixels, 8192 * 8192);

	// Scale down to pixel limit
	if (targetW * targetH > maxPx) {
		const scale = Math.sqrt(maxPx / (targetW * targetH));
		targetW = Math.max(1, Math.floor(targetW * scale));
		targetH = Math.max(1, Math.floor(targetH * scale));
	}

	const mimeType = valueOr(opts.mimeType, 'image/png');
	const quality = opts.quality;
	const as = valueOr(opts.as, 'blob');

	const renderTarget = new THREE.WebGLRenderTarget(targetW, targetH, {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		format: THREE.RGBAFormat,
	});

	// Preserve current state
	const prevTarget = renderer.getRenderTarget();
	const prevSize = renderer.getSize(new THREE.Vector2());
	const prevAspect = camera.aspect;

	let blob;
	try {
		renderer.setRenderTarget(renderTarget);
		renderer.setSize(targetW, targetH, false);

		if (camera.isPerspectiveCamera || camera.isOrthographicCamera) {
			camera.aspect = targetW / targetH;
			camera.updateProjectionMatrix();
		}

		// Offscreen path skips composer (passes hold screen-sized buffers); render directly
		renderer.render(scene, camera);

		const pixels = new Uint8Array(targetW * targetH * 4);
		renderer.readRenderTargetPixels(renderTarget, 0, 0, targetW, targetH, pixels);

		blob = await rgbaToBlob(pixels, targetW, targetH, mimeType, quality);
	} finally {
		// Restore renderer state regardless of success or failure
		renderer.setRenderTarget(prevTarget);
		renderer.setSize(prevSize.x, prevSize.y, false);
		if (camera.isPerspectiveCamera || camera.isOrthographicCamera) {
			camera.aspect = prevAspect;
			camera.updateProjectionMatrix();
		}
		renderTarget.dispose();
	}

	const dataUrl = as === 'dataUrl' ? await blobToDataUrl(blob) : null;

	return {
		blob,
		dataUrl,
		width: targetW,
		height: targetH,
		mimeType,
		path: 'offscreen',
	};
}

/**
 * Flip RGBA Uint8Array on the Y axis and encode as a Blob.
 * WebGL readPixels origin is bottom-left; flip to top-left image origin.
 * @param {Uint8Array} pixels
 * @param {number} w
 * @param {number} h
 * @param {string} mimeType
 * @param {number} [quality]
 * @returns {Promise<Blob>}
 */
function rgbaToBlob(pixels, w, h, mimeType, quality) {
	// Prefer OffscreenCanvas (Web Worker friendly, non-blocking on main thread)
	const CanvasImpl = typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : null;
	const canvas = CanvasImpl ? new CanvasImpl(w, h) : document.createElement('canvas');
	if (!CanvasImpl) {
		canvas.width = w;
		canvas.height = h;
	}
	const ctx2d = canvas.getContext('2d');
	const imageData = ctx2d.createImageData(w, h);

	// Flip Y
	const rowBytes = w * 4;
	for (let row = 0; row < h; row++) {
		const srcRow = h - 1 - row;
		imageData.data.set(
			pixels.subarray(srcRow * rowBytes, srcRow * rowBytes + rowBytes),
			row * rowBytes
		);
	}
	ctx2d.putImageData(imageData, 0, 0);

	if (CanvasImpl) {
		return canvas.convertToBlob({ type: mimeType, quality });
	}
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error('[sceneCaptureUtil] canvas.toBlob returned null'))),
			mimeType,
			quality
		);
	});
}

/**
 * Convert Blob to DataURL.
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function blobToDataUrl(blob) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(/** @type {string} */ (reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

// ---------------------------------------------------------------------------
// Screen recording
// ---------------------------------------------------------------------------

const DEFAULT_VIDEO_MIME_CANDIDATES = [
	'video/webm;codecs=vp9',
	'video/webm;codecs=vp8',
	'video/webm',
];

/**
 * @typedef {object} RecordSceneVideoOptions
 * @property {number} [fps=30]             captureStream frame rate
 * @property {string} [mimeType]           Recording format (defaults to first browser-supported webm variant)
 * @property {number} [videoBitsPerSecond] Encoding bitrate
 * @property {number} [timeslice]          MediaRecorder.start(timeslice) chunk interval (ms); omit for single blob on stop
 * @property {(chunk: Blob) => void} [onChunk]  Callback for each data chunk (use with timeslice)
 */

/**
 * @typedef {object} VideoRecorder
 * @property {() => Promise<Blob>} stop     Stop recording and return final video Blob
 * @property {() => void} pause            Pause recording (if supported by browser)
 * @property {() => void} resume           Resume recording (if supported by browser)
 * @property {() => boolean} isRecording   Whether recording is active
 * @property {string} mimeType             MIME type actually used
 * @property {MediaStream} stream          Media stream from captureStream
 */

/**
 * Start recording the current scene video.
 * Caller must ensure `renderLoop` is running (otherwise the recording shows a static frame).
 *
 * @param {object} ctx  Scene runtime context (`{ renderer, renderLoop? }`)
 * @param {RecordSceneVideoOptions} [options]
 * @returns {VideoRecorder}
 */
function recordSceneVideo(ctx, options = {}) {
	if (!ctx || !ctx.renderer) {
		throw new Error('[recordSceneVideo] ctx.renderer does not exist');
	}

	const { renderer } = ctx;
	const canvas = renderer.domElement;

	if (typeof canvas.captureStream !== 'function') {
		throw new Error('[recordSceneVideo] current browser does not support HTMLCanvasElement.captureStream');
	}
	if (typeof MediaRecorder === 'undefined') {
		throw new Error('[recordSceneVideo] current browser does not support MediaRecorder');
	}

	const fps = valueOr(options.fps, 30);
	const mimeType = valueOr(
		options.mimeType,
		pickSupportedMimeType(DEFAULT_VIDEO_MIME_CANDIDATES)
	);

	if (!mimeType) {
		throw new Error('[recordSceneVideo] browser does not support any known video mimeType');
	}

	const recorderOpts = { mimeType };
	if (Number.isFinite(options.videoBitsPerSecond)) {
		recorderOpts.videoBitsPerSecond = options.videoBitsPerSecond;
	}

	const stream = canvas.captureStream(fps);
	const recorder = new MediaRecorder(stream, recorderOpts);
	const chunks = [];
	let recording = true;

	recorder.ondataavailable = (e) => {
		if (e.data && e.data.size > 0) {
			chunks.push(e.data);
			options.onChunk?.(e.data);
		}
	};

	if (Number.isFinite(options.timeslice) && options.timeslice > 0) {
		recorder.start(options.timeslice);
	} else {
		recorder.start();
	}

	/** @returns {Promise<Blob>} */
	function stop() {
		if (!recording) {
			return Promise.resolve(new Blob(chunks, { type: mimeType }));
		}
		recording = false;

		return new Promise((resolve, reject) => {
			recorder.onstop = () => {
				const blob = new Blob(chunks, { type: mimeType });
				// Release media stream tracks
				stream.getTracks().forEach((t) => t.stop());
				resolve(blob);
			};
			recorder.onerror = (e) => {
				stream.getTracks().forEach((t) => t.stop());
				reject(e.error || new Error('[recordSceneVideo] MediaRecorder error'));
			};
			try {
				recorder.requestData();
				recorder.stop();
			} catch (err) {
				reject(err);
			}
		});
	}

	function pause() {
		if (recording && recorder.state === 'recording') {
			recorder.pause();
		}
	}

	function resume() {
		if (recording && recorder.state === 'paused') {
			recorder.resume();
		}
	}

	return {
		stop,
		pause,
		resume,
		isRecording: () => recording,
		mimeType,
		stream,
	};
}

// ---------------------------------------------------------------------------
// Unified entry
// ---------------------------------------------------------------------------

/**
 * @typedef {object} CaptureSceneOptions
 * @property {'frame'|'video'} mode  Operation mode: `'frame'` screenshot, `'video'` recording
 * @property {CaptureFrameOptions} [frame]   Screenshot-only options (when `mode === 'frame'`)
 * @property {RecordSceneVideoOptions} [video]  Recording-only options (when `mode === 'video'`)
 * // Convenience top-level properties (lower priority than same-named properties inside frame/video)
 * @property {string} [mimeType]
 * @property {number} [fps]
 * @property {boolean} [offscreen]
 */

/**
 * Unified scene screenshot/recording entry; dispatches by `options.mode`.
 *
 * @param {object} ctx  Scene runtime context
 * @param {CaptureSceneOptions} [options]
 * @returns {Promise<CaptureFrameResult> | VideoRecorder}
 *   When `mode === 'frame'`, returns `Promise<CaptureFrameResult>`;
 *   when `mode === 'video'`, synchronously returns `VideoRecorder` (recording already started).
 */
function captureScene(ctx, options = {}) {
	const mode = valueOr(options.mode, 'frame');

	if (mode === 'video') {
		const videoOpts = {
			fps: options.fps,
			mimeType: options.mimeType,
			...valueOr(options.video, {}),
		};
		return recordSceneVideo(ctx, videoOpts);
	}

	const frameOpts = {
		mimeType: options.mimeType,
		offscreen: options.offscreen,
		...valueOr(options.frame, {}),
	};
	return captureSceneFrame(ctx, frameOpts);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
	captureSceneFrame,
	recordSceneVideo,
	captureScene,
};
