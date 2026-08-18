export interface SceneAgentSettings {
  ai: Record<string, unknown> & {
    sceneGenerationMode: "auto" | "direct" | "draft_refine";
    updateOutputMode: "commands" | "json-incremental" | "json-full";
    maxAutoRefineRounds: number;
    sceneMaxOutputTokens: number;
  };
  io: Record<string, unknown> & { turnCacheMode: "full" | "diff" };
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
  getAllProjects(): Promise<any[]>;
  resetConnection(): void;
}
