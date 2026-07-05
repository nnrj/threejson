/**
 * Node bridge: stdin JSON → fillTextureUrls → stdout JSON.
 * @example
 * echo '{"scenePath":"./scene.json","setting":{...}}' | node bridge/texture-fill.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fillTextureUrls,
  createOpenAiImageProvider,
  planTextures
} from "../../../core/ai/index.js";
import { withNodeTextureSink } from "../../../core/util/nodeTextureSink.js";

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

export async function runTextureFill(options = {}) {
  const opts = options || {};
  const projectRoot = path.resolve(opts.projectRoot || repoRoot);
  const scenePath = path.isAbsolute(opts.scenePath)
    ? opts.scenePath
    : path.resolve(projectRoot, opts.scenePath || "");
  const setting = opts.setting || {};
  const llm = setting.llm || {};
  const texture = setting.texture || {};
  const userHint = opts.userHint || "";
  const dryRun = Boolean(opts.dryRun);

  const sceneText = readFileSync(scenePath, "utf8");
  const apiKey = llm.apiKey || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
  const imageBase = String(llm.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const imageModel = llm.imageModel || "dall-e-3";

  const chatOptions = {
    provider: llm.provider || "chatgpt",
    apiKey,
    model: llm.model || undefined,
    baseUrl: llm.baseUrl || undefined,
    temperature: llm.temperature
  };

  if (dryRun) {
    const planned = await planTextures(sceneText, userHint, chatOptions);
    return {
      ok: true,
      dryRun: true,
      scenePath,
      taskCount: planned.tasks?.length || 0,
      tasks: planned.tasks
    };
  }

  const localOutputDir = path.resolve(
    projectRoot,
    texture.localOutputDir || "assets/textures/ai-generated"
  );

  const imageProvider = createOpenAiImageProvider({
    apiKey,
    baseUrl: imageBase,
    model: imageModel
  });

  const result = await fillTextureUrls(
    sceneText,
    withNodeTextureSink({
      userHint,
      localOutputDir,
      projectRoot,
      imageProvider,
      overwriteExisting: Boolean(texture.overwriteExisting),
      concurrency: Number(texture.concurrency) || 2,
      chatOptions
    })
  );

  writeFileSync(scenePath, result.sceneJsonString, "utf8");
  return {
    ok: true,
    scenePath,
    taskCount: result.tasks?.length || 0,
    applied: result.taskResults?.length || 0,
    skipped: result.skipped?.length || 0
  };
}

const isDirectExec = (() => {
  const selfPath = fileURLToPath(import.meta.url);
  const argvPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return argvPath === path.resolve(selfPath);
})();

if (isDirectExec) {
  const raw = await readStdin();
  const out = await runTextureFill(JSON.parse(raw || "{}"));
  process.stdout.write(JSON.stringify(out));
}
