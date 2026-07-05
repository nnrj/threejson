import { parseSceneJsonString } from "threejson";
import {
  batchResultsHaveSceneMutation,
  batchResultsHaveSuccessfulAdjustment
} from "../../../../core/ai/sceneCommandSkill.js";
import { createOpenAiImageProvider } from "../../../../core/ai/index.js";
import { EDITOR_SETTINGS_DEFAULTS } from "../../shared/js/editorSettingsSchema.js";
import { getHostPlatform } from "../../shared/js/platform/hostPlatform.js";
import { createTextureSink } from "../../shared/js/platform/textureSink.js";

export const AI_UPDATE_MODE_UI = {
  commands: {
    buttonLabel: "调整并应用",
    busyLabel: "应用中...",
    hintSource:
      "命令模式默认附带场景对象列表（id/名称/类型）与当前选中项；可勾选空间摘要或完整 JSON 提供尺寸/位置。在旁边添加同类物体时，建议勾选其一。大场景或需完整材质/结构时，可改勾完整 JSON。",
    hintMode:
      "单轮须一次性输出变更命令（非 object.get）；仅调相机/自适应取景亦有效。就地修改，可撤销（Ctrl+Z）；不整包载入 JSON。"
  },
  "json-full": {
    buttonLabel: "调整并载入",
    busyLabel: "载入中...",
    hintSource: "始终将「查看 → 查看场景 JSON」同源的完整当前场景 JSON 发给模型（与上方复选框无关）。",
    hintMode: "JSON 全量模式会重建场景，与「文件 → 导入 ▸ 导入 ThreeJSON」效果相同，未保存的编辑将丢失。"
  },
  "json-incremental": {
    buttonLabel: "应用补丁",
    busyLabel: "应用中...",
    hintSource: "始终将完整当前场景 JSON 作为补丁基线发给模型（与上方复选框无关）。",
    hintMode: "JSON 增量模式应用 RFC 6902 补丁后载入；主要改 objectList，仍可能触发场景重载。"
  },
  auto: {
    buttonLabel: "自动调整",
    busyLabel: "调整中...",
    hintSource:
      "默认附带对象列表与选中项；可勾选空间摘要或完整 JSON。Agent +「迭代应用到画布」时多轮 patch 逐步上画布。",
    hintMode: "单轮优先变更命令或 camera.fit，必要时回退 JSON 全量。Agent 未开迭代时仍为 get 探索后末轮 patch。"
  }
};

export function isAiAbortError(err) {
  const name = err?.name || "";
  return name === "AbortError" || /aborted/i.test(String(err?.message || err));
}

export function formatTextureFillWarning(warning) {
  if (!warning) {
    return null;
  }
  const w = String(warning);
  const lower = w.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return `纹理填充失败（可能是浏览器跨域 CORS）：${w}。场景 JSON 已载入。`;
  }
  if (/\b401\b/.test(w) || lower.includes("unauthorized")) {
    return `纹理填充失败（401 未授权，请检查 API Key 与网关是否支持 images）：${w}。场景 JSON 已载入。`;
  }
  return `纹理填充失败：${w}。场景 JSON 已载入。`;
}

export function formatAssemblyParentWarnings(batchOrResult) {
  const warnings =
    batchOrResult?.assemblyWarnings || batchOrResult?.batch?.assemblyWarnings || [];
  return Array.isArray(warnings) ? warnings.filter(Boolean).join(" ") : "";
}

export function truncateAiDisplayText(text, cap = 8000) {
  const raw = String(text || "");
  if (raw.length <= cap) {
    return raw;
  }
  return `${raw.slice(0, cap)}\n…（已截断，共 ${raw.length} 字符）`;
}

export function formatCommandsArrayForDisplay(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    return "";
  }
  try {
    return commands
      .map((cmd) => {
        const op = cmd?.op;
        const args = cmd?.args || {};
        if (!op) {
          return "";
        }
        const id = args.id != null ? String(args.id) : "";
        if (op === "object.patch" && id) {
          const partial = args.partial != null ? JSON.stringify(args.partial) : "{}";
          return `object.patch id=${id} partial=${partial}`;
        }
        if (op === "object.add") {
          return `object.add parent=${args.parent ?? ""} descriptor=${JSON.stringify(args.descriptor || {})}`;
        }
        if (op === "object.remove" && id) {
          return `object.remove id=${id}`;
        }
        if (op === "material.patch" && id) {
          return `material.patch id=${id} partial=${JSON.stringify(args.partial || {})}`;
        }
        return JSON.stringify({ op, args });
      })
      .filter(Boolean)
      .join("\n");
  } catch {
    return commands.map((cmd) => JSON.stringify(cmd)).join("\n");
  }
}

