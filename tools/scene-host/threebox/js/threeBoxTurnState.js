const UNSUCCESSFUL_TURN_STATUSES = new Set(["failed", "stopped"]);

export function isUnsuccessfulTurn(turn) {
  return UNSUCCESSFUL_TURN_STATUSES.has(String(turn?.status || "").toLowerCase());
}

export function isSceneContextTurn(turn) {
  if (!turn || isUnsuccessfulTurn(turn)) {
    return false;
  }
  return Boolean(
    (typeof turn.sceneJson === "string" && turn.sceneJson.trim()) ||
      (Array.isArray(turn.commands) && turn.commands.length > 0)
  );
}

/**
 * Converts core/ai's negotiated classification into a ThreeBox chat route. The editor never uses
 * this helper because its Generate and Adjust tabs intentionally choose their route explicitly.
 * ThreeBox, however, must not turn a failed negotiation into a silent new scene when a prior
 * scene exists—the user would reasonably understand a conversational follow-up as operating on
 * that context.
 */
export function resolveThreeBoxNegotiatedRoute(classified, priorTurns = []) {
  const sceneTurns = Array.isArray(priorTurns) ? priorTurns.filter(isSceneContextTurn) : [];
  const latestTurn = sceneTurns.length ? sceneTurns[sceneTurns.length - 1] : null;

  if (classified?.classificationFailed === true && latestTurn) {
    const error = new Error(classified.note || "AI intent negotiation failed.");
    error.code = "THREEBOX_INTENT_CLASSIFICATION_FAILED";
    throw error;
  }

  if (classified?.intent === "adjust" && latestTurn) {
    const requestedTarget = sceneTurns.find((turn) => turn.id === classified.targetTurnId);
    return {
      intent: "adjust",
      targetTurnId: requestedTarget?.id || latestTurn.id
    };
  }

  return { intent: "generate", targetTurnId: null };
}

export function createUnsuccessfulTurnRecord({
  id,
  conversationId,
  userPrompt,
  mode,
  targetTurnId = null,
  stopped = false,
  errorMessage = "",
  errorCode = null,
  createdAt = Date.now()
}) {
  return {
    id,
    conversationId,
    seq: createdAt,
    userPrompt: String(userPrompt || ""),
    mode: mode === "adjust" ? "adjust" : "generate",
    targetTurnId: mode === "adjust" ? targetTurnId : null,
    stage: "error",
    status: stopped ? "stopped" : "failed",
    errorMessage: stopped ? "" : String(errorMessage || ""),
    errorCode: stopped ? null : errorCode || null,
    sceneJson: null,
    commands: null,
    patch: null,
    spatialSummary: "",
    recapSummary: "",
    sceneTitle: "",
    createdAt
  };
}
