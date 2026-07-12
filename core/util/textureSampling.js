/**
 * Texture sampling: preset path (A), global fields (G), quality tiers (S), explicit fields (C), opt-out.
 *
 * `deployTextureDefaults`/`deploySceneTextureQuality` live inside `createTextureSamplingStore()`
 * instances, one per RuntimeContext (see core/runtime/runtimeContext.js), so configuring
 * these for one scene's deploy never bleeds into a concurrently-loading sibling scene.
 * `configureTextureDefaultsForDeploy` takes an optional trailing `runtimeScope`; the
 * per-call `resolveTextureProps`/`applyTexturePropsFromRecord` family reads
 * `context.runtimeScope` (falling back to the shared default store) to resolve the
 * matching values set there.
 */
import * as THREE from "three";
import { resolveRuntimeContext } from "../runtime/runtimeContext.js";

const ANISOTROPY_MIN = 1;
const ANISOTROPY_MAX = 16;

export const TEXTURE_EXPLICIT_PROP_KEYS = Object.freeze([
	"generateMipmaps",
	"minFilter",
	"magFilter",
	"anisotropy",
	"colorSpace"
]);

/** @type {Readonly<Record<string, object>>} */
export const BUILTIN_PROFILES = Object.freeze({
	ui: Object.freeze({
		generateMipmaps: false,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		colorSpace: "srgb",
		anisotropy: 4
	}),
	imageMap: Object.freeze({
		generateMipmaps: true,
		colorSpace: "srgb",
		anisotropy: 4
	})
});

const FILTER_STRING_TO_THREE = Object.freeze({
	nearest: THREE.NearestFilter,
	linear: THREE.LinearFilter,
	nearestmipmapnearest: THREE.NearestMipmapNearestFilter,
	linearmipmapnearest: THREE.LinearMipmapNearestFilter,
	nearestmipmaplinear: THREE.NearestMipmapLinearFilter,
	linearmipmaplinear: THREE.LinearMipmapLinearFilter
});

const FILTER_THREE_TO_STRING = Object.freeze({
	[THREE.NearestFilter]: "nearest",
	[THREE.LinearFilter]: "linear",
	[THREE.NearestMipmapNearestFilter]: "nearestMipmapNearest",
	[THREE.LinearMipmapNearestFilter]: "linearMipmapNearest",
	[THREE.NearestMipmapLinearFilter]: "nearestMipmapLinear",
	[THREE.LinearMipmapLinearFilter]: "linearMipmapLinear"
});

/** @type {Record<string, Record<number, object|null>>} */
const QUALITY_TIER_BUNDLES = {
	ui: {
		1: {
			generateMipmaps: false,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			anisotropy: 1,
			colorSpace: "srgb"
		},
		2: null,
		3: {
			generateMipmaps: false,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			anisotropy: 4,
			colorSpace: "srgb"
		}
	},
	imageMap: {
		1: {
			generateMipmaps: true,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			anisotropy: 1,
			colorSpace: "srgb"
		},
		2: null,
		3: {
			generateMipmaps: true,
			minFilter: THREE.LinearMipmapLinearFilter,
			magFilter: THREE.LinearFilter,
			anisotropy: 8,
			colorSpace: "srgb"
		}
	}
};

export function createTextureSamplingStore() {
	/** @type {Record<string, object>|null} */
	let deployTextureDefaults = null;
	/** @type {number|null} */
	let deploySceneTextureQuality = null;

	function reset() {
		deployTextureDefaults = null;
		deploySceneTextureQuality = null;
	}

	return {
		get textureDefaults() {
			return deployTextureDefaults;
		},
		set textureDefaults(value) {
			deployTextureDefaults = value;
		},
		get sceneTextureQuality() {
			return deploySceneTextureQuality;
		},
		set sceneTextureQuality(value) {
			deploySceneTextureQuality = value;
		},
		reset,
		dispose: reset
	};
}

function resolveStore(runtimeScope) {
	return resolveRuntimeContext(runtimeScope).textureSampling;
}

function hasValue(value) {
	return value !== undefined && value !== null;
}

function hasOwn(obj, key) {
	return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

function numberBetween(value, fallback, min, max) {
	const n = Number(value);
	if (!Number.isFinite(n)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, n));
}

/**
 * @param {object} base
 * @param {object|null|undefined} patch
 * @returns {object}
 */
function mergeSettingsLayer(base, patch) {
	if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
		return { ...base };
	}
	const out = { ...base };
	for (const key of Object.keys(patch)) {
		const value = patch[key];
		if (value !== undefined) {
			out[key] = value;
		}
	}
	return out;
}

