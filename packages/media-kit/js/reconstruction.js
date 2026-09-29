/** Optional phase-two seam, deliberately independent of core and provider brands. */
export function selectMediaAnalysisRoute(capabilities, kind, preference = "auto") {
  const modes = new Set(capabilities?.inputModalities || []);
  if (!["image", "gif", "video"].includes(kind)) throw new TypeError("Reference must be image, gif or video.");
  if (kind === "image" && modes.has("image")) return "image";
  if (kind !== "image" && preference !== "frames" && modes.has("video")) return "video";
  if (modes.has("image")) return "frames";
  throw Object.assign(new Error("No declared visual input capability; text-only models cannot inspect this media."), { code: "MEDIA_ANALYSIS_UNAVAILABLE" });
}
export function validateMediaReference(input) {
  const reference = structuredClone(input);
  if (!reference || !["image", "gif", "video"].includes(reference.kind)) throw new TypeError("Invalid media reference kind.");
  if (!reference.source && !reference.frames?.length) throw new Error("Reference needs a source or time-stamped frames.");
  let time = -1;
  for (const frame of reference.frames || []) {
    if (!Number.isFinite(frame.time) || frame.time < 0 || frame.time < time || !frame.source) throw new Error("Reference frames need ordered nonnegative timestamps and a source.");
    time = frame.time;
  }
  return reference;
}
/** Calls only explicitly injected host adapters; no upload, API keys or model calls on import. */
export async function analyzeMediaReference(input, { analyzer, extractFrames, preference, signal, userPrompt } = {}) {
  const reference = validateMediaReference(input), route = selectMediaAnalysisRoute(analyzer?.capabilities, reference.kind, preference);
  if (typeof analyzer?.analyze !== "function") throw new TypeError("A host analysis adapter is required.");
  signal?.throwIfAborted();
  if (route === "frames" && !reference.frames?.length) {
    if (typeof extractFrames !== "function") throw Object.assign(new Error("The host must supply frame extraction for this route."), { code: "MEDIA_FRAME_EXTRACTOR_UNAVAILABLE" });
    reference.frames = await extractFrames(reference, { signal }); validateMediaReference(reference);
    if (!reference.frames?.length) throw new Error("Frame extractor returned no frames.");
  }
  const analysis = await analyzer.analyze({ reference, route, userPrompt, signal }); signal?.throwIfAborted();
  return { kind: "media-analysis", version: 1, reference, route, userPrompt, analysis, reconstruction: "approximate", note: "Analysis only; no scene has been generated or reconstructed." };
}
