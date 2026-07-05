/**
 * Info panel parse and deploy (non-CSS3D): normalize → resolveTexture → buildCarrier → deploy.
 * Carrier `panelBoxType`: box | sprite | plane; content `type`: text | html | img.
 */
import * as THREE from 'three';
import html2canvas from 'html2canvas-pro';

import { applyOpacityToColor, applyOpacityToImageTexture, createStrTextureMultiline } from '../util/textureUtils.js';
import {
	injectOpacityIntoHtmlBackgrounds,
	resolveHtmlOpacity,
	resolveOpacityByPanel
} from './htmlPanelOpacity.js';
import { trackDisposableResource } from '../handler/trackedResourceRegistry.js';
import { setUserDataObjJson } from '../handler/objectDescriptorAttach.js';
import { registerObject } from '../handler/objectRegistry.js';
import { applyObjectVisibility } from '../handler/objectVisibility.js';
import { ensureThreeJsonIdOnRecord } from '../util/util.js';
import { loadingManager } from '../cache/loading.js';
import { INFO_PANEL_DEFAULT_OPACITY } from '../theme/runtimeVisualDefaults.js';
import { applyUiTextureSampling } from '../util/textureSampling.js';
import {
	getActiveEventListenerManager,
	getActiveEventSceneToken
} from '../runtime/eventMechanism/bindEventRuntime.js';
import { wireInfoPanelDismissTriggerForObject } from '../runtime/eventMechanism/wireInfoPanelDismissTriggers.js';

const DEFAULT_INFO_PANEL_NAME = 'infoPanel';
const INFO_PANEL_DEFAULT_FOREGROUND = '#E80000';

const DEFAULT_INFO_PANEL_MAX_INFLIGHT_ASYNC = 4;
let infoPanelMaxInflightAsync = DEFAULT_INFO_PANEL_MAX_INFLIGHT_ASYNC;
let htmlTextureInflight = 0;
const htmlTextureWaitQueue = [];

/**
 * Read html info panel html2canvas concurrency cap from sceneConfig.infoPanel (createJsonScene / deployJsonScene path).
 * @param {object|null|undefined} normalized
 */
export function configureInfoPanelForDeploy(normalized) {
	const infoPanelRoot =
		normalized?.sceneConfig?.infoPanel && typeof normalized.sceneConfig.infoPanel === "object"
			? normalized.sceneConfig.infoPanel
			: null;
	const raw = infoPanelRoot?.maxInFlightAsync;
	infoPanelMaxInflightAsync = Number.isFinite(Number(raw))
		? Math.max(1, Math.floor(Number(raw)))
		: DEFAULT_INFO_PANEL_MAX_INFLIGHT_ASYNC;
}

/** @returns {number} */
export function getInfoPanelMaxInFlightAsync() {
	return infoPanelMaxInflightAsync;
}

/** @internal */
export function _resetInfoPanelDeployConfigForTests() {
	infoPanelMaxInflightAsync = DEFAULT_INFO_PANEL_MAX_INFLIGHT_ASYNC;
}

/**
 * Limit parallel html2canvas count to avoid GPU memory spikes causing WebGL context lost.
 * @param {() => Promise<THREE.Texture>} task
 * @returns {Promise<THREE.Texture>}
 */
function runHtmlTextureJob(task) {
	return new Promise((resolve, reject) => {
		const execute = () => {
			htmlTextureInflight += 1;
			Promise.resolve()
				.then(task)
				.then(resolve, reject)
				.finally(() => {
					htmlTextureInflight -= 1;
					const next = htmlTextureWaitQueue.shift();
					if (next) {
						next();
					}
				});
		};
		if (htmlTextureInflight < infoPanelMaxInflightAsync) {
			execute();
		} else {
			htmlTextureWaitQueue.push(execute);
		}
	});
}

const DEFAULT_PANEL = {
	text: "TEST",
	type: "text",
	panelBoxType: "box",
	color: INFO_PANEL_DEFAULT_FOREGROUND,
	backColor: '#FFFFFF',
	panelWidth: 10,
	panelHeight: 10,
	panelDepth: 1,
	transparent: false,
	opacity: INFO_PANEL_DEFAULT_OPACITY,
	font: '14px SimHei',
	textStyle: {},
	textAlign: 'left',
	textVerticalAlign: 'top',
	textFace: 'single',
	contentScale: 1,
	borderRadius: 0,
	htmlOpacity: true,
	opacityByPanel: false,
	panel: {
		geometry: {
			width: 10,
			height: 10,
			depth: 1
		},
		position: {
			x: 0,
			y: -5,
			z: 0
		},
		material: {
			color: '#FFFFFF',
			transparent: true,
			opacity: INFO_PANEL_DEFAULT_OPACITY
		},
		rotation: {
			rotationX: 0,
			rotationY: 0,
			rotationZ: 0
		},
		scale: {
			scaleX: 1,
			scaleY: 1,
			scaleZ: 1
		}
	}
};

