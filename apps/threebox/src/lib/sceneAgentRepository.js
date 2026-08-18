import {
  createConversationId,
  createProjectId,
  createResourceId,
  createSceneAgentRepository,
  createTurnId
} from "@threejson/scene-agent-kit/repository";

export const sceneAgentRepository = createSceneAgentRepository({ dbName: "threejson_threebox" });

export { createConversationId, createProjectId, createResourceId, createTurnId };
export const putTurn = (...args) => sceneAgentRepository.putTurn(...args);
export const getTurn = (...args) => sceneAgentRepository.getTurn(...args);
export const getTurnsForConversation = (...args) => sceneAgentRepository.getTurnsForConversation(...args);
export const getAllTurns = (...args) => sceneAgentRepository.getAllTurns(...args);
export const deleteTurnsForConversation = (...args) => sceneAgentRepository.deleteTurnsForConversation(...args);
export const putResource = (...args) => sceneAgentRepository.putResource(...args);
export const getResource = (...args) => sceneAgentRepository.getResource(...args);
export const getAllResources = (...args) => sceneAgentRepository.getAllResources(...args);
export const deleteResource = (...args) => sceneAgentRepository.deleteResource(...args);
export const putConversation = (...args) => sceneAgentRepository.putConversation(...args);
export const getConversation = (...args) => sceneAgentRepository.getConversation(...args);
export const getAllConversations = (...args) => sceneAgentRepository.getAllConversations(...args);
export const deleteConversation = (...args) => sceneAgentRepository.deleteConversation(...args);
export const putProject = (...args) => sceneAgentRepository.putProject(...args);
export const getAllProjects = (...args) => sceneAgentRepository.getAllProjects(...args);
