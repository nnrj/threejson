import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ThreeJsonDesktop", {
  isDesktop: true,
  getProjectRoot: () => ipcRenderer.invoke("threejson:getProjectRoot"),
  saveTextureToProject: (relativePath, bytes) =>
    ipcRenderer.invoke("threejson:saveTexture", { relativePath, bytes }),
  runTextureBridge: (payload) => ipcRenderer.invoke("threejson:runTextureBridge", payload)
});
