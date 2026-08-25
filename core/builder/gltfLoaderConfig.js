import * as THREE from "three";

function objectOr(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

export function deriveThreeExamplesVersion(revision = THREE.REVISION) {
  const number = Number.parseInt(String(revision || "").replace(/^r/i, ""), 10);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`[gltfLoaderConfig] cannot derive Three.js npm version from revision: ${revision}`);
  }
  return `0.${number}.0`;
}

export function deriveDracoDecoderPath(revision = THREE.REVISION) {
  return `https://cdn.jsdelivr.net/npm/three@${deriveThreeExamplesVersion(revision)}/examples/jsm/libs/draco/gltf/`;
}

/** Resolve host and descriptor decoder settings without performing imports or network requests. */
export function resolveGltfLoaderConfig(descriptor = {}, loadOptions = {}) {
  const host = objectOr(loadOptions.gltf ?? loadOptions.gltfLoader);
  const local = objectOr(descriptor.gltf);
  const decoderPaths = {
    ...objectOr(loadOptions.decoderPaths),
    ...objectOr(descriptor.decoderPaths)
  };
  const dracoLocal = objectOr(local.draco);
  const dracoHost = objectOr(host.draco);
  const meshoptLocal = objectOr(local.meshopt);
  const meshoptHost = objectOr(host.meshopt);
  const ktx2Local = objectOr(local.ktx2);
  const ktx2Host = objectOr(host.ktx2);
  const dracoDisabled = local.draco === false || host.draco === false;
  const meshoptDisabled = local.meshopt === false || host.meshopt === false;
  const ktx2Enabled = local.ktx2 === true || host.ktx2 === true || ktx2Local.enabled === true || ktx2Host.enabled === true;
  return {
    draco: {
      enabled: !dracoDisabled,
      decoderPath: dracoLocal.decoderPath || dracoHost.decoderPath || decoderPaths.draco || deriveDracoDecoderPath(),
      decoderConfig: dracoLocal.decoderConfig || dracoHost.decoderConfig
    },
    meshopt: { enabled: !meshoptDisabled },
    ktx2: {
      enabled: ktx2Enabled,
      transcoderPath: ktx2Local.transcoderPath || ktx2Host.transcoderPath || decoderPaths.ktx2 || ""
    }
  };
}

/** Configure optional GLTF decoders only when a GLTF model is actually requested. */
export async function configureGltfLoader(loader, descriptor = {}, loadOptions = {}) {
  if (!loader) throw new Error("[gltfLoaderConfig] GLTFLoader is required");
  const config = resolveGltfLoaderConfig(descriptor, loadOptions);
  const resources = [];
  if (config.draco.enabled) {
    const { DRACOLoader } = await import("three/examples/jsm/loaders/DRACOLoader.js");
    const draco = new DRACOLoader(loadOptions.loadingManager);
    draco.setDecoderPath(config.draco.decoderPath);
    if (config.draco.decoderConfig) draco.setDecoderConfig(config.draco.decoderConfig);
    loader.setDRACOLoader(draco);
    resources.push(draco);
  }
  if (config.meshopt.enabled) {
    const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  if (config.ktx2.enabled) {
    if (!config.ktx2.transcoderPath) {
      throw new Error("[gltfLoaderConfig] KTX2 is enabled but transcoderPath is missing");
    }
    if (!loadOptions.renderer) {
      throw new Error("[gltfLoaderConfig] KTX2 is enabled but a renderer was not supplied for detectSupport()");
    }
    const { KTX2Loader } = await import("three/examples/jsm/loaders/KTX2Loader.js");
    const ktx2 = new KTX2Loader(loadOptions.loadingManager);
    ktx2.setTranscoderPath(config.ktx2.transcoderPath);
    ktx2.detectSupport(loadOptions.renderer);
    loader.setKTX2Loader(ktx2);
    resources.push(ktx2);
  }
  return { loader, resources, config };
}

