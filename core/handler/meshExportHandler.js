import { resolveObjectById } from "../util/objectExportUtil.js";
import { prepareMeshExportRoot } from "../util/meshExportPrepare.js";

const SUPPORTED_MESH_FORMATS = new Set([
  "glb",
  "gltf",
  "obj",
  "stl",
  "ply",
  "usdz",
  "fbx"
]);

/** @type {Record<string, { extension: string, mimeType: string, defaultBinary: boolean }>} */
const FORMAT_META = {
  glb: { extension: "glb", mimeType: "model/gltf-binary", defaultBinary: true },
  gltf: { extension: "gltf", mimeType: "model/gltf+json", defaultBinary: false },
  obj: { extension: "obj", mimeType: "text/plain", defaultBinary: false },
  stl: { extension: "stl", mimeType: "model/stl", defaultBinary: true },
  ply: { extension: "ply", mimeType: "application/octet-stream", defaultBinary: true },
  usdz: { extension: "usdz", mimeType: "model/vnd.usdz+zip", defaultBinary: true },
  fbx: { extension: "fbx", mimeType: "application/octet-stream", defaultBinary: true }
};

function normalizeMeshFormat(format) {
  const key = typeof format === "string" ? format.trim().toLowerCase() : "";
  if (!SUPPORTED_MESH_FORMATS.has(key)) {
    const error = new Error(`E_MESH_EXPORT_FORMAT_INVALID: unsupported format "${format}"`);
    error.code = "E_MESH_EXPORT_FORMAT_INVALID";
    throw error;
  }
  return key;
}

function resolveOutputType(format, options = {}) {
  if (typeof options.outputType === "string") {
    const t = options.outputType.trim().toLowerCase();
    if (t === "arraybuffer" || t === "string") {
      return t;
    }
    const error = new Error(`E_MESH_EXPORT_OUTPUT_INVALID: unsupported outputType "${options.outputType}"`);
    error.code = "E_MESH_EXPORT_OUTPUT_INVALID";
    throw error;
  }
  if (format === "gltf" || format === "obj") {
    return "string";
  }
  return "arraybuffer";
}

function isPlainExporterObject(data) {
  return data !== null
    && typeof data === "object"
    && !(data instanceof ArrayBuffer)
    && !ArrayBuffer.isView(data);
}

function toArrayBuffer(data, options = {}) {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  if (typeof data === "string") {
    return new TextEncoder().encode(data).buffer;
  }
  if (isPlainExporterObject(data)) {
    const space = Number.isFinite(options.jsonSpace) ? options.jsonSpace : 2;
    return new TextEncoder().encode(JSON.stringify(data, null, space)).buffer;
  }
  const error = new Error("E_MESH_EXPORT_ENCODE_FAILED: exporter returned unsupported data type");
  error.code = "E_MESH_EXPORT_ENCODE_FAILED";
  throw error;
}

function toOutputData(raw, outputType, options = {}) {
  if (isPlainExporterObject(raw)) {
    const space = Number.isFinite(options.jsonSpace) ? options.jsonSpace : 2;
    const jsonText = JSON.stringify(raw, null, space);
    if (outputType === "string") {
      return jsonText;
    }
    return new TextEncoder().encode(jsonText).buffer;
  }
  if (outputType === "string") {
    if (typeof raw === "string") {
      return raw;
    }
    if (raw instanceof ArrayBuffer) {
      return new TextDecoder().decode(raw);
    }
    if (ArrayBuffer.isView(raw)) {
      return new TextDecoder().decode(raw);
    }
    const error = new Error("E_MESH_EXPORT_ENCODE_FAILED: cannot encode exporter result as string");
    error.code = "E_MESH_EXPORT_ENCODE_FAILED";
    throw error;
  }
  return toArrayBuffer(raw, options);
}

async function loadExporterModule(format) {
  switch (format) {
    case "glb":
    case "gltf":
      return import("three/examples/jsm/exporters/GLTFExporter.js");
    case "obj":
      return import("three/examples/jsm/exporters/OBJExporter.js");
    case "stl":
      return import("three/examples/jsm/exporters/STLExporter.js");
    case "ply":
      return import("three/examples/jsm/exporters/PLYExporter.js");
    case "usdz":
      return import("three/examples/jsm/exporters/USDZExporter.js");
    case "fbx": {
      const fbxExporterPkg = "@comfyorg/fbx-exporter-three";
      try {
        return import(fbxExporterPkg);
      } catch (error) {
        const wrapped = new Error(
          "E_MESH_FBX_UNAVAILABLE: install optional dependency @comfyorg/fbx-exporter-three to enable FBX export"
        );
        wrapped.code = "E_MESH_FBX_UNAVAILABLE";
        wrapped.cause = error;
        throw wrapped;
      }
    }
    default:
      return null;
  }
}

