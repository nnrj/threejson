/**
 * Canvas text rendering and Three.js texture helpers (multiline, alignment, DPR, background, etc.).
 */
import * as THREE from 'three';

import {trackDisposableResource} from '../handler/trackedResourceRegistry.js';
import { applyUiTextureSampling } from "./textureSampling.js";
import {
  TEXT_DEFAULT_BACKGROUND,
  TEXT_DEFAULT_FILL
} from '../theme/runtimeVisualDefaults.js';

const DEFAULT_TEXTURE_INFO = {
	str: "TEST",
	width: 50,
	height: 40,
	x: 5,
	y: 5,
	padding: 5,
	font: "14px SimHei",
	fillStyle: TEXT_DEFAULT_FILL,
	backgroundColor: TEXT_DEFAULT_BACKGROUND,
	textBaseline: "top",
	textAlign: "left",
	lineHeight: undefined,
	devicePixelRatio: undefined,
	maxLines: undefined,
	borderRadius: 0
};

function hasValue(value){
	return value !== undefined && value !== null;
}

function valueOr(value, fallback){
	return hasValue(value) ? value : fallback;
}

function numberOr(value, fallback){
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? numberValue : fallback;
}

function clampOpacity(opacity, fallback = 1) {
	const value = numberOr(opacity, fallback);
	return Math.min(1, Math.max(0, value));
}

function expandHex(hex) {
	const normalized = hex.replace("#", "");
	if (normalized.length === 3) {
		return normalized.split("").map((ch) => ch + ch).join("");
	}
	return normalized;
}

/**
 * Parse a CSS color string into RGBA (0–255 channels, alpha 0–1).
 * @param {string} color
 * @returns {{ r: number, g: number, b: number, a: number }|null}
 */
function parseColorRgba(color) {
	if (!hasValue(color) || color === "" || color === "none" || color === "transparent") {
		return null;
	}
	const value = String(color).trim();
	const rgbaMatch = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
	if (rgbaMatch) {
		return {
			r: numberOr(rgbaMatch[1], 0),
			g: numberOr(rgbaMatch[2], 0),
			b: numberOr(rgbaMatch[3], 0),
			a: hasValue(rgbaMatch[4]) ? clampOpacity(rgbaMatch[4]) : 1
		};
	}
	if (value.startsWith("#")) {
		const hex = expandHex(value);
		if (hex.length !== 6) {
			return null;
		}
		return {
			r: parseInt(hex.slice(0, 2), 16),
			g: parseInt(hex.slice(2, 4), 16),
			b: parseInt(hex.slice(4, 6), 16),
			a: 1
		};
	}
	return null;
}

/**
 * Bake opacity into color alpha for texture backgrounds (text foreground stays fully opaque).
 * @param {string|string[]|null|undefined} color
 * @param {number} opacity
 * @returns {string|string[]}
 */