const DEFAULT_TEXT_STYLE = {
	fontSizePx: 14,
	fontFamily: "SimHei",
	padding: 5,
	lineHeight: undefined,
	autoFit: false,
	fitRatio: 0.72,
	minFontPx: 10,
	maxFontPx: 72
};

const textureLoader = new THREE.TextureLoader();
trackDisposableResource(textureLoader);

/** @param {*} value @returns {boolean} */
function hasValue(value) {
	return value !== undefined && value !== null;
}

/** @param {*} value @param {*} fallback */
function valueOr(value, fallback) {
	return hasValue(value) ? value : fallback;
}

const PANEL_BOX_TYPES = new Set(["box", "sprite", "plane"]);

/** @param {*} value @returns {"box"|"sprite"|"plane"} */
function normalizePanelBoxType(value) {
	const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (PANEL_BOX_TYPES.has(raw)) {
		return raw;
	}
	return DEFAULT_PANEL.panelBoxType;
}

/**
 * @param {object|null|undefined} materialInfo
 * @returns {number} THREE.FrontSide | THREE.BackSide | THREE.DoubleSide
 */
function resolveMaterialSide(materialInfo) {
	if (!materialInfo || typeof materialInfo !== "object") {
		return THREE.FrontSide;
	}
	const side = materialInfo.side;
	if (side === "double") {
		return THREE.DoubleSide;
	}
	if (side === "back") {
		return THREE.BackSide;
	}
	return THREE.FrontSide;
}

/**
 * Extract MeshStandardMaterial PBR values from JSON material block (finite numbers only).
 * @param {object|null|undefined} m
 * @returns {{ metalness?: number, roughness?: number }}
 */
function standardMaterialPbrFromJson(m) {
	if (!m || typeof m !== "object") {
		return {};
	}
	const out = {};
	if (hasValue(m.metalness)) {
		const v = Number(m.metalness);
		if (Number.isFinite(v)) {
			out.metalness = v;
		}
	}
	if (hasValue(m.roughness)) {
		const v = Number(m.roughness);
		if (Number.isFinite(v)) {
			out.roughness = v;
		}
	}
	return out;
}

/** Normalize material color string; empty values return fallback. */
function normalizeColor(color, fallback = '#fff') {
	if (!hasValue(color) || color === '' || color === 'none') {
		return fallback;
	}
	return color;
}

/** @param {object} [position] @returns {{x:number,y:number,z:number}} */
function normalizePosition(position = {}) {
	return {
		x: valueOr(position.x, 0),
		y: valueOr(position.y, 0),
		z: valueOr(position.z, 0)
	};
}

/** @param {object} [rotation] @returns {{rotationX:number,rotationY:number,rotationZ:number}} */
function normalizeRotation(rotation = {}) {
	return {
		rotationX: valueOr(rotation.rotationX, 0),
		rotationY: valueOr(rotation.rotationY, 0),
		rotationZ: valueOr(rotation.rotationZ, 0)
	};
}

/** @param {object} [scale] @returns {{scaleX:number,scaleY:number,scaleZ:number}} */
function normalizeScale(scale = {}) {
	return {
		scaleX: valueOr(scale.scaleX, 1),
		scaleY: valueOr(scale.scaleY, 1),
		scaleZ: valueOr(scale.scaleZ, 1)
	};
}

function numberBetween(value, fallback, min, max) {
	const n = Number(value);
	if (!Number.isFinite(n)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, n));
}

function splitLines(text) {
	return String(text ?? "").split(/\r?\n/);
}

function calcLongestLineLength(lines) {
	let max = 0;
	for (let i = 0; i < lines.length; i++) {
		const len = String(lines[i] ?? "").length;
		if (len > max) {
			max = len;
		}
	}
	return max;
}

function resolveFontFromStyle(style) {
	return `${style.fontSizePx}px ${style.fontFamily}`;
}

