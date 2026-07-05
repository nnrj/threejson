export {
  CANONICAL_RUNTIME_OBJ_TYPES,
  CANONICAL_RUNTIME_OBJ_TYPE_SET,
  isLifecycleEligibleObjType,
  isLifecycleEligibleRecord,
  normalizeObjType
} from "./objectLifecycleEligibility.js";

export {
  OBJECT_LIFECYCLE_READY,
  OBJECT_LIFECYCLE_DISPOSE,
  resolveObjectLifecycleCallbacks,
  createObjectLifecycleContext,
  resolveObjectLifecycleContext,
  resolveSceneLoadObjectLifecycle,
  buildObjectLifecyclePayload,
  recordHasObjectReadyBinding,
  notifyObjectBeforeCreate,
  notifyObjectReady,
  notifyObjectDispose,
  notifyObjectDeployFailed,
  runRecordDeployWithLifecycle
} from "./objectLifecycleDispatch.js";

export { replayObjectReadyBindingsAfterBind } from "./objectLifecycleReplay.js";

export {
  recordHasObjectDisposeBinding,
  recordHasObjectLifecycleEventBinding,
  scenePayloadHasLifecycleEventBindings
} from "./objectLifecycleSceneScan.js";

export {
  ENGINE_DEFAULT_ENABLE_OBJECT_LIFECYCLE,
  resolveEnableObjectLifecycle
} from "./resolveEnableObjectLifecycle.js";