function applyOpacityToColor(color, opacity) {
	const alpha = clampOpacity(opacity);
	if (alpha >= 1) {
		return hasValue(color) ? color : DEFAULT_TEXTURE_INFO.backgroundColor;
	}
	if (!hasValue(color) || color === "" || color === "none" || color === "transparent") {
		return "transparent";
	}
	if (Array.isArray(color)) {
		return color.map((entry) => applyOpacityToColor(entry, alpha));
	}
	const parsed = parseColorRgba(color);
	if (!parsed) {
		return color;
	}
	const nextAlpha = clampOpacity(parsed.a * alpha);
	return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${nextAlpha})`;
}

/**
 * Multiply canvas pixel alpha by a factor (fade entire image; used by img panels).
 * @param {HTMLCanvasElement} canvas
 * @param {number} opacity
 */
function multiplyCanvasAlpha(canvas, opacity) {
	const factor = clampOpacity(opacity);
	if (factor >= 1 || !canvas) {
		return canvas;
	}
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return canvas;
	}
	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const data = imageData.data;
	for (let i = 3; i < data.length; i += 4) {
		data[i] = Math.round(data[i] * factor);
	}
	ctx.putImageData(imageData, 0, 0);
	return canvas;
}

/**
 * Scale alpha on an Image/Canvas texture by opacity and return a new CanvasTexture.
 * @param {THREE.Texture} texture
 * @param {number} opacity
 * @returns {THREE.CanvasTexture}
 */
function applyOpacityToImageTexture(texture, opacity) {
	const factor = clampOpacity(opacity);
	if (factor >= 1 || !texture?.image) {
		return texture;
	}
	const image = texture.image;
	const canvas = document.createElement("canvas");
	canvas.width = image.width || image.videoWidth || 1;
	canvas.height = image.height || image.videoHeight || 1;
	const ctx = canvas.getContext("2d");
	ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
	multiplyCanvasAlpha(canvas, factor);
	return createCanvasTexture(canvas, textureInfo);
}

/**
 * Merge user params with default texture draw settings (size, padding, devicePixelRatio, etc.).
 * @param {object} [textureInfo={}]
 * @returns {object} Normalized draw parameters
 */
function normalizeTextureInfo(textureInfo = {}){
	const browserDpr = globalThis.devicePixelRatio || 1;
	const width = Math.max(1, numberOr(valueOr(textureInfo.width, DEFAULT_TEXTURE_INFO.width), DEFAULT_TEXTURE_INFO.width));
	const height = Math.max(1, numberOr(valueOr(textureInfo.height, DEFAULT_TEXTURE_INFO.height), DEFAULT_TEXTURE_INFO.height));
	const padding = Math.max(0, numberOr(valueOr(textureInfo.padding, DEFAULT_TEXTURE_INFO.padding), DEFAULT_TEXTURE_INFO.padding));

	return {
		...DEFAULT_TEXTURE_INFO,
		...textureInfo,
		str: hasValue(textureInfo.str) ? String(textureInfo.str) : DEFAULT_TEXTURE_INFO.str,
		width,
		height,
		x: numberOr(valueOr(textureInfo.x, padding), padding),
		y: numberOr(valueOr(textureInfo.y, padding), padding),
		padding,
		devicePixelRatio: Math.max(1, numberOr(valueOr(textureInfo.devicePixelRatio, browserDpr), 1)),
		borderRadius: Math.max(0, numberOr(textureInfo.borderRadius, 0))
	};
}

/**
 * Build a rounded-rect path on a canvas (no fill).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRectPath(ctx, x, y, w, h, r) {
	const radius = Math.max(0, Math.min(r, w / 2, h / 2));
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.lineTo(x + w - radius, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
	ctx.lineTo(x + w, y + h - radius);
	ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
	ctx.lineTo(x + radius, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
	ctx.lineTo(x, y + radius);
	ctx.quadraticCurveTo(x, y, x + radius, y);
	ctx.closePath();
}

function parseFontSize(font){
	const match = String(font).match(/(\d+(?:\.\d+)?)px/);
	return match ? Number(match[1]) : 14;
}

function getLineHeight(ctx, font, explicitLineHeight){
	if(hasValue(explicitLineHeight)){
		return Math.max(1, numberOr(explicitLineHeight, parseFontSize(font) * 1.2));
	}

	// CJK line-height probe: "国" (CJK) + "Mg" (Latin) with SimHei yields stable ascent/descent for mixed text.
	const metrics = ctx.measureText("国Mg");
	const measuredHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
	return measuredHeight || parseFontSize(font) * 1.2;
}

function createCanvas(width, height, dpr){
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	canvas.style.width = width + "px";
	canvas.style.height = height + "px";
	return canvas;
}

function applyBackgroundFillStyle(ctx, info) {
	const background = info.backgroundColor;

	if (Array.isArray(background) && background.length > 0) {
		const gradient = ctx.createLinearGradient(0, 0, info.width, info.height);
		background.forEach((colorStop, index) => {
			if (Array.isArray(colorStop)) {
				gradient.addColorStop(colorStop[0], colorStop[1]);
				return;
			}
			gradient.addColorStop(index / Math.max(1, background.length - 1), colorStop);
		});
		ctx.fillStyle = gradient;
		return;
	}

	ctx.fillStyle = background || DEFAULT_TEXTURE_INFO.backgroundColor;
}

function fillBackground(ctx, info){
	applyBackgroundFillStyle(ctx, info);

	if (info.borderRadius > 0) {
		roundRectPath(ctx, 0, 0, info.width, info.height, info.borderRadius);
		ctx.fill();
		return;
	}

	ctx.fillRect(0, 0, info.width, info.height);
}

function getTextStartX(info, maxWidth){
	if(info.textAlign === "center"){
		return info.x + maxWidth / 2;
	}
	if(info.textAlign === "right" || info.textAlign === "end"){
		return info.x + maxWidth;
	}
	return info.x + 0.5;
}

/**
 * Compute first-line y from textBaseline; middle/bottom center or bottom-align the text block without relying on caller y.
 * @param {object} info
 * @param {number} lineCount
 * @param {number} lineHeight
 * @returns {number}
 */
function resolveFirstLineY(info, lineCount, lineHeight) {
	const pad = info.padding;
	const innerHeight = Math.max(lineHeight, info.height - pad * 2);
	const blockHeight = Math.max(lineHeight, lineCount * lineHeight);
	const baseline = info.textBaseline;

	if (baseline === "middle") {
		return pad + (innerHeight - blockHeight) / 2 + lineHeight / 2;
	}
	if (baseline === "bottom" || baseline === "alphabetic") {
		return info.height - pad - (lineCount - 1) * lineHeight;
	}
	return numberOr(info.y, pad);
}

function wrapText(ctx, text, maxWidth){
	const lines = [];
	const paragraphs = String(text).split(/\r?\n/);

	for(let i = 0; i < paragraphs.length; i++){
		const paragraph = paragraphs[i];
		let line = "";

		if(!paragraph){
			lines.push("");
			continue;
		}

		for(const char of paragraph){
			const testLine = line + char;
			if(ctx.measureText(testLine).width > maxWidth && line){
				lines.push(line);
				line = char;
			}
			else {
				line = testLine;
			}
		}

		lines.push(line);
	}

	return lines;
}

/**
 * Create a texture from a canvas and set needsUpdate.
 * @param {HTMLCanvasElement} canvas
 * @returns {THREE.CanvasTexture}
 */
function createCanvasTexture(canvas, sourceRecord){
	const texture = new THREE.CanvasTexture(canvas);
	texture.needsUpdate = true;
	applyUiTextureSampling(texture, sourceRecord);
	return trackDisposableResource(texture);
}

/**
 * Draw multiline text on a canvas and wrap as a tracked `CanvasTexture`.
 * @param {object} [textureInfo={}] Supported fields: str, width, height, x, y, padding, font, fillStyle,
 *   backgroundColor, textBaseline, textAlign, lineHeight, devicePixelRatio, maxLines, borderRadius
 * @returns {THREE.CanvasTexture}
 */
function createStrTextureMultiline(textureInfo = {}) {
	const info = normalizeTextureInfo(textureInfo);
	const canvas = createCanvas(info.width, info.height, info.devicePixelRatio);
	const ctx = canvas.getContext("2d");

	ctx.scale(info.devicePixelRatio, info.devicePixelRatio);
	const skipBg =
		info.backgroundColor === "transparent"
		|| info.backgroundColor === null
		|| info.backgroundColor === "";
	if(!skipBg){
		fillBackground(ctx, info);
	}

	ctx.font = info.font;
	ctx.fillStyle = info.fillStyle;
	ctx.textBaseline = info.textBaseline;
	ctx.textAlign = info.textAlign;

	const maxWidth = Math.max(1, info.width - info.x - info.padding);
	const drawableHeight = Math.max(1, info.height - info.padding * 2);
	const lineHeight = getLineHeight(ctx, info.font, info.lineHeight);
	const maxLines = Math.min(
		Math.max(1, Math.floor(drawableHeight / lineHeight)),
		hasValue(info.maxLines) ? Math.max(1, Number(info.maxLines)) : Infinity
	);
	const wrappedLines = wrapText(ctx, info.str, maxWidth);
	const lines = wrappedLines.slice(0, maxLines);
	const textX = getTextStartX(info, maxWidth);
	const firstLineY = resolveFirstLineY(info, lines.length, lineHeight);

	for(let i = 0; i < lines.length; i++){
		let line = lines[i];
		if(i === lines.length - 1 && wrappedLines.length > maxLines && line.length > 1){
			line = line.slice(0, -1) + "...";
		}
		ctx.fillText(line, textX, firstLineY + i * lineHeight);
	}

	return createCanvasTexture(canvas, textureInfo);
}

export {
	applyOpacityToColor,
	applyOpacityToImageTexture,
	createStrTextureMultiline,
	multiplyCanvasAlpha
}