/**
 * ThreeJSON stable aggregate entry: prefer importing from this file to avoid deep path churn.
 *
 * Heatmap: symbols already exported from `modelBuilder` are not re-exported from `heatmapTexture` / `rasterizeHeatmap`.
 * AI: `./ai/index.js` is the unified surface; `requestChatCompletion` and texture pointer helpers are exported below.
 */

export * from "./handler/businessDomainRegistry.js";
export * from "./handler/businessDomainModelDispatch.js";
export * from "./handler/sceneJsonHandler.js";
export * from "./handler/sceneFriendlyMap.js";
export * from "./handler/sceneFriendlyNormalizer.js";
export * from "./handler/sceneRuntimeHandler.js";
export {
  createControlsFromDescriptor,
  applyControlsConfig,
  resolveControlsType,
  registerControlsType
} from "./builder/controlsBuilder.js";
export { attachCameraToPlayerRig } from "./handler/controls/playerRigAttach.js";
export * from "./handler/sceneBackdropResolver.js";
export * from "./handler/sceneLoadHandler.js";
export * from "./handler/objectLoadHandler.js";
export * from "./handler/sceneExportHandler.js";
export {
  sceneToJson,
  sceneToStandardJson,
  sceneToStandardJsonSimple,
  sceneToFriendlyJson,
  rebuildStandardJson,
  rebuildFriendlyJson,
  collectObjectListFromScene
} from "./util/sceneToJson.js";
export { shouldSkipSceneExportNode } from "./util/sceneExportNode.js";
export { mergeObjectListByIdentity } from "./util/scenePayloadMerge.js";
export * from "./handler/objectExportHandler.js";
export {
  exportMesh,
  exportMeshObject,
  SUPPORTED_MESH_FORMATS,
  FORMAT_META,
  normalizeMeshFormat
} from "./handler/meshExportHandler.js";
export {
  importMeshBlob,
  importMeshFromArrayBuffer,
  buildExternalModelImportRecord,
  inferMeshImportFormatFromFileName,
  normalizeMeshImportFormat,
  SUPPORTED_MESH_IMPORT_FORMATS
} from "./handler/meshImportHandler.js";
export {
  parseMeshArrayBufferToObject3D,
  readMeshArrayBufferFromUrl,
  isBufferExternalMeshType
} from "./builder/meshImportLoaders.js";
export {
  buildDeployJobs,
  cancelActiveDeployScheduler,
  isRecordDeployImmediate,
  resolveDeploySchedulerConfig,
  runDeployJobs,
  runDeployJobsImmediate,
  runDeployJobsScheduled
} from "./runtime/deployScheduler.js";
export {
  normalizeIntroConfig,
  isIntroEnabled,
  isIntroExcludedFromLoadWait,
  warnIntroSkippedOnSyncPath,
  resolveIntroMountRoot
} from "./runtime/sceneIntroConfig.js";
export {
  runPostLoadIntro,
  runScenePostLoadIntroIfConfigured
} from "./runtime/sceneIntroOverlay.js";
export {
  LOAD_PHASE,
  TEARDOWN_PHASE,
  FRAME_PHASE,
  createSceneLifecycleContext,
  createFrameContext,
  createSceneLifecycleBus,
  registerSceneLoadLifecycleExtension,
  resolveLifecycleHooks,
  buildSceneReadyFields,
  buildRuntimeReadyFields
} from "./runtime/sceneLoadLifecycle.js";
export * from "./runtime/objectMutation/index.js";
export * from "./runtime/sceneObjectCommands.js";
export * from "./runtime/eventMechanism/index.js";
export * from "./runtime/objectLifecycle/index.js";
export { disposeObjectTree, detachObjectTree } from "./handler/disposeObjectTree.js";
export * from "./compat/index.js";
export * from "./handler/frameLoopHandler.js";
export * from "./handler/animationHandler.js";
export {
  deployByObjTypeExtension,
  getObjTypeDeployer,
  registerInteractionResolver,
  registerObjTypeDeployer,
  resolveInteractionTarget
} from "./handler/sceneExtensionRegistry.js";
export * from "./handler/objectVisibility.js";
export {
  resolveObjectDisplayLabel,
  resolveObjectDisplayLabelFromObject
} from "./util/resolveObjectDisplayLabel.js";
export * from "./handler/infoPanelRuntime.js";
export * from "./handler/objectObjType.js";
export * from "./handler/objectDomain.js";
export * from "./handler/modelHandler.js";
export * from "./handler/csgBrushOps.js";
export * from "./handler/boxModelListCoalescer.js";
export * from "./handler/holeSceneOps.js";
export * from "./handler/objectDescriptorAttach.js";
export * from "./handler/sceneDescriptorBinding.js";
export * from "./handler/objectRegistry.js";
export * from "./handler/bucketIndex.js";
export * from "./handler/inferSystemBucketTags.js";
export {
  getObjectsInCustomBucket,
  getObjectsInSystemBucket,
  hasSystemBucketTag,
  shouldIncludeThreeJsonIdInDefaultWorldExport
} from "./util/bucketQuery.js";
export * from "./handler/sceneRuntimeApi.js";
export * from "./handler/descriptorSync.js";
export * from "./handler/animationMixerRegistry.js";
export {
  registerAnimationStateMachine,
  unregisterAnimationStateMachine,
  updateAnimationStateMachines,
  setAnimationParameter,
  fireAnimationEvent,
  getAnimationStateMachine,
  isAnimationStateMachineRoot
} from "./handler/animationStateMachine.js";
export {
  resolveAnimationGraph,
  buildAnimationParameterDefaults,
  pickAnimationTransition,
  evaluateAnimationWhen
} from "./handler/animationGraphUtil.js";
export * from "./plugin/pluginHost.js";

