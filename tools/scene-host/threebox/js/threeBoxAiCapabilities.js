// Product facade; optional runtime activation/policy is shared with React hosts.
export {
  activateSceneHostAiCapabilities as activateThreeBoxAiCapabilities,
  ensureSceneHostSceneCapabilitiesForPayload as ensureThreeBoxSceneCapabilitiesForPayload,
  shouldActivateSceneHostTslCode as shouldActivateThreeBoxTslCode,
  resolveSceneHostAiRendererBackend as resolveThreeBoxAiRendererBackend,
  scenePayloadRequiresWebgpu, scenePayloadRequiresTslCode, projectSceneToRendererBackend
} from "../../shared/js/sceneCapabilities.js";