function resolveTextStyle(infoPanel, canvasSize) {
	const srcStyle = infoPanel.textStyle && typeof infoPanel.textStyle === "object"
		? infoPanel.textStyle
		: {};
	const minFontPx = numberBetween(srcStyle.minFontPx, DEFAULT_TEXT_STYLE.minFontPx, 6, 120);
	const maxFontPx = numberBetween(srcStyle.maxFontPx, DEFAULT_TEXT_STYLE.maxFontPx, minFontPx, 160);
	let fontSizePx = numberBetween(
		srcStyle.fontSizePx,
		DEFAULT_TEXT_STYLE.fontSizePx,
		minFontPx,
		maxFontPx
	);
	if (hasValue(infoPanel.fontSizePx)) {
		fontSizePx = numberBetween(infoPanel.fontSizePx, fontSizePx, minFontPx, maxFontPx);
	}
	const fontFamily =
		(typeof srcStyle.fontFamily === "string" && srcStyle.fontFamily.trim())
			? srcStyle.fontFamily.trim()
			: (typeof infoPanel.fontFamily === "string" && infoPanel.fontFamily.trim())
				? infoPanel.fontFamily.trim()
				: DEFAULT_TEXT_STYLE.fontFamily;

	const autoFit = srcStyle.autoFit === true;
	const fitRatio = numberBetween(srcStyle.fitRatio, DEFAULT_TEXT_STYLE.fitRatio, 0.3, 0.96);
	const padding = numberBetween(srcStyle.padding, DEFAULT_TEXT_STYLE.padding, 0, 64);
	let lineHeight = hasValue(srcStyle.lineHeight)
		? numberBetween(srcStyle.lineHeight, srcStyle.lineHeight, 8, 180)
		: undefined;

	if (autoFit) {
		const lines = splitLines(infoPanel.text);
		const lineCount = Math.max(1, lines.length);
		const longest = Math.max(1, calcLongestLineLength(lines));
		const drawWidth = Math.max(1, canvasSize.width - padding * 2);
		const drawHeight = Math.max(1, canvasSize.height - padding * 2);
		const targetWidth = drawWidth * fitRatio;
		const widthByChars = targetWidth / (longest * 0.62);
		const lineHeightFactor = Math.max(
			1.1,
			lineHeight && fontSizePx ? lineHeight / fontSizePx : 1.22
		);
		const maxByHeight = drawHeight / (lineCount * lineHeightFactor);
		fontSizePx = numberBetween(Math.min(widthByChars, maxByHeight), fontSizePx, minFontPx, maxFontPx);
	}

	if (!hasValue(lineHeight)) {
		lineHeight = Math.max(Math.round(fontSizePx * 1.2), fontSizePx + 2);
	}

	return {
		font: resolveFontFromStyle({ fontSizePx, fontFamily }),
		padding,
		lineHeight
	};
}

function resolveContentScale(infoPanel) {
	const scalar = numberBetween(
		valueOr(infoPanel.contentScale, valueOr(infoPanel.textureScale, 1)),
		1,
		0.1,
		10
	);
	const sx = numberBetween(valueOr(infoPanel.contentScaleX, scalar), scalar, 0.1, 10);
	const sy = numberBetween(valueOr(infoPanel.contentScaleY, scalar), scalar, 0.1, 10);
	return { sx, sy };
}

function applyContentScaleToPanel(infoPanel) {
	const { sx, sy } = resolveContentScale(infoPanel);
	infoPanel.panelWidth = infoPanel.panelWidth * sx;
	infoPanel.panelHeight = infoPanel.panelHeight * sy;
	if (infoPanel.panel && infoPanel.panel.geometry) {
		infoPanel.panel.geometry.width = infoPanel.panelWidth;
		infoPanel.panel.geometry.height = infoPanel.panelHeight;
	}
}

/** Canvas logical size for text/HTML texture drawing. */
function getTextCanvasSize(infoPanel) {
	return {
		width: Math.max(100, Math.round(valueOr(infoPanel.textureWidth, infoPanel.panelWidth))),
		height: Math.max(60, Math.round(valueOr(infoPanel.textureHeight, infoPanel.panelHeight)))
	};
}

/** Parse panel corner radius (texture logical pixels; 0 = square corners). */
function resolveBorderRadius(infoPanel) {
	return Math.max(0, numberBetween(infoPanel.borderRadius, 0, 0, 512));
}

/**
 * When background is baked into texture, material color should be white to avoid rectangular fill covering rounded transparent areas.
 * @param {object} infoPanel
 */
function usesTextureBackground(infoPanel) {
	const type = infoPanel.type || "text";
	return type === "text" || type === "html" || resolveBorderRadius(infoPanel) > 0;
}

/** @param {object} infoPanel */
function resolveMaterialColor(infoPanel) {
	if (usesTextureBackground(infoPanel)) {
		return "#ffffff";
	}
	return normalizeColor(infoPanel.backColor, "#fff");
}

/** Parse info panel vertical alignment (`textVerticalAlign`, `type: text` only). */
function resolveTextVerticalAlign(source) {
	const candidate = valueOr(source.textVerticalAlign, DEFAULT_PANEL.textVerticalAlign);
	if (candidate === "top" || candidate === "middle" || candidate === "bottom"
		|| candidate === "alphabetic" || candidate === "hanging" || candidate === "ideographic") {
		return candidate;
	}
	return DEFAULT_PANEL.textVerticalAlign;
}

