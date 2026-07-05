/**
 * Texture pipeline: chat plan → image provider → normalize → sink → write textureUrl pointers.
 */
import {
  requestChatCompletion,
  extractJsonText,
  parseSceneJsonString
} from "./sceneAiService.js";
import {
  buildTexturePlanSystemPrompt,
  buildTexturePlanUserContent
} from "./texturePrompt.js";
import { getByPointer, setByPointer } from "../util/jsonPointer.js";
import { listTextureUrlPointers } from "../util/materialDescriptorWalk.js";

function normalizePointer(p) {
  const s = String(p).trim();
  if (!s) return "";
  return s.startsWith("/") ? s : `/${s}`;
}

/**
 * @param {object} sceneObj
 * @param {{ pointer: string, prompt: string, size?: string, mimeType?: string }[]} tasks
 */
function validateTasksAgainstScene(sceneObj, tasks) {
  const allowed = new Set(listTextureUrlPointers(sceneObj));
  const filtered = [];
  for (const t of tasks) {
    const ptr = normalizePointer(t.pointer);
    if (!ptr.endsWith("/textureUrl")) {
      throw new Error(`Task pointer must end with /textureUrl, got: ${ptr}`);
    }
    if (!allowed.has(ptr)) {
      throw new Error(`Task pointer is not a known textureUrl slot: ${ptr}`);
    }
    if (!t.prompt || !String(t.prompt).trim()) {
      throw new Error(`Task missing prompt for pointer ${ptr}`);
    }
    filtered.push({
      pointer: ptr,
      prompt: String(t.prompt).trim(),
      size: t.size ? String(t.size) : undefined,
      mimeType: t.mimeType ? String(t.mimeType) : undefined
    });
  }
  return filtered;
}

/**
 * @typedef {{ kind: 'url', url: string } | { kind: 'base64', base64: string, mimeType?: string } | { kind: 'bytes', data: ArrayBuffer | Uint8Array, mimeType?: string }} ImageRawResult
 */

/**
 * @param {ImageRawResult} raw
 * @returns {Promise<Blob>}
 */
async function normalizeImageRawToBlob(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("normalizeImageRawToBlob: invalid raw result.");
  }
  const mimeType = raw.mimeType || "image/png";

  if (raw.kind === "bytes") {
    const data = raw.data instanceof Uint8Array ? raw.data : new Uint8Array(raw.data);
    return new Blob([data], { type: mimeType });
  }

  if (raw.kind === "base64") {
    const b64 = raw.base64;
    if (typeof b64 !== "string") {
      throw new Error("base64 payload missing.");
    }
    const bin =
      typeof atob === "function"
        ? atob(b64)
        : Buffer.from(b64, "base64").toString("binary");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  if (raw.kind === "url") {
    if (!raw.url || typeof raw.url !== "string") {
      throw new Error("url payload missing.");
    }
    const response = await fetch(raw.url);
    if (!response.ok) {
      throw new Error(`Failed to download image URL (${response.status}).`);
    }
    return await response.blob();
  }

  throw new Error(`Unknown image raw kind: ${raw.kind}`);
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} [opts.baseUrl='https://api.openai.com/v1']
 * @param {string} [opts.model='dall-e-3']
 * @param {string} [opts.defaultSize='1024x1024']
 * @param {'url'|'b64_json'} [opts.responseFormat='url']
 */
