/** Neutral execution parameters. No product tiers, provider selection or UI labels.
 * Automatic repair/visual requests are opt-in, independent of structural inspection. */
export function resolveQualityReviewProfile(value = {}) {
  if (!value || typeof value !== "object") throw new TypeError("Quality review requires an explicit profile object.");
  const profile = { id: "custom", repairRounds: 0, views: 1, samplesPerShot: 1, alternatives: 1, reviewVisual: false, ...value };
  for (const field of ["repairRounds", "views", "samplesPerShot", "alternatives"]) {
    if (!(field === "repairRounds" && profile[field] === Infinity) && (!Number.isSafeInteger(profile[field]) || profile[field] < (field === "repairRounds" ? 0 : 1))) throw new RangeError(`Invalid quality profile ${field}.`);
  }
  return profile;
}

export function providerSupportsVision(provider = {}) {
  const caps = provider.capabilities || {};
  return caps.vision === true || Array.isArray(caps.inputModalities) && caps.inputModalities.includes("image");
}

export function buildCreationQualityInstructions(value = {}) {
  const q = resolveQualityReviewProfile(value);
  return `Creation quality profile: ${q.id}. Always require correct geometry, readable subject, useful lighting and preserved edits. A simple work must still be finished, not a crude blockout. First establish silhouette, proportions, parts, thickness and connections; then edges and materials. Use revolve/loft/sweep/surfaces/editable meshes or licensed supplied assets when appropriate, not piles of boxes for every shape. Keep procedural sources editable. PBR metal needs a reflection environment (sceneConfig.scene.environment:{type:"studio"} is a built-in WebGL studio, no download); surface color is not enough. Author lights/camera/renderer in JSON, not assumed preview fill. Point/spot lights decay with distance squared. Choose shadows and material roughness deliberately; never fix a color-space mistake by excessive brightness. Default authored realistic look: renderer toneMapping:"agx", outputColorSpace:"srgb", toneMappingExposure:1. Preserve explicit user lighting including darkness, silhouettes and unlit diagrams. No mandatory floor, particles or bloom. Camera path signals can use parameterization:"arcLength", easing:"smootherstep" or speedCurve:[[0,0],[.2,1],[.8,1],[1,0]]; avoid accidental speed jumps. Stable captions, spatial SDF text and thick mesh lettering have different purposes. ${q.alternatives > 1 ? "For the hero subject/shot compare two purposeful framing/lighting proposals, select the better one before finalizing; do not duplicate the whole scene." : "Use one coherent visual direction."} A structural pass is not visual approval. Never claim you inspected images without actual image input. Explicit user/provider budgets and choices override this quality target.`;
}

export async function sceneQualityRevision(document) {
  const canonical = JSON.stringify(document, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Read/repair hooks are injected; no renderer or provider is owned by this module. */
export async function runCreationQualityReview(document, options = {}) {
  const profile = resolveQualityReviewProfile(options.profile);
  let current = structuredClone(document), repairs = 0, report;
  for (;;) {
    options.signal?.throwIfAborted();
    const revision = await sceneQualityRevision(current);
    let observed;
    try { observed = options.inspect ? await options.inspect(current, { profile, signal: options.signal }) : { available: false, warnings: [] }; }
    catch (error) {
      options.signal?.throwIfAborted();
      observed = { available: false, views: [], warnings: [{ code: error.code || "QUALITY_RENDER_FAILED", severity: "error", message: String(error.message || error) }] };
    }
    let visual = { status: profile.reviewVisual ? "unavailable" : "not-requested", issues: [] };
    if (profile.reviewVisual && options.visionAvailable === true && options.review && observed.views?.length) {
      try {
        const review = await options.review({ document: current, observed, profile, signal: options.signal });
        if (!review || typeof review.satisfied !== "boolean" || !Array.isArray(review.issues)) throw new Error("Malformed visual review");
        visual = { status: review.satisfied ? "passed" : "needs-work", issues: review.issues };
      } catch (error) {
        options.signal?.throwIfAborted(); visual = { status: "unavailable", issues: [], message: String(error.message || error) };
      }
    }
    const issues = [...(observed.warnings || []), ...visual.issues];
    const structuralBlocked = (observed.warnings || []).some(i => i.severity === "error");
    const blocked = issues.some(i => i.severity === "error"), needsWork = visual.status === "needs-work" || blocked || !observed.available;
    const checksComplete = Boolean(observed.available && (!profile.reviewVisual || visual.status !== "unavailable"));
    const messageCode = needsWork ? "QUALITY_NEEDS_WORK" : visual.status === "passed" ? "QUALITY_VISUAL_SAMPLED" : "QUALITY_STRUCTURAL_ONLY";
    report = { version: 1, sourceRevision: revision, profile: profile.id, repairs, structural: observed.available ? (structuralBlocked ? "failed" : "checked") : "unchecked", visual: visual.status, visualReason: visual.message || "", issues, observation: { ...observed, views: undefined },
      checksComplete, completed: !needsWork && checksComplete,
      coverage: { structural: observed.geometryCoverage || observed.coverage || "reported-observations", visual: visual.status === "passed" || visual.status === "needs-work" ? "sampled" : "none", viewCount: observed.views?.length || 0 },
      stopReason: needsWork ? "quality_budget_exhausted" : checksComplete ? "quality_checked" : "quality_visual_unavailable", messageCode,
      message: messageCode === "QUALITY_NEEDS_WORK" ? "Unresolved quality issues remain; the document is available for further editing." : messageCode === "QUALITY_VISUAL_SAMPLED" ? "Visual review passed for the sampled views, not every possible frame." : "Only structural and numeric checks were completed; visual quality is unverified." };
    if (!observed.available && !blocked) {
      report.stopReason = "quality_inspection_unavailable";
      report.messageCode = "QUALITY_INSPECTION_UNAVAILABLE";
      report.message = "Runtime inspection is unavailable; the document is retained without quality approval.";
    }
    options.onProgress?.({ kind: "quality_review", message: report.message, qualityReport: report });
    if (!observed.available && !blocked) break;
    if (!needsWork || repairs >= profile.repairRounds || !options.repair) break;
    let candidate;
    try { candidate = await options.repair(current, { issues, observed, profile, signal: options.signal }); }
    catch (error) { options.signal?.throwIfAborted(); report.stopReason = "quality_repair_failed"; report.error = String(error.message || error); break; }
    if (!candidate || await sceneQualityRevision(candidate) === revision) { report.stopReason = "quality_no_progress"; break; }
    try { if (options.validate && !(await options.validate(candidate))) { report.stopReason = "quality_repair_invalid"; break; } }
    catch (error) { options.signal?.throwIfAborted(); report.stopReason = "quality_repair_invalid"; report.error = String(error.message || error); break; }
    current = structuredClone(candidate); repairs++;
  }
  return { document: current, report };
}

/** Call only for lossless host presentation projections (e.g. friendly JSON).
 * The original inspected revision is retained; subsequent edits must invalidate. */
export async function bindStoredQualityReport(report, document) {
  if (!report) return null;
  return { ...report, savedRevision: await sceneQualityRevision(document) };
}
export function invalidateQualityReport(report, reason = "The document changed; the previous quality report is stale.") {
  return report ? { ...report, stale: true, messageCode: "QUALITY_REPORT_STALE", message: reason, checksComplete: false, completed: false, visual: "stale" } : null;
}
export async function verifyStoredQualityReport(report, document) {
  if (!report || report.stale) return report;
  return await sceneQualityRevision(document) === (report.savedRevision || report.sourceRevision) ? report : invalidateQualityReport(report);
}
