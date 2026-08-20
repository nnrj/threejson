import { createCloudMigrationClient } from "./cloudMigrationClient.js";
import { computeDeviceFingerprint } from "./threeBoxBuiltinProvider.js";
import { getAllConversations, getAllResources, getTurnsForConversation } from "./sceneAgentRepository.js";

/** React community ThreeBox binding for the same migration protocol used by the baseline app. */
export function createThreeBoxCloudMigration(options = {}) {
  return createCloudMigrationClient({
    apiBaseUrl: options.apiBaseUrl,
    cloudUrl: options.cloudUrl,
    settingsProvider: options.settingsProvider,
    deviceIdProvider: computeDeviceFingerprint,
    snapshotProvider: async () => {
      const conversations = await getAllConversations();
      return {
        items: await Promise.all(conversations.map(async (conversation) => ({ conversation, turns: await getTurnsForConversation(conversation.id) }))),
        resources: await getAllResources()
      };
    }
  });
}
