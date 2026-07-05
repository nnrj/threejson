const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("threejsonElectron", {
  platform: process.platform
});