/**
 * @param {unknown} field
 * @returns {boolean}
 */
export function isTextureSamplingOptOut(field) {
	if (field === false || field === "off" || field === "none") {
		return true;
	}
	return false;
}

/**
 * @param {object|null|undefined} record
 * @returns {boolean}
 */
export function isRecordTextureSamplingOptOut(record) {
	if (!record || typeof record !== "object") {
		return false;
	}
	if (isTextureSamplingOptOut(record.textureSampling)) {
		return true;
	}
	const tier = parseTextureQuality(record.textureQuality);
	return tier === 0;
}

/**
 * @param {unknown} value
 * @returns {0|1|2|3|null}
 */
export function parseTextureQuality(value) {
	if (value === undefined || value === null || value === "") {
		return null;
	}
	if (typeof value === "number" || typeof value === "string") {
		const n = Number(value);
		if (Number.isFinite(n) && n >= 0 && n <= 3 && Math.floor(n) === n) {
			return /** @type {0|1|2|3} */ (n);
		}
	}
	if (typeof value === "string") {
		const key = value.trim().toLowerCase();
		if (key === "off") {
			return 0;
		}
		if (key === "low") {
			return 1;
		}
		if (key === "medium") {
			return 2;
		}
		if (key === "high") {
			return 3;
		}
	}
	return null;
}

/**
 * @param {string} profileName
 * @param {0|1|2|3} tier
 * @returns {object|null}
 */
export function expandQualityTier(profileName, tier) {
	const bundles = QUALITY_TIER_BUNDLES[profileName] || QUALITY_TIER_BUNDLES.imageMap;
	const bundle = bundles[tier];
	if (bundle === null && tier === 2) {
		const builtin = BUILTIN_PROFILES[profileName] || BUILTIN_PROFILES.imageMap;
		return { ...builtin };
	}
	if (!bundle || typeof bundle !== "object") {
		return null;
	}
	return { ...bundle };
}

/**
 * @param {object|null|undefined} normalized
 * @returns {number|null}
 */
export function resolveSceneTextureQuality(normalized) {
	const raw = normalized?.sceneConfig?.textureQuality;
	return parseTextureQuality(raw);
}

/**
 * @param {object|null|undefined} record
 * @param {number|null} sceneTier
 * @returns {number|null}
 */
export function resolveEffectiveTextureQuality(record, sceneTier) {
	if (record && typeof record === "object" && hasOwn(record, "textureQuality")) {
		return parseTextureQuality(record.textureQuality);
	}
	return sceneTier ?? null;
}

/**
 * @param {unknown} value
 * @returns {number|undefined}
 */
export function normalizeTextureFilter(value) {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		if (Object.prototype.hasOwnProperty.call(FILTER_THREE_TO_STRING, value)) {
			return value;
		}
		return undefined;
	}
	if (typeof value === "string") {
		const key = value.trim().toLowerCase();
		if (Object.prototype.hasOwnProperty.call(FILTER_STRING_TO_THREE, key)) {
			return FILTER_STRING_TO_THREE[key];
		}
	}
	return undefined;
}

/**
 * @param {number|undefined} threeConstant
 * @returns {string|undefined}
 */
export function serializeTextureFilter(threeConstant) {
	if (threeConstant === undefined || threeConstant === null) {
		return undefined;
	}
	return FILTER_THREE_TO_STRING[threeConstant];
}

/**
 * @param {object|null|undefined} record
 * @returns {object}
 */
export function extractExplicitTextureProps(record) {
	if (!record || typeof record !== "object") {
		return {};
	}
	const out = {};
	if (hasOwn(record, "generateMipmaps")) {
		out.generateMipmaps = record.generateMipmaps === true;
	}
	if (hasOwn(record, "minFilter")) {
		const f = normalizeTextureFilter(record.minFilter);
		if (f !== undefined) {
			out.minFilter = f;
		}
	}
	if (hasOwn(record, "magFilter")) {
		const f = normalizeTextureFilter(record.magFilter);
		if (f !== undefined) {
			out.magFilter = f;
		}
	}
	const anisRaw = hasOwn(record, "anisotropy")
		? record.anisotropy
		: hasOwn(record, "textureAnisotropy")
			? record.textureAnisotropy
			: undefined;
	if (hasOwn(record, "anisotropy") || hasOwn(record, "textureAnisotropy")) {
		const n = Number(anisRaw);
		if (Number.isFinite(n)) {
			out.anisotropy = numberBetween(n, n, ANISOTROPY_MIN, ANISOTROPY_MAX);
		}
	}
	if (hasOwn(record, "colorSpace") && hasValue(record.colorSpace)) {
		out.colorSpace = String(record.colorSpace).trim().toLowerCase();
	}
	return out;
}