async function injectTextureUtilsIfNeeded(exporter, _renderer) {
  if (typeof exporter?.setTextureUtils !== "function") {
    return;
  }
  // r184+: WebGLTextureUtils is a namespace module (export function decompress), not a class constructor
  const textureUtilsModule = await import("three/examples/jsm/utils/WebGLTextureUtils.js");
  exporter.setTextureUtils(textureUtilsModule);
}

async function runFormatExporter(format, exportRoot, options = {}) {
  const meta = FORMAT_META[format];
  const binary = typeof options.binary === "boolean" ? options.binary : meta.defaultBinary;
  const started = Date.now();

  if (format === "usdz" && typeof document === "undefined") {
    const error = new Error("E_MESH_USDZ_REQUIRES_BROWSER: USDZ export requires a browser environment");
    error.code = "E_MESH_USDZ_REQUIRES_BROWSER";
    throw error;
  }

  const mod = await loadExporterModule(format);
  if (!mod) {
    const error = new Error(`E_MESH_EXPORT_FORMAT_INVALID: no exporter for "${format}"`);
    error.code = "E_MESH_EXPORT_FORMAT_INVALID";
    throw error;
  }

  let raw;

  if (format === "glb" || format === "gltf") {
    const { GLTFExporter } = mod;
    const exporter = new GLTFExporter();
    await injectTextureUtilsIfNeeded(exporter, options.renderer);
    raw = await exporter.parseAsync(exportRoot, { binary: format === "glb" || binary });
  } else if (format === "obj") {
    const { OBJExporter } = mod;
    const exporter = new OBJExporter();
    raw = exporter.parse(exportRoot);
  } else if (format === "stl") {
    const { STLExporter } = mod;
    const exporter = new STLExporter();
    raw = exporter.parse(exportRoot, { binary });
  } else if (format === "ply") {
    const { PLYExporter } = mod;
    const exporter = new PLYExporter();
    raw = exporter.parse(exportRoot, undefined, { binary });
  } else if (format === "usdz") {
    const { USDZExporter } = mod;
    const exporter = new USDZExporter();
    await injectTextureUtilsIfNeeded(exporter, options.renderer);
    raw = await exporter.parseAsync(exportRoot, options.usdzOptions || {});
  } else if (format === "fbx") {
    const { FBXExporter } = mod;
    const exporter = new FBXExporter();
    if (typeof exporter.parseAsync === "function") {
      raw = await exporter.parseAsync(exportRoot, {
        preset: options.fbxPreset || "threejs",
        binary
      });
    } else if (typeof exporter.parse === "function") {
      raw = exporter.parse(exportRoot, { preset: options.fbxPreset || "threejs", binary });
    } else {
      const error = new Error("E_MESH_FBX_UNAVAILABLE: FBXExporter API is not supported");
      error.code = "E_MESH_FBX_UNAVAILABLE";
      throw error;
    }
  }

  if (raw === undefined || raw === null) {
    const error = new Error("E_MESH_EXPORT_FAILED: exporter returned empty result");
    error.code = "E_MESH_EXPORT_FAILED";
    throw error;
  }

  return { raw, durationMs: Date.now() - started };
}

