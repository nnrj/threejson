/**
 * Core runtime event mechanism — M1 foundation.
 */

export {
  PLATFORM_EVENT_NAMES,
  PLATFORM_EVENT_SET,
  isPlatformEventName,
  normalizePlatformEventName
} from "./platformEvents.js";

export {
  registerObjTypeEventCapabilities,
  listObjTypeEventCapabilities,
  isEventAllowedForObjType,
  _resetObjTypeEventCapabilitiesForTests,
  _snapshotObjTypeEventCapabilitiesForTests
} from "./objTypeEventCapabilities.js";

export {
  deriveExecutorKind,
  buildBindingMetadataFromObject
} from "./bindingDescriptor.js";

export {
  addBinding,
  removeBinding,
  getBindings,
  getThreeJsonIdsWithBindingsForEvent,
  clearBindingsForThreeJsonId,
  clearBindingsForScene,
  clearAllEventBindings,
  listBindingsByObjType,
  listBindingsByDomainKey,
  getEventBindingRegistrySnapshot
} from "./eventBindingRegistry.js";

export {
  resolveEventTarget,
  resolveEventTargets
} from "./resolveEventTarget.js";

export {
  invokeDomainBindSceneEvents,
  invokeDomainExecuteBoundEvent,
  invokeAllDomainBindSceneEvents
} from "./eventDomainContract.js";

export { createEventListenerManager } from "./eventListenerManager.js";

export {
  bindEvent,
  unbindEvent,
  attachEventListenerManager,
  getActiveEventListenerManager,
  getActiveEventSceneToken,
  detachEventListenerManager
} from "./bindEventRuntime.js";

export {
  getRejectedEventConfigReason,
  listValidEventEntries,
  collectRejectedEventConfigs
} from "./eventRecordValidation.js";

export { resolveEventScriptSource } from "./resolveEventScriptSource.js";

export {
  bindEventsFromRecord,
  bindEventsFromScene
} from "./bindEventsFromRecord.js";

export {
  bindSceneEventRuntime,
  disposeSceneEventRuntime
} from "./bindSceneEventRuntime.js";

export {
  integrateEventMechanismIntoSceneLoad,
  wireEventMechanismSceneLifecycle,
  resolveBindSceneEvents
} from "./attachSceneEventRuntime.js";

export {
  applyPickThroughRaycastByObjectName,
  createCanvasRaycastEventHost,
  defaultResolveThreeJsonIdFromObject,
  findPickThroughRaycastAncestor,
  findPickThroughRaycastRoot,
  hasPickThroughRaycastAncestor,
  pickObjectFromIntersectsForEvent,
  pickObjectFromNativeEvent,
  resolveThreeJsonIdFromPick
} from "./createCanvasRaycastEventHost.js";

export {
  resolveInfoPanelDismissTrigger,
  normalizeDismissTrigger
} from "./infoPanelDismissTrigger.js";
export {
  bindDismissTriggerForPanel,
  wireInfoPanelDismissTriggerForObject
} from "./wireInfoPanelDismissTriggers.js";

export { isEventScriptReference } from "./scriptReference.js";

export {
  bindingHasActionPayload,
  bindingHasScriptPayload,
  bindingHasRuntimeHandler,
  resolveBindingScriptText,
  partitionBindingsForExecution
} from "./bindingPayload.js";

export {
  createCoreBindingExecutor,
  executeScriptBinding
} from "./createCoreBindingExecutor.js";

export * from "./coreActions/index.js";
export * from "./eventScript/index.js";