function createOpenAiImageProvider({
  apiKey,
  baseUrl = "https://api.openai.com/v1",
  model = "dall-e-3",
  defaultSize = "1024x1024",
  responseFormat = "url"
}) {
  if (!apiKey) {
    throw new Error("createOpenAiImageProvider: apiKey is required.");
  }
  return {
    /**
     * @param {{ prompt: string, size?: string }} input
     * @returns {Promise<ImageRawResult>}
     */
    async generateImage({ prompt, size }) {
      const root = String(baseUrl).replace(/\/$/, "");
      const url = `${root}/images/generations`;
      const body = {
        model,
        prompt,
        n: 1,
        size: size || defaultSize
      };
      if (/^dall-e/i.test(model)) {
        body.response_format = responseFormat;
      }
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`OpenAI images failed (${response.status}): ${detail}`);
      }
      const data = await response.json();
      const item = data?.data?.[0];
      if (item?.url) {
        return { kind: "url", url: item.url };
      }
      if (item?.b64_json) {
        return { kind: "base64", base64: item.b64_json, mimeType: "image/png" };
      }
      throw new Error("OpenAI images response contained no url or b64_json.");
    }
  };
}

/**
 * @param {string} absoluteOrRelative full path
 * @param {string} [projectRoot] when set, return site-relative path for textureUrl
 */
function toSiteRelativeTexturePath(absoluteOrRelative, projectRoot) {
  if (!projectRoot) {
    return absoluteOrRelative;
  }
  const normalized = String(absoluteOrRelative).replace(/\\/g, "/");
  if (normalized.startsWith("/assets/")) {
    return normalized;
  }
  const root = String(projectRoot).replace(/\\/g, "/").replace(/\/+$/, "");
  const full = normalized.replace(/\\/g, "/");
  if (full.startsWith(root)) {
    const rel = full.slice(root.length);
    return rel.startsWith("/") ? rel : `/${rel}`;
  }
  const resourcesIdx = full.indexOf("/assets/");
  if (resourcesIdx >= 0) {
    return full.slice(resourcesIdx);
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

/** Keep only chat completion options (avoid leaking sink/imageProvider into HTTP body). */
function pickChatCompletionOptions(source) {
  const keys = ["provider", "apiKey", "model", "baseUrl", "temperature", "maxTokens"];
  const out = {};
  for (const k of keys) {
    if (source && Object.prototype.hasOwnProperty.call(source, k)) {
      out[k] = source[k];
    }
  }
  return out;
}

/**
 * @param {object|string} sceneJsonStringOrObject
 * @param {string} userHint
 * @param {object} options requestChatCompletion options + maxTokens
 * @returns {Promise<{ tasks: object[] }>}
 */
async function planTextures(sceneJsonStringOrObject, userHint, options = {}) {
  const sceneObj =
    typeof sceneJsonStringOrObject === "string"
      ? parseSceneJsonString(sceneJsonStringOrObject)
      : parseSceneJsonString(JSON.stringify(sceneJsonStringOrObject));

  const pointers = listTextureUrlPointers(sceneObj);
  const pointerBlock = pointers.length ? pointers.join("\n") : "(no material textureUrl slots found)";
  const content = await requestChatCompletion({
    ...pickChatCompletionOptions(options),
    messages: [
      {
        role: "system",
        content: buildTexturePlanSystemPrompt(pointerBlock)
      },
      {
        role: "user",
        content: buildTexturePlanUserContent(sceneObj, userHint)
      }
    ]
  });

  const jsonText = extractJsonText(content);
  const plan = JSON.parse(jsonText);
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.tasks)) {
    throw new Error("Texture plan must be an object with tasks array.");
  }
  const tasks = validateTasksAgainstScene(sceneObj, plan.tasks);
  return { tasks };
}

/**
 * @typedef {{ saveLocal?: (blob: Blob, meta: object) => Promise<string>, upload?: (blob: Blob, meta: object) => Promise<string> }} TextureSink
 */

/**
 * @param {object|string} sceneJsonStringOrObject
 * @param {object} options
 * @param {string} [options.userHint]
 * @param {{ tasks: object[] }} [options.plan] pre-built plan (skips chat)
 * @param {TextureSink} [options.sink]
 * @param {string} [options.projectRoot] optional hint for sink implementations
 * @param {{ generateImage: Function }} [options.imageProvider]
 * @param {boolean} [options.overwriteExisting=false]
 * @param {boolean} [options.dryRun=false] only return plan, no image API
 * @param {number} [options.concurrency=2]
 * @param {object} [options.chatOptions] extra options for planTextures (when plan not given)
 */
