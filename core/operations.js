/** Neutral operation contracts: no imperative legacy handlers, AI or tool-server imports. */
export { createSceneOperationService, SCENE_OPERATION_PROTOCOL_VERSION } from "./document/sceneOperationService.js";
export { createSceneOperationRegistry, defaultSceneOperationRegistry } from "./command/operationRegistry.js";
export { validateCommandSchema, assertCommandContract } from "./command/contracts.js";
export { listEventActionSpecs, registerEventAction, unregisterEventAction } from "./runtime/eventMechanism/coreActions/actionRegistry.js";