/**
 * @param {object} settings
 * @param {{ threeJsonId?: string, materialPointer?: string }} [warnCtx]
 * @returns {object}
 */
export function coerceFiltersForMipmaps(settings, warnCtx = {}) {
	if (!settings || settings.generateMipmaps !== false) {
		return settings;
	}
	const mipmapFilters = new Set([
		THREE.NearestMipmapNearestFilter,
		THREE.LinearMipmapNearestFilter,
		THREE.NearestMipmapLinearFilter,
		THREE.LinearMipmapLinearFilter
	]);
	let out = settings;
	for (const key of ["minFilter", "magFilter"]) {
		if (hasValue(settings[key]) && mipmapFilters.has(settings[key])) {
			if (out === settings) {
				out = { ...settings };
			}
			out[key] = THREE.LinearFilter;
			if (typeof console !== "undefined" && console.warn) {
				const id = warnCtx.threeJsonId ? ` threeJsonId=${warnCtx.threeJsonId}` : "";
				const ptr = warnCtx.materialPointer ? ` material=${warnCtx.materialPointer}` : "";
				console.warn(
					`[textureSampling] generateMipmaps=false: ${key} downgraded to linear.${id}${ptr}`
				);
			}
		}
	}
	return out;
}

/**
 * @param {object} settings
 * @param {THREE.WebGLRenderer|null|undefined} renderer
 * @returns {object}
 */
function clampAnisotropyInSettings(settings, renderer) {
	if (!hasValue(settings.anisotropy)) {
		return settings;
	}
	let max = ANISOTROPY_MAX;
	if (renderer?.capabilities?.getMaxAnisotropy) {
		max = Math.min(max, renderer.capabilities.getMaxAnisotropy());
	}
	const clamped = numberBetween(settings.anisotropy, settings.anisotropy, ANISOTROPY_MIN, max);
	if (clamped === settings.anisotropy) {
		return settings;
	}
	return { ...settings, anisotropy: clamped };
}

/**
 * @param {object|null|undefined} patch
 * @returns {object}
 */
function normalizeGlobalDefaultsPatch(patch) {
	if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
		return {};
	}
	const out = {};
	if (hasOwn(patch, "generateMipmaps")) {
		out.generateMipmaps = patch.generateMipmaps === true;
	}
	if (hasOwn(patch, "minFilter")) {
		const f = normalizeTextureFilter(patch.minFilter);
		if (f !== undefined) {
			out.minFilter = f;
		}
	}
	if (hasOwn(patch, "magFilter")) {
		const f = normalizeTextureFilter(patch.magFilter);
		if (f !== undefined) {
			out.magFilter = f;
		}
	}
	if (hasOwn(patch, "anisotropy")) {
		const n = Number(patch.anisotropy);
		if (Number.isFinite(n)) {
			out.anisotropy = numberBetween(n, n, ANISOTROPY_MIN, ANISOTROPY_MAX);
		}
	}
	if (hasOwn(patch, "colorSpace") && hasValue(patch.colorSpace)) {
		out.colorSpace = String(patch.colorSpace).trim().toLowerCase();
	}
	return out;
}

/**
 * @param {"ui"|"imageMap"|string} profileName
 * @param {object|null|undefined} [record]
 * @param {object} [context]
 * @returns {{ disabled: boolean, profileName: string, settings: object, explicitOnly: object }}
 */
