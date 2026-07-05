/**
 * device root domain: cabinet, server, switch, AC, UPS, and other device semantics.
 * Do not invoke domain: "device" directly; use full subdomain id (e.g. device.cabinet).
 */
import { readBusinessDeviceId } from "./readBusinessDeviceId.js";
import { prepareDeviceDeployRecord } from "./deviceBoxFactory.js";
import {
  resolveDevicePanelBinding,
  resolveDevicePanelRef,
  appendDevicePanelSubScene,
  buildDefaultInfoPanelFromInfo,
  resolveDevicePanelBehaviorConfig,
  resolveDevicePanelTriggerConfig,
  resolveDevicePanelKeyboardTrigger,
  hasDevicePanelBinding,
  DEVICE_PANEL_NAME
} from "./devicePanelResolver.js";
import {
  showDevicePanel,
  hideDevicePanel,
  updateDevicePanelContent,
  bindDevicePanelTriggers,
  bindDevicePanelKeyboardTriggers,
  handleDevicePanelDblClick,
  resolveDevicePanelRefFromRoot,
  resolveDevicePanelHostRoot,
  ensureDevicePanelDeployed,
  toggleDevicePanel
} from "./devicePanelRuntime.js";
import {
  bindDevicePanelActionTriggers,
  registerDevicePanelActions
} from "./devicePanelActions.js";

const deviceDomain = {
  id: "device",
  bindSceneEvents(scene, ctx = {}) {
    return bindDevicePanelActionTriggers(scene, ctx);
  },
  api: {
    readBusinessDeviceId,
    prepareDeviceDeployRecord,
    resolveDevicePanelBinding,
    resolveDevicePanelRef,
    appendDevicePanelSubScene,
    buildDefaultInfoPanelFromInfo,
    resolveDevicePanelBehaviorConfig,
    resolveDevicePanelTriggerConfig,
    resolveDevicePanelKeyboardTrigger,
    hasDevicePanelBinding,
    DEVICE_PANEL_NAME,
    showDevicePanel,
    hideDevicePanel,
    updateDevicePanelContent,
    bindDevicePanelTriggers,
    bindDevicePanelKeyboardTriggers,
    handleDevicePanelDblClick,
    resolveDevicePanelRefFromRoot,
    resolveDevicePanelHostRoot,
    ensureDevicePanelDeployed,
    toggleDevicePanel,
    bindDevicePanelActionTriggers,
    registerDevicePanelActions
  }
};

export default deviceDomain;

export {
  readBusinessDeviceId,
  prepareDeviceDeployRecord,
  resolveDevicePanelBinding,
  resolveDevicePanelRef,
  appendDevicePanelSubScene,
  buildDefaultInfoPanelFromInfo,
  resolveDevicePanelBehaviorConfig,
  resolveDevicePanelTriggerConfig,
  resolveDevicePanelKeyboardTrigger,
  hasDevicePanelBinding,
  DEVICE_PANEL_NAME,
  showDevicePanel,
  hideDevicePanel,
  updateDevicePanelContent,
  bindDevicePanelTriggers,
  bindDevicePanelKeyboardTriggers,
  handleDevicePanelDblClick,
  resolveDevicePanelRefFromRoot,
  resolveDevicePanelHostRoot,
  ensureDevicePanelDeployed,
  toggleDevicePanel,
  bindDevicePanelActionTriggers,
  registerDevicePanelActions
};
