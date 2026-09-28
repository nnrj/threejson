/**
 * Node bridge: stdin JSON → semantic texture plan/acquisition → updated scene file.
 * Search, generation and persistence are supplied by a configured texture service; this bridge
 * contains no provider-specific adapters and never asks the LLM to invent URLs.
 */
import { readVersionedFile, writeVersionedFile } from "./files.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSceneTexturePlanner } from "threejson/ai";
import {
  planSceneTextures,
  runSceneTexturePipeline,
  TextureAcquisitionProvider
} from "threejson/texture";

const repoRoot = process.cwd();

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function requestJson(url, apiKey, init = {}) {
  const headers = new Headers(init.headers || {});
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);
  if (init.body != null) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) throw new Error(body?.message || body?.error || `Texture service returned HTTP ${response.status}.`);
  return body || {};
}

function createServiceProvider(config = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl || config.serviceUrl);
  const apiKey = String(config.apiKey || process.env.THREEJSON_TEXTURE_API_KEY || "").trim();
  if (!baseUrl || !apiKey) return null;
  const post = (pathName, payload, requestOptions = {}) => requestJson(`${baseUrl}${pathName}`, apiKey, {
    method: "POST",
    body: JSON.stringify(payload), signal: requestOptions.signal
  });
  return new TextureAcquisitionProvider({
    capabilities: (requestOptions = {}) => requestJson(`${baseUrl}/v1/textures/capabilities`, apiKey, { signal: requestOptions.signal }),
    search: (payload, options) => post("/v1/textures/search", payload, options),
    generate: (payload, options) => post("/v1/textures/generate", payload, options),
    persist: (payload, options) => post("/v1/textures/persist", payload, options)
  });
}

function chatOptions(llm = {}) {
  return {
    provider: llm.provider || "chatgpt",
    apiKey: llm.apiKey || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || "",
    model: llm.model || undefined,
    baseUrl: llm.baseUrl || undefined,
    temperature: llm.temperature
  };
}

export async function runTextureFill(options = {}) {
  options.signal?.throwIfAborted();
  const projectRoot = path.resolve(options.projectRoot || repoRoot);
  const scenePath = options.scenePath
    ? (path.isAbsolute(options.scenePath) ? options.scenePath : path.resolve(projectRoot, options.scenePath))
    : null;
  const setting = options.setting || {};
  const texture = setting.texture || {};
  const source = scenePath ? await readVersionedFile(scenePath) : null;
  const sceneText = typeof options.sceneJsonString === "string" && options.sceneJsonString.trim()
    ? options.sceneJsonString
    : scenePath
      ? source.bytes?.toString("utf8")
      : "";
  if (!sceneText) throw new Error("Texture fill requires scenePath or sceneJsonString.");
  const scene = JSON.parse(sceneText);
  const planner = createSceneTexturePlanner(chatOptions(setting.llm || {}));
  const plan = await planSceneTextures(scene, options.userHint || "", {
    signal: options.signal,
    planner,
    strategy: texture.strategy || "semantic-hybrid",
    pbr: texture.pbr !== false
  });
  if (options.dryRun) {
    return { ok: true, dryRun: true, scenePath, taskCount: plan.tasks.length, tasks: plan.tasks };
  }

  const provider = createServiceProvider(texture);
  if (!provider) {
    throw new Error("Texture fill requires texture.baseUrl and texture.apiKey (or THREEJSON_TEXTURE_API_KEY).");
  }
  const result = await runSceneTexturePipeline(scene, {
    signal: options.signal,
    mutate: true,
    plan,
    textureProvider: provider,
    strategy: texture.strategy || "semantic-hybrid",
    pbr: texture.pbr !== false,
    allowUnknownLicense: texture.allowUnknownLicense === true,
    persistenceMode: texture.persistenceMode || "remote",
    concurrency: Number(texture.concurrency) || 3
  });
  const sceneJsonString = JSON.stringify(result.scene, null, 2);
  options.signal?.throwIfAborted();
  if (scenePath && options.writeScene === true) await writeVersionedFile(scenePath, sceneJsonString, source.version);
  return {
    ok: true,
    scenePath: scenePath || null,
    sceneJsonString,
    taskCount: plan.tasks.length,
    applied: result.assignments.length,
    pendingLicense: result.pendingLicense.length,
    failed: result.taskResults.filter((entry) => entry.error).length
  };
}

const isDirectExec = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExec) {
  const raw = await readStdin();
  const output = await runTextureFill(JSON.parse(raw || "{}"));
  process.stdout.write(JSON.stringify(output));
}
