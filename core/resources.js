/** Runtime resource tracking and disposal capability. */
export { createAssetResolver } from "./resource/assetResolver.js";
export {
  disposeTrackedResources,
  disposeTrackedSceneResources,
  trackDisposableResource,
  untrackDisposableResource
} from "./handler/resourceReclaimer.js";
