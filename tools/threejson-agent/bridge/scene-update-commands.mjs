/**
 * Node bridge: stdin JSON → requestUpdatedSceneEditCommands → stdout JSON.
 * Headless update path for agents/MCP (core commands only, no editor.*).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requestUpdatedSceneEditCommands } from "../../../core/ai/sceneAiService.js";
import { createCommandContext, executeCommands } from "../../../core/command/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

const raw = await readStdin();
const opts = JSON.parse(raw || "{}");
const projectRoot = path.resolve(opts.projectRoot || repoRoot);
const setting = opts.setting || {};
const llm = setting.llm || {};
const apiKey =
  llm.apiKey || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
const chatOptions = {
  provider: llm.provider || "chatgpt",
  apiKey,
  model: llm.model || undefined,
  baseUrl: llm.baseUrl || undefined,
  temperature: llm.temperature,
  updateMode: opts.updateMode === "incremental" ? "incremental" : "full"
};

const prompt = String(opts.prompt || "").trim();
if (!prompt) {
  throw new Error("prompt is required.");
}

let currentSceneJsonString = String(opts.currentSceneJsonString || "").trim();
if (opts.scenePath && !currentSceneJsonString) {
  const scenePath = path.isAbsolute(opts.scenePath)
    ? opts.scenePath
    : path.resolve(projectRoot, opts.scenePath);
  currentSceneJsonString = readFileSync(scenePath, "utf8");
}
if (!currentSceneJsonString) {
  throw new Error("currentSceneJsonString or scenePath is required.");
}

const aiResult = await requestUpdatedSceneEditCommands(
  prompt,
  {
    currentSceneJsonString,
    objectList: Array.isArray(opts.objectList) ? opts.objectList : undefined,
    selectionId: opts.selectionId ?? null,
    fullSceneJson: opts.includeFullJson === true ? currentSceneJsonString : undefined
  },
  {
    ...chatOptions,
    outputMode: opts.outputMode === "json" ? "json" : "commands",
    fallbackToJson: opts.fallbackToJson !== false
  }
);

let appliedDocument = null;
if (opts.applyDocument === true && aiResult.commands?.length) {
  const ctx = createCommandContext({ document: JSON.parse(currentSceneJsonString) });
  const batch = await executeCommands(ctx, aiResult.commands, {
    executeMode: "auto",
    stopOnError: true
  });
  appliedDocument = ctx.document || null;
  aiResult.documentApply = { ok: batch.ok, results: batch.results, document: appliedDocument };
}

process.stdout.write(
  JSON.stringify({
    ok: true,
    ...aiResult
  })
);