export * from "./builder/modelBuilder.js";
export * from "./builder/nativeObjectLoader.js";
export * from "./builder/sceneHelperBuilder.js";
export * from "./builder/shapeGeometryUtil.js";
export * from "./builder/shapeTransformUtil.js";
export * from "./builder/bufferMeshLimits.js";
export * from "./builder/bufferMeshBuilder.js";
export * from "./builder/shapePlaneBuilder.js";
export * from "./builder/shapeExtrudeBuilder.js";
export * from "./builder/irregularShapeResolver.js";
export * from "./builder/irregularPlaneBuilder.js";
export * from "./builder/irregularGeometryBuilder.js";
export * from "./builder/infoPanelBuilder.js";
export * from "./builder/textBuilder.js";
export * from "./builder/css3d/index.js";
export {
  bindThreeJsonSceneAudioUnlock,
  cleanupThreeJsonAudioAttachments,
  deploySceneAudio,
  detachThreeJsonAudioListener,
  disposeAllThreeJsonSceneAudio,
  disposeThreeJsonAudioNode,
  ensureThreeJsonAudioListener,
  forEachThreeJsonSceneAudioNode,
  getThreeJsonSceneAudioPlaybackPolicy,
  getThreeJsonSceneAudioRoots,
  getThreeJsonSceneAudioSessionId,
  invalidateThreeJsonSceneAudioSession,
  pauseAllThreeJsonSceneAudio,
  resumeAllThreeJsonSceneAudio,
  resumeThreeJsonAudioContext,
  resumeThreeJsonAudioContextFromCamera,
  setThreeJsonSceneAudioPlaybackPolicy,
  setThreeJsonSceneAudioPaused,
  suspendThreeJsonAudioContext,
  teardownThreeJsonSceneAudioFromRuntime
} from "./builder/audioBuilder.js";

export * from "./cache/loading.js";
export * from "./handler/resourceReclaimer.js";
export * from "./util/util.js";
export { configureLogger, isDebugEnabled, log } from "./util/logger.js";
export * from "./util/sceneRuntimeDefaults.js";
export * from "./util/renderLoopPolicy.js";
export * from "./util/textureUtils.js";
export * from "./util/spatialQuery.js";
export * from "./util/spatialQueryUtil.js";
export * from "./util/extensionsUtil.js";
export * from "./util/meshPick.js";
export * from "./util/sceneHighlightInteraction.js";
export * from "./util/boxEdgeHelper.js";
export * from "./handler/postProcessPassTypeRegistry.js";
export * from "./handler/postProcessPassDeploy.js";
export * from "./handler/boxHelperDeploy.js";
export * from "./handler/passListEntryRegistry.js";
export * from "./builder/postProcessPassBuilder.js";
export * from "./util/passTargetResolver.js";
export * from "./util/scenePassRuntime.js";
export * from "./util/sceneCaptureUtil.js";
export * from "./util/archiveCommon.js";
export * from "./util/descriptorExportSanitize.js";
export * from "./util/boxTextureUrl.js";

export * from "./command/index.js";
export * from "./ai/index.js";
export { requestChatCompletion } from "./ai/sceneAiService.js";
export {
  getByPointer,
  setByPointer,
  getByPath,
  setByPath
} from "./util/jsonPointer.js";
export { normalizePointer, validateTasksAgainstScene } from "./ai/textureAiService.js";
export * from "./ai/threeJsonCoreSkill.js";
export * from "./ai/sceneCapability.js";
export * from "./ai/texturePrompt.js";