async function fillTextureUrls(sceneJsonStringOrObject, options = {}) {
  const {
    userHint = "",
    plan: inputPlan,
    sink,
    projectRoot,
    imageProvider,
    overwriteExisting = false,
    dryRun = false,
    concurrency = 2,
    chatOptions = {}
  } = options;

  const sceneObj =
    typeof sceneJsonStringOrObject === "string"
      ? parseSceneJsonString(sceneJsonStringOrObject)
      : parseSceneJsonString(JSON.stringify(sceneJsonStringOrObject));

  const scene = JSON.parse(JSON.stringify(sceneObj));

  let tasks;
  if (inputPlan && Array.isArray(inputPlan.tasks)) {
    tasks = validateTasksAgainstScene(scene, inputPlan.tasks);
  } else {
    const planned = await planTextures(scene, userHint, {
      ...pickChatCompletionOptions(options),
      ...chatOptions
    });
    tasks = planned.tasks;
  }

  const skipped = [];
  const toRun = [];
  tasks.forEach((t, index) => {
    const current = getByPointer(scene, t.pointer);
    if (!overwriteExisting && current != null && String(current).trim() !== "") {
      skipped.push({ pointer: t.pointer, reason: "existing textureUrl" });
      return;
    }
    toRun.push({ ...t, index });
  });

  if (dryRun) {
    return {
      scene,
      sceneJsonString: JSON.stringify(scene, null, 2),
      tasks,
      skipped,
      taskResults: []
    };
  }

  if (!imageProvider || typeof imageProvider.generateImage !== "function") {
    throw new Error("fillTextureUrls: imageProvider.generateImage is required unless dryRun is true.");
  }

  const effectiveSink = {
    saveLocal: sink?.saveLocal,
    upload: sink?.upload
  };
  if (!effectiveSink.saveLocal && !effectiveSink.upload) {
    throw new Error(
      "fillTextureUrls: provide sink.saveLocal and/or sink.upload (use core/util/nodeTextureSink.js in external Node tools)."
    );
  }

  /**
   * @param {typeof toRun[0]} task
   */
  async function runOne(task) {
    const raw = await imageProvider.generateImage({
      prompt: task.prompt,
      size: task.size
    });
    const blob = await normalizeImageRawToBlob(raw);
    const meta = {
      pointer: task.pointer,
      index: task.index,
      mimeType: task.mimeType || blob.type || "image/png"
    };
    let textureUrl;
    if (effectiveSink.upload) {
      textureUrl = await effectiveSink.upload(blob, meta);
    }
    if (!textureUrl && effectiveSink.saveLocal) {
      textureUrl = await effectiveSink.saveLocal(blob, meta);
    }
    if (!textureUrl || !String(textureUrl).trim()) {
      throw new Error(`Sink did not return a URL/path for ${task.pointer}`);
    }
    setByPointer(scene, task.pointer, textureUrl);
    return { pointer: task.pointer, textureUrl, ok: true };
  }

  const taskResults = await mapPool(toRun, Math.max(1, concurrency), runOne);

  return {
    scene,
    sceneJsonString: JSON.stringify(scene, null, 2),
    tasks,
    skipped,
    taskResults
  };
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<void>} fn
 */
async function mapPool(items, concurrency, fn) {
  const results = [];
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next;
      next += 1;
      const item = items[idx];
      const r = await fn(item, idx);
      results[idx] = r;
    }
  }

  const n = Math.min(concurrency, items.length) || 1;
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export {
  toSiteRelativeTexturePath,
  listTextureUrlPointers,
  getByPointer,
  setByPointer,
  normalizePointer,
  normalizeImageRawToBlob,
  createOpenAiImageProvider,
  planTextures,
  fillTextureUrls,
  validateTasksAgainstScene
};
