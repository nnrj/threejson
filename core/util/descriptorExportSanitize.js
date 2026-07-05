/**
 * Sanitize box/primitive descriptors into a persistable JSON shape (export boundary).
 * Strips runtime `THREE.Texture` / serialized garbage from `map`, and omits runtime-expanded
 * six-face `materials[]` when safe.
 */

import { isDefaultTextureRepeat } from "./loadTextureFromMaterialJson.js";
import {
	isRecordTextureSamplingOptOut,
	isTextureSamplingOptOut,
	parseTextureQuality,
	serializeTextureFilter
} from "./textureSampling.js";

function materialMapStringResolvableAsUrl(mapStr) {
  const s = typeof mapStr === "string" ? mapStr.trim() : "";
  if (!s.length) {
    return false;
  }
  return (
    /^data:/i.test(s)
    || /^https?:\/\//i.test(s)
    || s.startsWith("//")
    || s.startsWith("/")
    || /^\.{1,2}\//.test(s)
  );
}

/**
 * @param {unknown} mapValue
 * @returns {boolean} Whether the value should be kept in exported JSON
 */
function shouldKeepMapForExport(mapValue) {
  if (mapValue === undefined || mapValue === null) {
    return false;
  }
  if (typeof mapValue === "string") {
    return materialMapStringResolvableAsUrl(mapValue);
  }
  return false;
}

function sanitizeTextureSamplingFieldsForExport(material) {
	if (!material || typeof material !== "object") {
		return;
	}
	if (isTextureSamplingOptOut(material.textureSampling)) {
		material.textureQuality = 0;
		delete material.textureSampling;
	}
	const tier = parseTextureQuality(material.textureQuality);
	if (tier === null) {
		delete material.textureQuality;
	} else {
		material.textureQuality = tier;
	}
	if (isRecordTextureSamplingOptOut(material) && tier === 0) {
		delete material.textureSampling;
	}
	if (typeof material.minFilter === "number") {
		const s = serializeTextureFilter(material.minFilter);
		if (s) {
			material.minFilter = s;
		}
	}
	if (typeof material.magFilter === "number") {
		const s = serializeTextureFilter(material.magFilter);
		if (s) {
			material.magFilter = s;
		}
	}
}

/**
 * @param {object|null|undefined} material
 * @returns {object|null|undefined}
 */
function sanitizeMaterialJsonForExport(material) {
  if (!material || typeof material !== "object" || Array.isArray(material)) {
    return material;
  }
  const out = { ...material };
  if ("map" in out && !shouldKeepMapForExport(out.map)) {
    delete out.map;
  }
  if (isDefaultTextureRepeat(out.textureRepeat)) {
    delete out.textureRepeat;
  }
  sanitizeTextureSamplingFieldsForExport(out);
  return out;
}

/**
 * @param {object|null|undefined} material
 * @returns {string}
 */
function materialPersistSignature(material) {
  if (!material || typeof material !== "object") {
    return "";
  }
  const parts = [
    String(material.type || ""),
    String(material.color || ""),
    String(material.opacity ?? ""),
    String(material.transparent ?? ""),
    String(material.textureKind || material.mapSourceKind || "")
  ];
  const url = material.textureUrl && String(material.textureUrl).trim();
  if (url) {
    parts.push(`u:${url}`);
  } else if (typeof material.map === "string" && materialMapStringResolvableAsUrl(material.map)) {
    parts.push(`m:${material.map.trim()}`);
  }
  const tr = material.textureRepeat;
  if (tr && typeof tr === "object" && !isDefaultTextureRepeat(tr)) {
    parts.push(`r:${tr.x ?? ""},${tr.y ?? ""}`);
  }
  const tq = parseTextureQuality(material.textureQuality);
  if (tq !== null) {
    parts.push(`tq:${tq}`);
  }
  if (material.generateMipmaps === true || material.generateMipmaps === false) {
    parts.push(`gm:${material.generateMipmaps}`);
  }
  if (material.minFilter !== undefined) {
    parts.push(`min:${material.minFilter}`);
  }
  if (material.magFilter !== undefined) {
    parts.push(`mag:${material.magFilter}`);
  }
  if (material.anisotropy !== undefined) {
    parts.push(`an:${material.anisotropy}`);
  }
  if (material.colorSpace) {
    parts.push(`cs:${material.colorSpace}`);
  }
  if (isTextureSamplingOptOut(material.textureSampling)) {
    parts.push("opt:1");
  }
  return parts.join("|");
}