/** @param {object} infoPanel */
function resolvePanelOpacity(infoPanel) {
	return clampPanelOpacity(infoPanel.opacity);
}

function clampPanelOpacity(opacity) {
	const value = Number(opacity);
	if (!Number.isFinite(value)) {
		return DEFAULT_PANEL.opacity;
	}
	return Math.min(1, Math.max(0, value));
}

/** Info panel material opacity: opacity baked into texture; material layer stays opaque. */
function resolveInfoPanelMaterialTransparency(infoPanel) {
	const panelOpacity = resolvePanelOpacity(infoPanel);
	const needsTransparent = Boolean(infoPanel.transparent)
		|| panelOpacity < 1
		|| resolveBorderRadius(infoPanel) > 0;
	if (resolveOpacityByPanel(infoPanel)) {
		return {
			transparent: needsTransparent,
			opacity: panelOpacity
		};
	}
	return {
		transparent: needsTransparent,
		opacity: 1
	};
}

/** For `type: text`, generate CanvasTexture from panel copy. */
function createTextTexture(infoPanel) {
	const canvasSize = getTextCanvasSize(infoPanel);
	const textStyle = resolveTextStyle(infoPanel, canvasSize);
	const textVerticalAlign = resolveTextVerticalAlign(infoPanel);
	const textAlign = valueOr(infoPanel.textAlign, DEFAULT_PANEL.textAlign);
	const padding = textStyle.padding;
	const panelOpacity = resolvePanelOpacity(infoPanel);
	const byPanel = resolveOpacityByPanel(infoPanel);
	const texture = createStrTextureMultiline({
		str: infoPanel.text,
		width: canvasSize.width,
		height: canvasSize.height,
		fillStyle: infoPanel.color,
		backgroundColor: byPanel
			? infoPanel.backColor
			: applyOpacityToColor(infoPanel.backColor, panelOpacity),
		borderRadius: resolveBorderRadius(infoPanel),
		font: textStyle.font || infoPanel.font,
		textBaseline: textVerticalAlign,
		textAlign,
		x: padding,
		padding: textStyle.padding,
		lineHeight: textStyle.lineHeight
	});
	return trackDisposableResource(texture);
}

/** Assign texture to panel.material.map. */
function setInfoPanelTexture(infoPanel, texture) {
	if (infoPanel.panel && infoPanel.panel.material) {
		infoPanel.panel.material.map = texture
			? applyUiTextureSampling(texture, infoPanel)
			: '';
	}
}

/** Render HTML in `infoPanel.text` to texture via html2canvas. */
function renderHtmlTexture(infoPanel) {
	const canvasSize = getTextCanvasSize(infoPanel);
	const borderRadius = resolveBorderRadius(infoPanel);
	const panelOpacity = resolvePanelOpacity(infoPanel);
	const byPanel = resolveOpacityByPanel(infoPanel);
	const injectBackground = resolveHtmlOpacity(infoPanel);
	const parentDiv = document.createElement("div");
	parentDiv.id = "tempCanvasParent" + guid();
	parentDiv.innerHTML = infoPanel.text;
	if (panelOpacity < 1 && injectBackground && !byPanel) {
		injectOpacityIntoHtmlBackgrounds(parentDiv, panelOpacity);
	}
	parentDiv.style.position = "fixed";
	parentDiv.style.left = "-10000px";
	parentDiv.style.top = "0";
	parentDiv.style.width = canvasSize.width + "px";
	parentDiv.style.minHeight = canvasSize.height + "px";
	parentDiv.style.color = "black";
	parentDiv.style.pointerEvents = "none";
	parentDiv.style.boxSizing = "border-box";
	const backColor = normalizeColor(infoPanel.backColor, "#fff");
	parentDiv.style.backgroundColor = byPanel
		? backColor
		: applyOpacityToColor(backColor, panelOpacity);
	if (borderRadius > 0) {
		parentDiv.style.borderRadius = `${borderRadius}px`;
		parentDiv.style.overflow = "hidden";
	}
	document.body.appendChild(parentDiv);

	const html2canvasOptions = borderRadius > 0 ? { backgroundColor: null } : undefined;
	const loadId = `infoPanelHtml:${guid()}`;
	loadingManager.itemStart(loadId);

	return runHtmlTextureJob(() => html2canvas(parentDiv, html2canvasOptions).then((canvas) => {
		const texture = trackDisposableResource(new THREE.CanvasTexture(canvas));
		const width = canvas.width || infoPanel.panelWidth;
		const height = canvas.height || infoPanel.panelHeight;

		if (width && infoPanel.panelWidth) {
			const ratio = infoPanel.panelWidth / width;
			infoPanel.panelHeight = ratio * height;
		}
		applyContentScaleToPanel(infoPanel);
		setInfoPanelTexture(infoPanel, texture);
		return texture;
	})).finally(() => {
		loadingManager.itemEnd(loadId);
		if (parentDiv.parentNode) {
			parentDiv.parentNode.removeChild(parentDiv);
		}
	});
}

