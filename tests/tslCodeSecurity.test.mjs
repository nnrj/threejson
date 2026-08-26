import test from "node:test";
import assert from "node:assert/strict";
import {
  TSL_CODE_SECURITY_NOTICE,
  clearPreparedTslCode,
  configureTslCodeExecution,
  getTslCodeExecutionState,
  prepareTslCodeForPayload
} from "../webgpu/tslCode.js";
import { createTslMaterialFromDescriptor } from "../webgpu/tslMaterial.js";
import { createJsonScene } from "../core/handler/sceneLoadHandler.js";
import { buildAgentCapabilityIndex } from "../core/ai/sceneCapabilityIndex.js";

const payload = (code) => ({
  objectList: [{
    objType: "box",
    material: { type: "tsl", tsl: { kind: "code", source: { inline: code } } }
  }]
});

test.afterEach(() => {
  clearPreparedTslCode();
  configureTslCodeExecution({ executionPolicy: "trusted" });
});

test("the explicit tsl-code entry provides trusted module execution by default", async () => {
  assert.equal(getTslCodeExecutionState().executionPolicy, "trusted");
  const { getSceneCapability } = await import("../core/capabilities/sceneCapabilityManifest.js");
  assert.deepEqual(getSceneCapability("materials", "tsl").modes, ["preset", "graph", "code"]);
  assert.equal(getSceneCapability("materials", "tsl").entry, "threejson/tsl-code");
  assert.match(
    buildAgentCapabilityIndex({ rendererBackend: "webgpu", includePreviewCapabilities: true }),
    /kind:\"code\" is available because the host imported/
  );
  const { collectSceneCapabilityDiagnostics } = await import("../core/capabilities/sceneCapabilityValidation.js");
  assert.equal(
    collectSceneCapabilityDiagnostics(payload("export default () => ({})"), { rendererBackend: "webgpu" })
      .some((entry) => entry.category === "materialModes"),
    false
  );
  await prepareTslCodeForPayload({
    ...payload("export default () => ({ color: null });"),
    // Scene data cannot secretly weaken or strengthen the host policy.
    tslCodeExecutionPolicy: "disabled"
  });
  assert.equal(getTslCodeExecutionState().preparedCount, 1);
  assert.match(TSL_CODE_SECURITY_NOTICE, /host application chooses/i);
});

test("prompt policy asks once for the exact source while retaining full module capability", async () => {
  let approvals = 0;
  configureTslCodeExecution({
    executionPolicy: "prompt",
    authorize: async ({ hash, notice, policy }) => {
      approvals += 1;
      assert.match(hash, /^[a-f0-9]{64}$/);
      assert.match(notice, /executable JavaScript/);
      assert.equal(policy, "prompt");
      return true;
    }
  });
  const scene = payload("export default () => ({ color: null });");
  await prepareTslCodeForPayload(scene);
  await prepareTslCodeForPayload(scene);
  assert.equal(approvals, 1);
  assert.equal(getTslCodeExecutionState().preparedCount, 1);
});

test("trusted and prompt policies allow normal ESM dependencies", async () => {
  const dependency = Buffer.from("export const output = null;", "utf8").toString("base64");
  const code = `import { output } from "data:text/javascript;base64,${dependency}"; export default () => ({ color: output });`;
  await prepareTslCodeForPayload(payload(code));
  assert.equal(getTslCodeExecutionState().preparedCount, 1);

  configureTslCodeExecution({ executionPolicy: "prompt", authorize: async () => true });
  await prepareTslCodeForPayload(payload(code));
  assert.equal(getTslCodeExecutionState().preparedCount, 1);
});

test("code factories may return a complete material, one node, or mutate the supplied material", async () => {
  const materialCode = "export default (_params, { WEBGPU }) => new WEBGPU.MeshPhysicalNodeMaterial({ clearcoat: 0.75 });";
  await prepareTslCodeForPayload(payload(materialCode));
  const completeMaterial = createTslMaterialFromDescriptor({
    type: "tsl",
    tsl: { kind: "code", source: { inline: materialCode } }
  });
  assert.equal(completeMaterial.isMeshPhysicalNodeMaterial, true);
  assert.equal(completeMaterial.clearcoat, 0.75);

  const nodeCode = "export default (_params, { TSL }) => TSL.color('#ff3300');";
  await prepareTslCodeForPayload(payload(nodeCode));
  const nodeMaterial = createTslMaterialFromDescriptor({
    type: "tsl",
    tsl: { kind: "code", source: { inline: nodeCode } }
  });
  assert.equal(nodeMaterial.colorNode.isNode, true);

  const mutateCode = "export default (_params, { material, TSL }) => { material.emissiveNode = TSL.color('#00ff88'); };";
  await prepareTslCodeForPayload(payload(mutateCode));
  const mutatedMaterial = createTslMaterialFromDescriptor({
    type: "tsl",
    tsl: { kind: "code", source: { inline: mutateCode } }
  });
  assert.equal(mutatedMaterial.emissiveNode.isNode, true);

  completeMaterial.dispose();
  nodeMaterial.dispose();
  mutatedMaterial.dispose();
});

test("restricted remains an optional host policy rather than an engine-wide limit", async () => {
  configureTslCodeExecution({ executionPolicy: "restricted", authorize: async () => true });
  await assert.rejects(
    prepareTslCodeForPayload(payload('import "data:text/javascript,export default 1"; export default () => ({});')),
    (error) => error.code === "E_TSL_CODE_IMPORT_RESTRICTED"
  );
  await prepareTslCodeForPayload(payload("export default () => ({});"));
  assert.equal(getTslCodeExecutionState().preparedCount, 1);
});

test("disabled policy is controlled by the host", async () => {
  configureTslCodeExecution({ executionPolicy: "disabled" });
  const { getSceneCapability } = await import("../core/capabilities/sceneCapabilityManifest.js");
  assert.deepEqual(getSceneCapability("materials", "tsl").modes, ["preset", "graph"]);
  assert.equal(getSceneCapability("materials", "tsl").codeExecutionPolicy, "disabled");
  const { collectSceneCapabilityDiagnostics } = await import("../core/capabilities/sceneCapabilityValidation.js");
  assert.ok(
    collectSceneCapabilityDiagnostics(payload("export default () => ({})"), { rendererBackend: "webgpu" })
      .some((entry) => entry.category === "materialModes" && entry.id === "tsl.code")
  );
  await assert.rejects(
    prepareTslCodeForPayload(payload("export default () => ({});")),
    (error) => error.code === "E_TSL_CODE_DISABLED"
  );
});

test("an incompatible scene is rejected before TSL module loading", async () => {
  let moduleLoads = 0;
  configureTslCodeExecution({
    executionPolicy: "trusted",
    moduleLoader: async ({ defaultImport }) => {
      moduleLoads += 1;
      return defaultImport();
    }
  });
  await assert.rejects(
    createJsonScene({
      sceneConfig: { renderer: { backend: "webgl" } },
      ...payload("export default () => ({});")
    }),
    (error) => error?.code === "E_SCENE_CAPABILITY_UNAVAILABLE"
  );
  assert.equal(moduleLoads, 0);
});

test("changing application policy clears factories prepared under the old policy", async () => {
  await prepareTslCodeForPayload(payload("export default () => ({});"));
  assert.equal(getTslCodeExecutionState().preparedCount, 1);
  configureTslCodeExecution({ executionPolicy: "disabled" });
  assert.equal(getTslCodeExecutionState().preparedCount, 0);
});
