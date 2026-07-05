import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("threejsonElectron", {
  platform: process.platform
});
