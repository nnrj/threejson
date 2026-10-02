/**
 * Turns a `core/ai/sceneAgent.js` `SceneAgentProgress` event into a localized, human-readable
 * status line. `runSceneAgent`'s own `message` field is deliberately plain English (core/ai has no
 * i18n dependency of its own — see its module docblock) — every UI-facing host must run each
 * event's stable `kind` (plus whatever structured fields that kind carries: `round`/`maxRounds`,
 * `attempt`/`maxAttempts`, `count`, `error`, and `stage_preview`'s own `stage`) through its own
 * `t()` catalog here instead of showing `progress.message` directly, or a Chinese-locale host ends
 * up displaying raw English text (see this module's call sites in threeBoxApp.js,
 * editorAiGeneratePanel.js/editorAiAdjustPanel.js, and apps/threebox/src/App.jsx).
 *
 * Pure and DOM-free so every host (vanilla-JS ThreeBox/editor, the React port) can share the exact
 * same mapping — only the `t` function passed in differs.
 *
 * @param {{step:number, kind:string, message?:string, round?:number, maxRounds?:number, attempt?:number, maxAttempts?:number, count?:number, error?:string, stage?:string}} progress a core/ai SceneAgentProgress event
 * @param {(key: string, fallback: string, params?: object) => string} t
 * @returns {string} empty string for progress kinds with nothing worth showing as a status line
 *   (e.g. `stream`, which hosts that care about raw streamed text handle separately).
 */
export function formatAgentProgressLabel(progress, t) {
  if (!progress || typeof t !== "function") {
    return "";
  }
  const { kind, round, maxRounds, attempt, maxAttempts, count, error } = progress;
  if (progress.type === "video") {
    if (progress.mediaProject) {
      const project = progress.mediaProject, ready = project.shots.filter(shot => shot.stage !== "planned").length;
      return t("aiAgent.progress.videoShots", "视频项目：已制作 {ready} 个镜头，规划时长 {duration} 秒", { ready, duration: Math.round(project.duration) });
    }
    return t("aiAgent.progress.videoWork", "正在编排、制作或检查视频镜头…");
  }
  const roundNum = round ?? attempt;
  const roundMax = maxRounds ?? maxAttempts;
  switch (kind) {
    case "outline":
      return t("aiAgent.progress.outline", "Planning the scene outline…");
    case "generate":
      return t("aiAgent.progress.generate", "Generating the scene JSON…");
    case "commands":
      return roundNum
        ? t("aiAgent.progress.commandsRound", "Generating scene edit commands (step {round})…", {
            round: roundNum
          })
        : t("aiAgent.progress.commands", "Generating scene edit commands…");
    case "repair":
      return error
        ? t(
            "aiAgent.progress.repairWithError",
            "Fixing an issue (attempt {attempt}/{maxAttempts}): {error}",
            { attempt: roundNum, maxAttempts: roundMax, error }
          )
        : t("aiAgent.progress.repair", "Fixing an issue (attempt {attempt}/{maxAttempts})…", {
            attempt: roundNum,
            maxAttempts: roundMax
          });
    case "explore":
      return t("aiAgent.progress.explore", "Inspecting the current scene (step {round})…", {
        round: roundNum
      });
    case "commands_ready":
      return t("aiAgent.progress.commandsReady", "Scene edit commands ready.");
    case "commands_applied":
      return t("aiAgent.progress.commandsApplied", "Applied round {round} to the scene.", { round: roundNum });
    case "refine":
      return t("aiAgent.progress.refine", "Applying the next meaningful scene change (step {round})…", {
        round: roundNum
      });
    case "draft_refinement":
      return t("aiAgent.progress.draftRefinement", "Improving the complex-scene draft (step {round})…", {
        round: roundNum
      });
    case "capability_review":
      return t(
        "aiAgent.progress.capabilityReview",
        "Checking whether the scene makes full use of relevant capabilities (attempt {attempt}/{maxAttempts})…",
        { attempt: roundNum, maxAttempts: roundMax }
      );
    case "adjustment_refinement":
      return t(
        "aiAgent.progress.adjustmentRefinementPreview",
        "Adjustment preview updated (step {round}).",
        { round }
      );
    case "layout_review":
      return t(
        "aiAgent.progress.layoutReview",
        "Reviewing layout and material semantics…"
      );
    case "execution_fallback":
      return t(
        "aiAgent.progress.executionFallback",
        "The scene is too large for one response; switching to incremental construction…"
      );
    case "scene_ready":
      return t("aiAgent.progress.sceneReady", "Scene JSON ready.");
    case "stage_preview":
      return formatStagePreviewLabel(progress, t);
    case "stream":
      // Raw streamed text is handled separately by hosts that want it; not a status line.
      return "";
    default:
      return progress.message || "";
  }
}

function formatStagePreviewLabel(progress, t) {
  const { stage, round, maxRounds } = progress;
  switch (stage) {
    case "initial_draft":
      return t("aiAgent.progress.initialDraftReady", "Initial draft ready.");
    case "repair":
      return t("aiAgent.progress.repairPreview", "Repair preview (attempt {round}/{maxRounds}).", {
        round,
        maxRounds
      });
    case "draft_refinement":
      return t(
        "aiAgent.progress.draftRefinementPreview",
        "Complex-scene preview updated (step {round}).",
        { round }
      );
    case "direct_scene":
      return t("aiAgent.progress.directSceneReady", "Usable scene preview ready.");
    case "capability_review":
      return t("aiAgent.progress.capabilityReviewPreview", "Capability review preview.");
    case "layout_review":
      return t("aiAgent.progress.layoutReviewPreview", "Layout review preview.");
    default:
      return t("aiAgent.progress.previewUpdated", "Preview updated.");
  }
}
