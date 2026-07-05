import * as THREE from "three";

/** Import formats symmetric to mesh export and routed through `externalModel` JSON pipeline. */
const SUPPORTED_MESH_IMPORT_FORMATS = new Set([
  "glb",
  "gltf",
  "obj",
  "stl",
  "ply",
  "usdz",
  "fbx"
]);

const MESH_IMPORT_EXTENSION_ALIASES = {
  usd: "usdz"
};

/**
 * @param {string} format
 * @returns {string}
 */
function normalizeMeshImportFormat(format) {
  const key = typeof format === "string" ? format.trim().toLowerCase() : "";
  const normalized = MESH_IMPORT_EXTENSION_ALIASES[key] || key;
  if (!SUPPORTED_MESH_IMPORT_FORMATS.has(normalized)) {
    const error = new Error(`E_MESH_IMPORT_FORMAT_INVALID: unsupported format "${format}"`);
    error.code = "E_MESH_IMPORT_FORMAT_INVALID";
    throw error;
  }
  return normalized;
}

/**
 * @param {string} fileName
 * @returns {string}
 */
function inferMeshImportFormatFromFileName(fileName) {
  if (typeof fileName !== "string" || !fileName.trim()) {
    const error = new Error("E_MESH_IMPORT_FORMAT_INVALID: missing file name");
    error.code = "E_MESH_IMPORT_FORMAT_INVALID";
    throw error;
  }
  const normalized = fileName.trim().replace(/\\/g, "/");
  const base = normalized.split("/").pop() || normalized;
  const dotIndex = base.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === base.length - 1) {
    const error = new Error(`E_MESH_IMPORT_FORMAT_INVALID: cannot infer format from "${fileName}"`);
    error.code = "E_MESH_IMPORT_FORMAT_INVALID";
    throw error;
  }
  return normalizeMeshImportFormat(base.slice(dotIndex + 1));
}

/**
 * @param {string} format
 * @returns {Promise<object>}
 */
async function loadMeshLoaderModule(format) {
  const key = normalizeMeshImportFormat(format);
  switch (key) {
    case "glb":
    case "gltf":
      return import("three/examples/jsm/loaders/GLTFLoader.js");
    case "obj":
      return import("three/examples/jsm/loaders/OBJLoader.js");
    case "stl":
      return import("three/examples/jsm/loaders/STLLoader.js");
    case "ply":
      return import("three/examples/jsm/loaders/PLYLoader.js");
    case "fbx":
      return import("three/examples/jsm/loaders/FBXLoader.js");
    case "usdz":
      return import("three/examples/jsm/loaders/USDLoader.js");
    default: {
      const error = new Error(`E_MESH_IMPORT_FORMAT_INVALID: unsupported format "${format}"`);
      error.code = "E_MESH_IMPORT_FORMAT_INVALID";
      throw error;
    }
  }
}

/**
 * @param {string} url
 * @param {THREE.LoadingManager} [loadingManager]
 * @returns {Promise<ArrayBuffer>}
 */
function readMeshArrayBufferFromUrl(url, loadingManager) {
  return new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error("E_MESH_IMPORT_READ_FAILED: empty url"));
      return;
    }
    const loader = new THREE.FileLoader(loadingManager);
    loader.setResponseType("arraybuffer");
    loader.load(
      url,
      (data) => {
        if (data instanceof ArrayBuffer) {
          resolve(data);
          return;
        }
        if (ArrayBuffer.isView(data)) {
          resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
          return;
        }
        reject(new Error("E_MESH_IMPORT_READ_FAILED: FileLoader returned non-binary data"));
      },
      undefined,
      (error) => {
        const wrapped = new Error(
          `E_MESH_IMPORT_READ_FAILED: ${error instanceof Error ? error.message : String(error)}`
        );
        wrapped.code = "E_MESH_IMPORT_READ_FAILED";
        wrapped.cause = error;
        reject(wrapped);
      }
    );
  });
}

/**
 * @param {*} result
 * @returns {import("three").Object3D}
 */
function ensureObject3DFromLoaderResult(result) {
  if (!result) {
    const error = new Error("E_MESH_IMPORT_PARSE_FAILED: loader returned empty result");
    error.code = "E_MESH_IMPORT_PARSE_FAILED";
    throw error;
  }
  if (result.isObject3D) {
    return result;
  }
  if (result.isBufferGeometry) {
    const material = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
    return new THREE.Mesh(result, material);
  }
  const error = new Error("E_MESH_IMPORT_PARSE_FAILED: loader returned unsupported result type");
  error.code = "E_MESH_IMPORT_PARSE_FAILED";
  throw error;
}

/**
 * @param {string} format
 * @param {ArrayBuffer|Uint8Array|string} data
 * @param {{ resourcePath?: string, fileName?: string, loadingManager?: THREE.LoadingManager }} [options]
 * @returns {Promise<import("three").Object3D>}
 */
