import test from "node:test";
import assert from "node:assert/strict";
import { createAiModelAssetPolicy, prepareCreationTurn } from "../packages/host-kit/js/creationTurnPolicy.js";
const node = modelPath => ({ objType: "externalModel", modelPath });
const asset = { acquired: true, url: "https://models.example/objects/hash", id: "catalog:chair", license: "CC0-1.0", source: "catalog" };
function adapter() { return { capabilities: async () => ({ available: true }), search: async () => ({ candidates: [{ id: "catalog:chair" }] }), acquire: async () => asset }; }
test("all four switch combinations gate new acquisition; saved assets/textures/local imports are unaffected", async () => {
  for (const server of [true, false]) for (const user of [true, false]) {
    const backend = adapter(); backend.capabilities = async () => ({ enabled: server, available: server });
    const policy = createAiModelAssetPolicy({ adapter: backend, enabled: user, initialDocument: { objectList: [node("local-import.glb")] } });
    const request = () => policy.prepare({ objectList: [node("asset-model://search/wooden%20chair")] });
    if (server && user) assert.equal((await request()).objectList[0].userData.assetProvenance.license, asset.license);
    else await assert.rejects(request);
    assert.equal((await policy.prepare(node("local-import.glb"))).modelPath, "local-import.glb");
    assert.equal((await policy.prepare({ material: { map: "https://images.example/wood.png" } })).material.map, "https://images.example/wood.png");
  }
});
test("new arbitrary URLs cannot bypass the policy through command or patch descriptors", async () => {
  const policy = createAiModelAssetPolicy({ adapter: adapter() });
  await assert.rejects(() => policy.prepare([{ op: "object.add", args: { descriptor: node("https://untrusted.example/a.glb") } }]), /任意 URL/);
  await assert.rejects(() => policy.prepare([{ op: "replace", path: "/objectList/0/modelPath", value: "https://untrusted.example/a.glb" }]), /任意 URL/);
  const model = await policy.prepare(node("asset-model://id/catalog%3Achair"));
  assert.equal(model.modelPath, asset.url);
  assert.equal((await policy.prepare(node(asset.url))).userData.assetProvenance.referencedAsset, true);
});
test("switch disabled mid-download rejects import; trusted result requires license", async () => {
  const backend = adapter(); let enabled = true;
  backend.capabilities = async () => ({ available: enabled }); backend.acquire = async () => { enabled = false; return asset; };
  await assert.rejects(() => createAiModelAssetPolicy({ adapter: backend }).prepare(node("asset-model://search/chair")), /关闭/);
  backend.capabilities = async () => ({ available: true }); backend.acquire = async () => ({ ...asset, license: null });
  await assert.rejects(() => createAiModelAssetPolicy({ adapter: backend }).prepare(node("asset-model://search/chair")), /unverified/);
});
test("early progress previews and adjust envelopes use the same acquisition boundary", async () => {
  const events = [];
  const turn = await prepareCreationTurn({ envelope: JSON.stringify({ intent: "adjust", userRequest: "add a chair" }), agentOptions: { externalModelsEnabled: false }, onAgentProgress: progress => events.push(progress) });
  assert.match(JSON.parse(turn.envelope).globalInstructions, /disabled/);
  turn.onAgentProgress({ commands: [{ op: "object.add", args: { descriptor: node("https://bad.example/a.glb") } }] });
  await turn.drainCreationPreviews();
  assert.equal(events[0].kind, "draft_policy_rejected"); assert.equal(events.some(e => e.commands), false);
});
