import "./cabinetSubSceneDeploy.js";
import { log } from "../../../core/util/logger.js";
import {
  createCabinet,
  createCabinetJson,
  deployCabinet
} from "./cabinetFactory.js";
import {
  capturePersistDescriptor,
  cabinetPersistMergeKey,
  mergePersistDescriptor
} from "./cabinetPersist.js";
import {
  clearCabinetStatView,
  mapUtilizationRateToColor,
  showCapacityStats,
  showLoadStats,
  showRackSpaceStats,
  showUUsageStats
} from "./cabinetHandler.js";
import { computeCabinetStats, getUUsage, normalizeSlots } from "../deviceShared.js";
import {
  addDevice,
  findCabinetByThreeJsonId,
  getSlotOccupancy,
  removeDevice
} from "./cabinetRuntime.js";

function resolveCabinetDomainModel(record, scene) {
  const handler = record.handler ?? "deployCabinet";
  if (handler === "deployCabinet" || handler === "createCabinet") {
    deployCabinet(record, scene);
    return;
  }
  log.warn("[device.cabinet] unknown handler:", handler);
}

function addToScene(scene, overrides = {}) {
  deployCabinet(
    {
      name: "cabinet",
      label: `机柜-${Date.now()}`,
      position: { x: 0, y: 0, z: 0 },
      ...overrides
    },
    scene
  );
}

const deviceCabinetDomain = {
  id: "device.cabinet",
  defaultHandler: "deployCabinet",
  peerDomains: ["device", "door"],
  legacyBoxObjTypes: {
    deviceCabinet: "deployCabinet"
  },
  resolveDomainModel: resolveCabinetDomainModel,
  api: {
    capturePersistDescriptor,
    mergePersistDescriptor,
    persistMergeKey: cabinetPersistMergeKey,
    matchesSceneDeployRootObjJson(objJson) {
      if (!objJson || typeof objJson !== "object") {
        return false;
      }
      const objType = String(objJson.objType || objJson.type || "").trim();
      if (objType === "domain" && String(objJson.domain || "").trim() === "device.cabinet") {
        return true;
      }
      return objType === "deviceCabinet";
    },
    createCabinetJson,
    createCabinet,
    deployCabinet,
    addToScene,
    showCapacityStats,
    showLoadStats,
    showUUsageStats,
    showRackSpaceStats,
    clearCabinetStatView,
    mapUtilizationRateToColor,
    computeCabinetStats,
    normalizeSlots,
    getUUsage,
    addDevice,
    removeDevice,
    findCabinetByThreeJsonId,
    getSlotOccupancy
  }
};

export default deviceCabinetDomain;
