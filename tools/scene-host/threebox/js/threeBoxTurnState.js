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

export function createUnsuccessfulTurnRecord({
  id,
  conversationId,
  userPrompt,
  mode,
  targetTurnId = null,
  stopped = false,
  errorMessage = "",
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
    sceneJson: null,
    commands: null,
    patch: null,
    spatialSummary: "",
    recapSummary: "",
    sceneTitle: "",
    createdAt
  };
}
