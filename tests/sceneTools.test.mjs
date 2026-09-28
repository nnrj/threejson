import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSceneToolHost } from "../packages/scene-tools/js/index.js";
import { createSceneMcpServer, sceneMcpTools } from "../packages/scene-tools/js/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scene = { objectList: [{ objType: "box", threeJsonId: "box" }] };
const command = { op: "object.transform", args: { id: "box", frame: "world", position: [3, 2, 1] } };
test("Node tool sessions retain revisions across calls and failed exports never overwrite externally changed files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "threejson-tools-")), file = path.join(dir, "scene.json");
  const host = createSceneToolHost({ workspace: dir });
  try {
    await writeFile(file, JSON.stringify(scene));
    const opened = await host.open({ file: "scene.json" });
    assert.equal((await host.preflight({ sessionId: opened.sessionId, commands: [command] })).status, "preflight");
    assert.equal((await host.apply({ sessionId: opened.sessionId, commands: [command], requestId: "first" })).status, "committed");
    const changed = '{"external":"edit"}'; await writeFile(file, changed);
    await assert.rejects(host.export({ sessionId: opened.sessionId, file: "scene.json" }), { code: "FILE_CHANGED" });
    assert.equal(await readFile(file, "utf8"), changed);
    const saved = await host.export({ sessionId: opened.sessionId, file: "copy.json" });
    assert.ok(saved.version);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, "copy.json"), "utf8")).objectList[0].position, { x: 3, y: 2, z: 1 });
    await host.undo({ sessionId: opened.sessionId }); assert.equal(host.list().sessions[0].revision, 2);
    host.close({ sessionId: opened.sessionId });
    await assert.rejects(host.apply({ sessionId: opened.sessionId, commands: [command] }), { code: "SESSION_EXPIRED" });
  } finally { await host.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test("real MCP SDK client and server negotiate and operate the same scene session", async () => {
  const app = createSceneMcpServer(), client = new Client({ name: "test-agent", version: "1" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)]);
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "op.object.transform"));
    assert.deepEqual(tools.tools.find((tool) => tool.name === "op.scene.query").inputSchema.properties.args, app.host.discover().commands.find((spec) => spec.op === "scene.query").inputSchema);
    const opened = (await client.callTool({ name: "session.open", arguments: { json: scene } })).structuredContent;
    const receipt = (await client.callTool({ name: "op.object.transform", arguments: { sessionId: opened.sessionId, requestId: "move", baseRevision: 0, args: command.args } })).structuredContent;
    assert.equal(receipt.ok, true); assert.equal(receipt.afterRevision, 1);
    const query = (await client.callTool({ name: "op.scene.query", arguments: { sessionId: opened.sessionId, args: { projection: ["transform"] } } })).structuredContent;
    assert.deepEqual(query.results[0].data.items[0].transform.worldPosition, [3, 2, 1]);
    const unavailable = await client.callTool({ name: "op.scene.capture", arguments: { sessionId: opened.sessionId, args: {} } });
    assert.equal(unavailable.isError, true); assert.equal(unavailable.structuredContent.code, "CAPTURE_UNAVAILABLE");
    assert.equal(sceneMcpTools(app.host).some((tool) => /generate|llm/.test(tool.name)), false);
  } finally { await client.close(); await app.close(); }
});

test("installed-style MCP stdio entry stays protocol-clean while opening a headless runtime", async () => {
  const client = new Client({ name: "stdio-check", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL("../packages/scene-tools/bin/threejson-mcp.mjs", import.meta.url))], stderr: "pipe" });
  transport.stderr?.on("data", () => {});
  try {
    await client.connect(transport);
    const opened = (await client.callTool({ name: "session.open", arguments: { json: scene, runtime: true } })).structuredContent;
    assert.equal(opened.ok, true);
    const result = (await client.callTool({ name: "op.scene.query", arguments: { sessionId: opened.sessionId, args: { projection: ["identity"] } } })).structuredContent;
    assert.equal(result.results[0].data.items[0].id, "box");
    await client.callTool({ name: "session.close", arguments: { sessionId: opened.sessionId } });
  } finally { await client.close(); }
});

test("CLI argument errors are JSON and failed postconditions exit nonzero", () => {
  const bin = fileURLToPath(new URL("../packages/scene-tools/bin/threejson.mjs", import.meta.url));
  const invalid = spawnSync(process.execPath, [bin, "query", "unexpected"], { encoding: "utf8" });
  if (invalid.error) throw invalid.error;
  assert.equal(invalid.status, 1); assert.equal(JSON.parse(invalid.stdout).ok, false);
  const checked = spawnSync(process.execPath, [bin, "check", "--file", fileURLToPath(new URL("../examples/scene-operations/scene.json", import.meta.url)), "--args", JSON.stringify({ assertions: [{ type: "exists", id: "missing" }] })], { encoding: "utf8" });
  if (checked.error) throw checked.error;
  assert.equal(checked.status, 1); assert.equal(JSON.parse(checked.stdout).checks.postconditions, "failed");
});
