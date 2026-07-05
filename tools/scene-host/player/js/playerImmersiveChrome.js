/** Immersive fullscreen chrome — edge strips reveal top/bottom/right panels. */
export function createPlayerImmersiveChrome({
  rootContainer,
  topBarEl,
  bottomBarEl,
  rightDockEl,
  rightPanelEl,
  getChromeHideDelayMs,
  getRightEdgeStripWidthPx,
  onResize,
  syncRightDockToggleUi
}) {
  const immersiveTopEdgeStrip = document.getElementById("immersiveTopEdgeStrip");
  const immersiveBottomEdgeStrip = document.getElementById("immersiveBottomEdgeStrip");
  const immersiveRightEdgeStrip = document.getElementById("immersiveRightEdgeStrip");
  const bottomFullscreenBtn = document.getElementById("bottomBtnFullscreen");

  let immersiveTopBarHideTimer = null;
  let immersiveBottomBarHideTimer = null;
  let immersiveDockHideTimer = null;
  let immersivePlaylistPinned = false;

  function applyRightEdgeStripWidth() {
    const stripPx = getRightEdgeStripWidthPx?.();
    if (Number.isFinite(stripPx) && immersiveRightEdgeStrip) {
      immersiveRightEdgeStrip.style.width = `${stripPx}px`;
    }
  }

  function showImmersiveTopBar() {
    if (!rootContainer?.classList.contains("immersiveFullscreen")) {
      return;
    }
    if (immersiveTopBarHideTimer) {
      window.clearTimeout(immersiveTopBarHideTimer);
      immersiveTopBarHideTimer = null;
    }
    topBarEl?.classList.add("immersiveChromeVisible");
  }

  function scheduleHideImmersiveTopBar() {
    if (!rootContainer?.classList.contains("immersiveFullscreen")) {
      return;
    }
    if (immersiveTopBarHideTimer) {
      window.clearTimeout(immersiveTopBarHideTimer);
    }
    immersiveTopBarHideTimer = window.setTimeout(() => {
      immersiveTopBarHideTimer = null;
      topBarEl?.classList.remove("immersiveChromeVisible");
    }, getChromeHideDelayMs?.() ?? 420);
  }

  function showImmersiveBottomBar() {
    if (!rootContainer?.classList.contains("immersiveFullscreen")) {
      return;
    }
    if (immersiveBottomBarHideTimer) {
      window.clearTimeout(immersiveBottomBarHideTimer);
      immersiveBottomBarHideTimer = null;
    }
    bottomBarEl?.classList.add("immersiveChromeVisible");
  }

  function scheduleHideImmersiveBottomBar() {
    if (!rootContainer?.classList.contains("immersiveFullscreen")) {
      return;
    }
    if (immersiveBottomBarHideTimer) {
      window.clearTimeout(immersiveBottomBarHideTimer);
    }
    immersiveBottomBarHideTimer = window.setTimeout(() => {
      immersiveBottomBarHideTimer = null;
      bottomBarEl?.classList.remove("immersiveChromeVisible");
    }, getChromeHideDelayMs?.() ?? 420);
  }

  function showImmersiveDock() {
    if (!rootContainer?.classList.contains("immersiveFullscreen")) {
      return;
    }
    if (immersiveDockHideTimer) {
      window.clearTimeout(immersiveDockHideTimer);
      immersiveDockHideTimer = null;
    }
    rootContainer.classList.add("rightPanelOpen");
    syncRightDockToggleUi?.();
    rightDockEl?.classList.add("immersiveDockVisible");
  }

  function scheduleHideImmersiveDock() {
    if (!rootContainer?.classList.contains("immersiveFullscreen")) {
      return;
    }
    if (immersivePlaylistPinned) {
      return;
    }
    if (immersiveDockHideTimer) {
      window.clearTimeout(immersiveDockHideTimer);
    }
    immersiveDockHideTimer = window.setTimeout(() => {
      immersiveDockHideTimer = null;
      rightDockEl?.classList.remove("immersiveDockVisible");
    }, getChromeHideDelayMs?.() ?? 420);
  }

  function updateImmersiveFullscreenChrome() {
    const immersive = document.fullscreenElement === rootContainer;
    rootContainer?.classList.toggle("immersiveFullscreen", immersive);
    if (!immersive) {
      immersivePlaylistPinned = false;
      topBarEl?.classList.remove("immersiveChromeVisible");
      bottomBarEl?.classList.remove("immersiveChromeVisible");
      rightDockEl?.classList.remove("immersiveDockVisible");
      if (immersiveTopBarHideTimer) {
        window.clearTimeout(immersiveTopBarHideTimer);
        immersiveTopBarHideTimer = null;
      }
      if (immersiveBottomBarHideTimer) {
        window.clearTimeout(immersiveBottomBarHideTimer);
        immersiveBottomBarHideTimer = null;
      }
      if (immersiveDockHideTimer) {
        window.clearTimeout(immersiveDockHideTimer);
        immersiveDockHideTimer = null;
      }
    }
    onResize?.();
    requestAnimationFrame(() => requestAnimationFrame(() => onResize?.()));
  }

  function syncFullscreenToggleLabels() {
    const full = document.fullscreenElement === rootContainer;
    if (bottomFullscreenBtn) {
      bottomFullscreenBtn.title = full ? "退出全屏 (Esc)" : "全屏";
    }
  }

  async function toggleFullscreen(showMessage) {
    try {
      if (!document.fullscreenElement) {
        await rootContainer.requestFullscreen();
        showMessage?.(
          "全屏：指针移到上/下/右屏幕边缘可唤出标题栏、底栏与播放列表；按 ESC 退出。",
          "info"
        );
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error(error);
      showMessage?.("全屏操作失败。", "warning");
    }
    syncFullscreenToggleLabels();
  }

  function onBottomBarPlaylistToggleClick() {
    if (!rootContainer?.classList.contains("immersiveFullscreen")) {
      rootContainer?.classList.toggle("rightPanelOpen");
      syncRightDockToggleUi?.();
      onResize?.();
      requestAnimationFrame(() => requestAnimationFrame(() => onResize?.()));
      return;
    }
    if (immersivePlaylistPinned) {
      immersivePlaylistPinned = false;
      rightDockEl?.classList.remove("immersiveDockVisible");
      rootContainer?.classList.remove("rightPanelOpen");
      if (immersiveDockHideTimer) {
        window.clearTimeout(immersiveDockHideTimer);
        immersiveDockHideTimer = null;
      }
    } else {
      immersivePlaylistPinned = true;
      rootContainer?.classList.add("rightPanelOpen");
      rightDockEl?.classList.add("immersiveDockVisible");
      if (immersiveDockHideTimer) {
        window.clearTimeout(immersiveDockHideTimer);
        immersiveDockHideTimer = null;
      }
    }
    syncRightDockToggleUi?.();
    onResize?.();
    requestAnimationFrame(() => requestAnimationFrame(() => onResize?.()));
  }

  function init(showMessage) {
    applyRightEdgeStripWidth();
    bottomFullscreenBtn?.addEventListener("click", () => {
      void toggleFullscreen(showMessage);
    });
    document.addEventListener("fullscreenchange", () => {
      updateImmersiveFullscreenChrome();
      syncFullscreenToggleLabels();
    });

    immersiveTopEdgeStrip?.addEventListener("pointerenter", showImmersiveTopBar);
    immersiveTopEdgeStrip?.addEventListener("pointermove", showImmersiveTopBar);
    immersiveTopEdgeStrip?.addEventListener("pointerleave", scheduleHideImmersiveTopBar);
    immersiveBottomEdgeStrip?.addEventListener("pointerenter", showImmersiveBottomBar);
    immersiveBottomEdgeStrip?.addEventListener("pointermove", showImmersiveBottomBar);
    immersiveBottomEdgeStrip?.addEventListener("pointerleave", scheduleHideImmersiveBottomBar);
    immersiveRightEdgeStrip?.addEventListener("pointerenter", showImmersiveDock);
    immersiveRightEdgeStrip?.addEventListener("pointermove", showImmersiveDock);

    topBarEl?.addEventListener("pointerenter", () => {
      if (rootContainer?.classList.contains("immersiveFullscreen")) {
        showImmersiveTopBar();
      }
    });
    topBarEl?.addEventListener("pointerleave", (event) => {
      if (!rootContainer?.classList.contains("immersiveFullscreen")) {
        return;
      }
      const rel = event.relatedTarget;
      if (rel && topBarEl?.contains(rel)) {
        return;
      }
      if (rel && immersiveTopEdgeStrip && (rel === immersiveTopEdgeStrip || immersiveTopEdgeStrip.contains(rel))) {
        return;
      }
      scheduleHideImmersiveTopBar();
    });

    bottomBarEl?.addEventListener("pointerenter", () => {
      if (rootContainer?.classList.contains("immersiveFullscreen")) {
        showImmersiveBottomBar();
      }
    });
    bottomBarEl?.addEventListener("pointerleave", (event) => {
      if (!rootContainer?.classList.contains("immersiveFullscreen")) {
        return;
      }
      const rel = event.relatedTarget;
      if (rel && bottomBarEl?.contains(rel)) {
        return;
      }
      if (
        rel &&
        immersiveBottomEdgeStrip &&
        (rel === immersiveBottomEdgeStrip || immersiveBottomEdgeStrip.contains(rel))
      ) {
        return;
      }
      scheduleHideImmersiveBottomBar();
    });

    rightDockEl?.addEventListener("pointerenter", () => {
      if (rootContainer?.classList.contains("immersiveFullscreen") && immersiveDockHideTimer) {
        window.clearTimeout(immersiveDockHideTimer);
        immersiveDockHideTimer = null;
      }
    });
    rightDockEl?.addEventListener("pointerleave", () => {
      scheduleHideImmersiveDock();
    });
  }

  return {
    init,
    applyRightEdgeStripWidth,
    updateImmersiveFullscreenChrome,
    toggleFullscreen,
    onBottomBarPlaylistToggleClick
  };
}
