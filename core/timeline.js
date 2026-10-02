/** Optional deterministic animation/composition API; no codecs, AI or audio models. */
export { createSceneClock } from "./timeline/clock.js";
export { validateTimeline, getTimelineDuration, getActiveClips, timelineError } from "./timeline/schema.js";
export { registerTimelineEasing, sampleTimelineTrack, compileTimelineTracks } from "./timeline/tracks.js";
export { registerTimelineSignal, getTimelineSignals, validateTimelineSignal, sampleTimelineSignal, sampleTimelineWindow } from "./timeline/signals.js";
export { createSceneTimelineController, attachSceneTimeline, prepareTimelineResources } from "./timeline/playback.js";
export { registerParticleMotionOperator, getParticleMotionOperators, prepareParticleEffects, matchParticlePositions } from "./timeline/particleEffects.js";