export function buildAiAdjustLastResultText(result, outputMode = "commands") {
  if (!result || typeof result !== "object") {
    return null;
  }
  const mode = String(outputMode || result.outputMode || "commands");
  if (result.outputMode === "commands" && result.execOk) {
    const count = Array.isArray(result.commands) ? result.commands.length : 0;
    const body =
      String(result.commandScript || "").trim() || formatCommandsArrayForDisplay(result.commands);
    const fallbackNote = result.fallbackUsed ? " · 曾回退 JSON" : "";
    return {
      title: `上次 AI 产出 · 命令 · 已执行 · ${count || "?"} 条${fallbackNote}`,
      body: truncateAiDisplayText(body || "（无命令脚本文本）")
    };
  }
  if (result.sceneJsonString) {
    const jsonBody = truncateAiDisplayText(result.sceneJsonString);
    if (result.fallbackUsed && mode !== "json-full" && mode !== "json-incremental") {
      return {
        title: "上次 AI 产出 · JSON · 已载入（命令失败后回退）",
        body: jsonBody
      };
    }
    if (mode === "json-incremental" || result.updateMode === "incremental") {
      return {
        title: "上次 AI 产出 · JSON 增量 · 已载入",
        body: jsonBody
      };
    }
    return {
      title: "上次 AI 产出 · JSON 全量 · 已载入",
      body: jsonBody
    };
  }
  return null;
}

export function scrollAiStreamPreviewToEnd(el) {
  if (!el || el.hasAttribute("hidden")) {
    return;
  }
  el.scrollTop = el.scrollHeight;
}

export function bindAiPanelSubmitShortcut(fields, actionButton, trigger) {
  const list = Array.isArray(fields) ? fields : [fields];
  for (const field of list) {
    if (!field) {
      continue;
    }
    field.addEventListener("keydown", (event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (event.key !== "Enter" || !mod || event.shiftKey || event.altKey) {
        return;
      }
      if (actionButton?.disabled) {
        return;
      }
      event.preventDefault();
      void trigger();
    });
  }
}

export function createAiSidebarStreamPreview(dom, getActiveTab) {
  let buffer = "";

  function getElements() {
    return [dom.streamGenerate, dom.streamAdjust, dom.streamImage].filter(Boolean);
  }

  function getActiveElement() {
    const tab = getActiveTab();
    if (tab === "aiConfig" || tab === "builtin") {
      return null;
    }
    const map = {
      aiGenerate: dom.streamGenerate,
      aiAdjust: dom.streamAdjust,
      aiImage: dom.streamImage
    };
    return map[tab] || null;
  }

  function syncDom() {
    const on = dom.streamPreview?.checked === true;
    const cap = 12000;
    const text = buffer.length > cap ? buffer.slice(-cap) : buffer;
    const elements = getElements();
    const activeEl = getActiveElement();
    for (const el of elements) {
      if (el === activeEl) {
        continue;
      }
      el.textContent = "";
      el.toggleAttribute("hidden", true);
    }
    if (!activeEl) {
      return;
    }
    activeEl.textContent = text;
    activeEl.toggleAttribute("hidden", !on || !text);
    if (!on || !text) {
      return;
    }
    requestAnimationFrame(() => scrollAiStreamPreviewToEnd(activeEl));
  }

  function beginOperation() {
    buffer = "";
    syncDom();
  }

  function appendDelta(delta) {
    buffer += delta;
    syncDom();
  }

  return { syncDom, beginOperation, appendDelta, getBuffer: () => buffer };
}

export async function buildSidebarTextureOptions(host, dom, getCredentials) {
  if (!dom.fillTextures?.checked) {
    return null;
  }
  const creds = getCredentials();
  const imageModel =
    host.getEditorSettings()?.ai?.defaultImageModel ||
    EDITOR_SETTINGS_DEFAULTS.ai.defaultImageModel;
  const imageProvider = createOpenAiImageProvider({
    apiKey: creds.apiKey,
    baseUrl: creds.baseUrl,
    model: imageModel
  });
  const platform = getHostPlatform();
  const sink = createTextureSink(platform, dom);
  return {
    enabled: true,
    sink,
    imageProvider,
    imageApiKey: creds.apiKey,
    imageBaseUrl: creds.baseUrl,
    imageModel,
    overwriteExisting: false,
    concurrency: 2
  };
}