function loadImageTexture(url) {
	return new Promise((resolve, reject) => {
		textureLoader.load(
			url,
			(texture) => resolve(texture),
			undefined,
			(err) => reject(err instanceof Error ? err : new Error(String(err)))
		);
	});
}

/**
 * Load or generate panel main texture by `type`: `img` / `html` / default text.
 * @param {object} infoPanel Normalized descriptor
 * @returns {Promise<THREE.Texture>}
 */
async function resolveInfoPanelTexture(infoPanel) {
	const type = infoPanel.type || 'text';

	if (type === 'img') {
		let texture = trackDisposableResource(await loadImageTexture(infoPanel.text));
		const panelOpacity = resolvePanelOpacity(infoPanel);
		if (panelOpacity < 1 && !resolveOpacityByPanel(infoPanel)) {
			texture = trackDisposableResource(applyOpacityToImageTexture(texture, panelOpacity));
		}
		applyContentScaleToPanel(infoPanel);
		setInfoPanelTexture(infoPanel, texture);
		return texture;
	}

	if (type === 'html') {
		return renderHtmlTexture(infoPanel);
	}

	const texture = createTextTexture(infoPanel);
	setInfoPanelTexture(infoPanel, texture);
	return texture;
}

/**
 * Assemble shared base params for SpriteMaterial / MeshStandardMaterial.
 * @param {object} infoPanel
 * @param {THREE.Texture|null} texture
 * @param {{ includePbr?: boolean }} [opts] Do not pass PBR fields for Sprite material
 */
function materialParams(infoPanel, texture, opts = {}) {
	const color = resolveMaterialColor(infoPanel);
	const mat = infoPanel.panel && infoPanel.panel.material ? infoPanel.panel.material : {};
	const transparency = resolveInfoPanelMaterialTransparency(infoPanel);
	const base = {
		color,
		alphaTest: 0.1,
		map: texture || null,
		transparent: transparency.transparent,
		opacity: transparency.opacity,
	};
	if (opts.includePbr === false) {
		return base;
	}
	return {
		...base,
		...standardMaterialPbrFromJson(mat),
	};
}

/**
 * Box face materials: single-face text texture or `textFace: full` same material on all six faces.
 * @returns {THREE.MeshStandardMaterial[]} Array of 6 materials
 */
function createTextureMaterials(infoPanel, texture) {
	const textMaterial = trackDisposableResource(new THREE.MeshStandardMaterial(materialParams(infoPanel, texture)));

	if (infoPanel.textFace === "full") {
		return [textMaterial, textMaterial, textMaterial, textMaterial, textMaterial, textMaterial];
	}

	const mat = infoPanel.panel && infoPanel.panel.material ? infoPanel.panel.material : {};
	const transparency = resolveInfoPanelMaterialTransparency(infoPanel);
	const blankMaterial = trackDisposableResource(new THREE.MeshStandardMaterial({
		color: "#ffffff",
		alphaTest: 0.1,
		transparent: transparency.transparent,
		opacity: transparency.opacity,
		...standardMaterialPbrFromJson(mat),
	}));

	return [
		blankMaterial,
		blankMaterial,
		blankMaterial,
		blankMaterial,
		textMaterial,
		blankMaterial
	];
}

/** @param {object} infoPanel */
function resolveInfoPanelRecordName(infoPanel) {
	if (typeof infoPanel?.name === 'string' && infoPanel.name.length) {
		return infoPanel.name;
	}
	return DEFAULT_INFO_PANEL_NAME;
}

/** Apply panel position/rotation and write userData.objJson. */
function applyTransform(object3D, infoPanel) {
	object3D.position.set(
		infoPanel.panel.position.x,
		infoPanel.panel.position.y,
		infoPanel.panel.position.z
	);
	object3D.rotation.set(
		infoPanel.panel.rotation.rotationX,
		infoPanel.panel.rotation.rotationY,
		infoPanel.panel.rotation.rotationZ
	);
	const name = resolveInfoPanelRecordName(infoPanel);
	infoPanel.name = name;
	object3D.name = name;
	setUserDataObjJson(object3D, infoPanel);
}

