/**
 * One-time encrypted migration envelope to ThreeBox Cloud, ported verbatim from
 * tools/scene-host/threebox/js/threeBoxCloudMigration.js. Cloud never reads this origin's IndexedDB
 * directly: the user initiates the transfer, the local snapshot is AES-GCM encrypted with a
 * per-transfer key that is itself RSA-OAEP wrapped with the server's public key, and the envelope is
 * POSTed; the user completes the transfer after Cloud login (we redirect with the returned id).
 */
import { getAllConversations, getTurnsForConversation } from "./sceneAgentRepository.js";

const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

export function createThreeBoxCloudMigration({
  apiBaseUrl = "https://api.threebox.org",
  cloudUrl = "https://cloud.threebox.org"
} = {}) {
  const api = String(apiBaseUrl || "https://api.threebox.org").replace(/\/$/, "");
  async function migrate() {
    const conversations = await getAllConversations();
    const items = await Promise.all(
      conversations.map(async (conversation) => ({
        conversation,
        turns: await getTurnsForConversation(conversation.id)
      }))
    );
    const publicKey = await fetch(`${api}/v1/cloud/migrations/public-key`).then((response) =>
      response.ok ? response.json() : Promise.reject(new Error("CLOUD_MIGRATION_UNAVAILABLE"))
    );
    const rsa = await crypto.subtle.importKey("jwk", publicKey.jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify({ version: 1, createdAt: Date.now(), items }));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, plaintext);
    const rawKey = await crypto.subtle.exportKey("raw", aes);
    const wrappedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsa, rawKey);
    const response = await fetch(`${api}/v1/cloud/migrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ciphertext: bytesToBase64(ciphertext),
        iv: bytesToBase64(iv),
        wrappedKey: bytesToBase64(wrappedKey)
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.id) {
      throw new Error(body.code || "CLOUD_MIGRATION_FAILED");
    }
    window.location.assign(`${cloudUrl.replace(/\/$/, "")}/?migration=${encodeURIComponent(body.id)}`);
  }
  return { migrate };
}
