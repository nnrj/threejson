import { resolveMediaOutputKind } from "threejson/ai";
import { classifyAiTurnIntent } from "./aiTurnOrchestrator.js";
import { t } from "../i18n/index.js";

export function getDocumentOutputKind(value) {
  try {
    const document = typeof value === "string" ? JSON.parse(value) : value;
    return document?.documentType === "composition" ? "video" : "scene";
  } catch { return "scene"; }
}

export function formatAiOutputRoute(outputKind, intent = "generate") {
  if (outputKind === "video") return intent === "adjust"
    ? t("ai.output.adjustVideo", "Will adjust the video. You can stop if this is not what you intended.")
    : t("ai.output.generateVideo", "Will generate a video. You can stop if this is not what you intended.");
  return intent === "adjust"
    ? t("ai.output.adjustScene", "Will adjust the 3D scene. You can stop if this is not what you intended.")
    : t("ai.output.generateScene", "Will generate a 3D scene. You can stop if this is not what you intended.");
}

/** A single pre-generation AI decision, reused by both hosts and retries.
 * Explicit edits of a composition keep its medium. Never infer medium from
 * prompt keywords, or silently generate a scene when negotiation fails.
 */
export async function prepareAiMediaTurn(input, intent) {
  input.signal?.throwIfAborted();
  let requested = input.outputKind || input.videoOptions?.outputKind || "auto";
  if (intent === "adjust" && getDocumentOutputKind(input.targetSceneJsonString) === "video") requested = "video";
  let negotiated;
  if (requested === "auto") {
    const result = await classifyAiTurnIntent({ userPrompt: input.userPrompt, history: [] }, {
      ...input.providerOptions, signal: input.signal, negotiateOutputKind: true
    });
    if (result.classificationFailed) throw Object.assign(new Error(result.note || "AI output-kind negotiation failed."), { code: "AI_OUTPUT_KIND_REQUIRED" });
    negotiated = result.outputKind;
  }
  const outputKind = resolveMediaOutputKind(input.userPrompt, requested, negotiated);
  input.signal?.throwIfAborted();
  await input.onOutputKind?.({ outputKind, intent, message: formatAiOutputRoute(outputKind, intent) });
  // The host yields to paint the notice. Stop must prevent the authoring call.
  input.signal?.throwIfAborted();
  return { ...input, outputKind };
}
