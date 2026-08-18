/** Unbranded inline live ThreeJSON scene card for conversational authoring hosts. */
import { createElement as h, useEffect } from "react";
import { useSceneCardRuntime } from "./useSceneCardRuntime.js";

function text(options, key, fallback) {
  return options?.translate?.(key, fallback) || fallback;
}

function ActionBtn({ title, glyph, onClick, disabled }) {
  return h(
    "button",
    { type: "button", className: "sceneCardActionBtn", title, "aria-label": title, onClick, disabled },
    h("span", { dangerouslySetInnerHTML: { __html: glyph } })
  );
}

export function SceneAgentSceneCard({ sceneJson, label, showToast, options, onReady, managed = false }) {
  const mergedOptions = { showToast, ...options };
  const card = useSceneCardRuntime(mergedOptions);

  useEffect(() => {
    onReady?.(card);
    return () => onReady?.(null);
    // The runtime's imperative methods are stable; publishing every state render would make a host
    // repeatedly replace its handle and can race an in-flight command batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!managed && sceneJson) void card.render(sceneJson, { label });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneJson, managed]);

  const action = (title, glyph, onClick, disabled) => h(ActionBtn, { title, glyph, onClick, disabled });
  return h(
    "div",
    { className: "sceneAgentSceneCard sceneCard" },
    h(
      "div",
      { className: "sceneCardCanvasWrap", ref: card.canvasWrapRef },
      h("canvas", { className: "sceneCardCanvas", ref: card.canvasRef }),
      card.loadingText
        ? h("div", { className: `sceneCardLoadingMask${card.loadingCompact ? " sceneCardLoadingMaskCompact" : ""}` }, card.loadingText)
        : null,
      card.draft
        ? h("div", { className: "sceneCardDraftBadge" }, text(mergedOptions, "sceneAgent.sceneCard.draftBadge", "草稿 · 自动细化中…"))
        : null,
      card.textureProgress
        ? h(
            "div",
            { className: `sceneCardTextureBadge state-${card.textureProgress.phase}`, "data-state": card.textureProgress.phase },
            card.textureProgress.message || text(mergedOptions, "sceneAgent.sceneCard.textureProgress", "正在完善纹理…")
          )
        : null
    ),
    h(
      "div",
      { className: "sceneCardActionBar" },
      action(text(mergedOptions, "sceneAgent.sceneCard.downloadJson", "下载 JSON"), "&#8681;", card.handleDownloadJson),
      action(text(mergedOptions, "sceneAgent.sceneCard.exportTjz", "导出 .tjz 场景包"), "&#128230;", () => void card.handleExportTjz(), card.exporting === "tjz"),
      action(text(mergedOptions, "sceneAgent.sceneCard.exportMesh", "导出三方模型"), "&#9672;", () => void card.handleExportMesh(), card.exporting === "mesh"),
      mergedOptions.openInEditor
        ? action(text(mergedOptions, "sceneAgent.sceneCard.openInEditor", "在编辑器内打开"), "&#9998;", card.handleOpenEditor)
        : null,
      mergedOptions.openInPlayer
        ? action(text(mergedOptions, "sceneAgent.sceneCard.openInPlayer", "在播放器内打开"), "&#9654;", card.handleOpenPlayer)
        : null,
      action(text(mergedOptions, "sceneAgent.sceneCard.refresh", "刷新画布"), "&#8635;", () => void card.handleRefresh(), card.exporting === "refresh"),
      action(text(mergedOptions, "sceneAgent.sceneCard.fullscreen", "全屏"), "&#10021;", card.handleFullscreen)
    )
  );
}
