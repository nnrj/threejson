import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("ThreeJsonDesktop", {
  isDesktop: true
});