/** @param {import("three").Object3D} object3D @param {object} descriptor */
function applyInfoPanelVisibility(object3D, descriptor) {
	const visible = descriptor.visible !== false;
	applyObjectVisibility(object3D, visible, { applyToSubtree: false });
}

/** Create BoxGeometry matching panel width/height/depth. */
function createBoxGeometry(infoPanel) {
	return trackDisposableResource(new THREE.BoxGeometry(
		infoPanel.panelWidth,
		infoPanel.panelHeight,
		infoPanel.panelDepth
	));
}

/**
 * Build box Mesh from texture (does not scene.add itself).
 * @param {object} infoPanel Panel config with aligned fields
 * @param {THREE.Texture} texture
 * @returns {THREE.Mesh}
 */
function createInfoBoxMesh(infoPanel, texture) {
	const boxMesh = trackDisposableResource(new THREE.Mesh(
		createBoxGeometry(infoPanel),
		createTextureMaterials(infoPanel, texture)
	));
	applyTransform(boxMesh, infoPanel);
	boxMesh.scale.set(
		infoPanel.panel.scale.scaleX,
		infoPanel.panel.scale.scaleY,
		infoPanel.panel.scale.scaleZ
	);
	return boxMesh;
}

/** Create PlaneGeometry matching panel width/height (+Z is texture front). */
function createPlaneGeometry(infoPanel) {
	return trackDisposableResource(new THREE.PlaneGeometry(
		infoPanel.panelWidth,
		infoPanel.panelHeight
	));
}

/**
 * Plane carrier material side: defaults to double-sided when `panel.material.side` not set.
 * @param {object|null|undefined} materialInfo
 * @returns {number}
 */
function resolvePlaneMaterialSide(materialInfo) {
	if (!materialInfo || typeof materialInfo !== "object") {
		return THREE.DoubleSide;
	}
	const side = materialInfo.side;
	if (side === undefined || side === null || String(side).trim() === "") {
		return THREE.DoubleSide;
	}
	return resolveMaterialSide(materialInfo);
}

/**
 * Plane carrier material (`textFace` only for box; ignored on plane).
 * @param {object} infoPanel
 * @param {THREE.Texture} texture
 * @returns {THREE.MeshStandardMaterial}
 */
function createInfoPlaneMaterial(infoPanel, texture) {
	const mat = infoPanel.panel && infoPanel.panel.material ? infoPanel.panel.material : {};
	return trackDisposableResource(new THREE.MeshStandardMaterial({
		...materialParams(infoPanel, texture),
		side: resolvePlaneMaterialSide(mat),
	}));
}

/**
 * Build plane Mesh from texture (fixed orientation, not billboard).
 * @param {object} infoPanel
 * @param {THREE.Texture} texture
 * @returns {THREE.Mesh}
 */
function createInfoPlaneMesh(infoPanel, texture) {
	const planeMesh = trackDisposableResource(new THREE.Mesh(
		createPlaneGeometry(infoPanel),
		createInfoPlaneMaterial(infoPanel, texture)
	));
	applyTransform(planeMesh, infoPanel);
	planeMesh.scale.set(
		infoPanel.panel.scale.scaleX,
		infoPanel.panel.scale.scaleY,
		infoPanel.panel.scale.scaleZ
	);
	return planeMesh;
}

/**
 * Build Sprite from texture.
 * @param {object} infoPanel
 * @param {THREE.Texture} texture
 * @returns {THREE.Sprite}
 */
function createInfoSpriteMesh(infoPanel, texture) {
	const material = trackDisposableResource(new THREE.SpriteMaterial(materialParams(infoPanel, texture, { includePbr: false })));
	const sprite = trackDisposableResource(new THREE.Sprite(material));
	applyTransform(sprite, infoPanel);
	sprite.scale.set(infoPanel.panelWidth, infoPanel.panelHeight, 1);
	return sprite;
}

/**
 * Build Mesh or Sprite from texture by `panelBoxType` (not added to scene).
 * @param {object} infoPanel
 * @param {THREE.Texture} texture
 * @returns {THREE.Mesh|THREE.Sprite}
 */
function buildInfoPanelObject(infoPanel, texture) {
	if (infoPanel.panelBoxType === "sprite") {
		return createInfoSpriteMesh(infoPanel, texture);
	}
	if (infoPanel.panelBoxType === "plane") {
		return createInfoPlaneMesh(infoPanel, texture);
	}
	return createInfoBoxMesh(infoPanel, texture);
}

/**
 * Unified deploy entry: normalize → texture → carrier → optional scene.add.
 * @param {THREE.Scene|THREE.Object3D} scene
 * @param {object} infoPanel
 * @param {{ addToScene?: boolean, parent?: import("three").Object3D }} [options]
 * @returns {Promise<THREE.Mesh|THREE.Sprite>}
 */