export function resolveTextureProps(profileName, record, context = {}) {
	const resolvedProfile = profileName || "imageMap";
	const explicitOnly = extractExplicitTextureProps(record);
	const warnCtx = {
		threeJsonId: context.threeJsonId,
		materialPointer: context.materialPointer
	};

	if (isRecordTextureSamplingOptOut(record)) {
		let settings = { ...explicitOnly };
		settings = coerceFiltersForMipmaps(settings, warnCtx);
		settings = clampAnisotropyInSettings(settings, context.renderer);
		return {
			disabled: true,
			profileName: resolvedProfile,
			settings,
			explicitOnly
		};
	}

	const store = resolveStore(context.runtimeScope);
	const sceneTier = context.sceneTextureQuality !== undefined
		? context.sceneTextureQuality
		: store.sceneTextureQuality;
	const effectiveTier = resolveEffectiveTextureQuality(record, sceneTier);

	const builtin = BUILTIN_PROFILES[resolvedProfile] || BUILTIN_PROFILES.imageMap;
	let settings = { ...builtin };

	const globalPatch = context.textureDefaults?.[resolvedProfile]
		?? store.textureDefaults?.[resolvedProfile];
	if (globalPatch) {
		settings = mergeSettingsLayer(settings, normalizeGlobalDefaultsPatch(globalPatch));
	}

	if (effectiveTier !== null) {
		const tierBundle = expandQualityTier(resolvedProfile, effectiveTier);
		if (tierBundle) {
			settings = mergeSettingsLayer(settings, tierBundle);
		}
	}

	settings = mergeSettingsLayer(settings, explicitOnly);
	settings = coerceFiltersForMipmaps(settings, warnCtx);
	settings = clampAnisotropyInSettings(settings, context.renderer);

	return {
		disabled: false,
		profileName: resolvedProfile,
		settings,
		explicitOnly
	};
}

/**
 * @param {THREE.Texture} texture
 * @param {unknown} colorSpace
 */
function applyColorSpace(texture, colorSpace) {
	if (!hasValue(colorSpace) || THREE.SRGBColorSpace === undefined) {
		return;
	}
	const normalized = String(colorSpace).trim().toLowerCase();
	if (normalized === "srgb") {
		texture.colorSpace = THREE.SRGBColorSpace;
		return;
	}
	if (normalized === "linear" && THREE.LinearSRGBColorSpace !== undefined) {
		texture.colorSpace = THREE.LinearSRGBColorSpace;
		return;
	}
	if (normalized === "none" && THREE.NoColorSpace !== undefined) {
		texture.colorSpace = THREE.NoColorSpace;
	}
}

/**
 * @param {THREE.Texture|null|undefined} texture
 * @param {object} settings
 * @param {{ skipPreset?: boolean }} [opts]
 */
function applySettingsToTexture(texture, settings, opts = {}) {
	if (!(texture instanceof THREE.Texture) || !settings) {
		return texture;
	}
	if (!opts.skipPreset) {
		if (hasValue(settings.generateMipmaps)) {
			texture.generateMipmaps = settings.generateMipmaps === true;
		}
		if (hasValue(settings.minFilter)) {
			texture.minFilter = settings.minFilter;
		} else if (settings.generateMipmaps === false) {
			texture.minFilter = THREE.LinearFilter;
		}
		if (hasValue(settings.magFilter)) {
			texture.magFilter = settings.magFilter;
		} else if (settings.generateMipmaps === false) {
			texture.magFilter = THREE.LinearFilter;
		}
		if (hasValue(settings.anisotropy)) {
			texture.anisotropy = settings.anisotropy;
		}
		applyColorSpace(texture, settings.colorSpace);
	} else {
		const explicit = settings;
		if (hasValue(explicit.generateMipmaps)) {
			texture.generateMipmaps = explicit.generateMipmaps === true;
		}
		if (hasValue(explicit.minFilter)) {
			texture.minFilter = explicit.minFilter;
		}
		if (hasValue(explicit.magFilter)) {
			texture.magFilter = explicit.magFilter;
		}
		if (hasValue(explicit.anisotropy)) {
			texture.anisotropy = explicit.anisotropy;
		}
		if (hasValue(explicit.colorSpace)) {
			applyColorSpace(texture, explicit.colorSpace);
		}
	}
	if (texture.generateMipmaps === false) {
		texture.minFilter = hasValue(settings.minFilter) ? texture.minFilter : THREE.LinearFilter;
		texture.magFilter = hasValue(settings.magFilter) ? texture.magFilter : THREE.LinearFilter;
	}
	texture.needsUpdate = true;
	return texture;
}

/**
 * @param {object|null|undefined} normalized
 * @param {*} [runtimeScope]
 */
export function configureTextureDefaultsForDeploy(normalized, runtimeScope) {
	const store = resolveStore(runtimeScope);
	const cfg = normalized?.sceneConfig?.textureDefaults;
	store.sceneTextureQuality = resolveSceneTextureQuality(normalized);
	if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
		store.textureDefaults = null;
		return;
	}
	const nextDefaults = {};
	for (const key of Object.keys(cfg)) {
		const patch = normalizeGlobalDefaultsPatch(cfg[key]);
		if (Object.keys(patch).length) {
			nextDefaults[key] = patch;
		}
	}
	store.textureDefaults = Object.keys(nextDefaults).length ? nextDefaults : null;
}

