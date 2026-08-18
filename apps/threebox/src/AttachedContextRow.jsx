/**
 * Ported from threeBoxAttachedContext.js's renderExpanded/renderChip DOM halves (structure follows
 * threebox-cloud's AttachedContextRow). State lives in useAttachedContext.js. The expanded preview
 * reuses the app's live SceneCard (same as the original, which builds its attached preview from the
 * same scene-card factory the chat uses).
 */
import { useRef } from "react";
import { t } from "@threejson/host-kit/i18n/index.js";
import { SceneAgentSceneCard } from "@threejson/react-scene-agent/scene-card";

export function AttachedContextRow({ attachedContext, showToast, sceneCardOptions }) {
  const canvasWrapRef = useRef(null);
  const { current, expanded } = attachedContext;

  if (!current) {
    return <div id="attachedContextRow" className="attachedContextRow" hidden />;
  }

  if (!expanded) {
    return (
      <div id="attachedContextRow" className="attachedContextRow">
        <button
          type="button"
          className="attachedContextChip"
          title={t("threebox.attached.clickToExpand", "点击展开预览")}
          onClick={attachedContext.expand}
        >
          <span className="attachedContextChipThumb">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" d="M2 12.5 6 4.5 9 9.5 11 6.5 14 12.5z" />
            </svg>
          </span>
          <span className="attachedContextChipLabel">{current.label}</span>
          <span
            className="attachedContextChipRemoveBtn"
            onClick={(event) => {
              event.stopPropagation();
              attachedContext.clear();
            }}
          >
            ×
          </span>
        </button>
      </div>
    );
  }

  function handleFullscreen() {
    const wrap = canvasWrapRef.current;
    if (!wrap) {
      return;
    }
    if (document.fullscreenElement === wrap) {
      void document.exitFullscreen();
      return;
    }
    wrap.requestFullscreen?.().catch((error) => {
      showToast?.(
        t("threebox.attached.fullscreenFailed", "进入全屏失败：{error}", { error: error?.message || error }),
        "warning"
      );
    });
  }

  return (
    <div id="attachedContextRow" className="attachedContextRow">
      <div className="attachedContextExpanded">
        <div className="attachedContextHeader">
          <span className="attachedContextLabel">{attachedContext.label}</span>
          <button
            type="button"
            className="attachedContextHeaderBtn"
            title={t("threebox.attached.collapse", "折叠")}
            onClick={attachedContext.collapse}
          >
            –
          </button>
          <button
            type="button"
            className="attachedContextHeaderBtn"
            title={t("threebox.attached.fullscreen", "全屏")}
            onClick={handleFullscreen}
          >
            ✥
          </button>
          <button
            type="button"
            className="attachedContextHeaderBtn"
            title={t("threebox.attached.remove", "移除")}
            onClick={attachedContext.clear}
          >
            ×
          </button>
        </div>
        <div className="attachedContextCanvasWrap" ref={canvasWrapRef}>
          <SceneAgentSceneCard sceneJson={current.sceneJson} label={current.label} showToast={showToast} options={sceneCardOptions} />
        </div>
      </div>
    </div>
  );
}
