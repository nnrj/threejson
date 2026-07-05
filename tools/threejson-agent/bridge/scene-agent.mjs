/**
 * Node bridge: stdin JSON → runSceneAgent → stdout JSON.
 * Progress lines go to stderr (message only) for CLI/GUI consumers.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSceneAgent, requestUpdatedSceneEditCommands } from "../../../core/ai/index.js";
import { createOpenAiImageProvider } from "../../../core/ai/textureAiService.js";
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

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

/**
 * @param {string} imageRef path, http(s) URL, or data: URL
 * @param {string} projectRoot
 */
function resolveImageInput(imageRef, projectRoot) {
  const s = String(imageRef || "").trim();
  if (!s) {
    throw new Error("image is required for fromImage mode.");
  }
  if (/^https?:\/\//i.test(s) || /^data:image\//i.test(s)) {
    return s;
  }
  const filePath = path.isAbsolute(s) ? s : path.resolve(projectRoot, s);
  if (!existsSync(filePath)) {
    throw new Error(`Image file not found: ${filePath}`);
  }
  const buf = readFileSync(filePath);
  return { base64: buf.toString("base64"), mimeType: mimeFromPath(filePath) };
}

function normalizeMode(mode) {
  const m = String(mode || "generate").trim();
  if (m === "from_image" || m === "from-image") return "fromImage";
  if (m === "fromImage") return "fromImage";
  if (m === "update") return "update";
  return "generate";
}

const raw = await readStdin();
const opts = JSON.parse(raw || "{}");
const projectRoot = path.resolve(opts.projectRoot || repoRoot);
const setting = opts.setting || {};
const llm = setting.llm || {};
const agentCfg = { ...setting.agent, ...opts.agent };
const textureCfg = setting.texture || {};
const apiKey =
  llm.apiKey || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "";
const chatOptions = {
  provider: llm.provider || "chatgpt",
  apiKey,
  model: llm.model || undefined,
  baseUrl: llm.baseUrl || undefined,
  temperature: llm.temperature
};

const mode = normalizeMode(opts.mode);
const prompt = String(opts.prompt || "").trim();
let currentSceneJsonString = opts.currentSceneJsonString || "";

if (opts.scenePath) {
  const scenePath = path.isAbsolute(opts.scenePath)
    ? opts.scenePath
    : path.resolve(projectRoot, opts.scenePath);
  if (mode === "update" && !currentSceneJsonString) {
    currentSceneJsonString = readFileSync(scenePath, "utf8");
  }
}

const input = { mode, prompt };
if (mode === "update") {
  input.currentSceneJsonString = currentSceneJsonString;
}
if (mode === "fromImage") {
  input.image = resolveImageInput(opts.image, projectRoot);
}

const agentEnabled =
  opts.agentEnabled !== undefined ? Boolean(opts.agentEnabled) : Boolean(agentCfg.enabled);
const depth = opts.depth || agentCfg.depth || "simple";

const fillTextures =
  opts.fillTextures !== undefined
    ? Boolean(opts.fillTextures)
    : Boolean(textureCfg.fillAfterAgent) || Boolean(textureCfg.enabled);

let texture;
if (fillTextures) {
  const localOutputDir = path.resolve(
    projectRoot,
    textureCfg.localOutputDir || "assets/textures/ai-generated"
  );
  const sunk = withNodeTextureSink({ localOutputDir, projectRoot });
  const imageBase = String(llm.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  texture = {
    enabled: true,
    sink: sunk.sink,
    projectRoot,
    imageProvider: createOpenAiImageProvider({
      apiKey,
      baseUrl: imageBase,
      model: llm.imageModel || "dall-e-3"
    }),
    overwriteExisting: Boolean(textureCfg.overwriteExisting),
    concurrency: Number(textureCfg.concurrency) || 2
  };
}

const runOptions = {
  ...chatOptions,
  agent: { enabled: agentEnabled, depth },
  updateMode: opts.updateMode === "incremental" ? "incremental" : undefined,
  stream: Boolean(opts.stream),
  streamPreview: Boolean(opts.streamPreview),
  onProgress: (p) => {
    if (p?.message) {
      process.stderr.write(`${p.message}\n`);
    }
    if (opts.streamPreview && p?.previewDelta) {
      process.stderr.write(p.previewDelta);
    }
  }
};
if (texture) {
  runOptions.texture = texture;
}

let result;
if (
  mode === "update" &&
  (opts.outputMode === "commands" || opts.preferCommands === true)
) {
  result = await requestUpdatedSceneEditCommands(
    prompt,
    {
      currentSceneJsonString,
      objectList: Array.isArray(opts.objectList) ? opts.objectList : undefined,
      selectionId: opts.selectionId ?? null,
      fullSceneJson: opts.includeFullJson === true ? currentSceneJsonString : undefined
    },
    {
      ...chatOptions,
      outputMode: "commands",
      fallbackToJson: opts.fallbackToJson !== false,
      updateMode: opts.updateMode === "incremental" ? "incremental" : "full"
    }
  );
} else {
  result = await runSceneAgent(input, runOptions);
}

if (opts.scenePath && opts.writeScene !== false && result.sceneJsonString) {
  const scenePath = path.isAbsolute(opts.scenePath)
    ? opts.scenePath
    : path.resolve(projectRoot, opts.scenePath);
  writeFileSync(scenePath, result.sceneJsonString, "utf8");
}

process.stdout.write(
  JSON.stringify({
    ok: true,
    sceneJsonString: result.sceneJsonString,
    commandScript: result.commandScript,
    commands: result.commands,
    outputMode: result.outputMode,
    fallbackUsed: result.fallbackUsed,
    fallbackReason: result.fallbackReason,
    textureFillWarning: result.textureFillWarning,
    agentUsed: result.agentUsed,
    steps: result.steps,
    tokenHint: result.tokenHint
  })
);