/** @internal For tests */
export function _resetTextureSamplingForDeployForTests(runtimeScope) {
	resolveStore(runtimeScope).reset();
}

/**
 * @param {*} [runtimeScope]
 * @returns {{ textureDefaults: Record<string, object>|null, sceneTextureQuality: number|null }}
 */
export function getDeployTextureContext(runtimeScope) {
	const store = resolveStore(runtimeScope);
	return {
		textureDefaults: store.textureDefaults,
		sceneTextureQuality: store.sceneTextureQuality
	};
}

/**
 * @param {"ui"|"imageMap"|string} profileName
 * @param {object|null|undefined} [sourceRecord]
 * @param {object} [context]
 * @returns {{ disabled: boolean, profileName: string, settings: object }}
 */
export function resolveTextureSamplingSettings(profileName, sourceRecord, context = {}) {
	const { disabled, profileName: pn, settings } = resolveTextureProps(profileName, sourceRecord, context);
	return { disabled, profileName: pn, settings };
}

/**
 * @param {THREE.Texture|null|undefined} texture
 * @param {"ui"|"imageMap"|string} profileName
 * @param {object|null|undefined} [sourceRecord]
 * @param {object} [context]
 * @returns {THREE.Texture|null|undefined}
 */
export function applyTexturePropsFromRecord(texture, profileName, sourceRecord, context = {}) {
	if (!(texture instanceof THREE.Texture)) {
		return texture;
	}
	const { disabled, settings, explicitOnly } = resolveTextureProps(profileName, sourceRecord, context);
	if (disabled) {
		if (Object.keys(explicitOnly).length) {
			applySettingsToTexture(texture, explicitOnly, { skipPreset: true });
		}
		return texture;
	}
	return applySettingsToTexture(texture, settings);
}

/**
 * @param {THREE.Texture|null|undefined} map
 * @param {object|null|undefined} sourceRecord
 * @param {"ui"|"imageMap"|string} profileName
 * @param {object} [context]
 * @returns {THREE.Texture|null|undefined}
 */
export function syncTexturePropsToMap(map, sourceRecord, profileName, context = {}) {
	return applyTexturePropsFromRecord(map, profileName, sourceRecord, context);
}

/**
 * @param {THREE.Texture|null|undefined} texture
 * @param {"ui"|"imageMap"|string} profileName
 * @param {object|null|undefined} [sourceRecord]
 * @param {object} [context]
 * @returns {THREE.Texture|null|undefined}
 */
export function applyTextureSampling(texture, profileName, sourceRecord, context = {}) {
	return applyTexturePropsFromRecord(texture, profileName, sourceRecord, context);
}

/**
 * @param {THREE.Texture|null|undefined} texture
 * @param {object|null|undefined} [sourceRecord]
 * @param {object} [context]
 * @returns {THREE.Texture|null|undefined}
 */
export function applyUiTextureSampling(texture, sourceRecord, context = {}) {
	return applyTexturePropsFromRecord(texture, "ui", sourceRecord, context);
}

/**
 * @param {object} settings
 * @returns {string}
 */
export function formatTexturePropsSummary(settings) {
	if (!settings || typeof settings !== "object") {
		return "";
	}
	const parts = [];
	if (hasValue(settings.anisotropy)) {
		parts.push(`各向异性 ${settings.anisotropy}`);
	}
	const minS = serializeTextureFilter(settings.minFilter);
	const magS = serializeTextureFilter(settings.magFilter);
	if (minS) {
		parts.push(`min ${minS}`);
	}
	if (magS) {
		parts.push(`mag ${magS}`);
	}
	if (hasValue(settings.generateMipmaps)) {
		parts.push(settings.generateMipmaps ? "mipmap" : "no-mipmap");
	}
	return parts.join(" · ");
}

/**
 * @param {"ui"|"imageMap"|string} profileName
 * @param {object|null|undefined} record
 * @param {object} [context]
 * @returns {string}
 */
export function resolveEffectiveTextureSummary(profileName, record, context = {}) {
	const { settings } = resolveTextureProps(profileName, record, context);
	return formatTexturePropsSummary(settings);
}

/** @deprecated Use {@link configureTextureDefaultsForDeploy} */
export function configureTextureSamplingForDeploy(normalized) {
	configureTextureDefaultsForDeploy(normalized);
}
