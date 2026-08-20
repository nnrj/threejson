import { createCloudMigrationClient } from "../../shared/js/cloudMigrationClient.js";
import { computeDeviceFingerprint } from "../../shared/js/builtinAiProvider.js";
import { getAllConversations, getAllResources, getTurnsForConversation } from "./threeBoxSessionStore.js";

/** Community ThreeBox binding for the shared application-layer Cloud migration protocol. */
export function createThreeBoxCloudMigration(options = {}) {
  return createCloudMigrationClient({
    apiBaseUrl: options.apiBaseUrl,
    cloudUrl: options.cloudUrl,
    settingsProvider: options.settingsProvider,
    deviceIdProvider: computeDeviceFingerprint,
    snapshotProvider: async () => {
      const conversations = await getAllConversations();
      return {
        items: await Promise.all(conversations.map(async (conversation) => ({
          conversation,
          turns: await getTurnsForConversation(conversation.id)
        }))),
        resources: await getAllResources()
      };
    }
  });
}
