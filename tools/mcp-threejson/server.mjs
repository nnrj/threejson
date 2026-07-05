#!/usr/bin/env node
/**
 * ThreeJSON MCP server (stdio). Set THREEJSON_ROOT to repo root (optional).
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
  runSceneAgent,
  generateSceneJsonString,
  updateSceneJsonString,
  requestUpdatedSceneEditCommands,
  validateSceneJson,
  planTextures,
  fillTextureUrls,
  createOpenAiImageProvider,
  parseSceneJsonString
} from "../../core/ai/index.js";
import {
  createCommandContext,
  executeCommands,
  getCommandSpec
} from "../../core/command/index.js";
import { withNodeTextureSink } from "../../core/util/nodeTextureSink.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "../..");
const projectRoot = process.env.THREEJSON_ROOT
  ? path.resolve(process.env.THREEJSON_ROOT)
  : defaultRoot;

function loadSetting() {
  const p = path.join(__dirname, "setting.json");
  if (!existsSync(p)) {
    return {};
  }
  return JSON.parse(readFileSync(p, "utf8"));
}

function chatOptionsFromSetting(setting, overrides = {}) {
  const llm = { ...setting.llm, ...overrides };
  return {
    provider: llm.provider || "chatgpt",
    apiKey: llm.apiKey || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "",
    model: llm.model || undefined,
    baseUrl: llm.baseUrl || undefined,
    temperature: llm.temperature
  };
}

const server = new Server(
  { name: "threejson", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "threejson_validate",
      description: "Validate ThreeJSON scene JSON string",
      inputSchema: {
        type: "object",
        properties: { sceneJsonString: { type: "string" } },
        required: ["sceneJsonString"]
      }
    },
    {
      name: "threejson_generate",
      description: "Generate scene JSON from prompt (optional agent)",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          agentEnabled: { type: "boolean" },
          depth: { type: "string" }
        },
        required: ["prompt"]
      }
    },
    {
      name: "threejson_update",
      description:
        "Update scene with natural language. outputMode commands returns core command script; json returns full scene JSON (default).",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          currentSceneJsonString: { type: "string" },
          updateMode: { type: "string", enum: ["full", "incremental"] },
          outputMode: { type: "string", enum: ["json", "commands"] },
          includeFullJson: { type: "boolean" },
          objectList: { type: "array" },
          selectionId: { type: "string" },
          fallbackToJson: { type: "boolean" }
        },
        required: ["prompt", "currentSceneJsonString"]
      }
    },
    {
      name: "threejson_plan_textures",
      description: "Dry-run texture task plan for a scene",
      inputSchema: {
        type: "object",
        properties: {
          sceneJsonString: { type: "string" },
          userHint: { type: "string" }
        },
        required: ["sceneJsonString"]
      }
    },
    {
      name: "threejson_fill_textures",
      description: "Fill textureUrl slots (Node only; writes under resources/textures/)",
      inputSchema: {
        type: "object",
        properties: {
          sceneJsonString: { type: "string" },
          userHint: { type: "string" },
          outputPath: { type: "string" }
        },
        required: ["sceneJsonString"]
      }
    },
    {
      name: "threejson_exec",
      description:
        "Execute ThreeJSON JSONL command script. Document ops (scene.validate, scene.applyPatch) work without runtime; runtime ops need sceneJson + sync scene.load.",
      inputSchema: {
        type: "object",
        properties: {
          script: { type: "string", description: "JSONL command script" },
          sceneJson: { type: "object", description: "Optional scene document for ctx.document" },
          stopOnError: { type: "boolean" },
          dryRun: {
            type: "boolean",
            description: "Parse and validate commands without mutating runtime/document"
          },
          executeMode: {
            type: "string",
            enum: ["auto", "runtime", "document"],
            description: "auto skips runtime ops when no scene loaded (MCP document workflows)"
          }
        },
        required: ["script"]
      }
    },
    {
      name: "threejson_command_spec",
      description: "List machine-readable core command specifications for agents",
      inputSchema: { type: "object", properties: {} }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const setting = loadSetting();
  const chat = chatOptionsFromSetting(setting);
  const args = request.params.arguments || {};

  try {
    if (request.params.name === "threejson_validate") {
      const r = validateSceneJson(args.sceneJsonString);
      return {
        content: [{ type: "text", text: JSON.stringify(r, null, 2) }]
      };
    }

    if (request.params.name === "threejson_generate") {
      let sceneJsonString;
      if (args.agentEnabled) {
        const r = await runSceneAgent(
          { mode: "generate", prompt: args.prompt },
          {
            ...chat,
            agent: { enabled: true, depth: args.depth || setting.agent?.depth || "medium" }
          }
        );
        sceneJsonString = r.sceneJsonString;
      } else {
        sceneJsonString = await generateSceneJsonString(args.prompt, chat);
      }
      return { content: [{ type: "text", text: sceneJsonString }] };
    }

    if (request.params.name === "threejson_update") {
      const updateOpts = {
        ...chat,
        ...(args.updateMode === "incremental" ? { updateMode: "incremental" } : {})
      };
      const outputMode = args.outputMode === "commands" ? "commands" : "json";
      if (outputMode === "commands") {
        const result = await requestUpdatedSceneEditCommands(
          args.prompt,
          {
            currentSceneJsonString: args.currentSceneJsonString,
            objectList: Array.isArray(args.objectList) ? args.objectList : undefined,
            selectionId: args.selectionId ?? null,
            fullSceneJson: args.includeFullJson === true ? args.currentSceneJsonString : undefined
          },
          {
            ...updateOpts,
            outputMode: "commands",
            fallbackToJson: args.fallbackToJson !== false
          }
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      const sceneJsonString = await updateSceneJsonString(
        args.prompt,
        args.currentSceneJsonString,
        updateOpts
      );
      return { content: [{ type: "text", text: sceneJsonString }] };
    }

    if (request.params.name === "threejson_plan_textures") {
      const scene = parseSceneJsonString(args.sceneJsonString);
      const planned = await planTextures(scene, args.userHint || "", chat);
      return {
        content: [{ type: "text", text: JSON.stringify(planned, null, 2) }]
      };
    }

    if (request.params.name === "threejson_exec") {
      const ctx = createCommandContext({
        document: args.sceneJson && typeof args.sceneJson === "object" ? args.sceneJson : null
      });
      const executeMode =
        args.executeMode === "auto" || args.executeMode === "document"
          ? args.executeMode
          : "runtime";
      const batch = await executeCommands(ctx, args.script, {
        stopOnError: args.stopOnError !== false,
        executeMode,
        dryRun: args.dryRun === true
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: batch.ok,
                dryRun: batch.dryRun === true,
                results: batch.results,
                document: args.dryRun === true ? args.sceneJson || null : ctx.document || null
              },
              null,
              2
            )
          }
        ]
      };
    }

    if (request.params.name === "threejson_command_spec") {
      return {
        content: [{ type: "text", text: JSON.stringify(getCommandSpec(), null, 2) }]
      };
    }

    if (request.params.name === "threejson_fill_textures") {
      const tex = setting.texture || {};
      const localOutputDir = path.resolve(
        projectRoot,
        tex.localOutputDir || "assets/textures/ai-generated"
      );
      const llm = setting.llm || {};
      const imageProvider = createOpenAiImageProvider({
        apiKey: chat.apiKey,
        baseUrl: String(llm.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, ""),
        model: llm.imageModel || "dall-e-3"
      });
      const filled = await fillTextureUrls(
        args.sceneJsonString,
        withNodeTextureSink({
          userHint: args.userHint || "",
          localOutputDir,
          projectRoot,
          imageProvider,
          overwriteExisting: Boolean(tex.overwriteExisting),
          concurrency: tex.concurrency || 2,
          chatOptions: chat
        })
      );
      if (args.outputPath) {
        const out = path.isAbsolute(args.outputPath)
          ? args.outputPath
          : path.join(projectRoot, args.outputPath);
        const { writeFileSync } = await import("node:fs");
        writeFileSync(out, filled.sceneJsonString, "utf8");
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                sceneJsonString: filled.sceneJsonString,
                applied: filled.taskResults?.length,
                skipped: filled.skipped?.length
              },
              null,
              2
            )
          }
        ]
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: String(err?.message || err) }],
      isError: true
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
