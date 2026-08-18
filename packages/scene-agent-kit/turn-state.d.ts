export function isUnsuccessfulTurn(turn: unknown): boolean;
export function isSceneContextTurn(turn: unknown): boolean;
export function resolveSceneAgentRoute(classified: unknown, priorTurns?: unknown[]): {
  intent: "generate" | "adjust";
  targetTurnId: string | null;
};
export function createUnsuccessfulTurnRecord(input: Record<string, unknown>): Record<string, unknown>;
