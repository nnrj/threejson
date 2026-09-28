import { readFile } from "node:fs/promises";
import { createSceneSession, createSceneOperationService, captureSceneSession } from "threejson/session";
import { readVersionedFile, writeVersionedFile, toolError } from "./files.js";
import path from "node:path";

/** Explicit opt-in only. Ordinary CLI/MCP session tools never import or call this module. */
export async function runSceneAi(options = {}) {
  const { runSceneAgent, runSceneOperationAgent } = await import("threejson/ai");
  const file = options.scenePath && path.resolve(options.projectRoot || process.cwd(), options.scenePath);
  const source = file ? await readVersionedFile(file) : null;
  const current = options.currentSceneJsonString || source?.bytes?.toString("utf8");
  const llm = options.setting?.llm || {}, chat = { ...llm, apiKey: llm.apiKey || process.env.THREEJSON_AI_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY, signal: options.signal, onProgress: options.onProgress };
  let result;
  if (options.mode === "update") {
    if (!current) throw toolError("SCENE_REQUIRED", "Updating requires an existing scene.");
    const session = createSceneSession(JSON.parse(current));
    try {
      result = await runSceneOperationAgent({ ...chat, service: createSceneOperationService({ session }), prompt: options.prompt, protocol: options.protocol || "jsonl", modelBudget: options.modelBudget, assertions: options.assertions });
      result.sceneJsonString = JSON.stringify(captureSceneSession(session), null, 2);
    } finally { session.dispose(); }
  } else {
    let image = options.image;
    if (typeof image === "string" && !/^(https?:|data:)/.test(image)) {
      const bytes = await readFile(path.resolve(options.projectRoot || process.cwd(), image));
      image = { base64: bytes.toString("base64"), mimeType: /\.jpe?g$/i.test(image) ? "image/jpeg" : /\.webp$/i.test(image) ? "image/webp" : "image/png" };
    }
    result = await runSceneAgent({ mode: image ? "fromImage" : "generate", prompt: options.prompt, ...(image ? { image } : {}) }, { ...chat, ...options.agent, modelBudget: options.modelBudget });
  }
  if (options.fillTextures && result.completed !== false && result.sceneJsonString) {
    const { runTextureFill } = await import("./texture-fill.mjs");
    const textures = await runTextureFill({ sceneJsonString: result.sceneJsonString, setting: options.setting, userHint: options.prompt, writeScene: false, signal: options.signal });
    result = { ...result, sceneJsonString: textures.sceneJsonString, textureResult: textures };
  }
  if (file && options.writeScene === true && result.sceneJsonString && result.completed !== false) result.saved = await writeVersionedFile(file, result.sceneJsonString, source.version);
  return { ok: result.completed !== false, ...result };
}
