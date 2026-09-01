export interface SceneAgentSettings {
  ai: Record<string, unknown> & {
    sceneGenerationMode: "auto" | "direct" | "draft_refine";
    complexModelStrategy: "auto" | "full-coordinates" | "progressive";
    modelQuality: "draft" | "balanced" | "high" | "custom";
    modelBudget: { maxTokens: number; maxCost: number; maxTimeMs: number };
    updateOutputMode: "commands" | "json-incremental" | "json-full";
    maxAutoRefineRounds: number;
    maxSceneSegments: number;
    sceneMaxOutputTokens: number;
  };
  io: Record<string, unknown> & {
    turnCacheMode: "full" | "diff";
    turnDiffCheckpointInterval: number;
  };
}

export interface SceneAgentEvent {
  type: string;
  at: number;
  [key: string]: unknown;
}

export interface SceneAgentIndexedDbFactory {
  open(name: string, version?: number): any;
}

export interface SceneAgentRepository {
  dbName: string;
  available(): boolean;
  putTurn(turn: any): Promise<any>;
  getTurn(id: string): Promise<any | null>;
  getTurnsForConversation(id: string): Promise<any[]>;
  getAllTurns(): Promise<any[]>;
  deleteTurn(id: string): Promise<void>;
  deleteTurnsForConversation(id: string): Promise<void>;
  putResource(resource: any): Promise<any>;
  getResource(id: string): Promise<any | null>;
  getAllResources(): Promise<any[]>;
  deleteResource(id: string): Promise<void>;
  putConversation(conversation: any): Promise<any>;
  getConversation(id: string): Promise<any | null>;
  getAllConversations(): Promise<any[]>;
  deleteConversation(id: string): Promise<void>;
  putProject(project: any): Promise<any>;
  getProject(id: string): Promise<any | null>;
  getAllProjects(): Promise<any[]>;
  deleteProject(id: string): Promise<void>;
  resetConnection(): void;
}
