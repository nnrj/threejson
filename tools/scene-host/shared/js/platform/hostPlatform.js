const DESKTOP_CAPABILITIES = Object.freeze({
  textureWrite: "textureWrite",
  textureBridge: "textureBridge",
  projectRoot: "projectRoot"
});

function resolveDesktopApi() {
  const api = globalThis?.ThreeJsonDesktop;
  if (!api || typeof api !== "object" || api.isDesktop !== true) {
    return null;
  }
  return api;
}

function createCapabilityMap(desktopApi) {
  return {
    [DESKTOP_CAPABILITIES.textureWrite]: typeof desktopApi?.saveTextureToProject === "function",
    [DESKTOP_CAPABILITIES.textureBridge]: typeof desktopApi?.runTextureBridge === "function",
    [DESKTOP_CAPABILITIES.projectRoot]: typeof desktopApi?.getProjectRoot === "function"
  };
}

export function getHostPlatform() {
  const desktopApi = resolveDesktopApi();
  if (!desktopApi) {
    return {
      kind: "web",
      isDesktop: false,
      capabilities: {},
      has(name) {
        return false;
      },
      invoke() {
        throw new Error("Desktop capability unavailable in web runtime.");
      }
    };
  }

  const capabilities = createCapabilityMap(desktopApi);
  return {
    kind: "desktop",
    isDesktop: true,
    capabilities,
    has(name) {
      return capabilities[name] === true;
    },
    invoke(name, ...args) {
      if (name === DESKTOP_CAPABILITIES.textureWrite) {
        return desktopApi.saveTextureToProject(...args);
      }
      if (name === DESKTOP_CAPABILITIES.textureBridge) {
        return desktopApi.runTextureBridge(...args);
      }
      if (name === DESKTOP_CAPABILITIES.projectRoot) {
        return desktopApi.getProjectRoot(...args);
      }
      throw new Error(`Unsupported desktop capability: ${String(name)}`);
    }
  };
}

export { DESKTOP_CAPABILITIES };
