import type { SceneAgentRepository } from "@threejson/scene-agent-kit";

export function useSceneConversations(options: {
  repository: SceneAgentRepository;
  includeArchived?: boolean;
}): any;
