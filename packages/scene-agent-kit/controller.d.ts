export function runSceneAgentGenerateTurn(input: Record<string, unknown>): Promise<any>;
export function runSceneAgentAdjustTurn(input: Record<string, unknown>): Promise<any>;
export function buildSceneAgentTurnEnvelope(input: Record<string, unknown>): string;
export function createSceneAgentTurnContext(turnId: string, userPrompt: string): Record<string, unknown>;
export function projectSceneAgentJsonString(
  sceneJsonString: string,
  outputFormat?: "standard" | "friendly",
  options?: Record<string, unknown>
): string;
export function negotiateSceneAgentTurn(
  input: Record<string, unknown>,
  providerOptions: Record<string, unknown>
): Promise<any>;
export function reconstructSceneAgentTurn(turns: any[], targetTurnId: string): Promise<string>;
export function buildSceneAgentResultDigest(scene: unknown): string;
export function resolveSceneAgentAdjustContext(scene: unknown, settings?: unknown): unknown;
export function runSceneAgentTitle(input: Record<string, unknown>): Promise<string>;
export function runSceneAgentSummary(input: Record<string, unknown>): Promise<string>;
export function isProviderVisionCapable(provider: unknown): boolean;