async function parseMeshArrayBufferToObject3D(format, data, options = {}) {
  const key = normalizeMeshImportFormat(format);
  const module = await loadMeshLoaderModule(key);
  const resourcePath = typeof options.resourcePath === "string" ? options.resourcePath : "";
  const fileName = typeof options.fileName === "string" ? options.fileName : "";

  if (key === "gltf" || key === "glb") {
    const loader = new module.GLTFLoader(options.loadingManager);
    return new Promise((resolve, reject) => {
      try {
        loader.parse(
          data,
          resourcePath,
          (gltf) => {
            if (!gltf?.scene) {
              reject(new Error("E_MESH_IMPORT_PARSE_FAILED: GLTFLoader returned empty scene"));
              return;
            }
            resolve(gltf.scene);
          },
          (error) => {
            const wrapped = new Error(
              `E_MESH_IMPORT_PARSE_FAILED: ${error instanceof Error ? error.message : String(error)}`
            );
            wrapped.code = "E_MESH_IMPORT_PARSE_FAILED";
            wrapped.cause = error;
            reject(wrapped);
          }
        );
      } catch (error) {
        const wrapped = new Error(
          `E_MESH_IMPORT_PARSE_FAILED: ${error instanceof Error ? error.message : String(error)}`
        );
        wrapped.code = "E_MESH_IMPORT_PARSE_FAILED";
        wrapped.cause = error;
        reject(wrapped);
      }
    });
  }

  if (key === "obj") {
    const loader = new module.OBJLoader(options.loadingManager);
    const text = typeof data === "string"
      ? data
      : new TextDecoder().decode(data instanceof ArrayBuffer ? data : data.buffer);
    try {
      return ensureObject3DFromLoaderResult(loader.parse(text));
    } catch (error) {
      const wrapped = new Error(
        `E_MESH_IMPORT_PARSE_FAILED: ${error instanceof Error ? error.message : String(error)}`
      );
      wrapped.code = "E_MESH_IMPORT_PARSE_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
  }

  if (key === "fbx") {
    const loader = new module.FBXLoader(options.loadingManager);
    if (resourcePath) {
      loader.setResourcePath(resourcePath);
    }
    try {
      return ensureObject3DFromLoaderResult(loader.parse(data, fileName || resourcePath));
    } catch (error) {
      const wrapped = new Error(
        `E_MESH_IMPORT_PARSE_FAILED: ${error instanceof Error ? error.message : String(error)}`
      );
      wrapped.code = "E_MESH_IMPORT_PARSE_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
  }

  if (key === "usdz") {
    const loader = new module.USDLoader(options.loadingManager);
    if (resourcePath) {
      loader.setResourcePath(resourcePath);
    }
    try {
      const group = loader.parse(data);
      if (!group) {
        const error = new Error("E_MESH_IMPORT_PARSE_FAILED: USDLoader returned empty group");
        error.code = "E_MESH_IMPORT_PARSE_FAILED";
        throw error;
      }
      return ensureObject3DFromLoaderResult(group);
    } catch (error) {
      if (error?.code === "E_MESH_IMPORT_PARSE_FAILED") {
        throw error;
      }
      const wrapped = new Error(
        `E_MESH_IMPORT_PARSE_FAILED: ${error instanceof Error ? error.message : String(error)}`
      );
      wrapped.code = "E_MESH_IMPORT_PARSE_FAILED";
      wrapped.cause = error;
      throw wrapped;
    }
  }

  const LoaderClass = key === "stl" ? module.STLLoader : module.PLYLoader;
  const loader = new LoaderClass(options.loadingManager);
  try {
    return ensureObject3DFromLoaderResult(loader.parse(data));
  } catch (error) {
    const wrapped = new Error(
      `E_MESH_IMPORT_PARSE_FAILED: ${error instanceof Error ? error.message : String(error)}`
    );
    wrapped.code = "E_MESH_IMPORT_PARSE_FAILED";
    wrapped.cause = error;
    throw wrapped;
  }
}

/** External model types parsed via buffer (excludes gltf/glb/obj/three-native). */
const BUFFER_EXTERNAL_MESH_TYPES = new Set(["stl", "ply", "fbx", "usdz", "usd"]);

function isBufferExternalMeshType(format) {
  const key = typeof format === "string" ? format.trim().toLowerCase() : "";
  return BUFFER_EXTERNAL_MESH_TYPES.has(key) || BUFFER_EXTERNAL_MESH_TYPES.has(MESH_IMPORT_EXTENSION_ALIASES[key] || "");
}

export {
  SUPPORTED_MESH_IMPORT_FORMATS,
  BUFFER_EXTERNAL_MESH_TYPES,
  normalizeMeshImportFormat,
  inferMeshImportFormatFromFileName,
  loadMeshLoaderModule,
  readMeshArrayBufferFromUrl,
  parseMeshArrayBufferToObject3D,
  isBufferExternalMeshType
};
