import test from "node:test";
import assert from "node:assert/strict";
import {
  TSL_CODE_SECURITY_NOTICE,
  clearPreparedTslCode,
  configureTslCodeExecution,
  getTslCodeExecutionState,
  prepareTslCodeForPayload
} from "../webgpu/tslCode.js";
import { createJsonScene } from "../core/handler/sceneLoadHandler.js";

const payload = (code) => ({ objectList: [{ objType: "box", material: { type: "tsl", tsl: { kind: "code", source: { inline: code } } } }] });

test.afterEach(() => {
  clearPreparedTslCode();
  configureTslCodeExecution({ enabled: false });
});

test("TSL code is closed by default and scene JSON cannot enable it", async () => {
  await assert.rejects(
    prepareTslCodeForPayload({ ...payload("export default ()=>({});"), enableTslCode: true }),
    (error) => error.code === "E_TSL_CODE_DISABLED"
  );
  assert.match(TSL_CODE_SECURITY_NOTICE, /same page permissions/i);
  await assert.rejects(
    prepareTslCodeForPayload({
      objectList: [{ objType: "box", materials: [{ type: "tsl", tsl: { kind: "code", source: { inline: "export default () => ({});" } } }] }]
    }),
    (error) => error.code === "E_TSL_CODE_DISABLED"
  );
});

test("TSL code requires host approval for the exact SHA-256 content", async () => {
  let approvals = 0;
  configureTslCodeExecution({
    enabled: true,
    authorize: async ({ hash, notice }) => {
      approvals += 1;
      assert.match(hash, /^[a-f0-9]{64}$/);
      assert.match(notice, /JavaScript module/);
      return true;
    }
  });
  await prepareTslCodeForPayload(payload("export default () => ({ color: null });"));
  assert.equal(approvals, 1);
  assert.equal(getTslCodeExecutionState().preparedCount, 1);
});

test("TSL code cannot execute unhashed dependency imports", async () => {
  configureTslCodeExecution({ enabled: true, authorize: async () => true });
  await assert.rejects(
    prepareTslCodeForPayload(payload('import "https://example.invalid/unapproved.js"; export default () => ({});')),
    (error) => error.code === "E_TSL_CODE_IMPORT_FORBIDDEN"
  );
  await assert.rejects(
    prepareTslCodeForPayload(payload('export default async () => { await import /* bypass */ ("https://example.invalid/unapproved.js"); return {}; };')),
    (error) => error.code === "E_TSL_CODE_IMPORT_FORBIDDEN"
  );
});

test("an incompatible scene is rejected before TSL code authorization or execution", async () => {
  let approvals = 0;
  configureTslCodeExecution({ enabled: true, authorize: async () => { approvals += 1; return true; } });
  await assert.rejects(
    createJsonScene({
      sceneConfig: { renderer: { backend: "webgl" } },
      ...payload("export default () => ({});")
    }),
    (error) => error?.code === "E_SCENE_CAPABILITY_UNAVAILABLE"
  );
  assert.equal(approvals, 0);
});

test("disabling TSL code clears already prepared factories", async () => {
  configureTslCodeExecution({ enabled: true, authorize: async () => true });
  await prepareTslCodeForPayload(payload("export default () => ({});"));
  assert.equal(getTslCodeExecutionState().preparedCount, 1);
  configureTslCodeExecution({ enabled: false });
  assert.equal(getTslCodeExecutionState().preparedCount, 0);
});