async function deployInfoPanel(scene, infoPanel, options = {}) {
	const descriptor = normalizeInfoPanelDescriptor(infoPanel);
	ensureThreeJsonIdOnRecord(descriptor);
	const texture = await resolveInfoPanelTexture(descriptor);
	const object3D = buildInfoPanelObject(descriptor, texture);
	applyInfoPanelVisibility(object3D, descriptor);
	const addToScene = options.addToScene !== false;
	const parent = options.parent || scene;
	if (addToScene && parent && typeof parent.add === 'function') {
		parent.add(object3D);
	}
	registerObject(object3D, descriptor, { recursive: false });
	const manager = getActiveEventListenerManager();
	if (manager) {
		wireInfoPanelDismissTriggerForObject(object3D, {
			manager,
			sceneToken: getActiveEventSceneToken() ?? ""
		});
	}
	return object3D;
}

/**
 * Deploy box info panel (forces `panelBoxType: box`) and add to scene.
 * @param {THREE.Scene} scene
 * @param {object} infoPanel
 * @returns {Promise<THREE.Mesh>}
 */
async function deployBoxInfoPanel(scene, infoPanel) {
	const descriptor = normalizeInfoPanelDescriptor({
		...infoPanel,
		panelBoxType: "box",
		boxType: "box"
	});
	return deployInfoPanel(scene, descriptor);
}

/**
 * Deploy sprite info panel (forces `panelBoxType: sprite`) and add to scene.
 * @param {THREE.Scene} scene
 * @param {object} infoPanel
 * @returns {Promise<THREE.Sprite>}
 */
async function deploySpriteInfoPanel(scene, infoPanel) {
	const descriptor = normalizeInfoPanelDescriptor({
		...infoPanel,
		panelBoxType: "sprite",
		boxType: "sprite"
	});
	return deployInfoPanel(scene, descriptor);
}

/**
 * Deploy plane info panel (forces `panelBoxType: plane`) and add to scene.
 * @param {THREE.Scene} scene
 * @param {object} infoPanel
 * @returns {Promise<THREE.Mesh>}
 */
async function deployPlaneInfoPanel(scene, infoPanel) {
	const descriptor = normalizeInfoPanelDescriptor({
		...infoPanel,
		panelBoxType: "plane",
		boxType: "plane"
	});
	return deployInfoPanel(scene, descriptor);
}

/**
 * Assemble info panel JSON descriptor from text and position (not added to scene).
 * @param {string} [text]
 * @param {{x?:number,y?:number,z?:number}} [position]
 * @param {object} [options]
 * @returns {object}
 */
function createInfoPanelDescriptor(text = '', position = { x: 0, y: 0, z: 0 }, options = {}) {
	const panelWidth = valueOr(options.panelWidth, DEFAULT_PANEL.panelWidth);
	const panelHeight = valueOr(options.panelHeight, DEFAULT_PANEL.panelHeight);
	const panelDepth = valueOr(options.panelDepth, DEFAULT_PANEL.panelDepth);
	const backColor = valueOr(options.backColor, DEFAULT_PANEL.backColor);
	const transparent = valueOr(options.transparent, DEFAULT_PANEL.transparent);
	const opacity = valueOr(options.opacity, DEFAULT_PANEL.opacity);

	return normalizeInfoPanelDescriptor({
		text: text ? text : DEFAULT_PANEL.text,
		type: valueOr(options.type, DEFAULT_PANEL.type),
		panelBoxType: valueOr(options.panelBoxType, valueOr(options.boxType, DEFAULT_PANEL.panelBoxType)),
		color: valueOr(options.color, '#000'),
		backColor,
		panelWidth,
		panelHeight,
		panelDepth,
		transparent,
		opacity,
		font: valueOr(options.font, DEFAULT_PANEL.font),
		textStyle: options.textStyle,
		textVerticalAlign: valueOr(options.textVerticalAlign, DEFAULT_PANEL.textVerticalAlign),
		textAlign: valueOr(options.textAlign, DEFAULT_PANEL.textAlign),
		textFace: valueOr(options.textFace, DEFAULT_PANEL.textFace),
		contentScale: options.contentScale,
		contentScaleX: options.contentScaleX,
		contentScaleY: options.contentScaleY,
		textureScale: options.textureScale,
		textureWidth: options.textureWidth,
		textureHeight: options.textureHeight,
		borderRadius: options.borderRadius,
		panel: {
			geometry: {
				width: panelWidth,
				height: panelHeight,
				depth: panelDepth
			},
			position: normalizePosition(position),
			material: {
				color: backColor,
				transparent,
				opacity
			},
			rotation: normalizeRotation(options.rotation),
			scale: normalizeScale(options.scale)
		}
	});
}