/** Heatmap APIs implemented in `modelBuilder` are not re-exported; only mesh transform helpers are added here. */
export { applyObjectTransform } from "./builder/heatmap/heatmapTexture.js";
export {
  buildObjectLoaderGraphFromRecord,
  deployNativeObjectRecord
} from "./builder/nativeObjectBuilder.js";
export {
  resolveParseMode,
  shouldDeployNativeOnly,
  shouldTryNativeFallback,
  shouldDeferBoxCoerce,
  isNativeShapeHeuristicEnabled
} from "./handler/nativeParseMode.js";
export { deployNativeObjectRecordWithFallback } from "./handler/nativeObjectDispatch.js";
/** Low-level rasterization APIs (excluding names owned by modelBuilder; constants/sizes handled there are omitted). */
export {
  pointToTexel,
  pointToTexel3,
  gaussianSplat,
  gaussianSplat3,
  buildColormapLut,
  clampVolumeTextureDims,
  defaultTextureDimensions3D,
  HEATMAP_VOLUME_MAX_VOXELS,
  HEATMAP_VOLUME_MAX_TEX_AXIS,
  HEATMAP_LEGACY_COLOR_STOPS,
  HEATMAP_LEGACY_COLOR_STOPS_VOLUME,
  rasterizeHeatmapVolumeRgba,
  rasterizeHeatmapRgba
} from "./builder/heatmap/rasterizeHeatmap.js";

export {
  registerShaderPreset,
  getShaderPreset,
  hasShaderPreset,
  mergeShaderUniforms,
  createShaderMaterialFromPreset,
  resolveShaderPresetIdFromDescriptor,
  _clearShaderPresetsForTests
} from "./builder/shader/shaderPresetRegistry.js";
export {
  trackShaderMaterial,
  disposeShaderMotion,
  updateShaderMotion,
  _resetShaderMotionForTests
} from "./builder/shader/shaderMotion.js";
export { deployShaderSurface } from "./builder/shader/shaderSurfaceBuilder.js";
export { registerCoreShaderMechanism } from "./builder/shader/registerCoreShader.js";
export { deployParticleEmitter, deployParticleEmitterCore } from "./builder/particle/particleEmitterBuilder.js";
export {
  registerParticleEmitterProvider,
  getParticleEmitterProvider,
  resolveParticleProviderId
} from "./builder/particle/particleProviderRegistry.js";
export { deployParticleGpuEmitter } from "./builder/particle/particleGpuCompute.js";
export { resolveParticleTextureSize } from "./builder/particle/particleComputeUtil.js";
export {
  configureTextureUrlCacheForDeploy,
  isTextureUrlCacheEnabled,
  clearTextureUrlCache
} from "./cache/textureUrlCache.js";
export { applyAssetGatewayToPayload, resolveAssetUrl } from "./util/assetGateway.js";
export {
  configureTextureDefaultsForDeploy,
  configureTextureSamplingForDeploy,
  applyTextureSampling,
  applyUiTextureSampling,
  applyTexturePropsFromRecord,
  syncTexturePropsToMap,
  resolveTextureProps,
  resolveTextureSamplingSettings,
  resolveEffectiveTextureSummary,
  parseTextureQuality,
  normalizeTextureFilter,
  serializeTextureFilter,
  extractExplicitTextureProps,
  isRecordTextureSamplingOptOut,
  getDeployTextureContext,
  TEXTURE_EXPLICIT_PROP_KEYS,
  BUILTIN_PROFILES
} from "./util/textureSampling.js";
export {
  assetUrl,
  assetUrlCandidates,
  resolvePublicAssetUrl,
  resolvePublicAssetUrlCandidates,
  getAssetsBaseUrl,
  getAssetsBaseMode,
  setAssetsBaseUrl,
  setAssetsBaseMode,
  normalizeAssetsBase,
  normalizeAssetsBaseMode,
  resolveAssetsBaseFromLoad,
  resolveAssetsBaseModeFromLoad,
  applyAssetsBaseForLoad,
  DEFAULT_CDN_ASSETS_BASE,
  LOCAL_ASSETS_BASE,
  ASSETS_BASE_MODE_LOCAL_FIRST,
  ASSETS_BASE_MODE_CDN_FIRST,
  ASSETS_BASE_MODE_LOCAL_ONLY,
  ASSETS_BASE_MODE_CDN_ONLY,
  ASSETS_BASE_MODE_BASE_ONLY,
  ASSETS_BASE_MODE_BASE_FIRST,
  ASSETS_PACKAGE_VERSION
} from "./util/assetsBase.js";
export { registerCoreParticleMechanism } from "./builder/particle/registerCoreParticle.js";

import "./builder/shader/registerCoreShader.js";
import "./builder/particle/registerCoreParticle.js";