export function applyAiSettingsToSidebarDom(dom, ai) {
  if (!ai) {
    return;
  }
  if (dom.remember) {
    dom.remember.checked = Boolean(ai.rememberConfig);
  }
  if (dom.provider && ["chatgpt", "deepseek", "custom"].includes(ai.provider)) {
    dom.provider.value = ai.provider;
  }
  if (dom.model && ai.model != null) {
    dom.model.value = ai.model;
  }
  if (dom.apiKey && ai.rememberConfig && ai.apiKey) {
    dom.apiKey.value = ai.apiKey;
  }
  if (dom.customBase && ai.customApiBase != null) {
    dom.customBase.value = ai.customApiBase;
  }
  if (dom.agentEnabled) {
    dom.agentEnabled.checked = Boolean(ai.agentEnabled);
  }
  if (dom.agentIterative) {
    dom.agentIterative.checked = Boolean(ai.agentIterativeApply);
  }
  if (dom.agentFitViewEachRound) {
    dom.agentFitViewEachRound.checked = Boolean(ai.agentFitViewEachRound);
  }
  if (dom.agentDepth && ai.agentDepth) {
    dom.agentDepth.value = ai.agentDepth;
  }
  if (dom.updateMode) {
    const legacyIncremental = Boolean(ai.incrementalUpdate);
    const mode = ai.updateOutputMode || (legacyIncremental ? "json-incremental" : "commands");
    if (["commands", "json-full", "json-incremental", "auto"].includes(mode)) {
      dom.updateMode.value = mode;
    }
  }
  if (dom.includeFullJson) {
    dom.includeFullJson.checked = Boolean(ai.includeFullJson);
  }
  if (dom.includeSpatial) {
    dom.includeSpatial.checked = Boolean(ai.includeSpatialSummary);
  }
  if (dom.streamPreview) {
    dom.streamPreview.checked = Boolean(ai.streamPreview);
  }
  if (dom.stageAutoLoad) {
    dom.stageAutoLoad.checked = ai.stageAutoLoad !== false;
  }
  if (dom.textureBrowserMode && ai.textureBrowserMode) {
    dom.textureBrowserMode.value = ai.textureBrowserMode;
  }
  if (dom.imageDetail && ai.imageDetail) {
    dom.imageDetail.value = ai.imageDetail;
  }
  dom.customBaseWrap?.toggleAttribute("hidden", dom.provider?.value !== "custom");
}

export function syncAiSettingsFromSidebarDom(dom, ai) {
  if (!ai) {
    return;
  }
  ai.rememberConfig = Boolean(dom.remember?.checked);
  ai.provider = dom.provider?.value || "chatgpt";
  ai.model = dom.model?.value || "";
  ai.customApiBase = dom.customBase?.value || "";
  ai.agentEnabled = Boolean(dom.agentEnabled?.checked);
  ai.agentIterativeApply = Boolean(dom.agentIterative?.checked);
  ai.agentFitViewEachRound = Boolean(dom.agentFitViewEachRound?.checked);
  ai.agentDepth = dom.agentDepth?.value || "medium";
  ai.updateOutputMode = dom.updateMode?.value || "commands";
  ai.incrementalUpdate = ai.updateOutputMode === "json-incremental";
  ai.includeFullJson = Boolean(dom.includeFullJson?.checked);
  ai.includeSpatialSummary = Boolean(dom.includeSpatial?.checked);
  ai.streamPreview = Boolean(dom.streamPreview?.checked);
  ai.stageAutoLoad = dom.stageAutoLoad?.checked !== false;
  ai.textureBrowserMode = dom.textureBrowserMode?.value || "directory";
  if (ai.rememberConfig) {
    ai.apiKey = dom.apiKey?.value || "";
  }
}

export async function applyScenePayloadFromAiJsonString(host, jsonString, hintLabel = "", options = {}) {
  if (!options.skipDirtyConfirm) {
    const ok = await host.confirmOverwriteIfDirty?.({ actionLabel: `载入「${hintLabel}」` });
    if (!ok) {
      return false;
    }
  }
  const obj = parseSceneJsonString(String(jsonString || "").trim());
  return host.ingestScenePayload(obj, hintLabel, {
    runtimeFlags: options.runtimeFlags,
    skipRuntimeResolve: options.skipRuntimeResolve === true,
    keepDirtyAfterLoad: options.keepDirtyAfterLoad === true
  });
}