function buildFileNameHint(format, options = {}) {
  const meta = FORMAT_META[format];
  const stem = typeof options.fileNameStem === "string" && options.fileNameStem.trim()
    ? options.fileNameStem.trim().replace(/[\\/:*?"<>|]+/g, "_")
    : "export";
  return `${stem}.${meta.extension}`;
}

function isUsableTextureImage(image) {
  if (!image) {
    return false;
  }
  if (image.data !== undefined) {
    return Number(image.width) > 0 && Number(image.height) > 0;
  }
  return Number(image.width || image.videoWidth || image.naturalWidth) > 0
    && Number(image.height || image.videoHeight || image.naturalHeight) > 0;
}

function listMaterialTextureSlots(root) {
  const slots = [];
  root?.traverse?.((object3D) => {
    const materials = Array.isArray(object3D?.material)
      ? object3D.material
      : object3D?.material
        ? [object3D.material]
        : [];
    for (const material of materials) {
      for (const key of Object.keys(material || {})) {
        const texture = material[key];
        if (texture?.isTexture === true) {
          slots.push({ material, key, texture });
        }
      }
    }
  });
  return slots;
}

async function loadExportableTextureImage(url, options = {}) {
  const fetchFn = options.fetchTexture || globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("fetch is unavailable");
  }
  const response = await fetchFn(url, { mode: "cors", signal: options.signal });
  if (!response?.ok) {
    throw new Error(`HTTP ${response?.status || "error"}`);
  }
  const blob = await response.blob();
  const createBitmap = options.createImageBitmap || globalThis.createImageBitmap;
  if (typeof createBitmap === "function") {
    return createBitmap(blob);
  }
  if (typeof document === "undefined" || typeof Image === "undefined") {
    throw new Error("no browser image decoder is available");
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image decode failed"));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Makes asynchronously-loaded URL textures exportable without mutating the live scene. The root
 * passed here is the cloned export root produced by prepareMeshExportRoot.
 */
async function prepareMeshExportTextures(root, options = {}) {
  const slots = listMaterialTextureSlots(root);
  const byTexture = new Map();
  for (const slot of slots) {
    if (!byTexture.has(slot.texture)) {
      byTexture.set(slot.texture, []);
    }
    byTexture.get(slot.texture).push(slot);
  }

  const warnings = [];
  const createdImages = [];
  try {
    await Promise.all(Array.from(byTexture.entries(), async ([texture, textureSlots]) => {
      if (isUsableTextureImage(texture.image)) {
        return;
      }
      const sourceImage = texture.source?.data;
      const url = String(
        texture.userData?.threeJsonResolvedUrl || sourceImage?.currentSrc || sourceImage?.src || ""
      ).trim();
      try {
        if (!url) {
          throw new Error("texture has no resolved source URL");
        }
        const image = await loadExportableTextureImage(url, options);
        if (!isUsableTextureImage(image)) {
          throw new Error("decoded image has no dimensions");
        }
        texture.image = image;
        texture.needsUpdate = true;
        if (typeof image.close === "function") {
          createdImages.push(image);
        }
      } catch (error) {
        if (options.textureFailurePolicy === "error") {
          throw error;
        }
        for (const slot of textureSlots) {
          slot.material[slot.key] = null;
        }
        warnings.push({
          code: "texture_unavailable",
          message: `Omitted an unreadable texture during model export${url ? `: ${url}` : "."}`,
          url,
          cause: error
        });
      }
    }));
  } catch (error) {
    for (const image of createdImages) {
      image.close?.();
    }
    throw error;
  }
  return {
    warnings,
    cleanup() {
      for (const image of createdImages) {
        image.close?.();
      }
    }
  };
}

/**
 * @param {import("three").Scene | { scene: import("three").Scene } | import("three").Object3D} target
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function exportMesh(target, options = {}) {
  const format = normalizeMeshFormat(options.format || "glb");
  const outputType = resolveOutputType(format, options);
  const prepared = prepareMeshExportRoot(target, options);
  const exportStarted = Date.now();
  const texturePreparation = (format === "glb" || format === "gltf" || format === "usdz")
    ? await prepareMeshExportTextures(prepared.exportRoot, options)
    : { warnings: [], cleanup() {} };
  prepared.warnings.push(...texturePreparation.warnings);
  let exporterResult;
  try {
    exporterResult = await runFormatExporter(format, prepared.exportRoot, options);
  } finally {
    texturePreparation.cleanup();
  }
  const { raw, durationMs: exporterDurationMs } = exporterResult;
  const meta = FORMAT_META[format];
  const data = toOutputData(raw, outputType, options);

  return {
    format,
    data,
    mimeType: meta.mimeType,
    extension: meta.extension,
    fileNameHint: buildFileNameHint(format, options),
    warnings: prepared.warnings,
    omittedExternalModels: prepared.omitted,
    stats: {
      ...prepared.stats,
      exporterDurationMs,
      durationMs: Date.now() - exportStarted
    }
  };
}

/**
 * @param {import("three").Scene | { scene: import("three").Scene }} target
 * @param {string} id
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function exportMeshObject(target, id, options = {}) {
  const object3D = resolveObjectById(target, id, options.by || "threeJsonId");
  if (!object3D) {
    const by = options.by || "threeJsonId";
    const error = new Error(`E_EXPORT_OBJECT_NOT_FOUND: object not found by ${by}="${id}"`);
    error.code = "E_EXPORT_OBJECT_NOT_FOUND";
    throw error;
  }
  const descriptor = object3D.userData?.objJson;
  const stem = typeof options.fileNameStem === "string" && options.fileNameStem.trim()
    ? options.fileNameStem.trim()
    : (descriptor?.name || descriptor?.objType || object3D.name || "object");
  return exportMesh(target, {
    ...options,
    scope: "object",
    object3D,
    externalModelPolicy: options.externalModelPolicy || "include",
    fileNameStem: stem
  });
}

export {
  SUPPORTED_MESH_FORMATS,
  FORMAT_META,
  exportMesh,
  exportMeshObject,
  prepareMeshExportTextures,
  normalizeMeshFormat
};
