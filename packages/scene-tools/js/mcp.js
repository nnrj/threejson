import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createSceneToolHost } from "./index.js";
import { validateCommandSchema } from "threejson/operations";
import packageInfo from "../package.json" with { type: "json" };

const str = { type: "string" }, integer = { type: "integer", minimum: 0 }, json = { type: "object" };
const batch = { sessionId: str, commands: { type: "array", items: { type: "object", properties: { op: str, args: json }, required: ["op"] } }, requestId: str, baseRevision: integer, historyGroup: str };
const baseTools = [
  ["session.open", "open", "Open a persistent scene session without calling any model.", { file: str, json, runtime: { type: "boolean" } }, []],
  ["session.list", "list", "List application scene sessions in this process.", {}, []],
  ["session.close", "close", "Close one scene and dispose its resources.", { sessionId: str }, ["sessionId"]],
  ["scene.discover", "discover", "Discover contracts, target types and actual adapter availability.", { sessionId: str }, []],
  ["scene.apply", "apply", "Apply one atomic batch with revision checks and session-lifetime request idempotency.", batch, ["sessionId", "commands"]],
  ["scene.preflight", "preflight", "Prepare without committing. Read check coverage: unchecked is not passed.", batch, ["sessionId", "commands"]],
  ["scene.undo", "undo", "Undo one authoring transaction.", { sessionId: str, baseRevision: integer, requestId: str }, ["sessionId"]],
  ["scene.redo", "redo", "Redo one authoring transaction.", { sessionId: str, baseRevision: integer, requestId: str }, ["sessionId"]],
  ["scene.save", "export", "Export source JSON or atomically save after checking the destination file version.", { sessionId: str, file: str, format: { enum: ["standard", "friendly"] }, expectedFileVersion: { type: ["string", "null"] } }, ["sessionId"]],
  ["job.start", "startJob", "Run a cancellable operation batch and return immediately.", batch, ["sessionId", "commands"]],
  ["job.get", "job", "Get job progress/result.", { jobId: str }, ["jobId"]],
  ["job.cancel", "cancel", "Request cancellation before commit; already committed batches remain.", { jobId: str }, ["jobId"]]
];
export function sceneMcpTools(host) {
  return [...baseTools.map(([name, , description, properties, required]) => ({ name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } })),
    { name: "media.render", description: "Render JSON/.tjz locally to PNG/JPEG/WebP/GIF/MP4/WebM using an installed browser. Writes a new file only; no browser install or AI call.", inputSchema: { type: "object", properties: { file: str, output: str, format: { enum: ["png","jpeg","webp","gif","mp4","webm"] }, executablePath: str, mediaOptions: json }, required: ["file","output","executablePath"], additionalProperties: false } },
    { name: "media.start", description: "Start a background media export from a file or immutable session snapshot. Poll job.get; cancel with job.cancel. Uses an installed browser only.", inputSchema: { type: "object", properties: { file: str, sessionId: str, output: str, format: { enum: ["png","jpeg","webp","gif","mp4","webm"] }, executablePath: str, mediaOptions: json }, required: ["output","executablePath"], additionalProperties: false } },
    { name: "editor.call", description: "Submit an operation to an explicitly paired local Editor; returns a request ID, not a claim of execution. Use editor.result to reconcile delivery.", inputSchema: { type: "object", properties: { url: str, token: str, method: { enum: ["discover", "execute", "preflight", "undo", "redo", "export"] }, params: json, requestId: str }, required: ["url", "token", "method"], additionalProperties: false } },
    { name: "editor.result", description: "Retrieve a paired Editor operation result without resending the write.", inputSchema: { type: "object", properties: { url: str, token: str, requestId: str }, required: ["url", "token", "requestId"], additionalProperties: false } },
    ...host.discover().commands.map((spec) => ({ name: `op.${spec.op}`, description: spec.summary,
      inputSchema: { type: "object", properties: { sessionId: str, requestId: str, baseRevision: integer, args: spec.inputSchema }, required: ["sessionId", "args"], additionalProperties: false },
      annotations: { readOnlyHint: spec.category === "read", idempotentHint: spec.category === "read" } }))];
}
export function createSceneMcpServer(options = {}) {
  const host = options.host || createSceneToolHost(options);
  const server = new Server({ name: "threejson-scene-tools", version: packageInfo.version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: sceneMcpTools(host) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    try {
      const name = request.params.name, args = request.params.arguments || {};
      const route = baseTools.find(([tool]) => tool === name);
      const definition = sceneMcpTools(host).find((tool) => tool.name === name);
      if (definition) validateCommandSchema(args, definition.inputSchema);
      let result;
      if (name === "media.render") result = await (await import("./media.js")).renderSceneMedia({ ...args, signal: extra.signal });
      else if (name === "media.start") result = host.startMediaJob(args);
      else if (name === "editor.call" || name === "editor.result") result = await (await import("./editor-bridge.js")).callEditorBridge({ ...args, signal: extra.signal });
      else if (route) result = await host[route[1]]({ ...args, signal: extra.signal });
      else if (name.startsWith("op.") && host.discover().commands.some((spec) => `op.${spec.op}` === name)) {
        const { args: commandArgs, ...envelope } = args;
        result = await host.apply({ ...envelope, commands: [{ op: name.slice(3), args: commandArgs }], signal: extra.signal });
      } else throw Object.assign(new Error(`Unknown tool: ${name}`), { code: "UNKNOWN_TOOL" });
      const images = [];
      const compact = JSON.parse(JSON.stringify(result, (key, value) => {
        if (key === "dataUrl" && typeof value === "string") {
          const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(value);
          if (match) { images.push({ type: "image", mimeType: match[1], data: match[2] }); return "[image attached]"; }
        }
        return value;
      }));
      return { isError: result.ok === false, structuredContent: compact, content: [{ type: "text", text: JSON.stringify(compact) }, ...images] };
    } catch (error) {
      const result = { ok: false, status: "failed", code: error.code || "TOOL_FAILED", error: error.message };
      return { isError: true, structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  });
  return { server, host, async close() { await server.close(); await host.dispose(); }, async start() { await server.connect(new StdioServerTransport()); } };
}
