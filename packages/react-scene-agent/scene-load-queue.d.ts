export function enqueueSceneAgentLoad<T>(task: () => T | Promise<T>): Promise<T>;
export function isSceneAgentLoadBusy(): boolean;