/**
 * Whether this is a six-face uniform material expanded in-place by createTextureBox/createNormalBox
 * (materials can be safely omitted).
 * @param {object} record
 * @returns {boolean}
 */
function detectRuntimeMaterialsArray(record) {
  const material = record?.material;
  if (!material || typeof material !== "object" || Array.isArray(material)) {
    return false;
  }
  const materials = record.materials;
  if (!Array.isArray(materials) || materials.length !== 6) {
    return false;
  }
  let allSameRef = true;
  for (let i = 0; i < 6; i += 1) {
    if (materials[i] !== material) {
      allSameRef = false;
      break;
    }
  }
  if (allSameRef) {
    return true;
  }
  const baseSig = materialPersistSignature(material);
  if (!baseSig) {
    return false;
  }
  for (let i = 0; i < 6; i += 1) {
    const mi = materials[i];
    if (!mi || typeof mi !== "object" || materialPersistSignature(mi) !== baseSig) {
      return false;
    }
  }
  return true;
}

const NESTED_RECORD_ARRAY_KEYS = ["joins", "inters", "holes", "subScene"];

const WORLD_INFO_LIST_KEYS = [
  "boxModelList",
  "sphereModelList",
  "groupList",
  "lineList",
  "heatList",
  "windList",
  "shaderSurfaceList",
  "infoPanelList",
  "css3dPanelList",
  "objModelList"
];

/**
 * @param {object} record
 * @returns {object}
 */
function sanitizeObjectRecordForExport(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return record;
  }
  const out = { ...record };

  if (out.material && typeof out.material === "object") {
    out.material = sanitizeMaterialJsonForExport(out.material);
  }
  if (Array.isArray(out.materials)) {
    out.materials = out.materials.map((entry) => sanitizeMaterialJsonForExport(entry));
  }
  if (Array.isArray(out.materialArr)) {
    out.materialArr = out.materialArr.map((entry) => sanitizeMaterialJsonForExport(entry));
  }

  for (let i = 0; i < NESTED_RECORD_ARRAY_KEYS.length; i += 1) {
    const key = NESTED_RECORD_ARRAY_KEYS[i];
    if (Array.isArray(out[key])) {
      out[key] = out[key].map((entry) => sanitizeObjectRecordForExport(entry));
    }
  }

  if (detectRuntimeMaterialsArray(out)) {
    delete out.materials;
  }

  return out;
}

/**
 * @param {object|null|undefined} worldInfo
 * @returns {object|null|undefined}
 */
function sanitizeWorldInfoForExport(worldInfo) {
  if (!worldInfo || typeof worldInfo !== "object" || Array.isArray(worldInfo)) {
    return worldInfo;
  }
  const out = { ...worldInfo };

  for (let i = 0; i < WORLD_INFO_LIST_KEYS.length; i += 1) {
    const key = WORLD_INFO_LIST_KEYS[i];
    if (Array.isArray(out[key])) {
      out[key] = out[key].map((entry) => sanitizeObjectRecordForExport(entry));
    }
  }

  if (Array.isArray(out.domainModelList)) {
    out.domainModelList = out.domainModelList.map((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        return block;
      }
      const next = { ...block };
      if (Array.isArray(next.items)) {
        next.items = next.items.map((entry) => sanitizeObjectRecordForExport(entry));
      }
      return next;
    });
  }

  return out;
}

/**
 * @param {object} record
 * @returns {object}
 */
function cloneAndSanitizeObjectRecordForExport(record) {
  const cloned = JSON.parse(JSON.stringify(record));
  return sanitizeObjectRecordForExport(cloned);
}

export {
  cloneAndSanitizeObjectRecordForExport,
  detectRuntimeMaterialsArray,
  materialMapStringResolvableAsUrl,
  materialPersistSignature,
  sanitizeMaterialJsonForExport,
  sanitizeObjectRecordForExport,
  sanitizeWorldInfoForExport,
  shouldKeepMapForExport
};