/**
 * Fill infoPanel fields with defaults (including nested panel.geometry, etc.).
 * @param {object} [infoPanel]
 * @returns {object}
 */
function normalizeInfoPanelDescriptor(infoPanel) {
	const source = infoPanel || {};
	const panel = source.panel || {};
	const geometry = panel.geometry || source.geometry || {};
	const material = panel.material || source.material || {};

	source.objType = "infoPanel";
	source.name = resolveInfoPanelRecordName(source);
	source.type = valueOr(source.type, DEFAULT_PANEL.type);
	source.panelBoxType = normalizePanelBoxType(valueOr(source.panelBoxType, source.boxType));
	source.text = source.text ? source.text : DEFAULT_PANEL.text;
	source.color = valueOr(source.color, DEFAULT_PANEL.color);
	source.font = valueOr(source.font, DEFAULT_PANEL.font);
	source.textStyle = source.textStyle && typeof source.textStyle === "object"
		? source.textStyle
		: {};
	source.textVerticalAlign = resolveTextVerticalAlign(source);
	source.textAlign = valueOr(source.textAlign, DEFAULT_PANEL.textAlign);
	source.textFace = valueOr(source.textFace, DEFAULT_PANEL.textFace);
	source.contentScale = valueOr(source.contentScale, valueOr(source.textureScale, DEFAULT_PANEL.contentScale));
	source.contentScaleX = valueOr(source.contentScaleX, source.contentScale);
	source.contentScaleY = valueOr(source.contentScaleY, source.contentScale);

	source.panelWidth = valueOr(source.panelWidth, valueOr(geometry.width, DEFAULT_PANEL.panelWidth));
	source.panelHeight = valueOr(source.panelHeight, valueOr(geometry.height, DEFAULT_PANEL.panelHeight));
	source.panelDepth = valueOr(source.panelDepth, valueOr(geometry.depth, DEFAULT_PANEL.panelDepth));
	source.backColor = valueOr(source.backColor, valueOr(material.color, DEFAULT_PANEL.backColor));
	source.transparent = valueOr(source.transparent, valueOr(material.transparent, DEFAULT_PANEL.transparent));
	source.opacity = valueOr(source.opacity, valueOr(material.opacity, DEFAULT_PANEL.opacity));
	source.borderRadius = resolveBorderRadius(source);
	source.opacityByPanel = source.opacityByPanel === true;
	if (source.type === "html") {
		source.htmlOpacity = source.htmlOpacity !== false;
	}

	source.panel = {
		geometry: {
			width: source.panelWidth,
			height: source.panelHeight,
			depth: source.panelDepth
		},
		position: normalizePosition(panel.position || DEFAULT_PANEL.panel.position),
		material: {
			color: source.backColor,
			transparent: source.transparent,
			opacity: source.opacity,
			map: material.map,
			...(typeof material.side === "string" && material.side.trim()
				? { side: material.side.trim().toLowerCase() }
				: {}),
			...(hasValue(material.metalness) ? { metalness: material.metalness } : {}),
			...(hasValue(material.roughness) ? { roughness: material.roughness } : {}),
		},
		rotation: normalizeRotation(panel.rotation || DEFAULT_PANEL.panel.rotation),
		scale: normalizeScale(panel.scale || DEFAULT_PANEL.panel.scale)
	};
	source.boxType = source.panelBoxType;

	source.geometry = source.panel.geometry;
	source.material = source.panel.material;
	return source;
}

function guid() {
	if (window.crypto && typeof window.crypto.randomUUID === 'function') {
		return window.crypto.randomUUID();
	}

	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
		const r = Math.random() * 16 | 0;
		const v = c === 'x' ? r : (r & 0x3 | 0x8);
		return v.toString(16);
	});
}

export {
	normalizeInfoPanelDescriptor,
	createInfoPanelDescriptor,
	applyUiTextureSampling as applyInfoPanelTextureDefaults,
	resolveInfoPanelTexture,
	buildInfoPanelObject,
	deployInfoPanel,
	deployBoxInfoPanel,
	deploySpriteInfoPanel,
	deployPlaneInfoPanel,
	createBoxGeometry as infoPanelCreateBoxGeometry,
	createPlaneGeometry as infoPanelCreatePlaneGeometry,
	createTextureMaterials as infoPanelCreateTextureMaterials,
	createInfoPlaneMaterial as infoPanelCreatePlaneMaterial,
	resolveMaterialColor as infoPanelResolveMaterialColor,
	resolveInfoPanelMaterialTransparency as infoPanelResolveMaterialTransparency,
	resolveInfoPanelRecordName as infoPanelResolveRecordName
};
