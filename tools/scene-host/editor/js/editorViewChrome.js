import { EDITOR_SETTINGS_DEFAULTS } from "../../shared/js/editorSettingsSchema.js";

export function createEditorViewChrome(host) {
  const rootContainer = document.getElementById("rootContainer");
  const topChromeWrap = document.getElementById("topChromeWrap");
  const bottomChromeWrap = document.getElementById("bottomChromeWrap");
  const leftFlyoutHost = document.getElementById("leftFlyoutHost");
  const rightFlyoutHost = document.getElementById("rightFlyoutHost");
  const leftPanelDom = document.getElementById("leftPanel");
  const rightPanelDom = document.getElementById("rightPanel");
  const leftPanelPinBtn = document.getElementById("leftPanelPinBtn");
  const rightPanelPinBtn = document.getElementById("rightPanelPinBtn");

  let topBarPinned = true;
  let bottomBarPinned = true;
  let leftDockPinned = true;
  let rightDockPinned = true;
  let topBarPeek = false;
  let bottomBarPeek = false;
  let leftDockPeek = false;
  let rightDockPeek = false;
  let topPeekHideTimer = null;
  let bottomPeekHideTimer = null;
  let leftPeekHideTimer = null;
  let rightPeekHideTimer = null;
  let dockChromeInsetResizeObserver = null;

  function getFlyoutPeekHideDelayMs() {
    return (
      host.getEditorSettings()?.layout?.flyoutPeekHideDelayMs ??
      EDITOR_SETTINGS_DEFAULTS.layout.flyoutPeekHideDelayMs
    );
  }

  function persistViewChromeCache() {
    const settings = host.getEditorSettings();
    if (!settings?.layout) {
      return;
    }
    settings.layout.topBarPinned = topBarPinned;
    settings.layout.bottomBarPinned = bottomBarPinned;
    settings.layout.leftDockPinned = leftDockPinned;
    settings.layout.rightDockPinned = rightDockPinned;
    host.persistSettings?.();
  }

  function syncLayoutPinsFromEditorSettings() {
    const layout = host.getEditorSettings()?.layout;
    if (!layout) {
      return;
    }
    if (typeof layout.topBarPinned === "boolean") {
      topBarPinned = layout.topBarPinned;
    }
    if (typeof layout.bottomBarPinned === "boolean") {
      bottomBarPinned = layout.bottomBarPinned;
    }
    if (typeof layout.leftDockPinned === "boolean") {
      leftDockPinned = layout.leftDockPinned;
    }
    if (typeof layout.rightDockPinned === "boolean") {
      rightDockPinned = layout.rightDockPinned;
    }
  }

  function syncViewMenuChecks() {
    document.querySelectorAll("[data-view-chrome]").forEach((btn) => {
      const key = btn.dataset.viewChrome;
      let on = false;
      if (key === "topBar") {
        on = topBarPinned;
      } else if (key === "bottomBar") {
        on = bottomBarPinned;
      } else if (key === "leftDock") {
        on = leftDockPinned;
      } else if (key === "rightDock") {
        on = rightDockPinned;
      }
      btn.setAttribute("aria-checked", on ? "true" : "false");
      const mark = btn.querySelector(".viewChromeCheck");
      if (mark) {
        mark.textContent = on ? "\u2713" : "";
      }
    });
  }

  function updateDockChromeInsets() {
    if (!rootContainer) {
      return;
    }
    const topH = topChromeWrap?.getBoundingClientRect().height ?? 0;
    const bottomH = bottomChromeWrap?.getBoundingClientRect().height ?? 0;
    rootContainer.style.setProperty("--dockInsetTop", `${topH}px`);
    rootContainer.style.setProperty("--dockInsetBottom", `${bottomH}px`);
  }

  function triggerWindowResize() {
    host.windowResize?.();
  }

  function peekRightDock() {
    rightDockPeek = true;
    syncDockPeekClasses({ persist: false });
    triggerWindowResize();
  }

  function initDockChromeInsetTracking() {
    updateDockChromeInsets();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    dockChromeInsetResizeObserver?.disconnect();
    dockChromeInsetResizeObserver = new ResizeObserver(() => {
      updateDockChromeInsets();
    });
    if (topChromeWrap) {
      dockChromeInsetResizeObserver.observe(topChromeWrap);
    }
    if (bottomChromeWrap) {
      dockChromeInsetResizeObserver.observe(bottomChromeWrap);
    }
  }

  function syncDockPeekClasses(options = {}) {
    const persist = options.persist !== false;
    rootContainer?.classList.toggle("leftDockPinned", leftDockPinned);
    rootContainer?.classList.toggle("leftDockPeek", leftDockPeek);
    rootContainer?.classList.toggle("rightDockPinned", rightDockPinned);
    rootContainer?.classList.toggle("rightDockPeek", rightDockPeek);

    const leftShown = leftDockPinned || leftDockPeek;
    const rightShown = rightDockPinned || rightDockPeek;
    leftPanelDom?.setAttribute("aria-hidden", leftShown ? "false" : "true");
    rightPanelDom?.setAttribute("aria-hidden", rightShown ? "false" : "true");

    if (leftPanelPinBtn) {
      leftPanelPinBtn.setAttribute("aria-pressed", leftDockPinned ? "true" : "false");
      leftPanelPinBtn.title = leftDockPinned ? "已钉住：鼠标移开仍显示" : "未钉住：移到屏幕左边缘唤出";
    }
    if (rightPanelPinBtn) {
      rightPanelPinBtn.setAttribute("aria-pressed", rightDockPinned ? "true" : "false");
      rightPanelPinBtn.title = rightDockPinned ? "已钉住：鼠标移开仍显示" : "未钉住：移到屏幕右边缘唤出";
    }

    rootContainer?.classList.toggle("topBarPinned", topBarPinned);
    rootContainer?.classList.toggle("topBarPeek", topBarPeek);
    rootContainer?.classList.toggle("bottomBarPinned", bottomBarPinned);
    rootContainer?.classList.toggle("bottomBarPeek", bottomBarPeek);

    if (persist) {
      persistViewChromeCache();
    }
    syncViewMenuChecks();
    updateDockChromeInsets();
  }

  function scheduleTopPeekHide() {
    clearTimeout(topPeekHideTimer);
    topPeekHideTimer = setTimeout(() => {
      topBarPeek = false;
      syncDockPeekClasses();
    }, getFlyoutPeekHideDelayMs());
  }

  function scheduleBottomPeekHide() {
    clearTimeout(bottomPeekHideTimer);
    bottomPeekHideTimer = setTimeout(() => {
      bottomBarPeek = false;
      syncDockPeekClasses();
    }, getFlyoutPeekHideDelayMs());
  }

  function scheduleLeftPeekHide() {
    clearTimeout(leftPeekHideTimer);
    leftPeekHideTimer = setTimeout(() => {
      leftDockPeek = false;
      syncDockPeekClasses();
    }, getFlyoutPeekHideDelayMs());
  }

  function scheduleRightPeekHide() {
    clearTimeout(rightPeekHideTimer);
    rightPeekHideTimer = setTimeout(() => {
      rightDockPeek = false;
      syncDockPeekClasses();
    }, getFlyoutPeekHideDelayMs());
  }

  function triggerWindowResize() {
    host.windowResize?.();
    requestAnimationFrame(() => requestAnimationFrame(() => host.windowResize?.()));
  }

  function toggleViewChromeFromMenu(which) {
    if (which === "topBar") {
      topBarPinned = !topBarPinned;
      if (topBarPinned) {
        topBarPeek = true;
        clearTimeout(topPeekHideTimer);
      } else if (!topChromeWrap?.matches(":hover")) {
        topBarPeek = false;
      }
    } else if (which === "bottomBar") {
      bottomBarPinned = !bottomBarPinned;
      if (bottomBarPinned) {
        bottomBarPeek = true;
        clearTimeout(bottomPeekHideTimer);
      } else if (!bottomChromeWrap?.matches(":hover")) {
        bottomBarPeek = false;
      }
    } else if (which === "leftDock") {
      leftDockPinned = !leftDockPinned;
      if (leftDockPinned) {
        leftDockPeek = true;
        clearTimeout(leftPeekHideTimer);
      } else if (!leftFlyoutHost?.matches(":hover")) {
        leftDockPeek = false;
      }
    } else if (which === "rightDock") {
      rightDockPinned = !rightDockPinned;
      if (rightDockPinned) {
        rightDockPeek = true;
        clearTimeout(rightPeekHideTimer);
      } else if (!rightFlyoutHost?.matches(":hover")) {
        rightDockPeek = false;
      }
    }
    syncDockPeekClasses();
    triggerWindowResize();
    host.closeAllDropdowns?.();
  }

  function resetPeekState() {
    topBarPeek = false;
    bottomBarPeek = false;
    leftDockPeek = false;
    rightDockPeek = false;
    clearTimeout(topPeekHideTimer);
    clearTimeout(bottomPeekHideTimer);
    clearTimeout(leftPeekHideTimer);
    clearTimeout(rightPeekHideTimer);
  }

  function syncFromSettings() {
    syncLayoutPinsFromEditorSettings();
    syncDockPeekClasses({ persist: false });
  }

  function initChromeFlyoutsAndViewMenu() {
    topChromeWrap?.addEventListener("mouseenter", () => {
      clearTimeout(topPeekHideTimer);
      if (!topBarPinned) {
        topBarPeek = true;
        syncDockPeekClasses();
      }
    });
    topChromeWrap?.addEventListener("mouseleave", () => {
      if (!topBarPinned) {
        scheduleTopPeekHide();
      }
    });

    bottomChromeWrap?.addEventListener("mouseenter", () => {
      clearTimeout(bottomPeekHideTimer);
      if (!bottomBarPinned) {
        bottomBarPeek = true;
        syncDockPeekClasses();
      }
    });
    bottomChromeWrap?.addEventListener("mouseleave", () => {
      if (!bottomBarPinned) {
        scheduleBottomPeekHide();
      }
    });

    document.querySelectorAll("[data-view-chrome]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const which = btn.dataset.viewChrome;
        if (which) {
          toggleViewChromeFromMenu(which);
        }
      });
    });

    leftFlyoutHost?.addEventListener("mouseenter", () => {
      clearTimeout(leftPeekHideTimer);
      leftDockPeek = true;
      syncDockPeekClasses();
    });
    leftFlyoutHost?.addEventListener("mouseleave", () => {
      if (!leftDockPinned) {
        scheduleLeftPeekHide();
      }
    });

    rightFlyoutHost?.addEventListener("mouseenter", () => {
      clearTimeout(rightPeekHideTimer);
      rightDockPeek = true;
      syncDockPeekClasses();
    });
    rightFlyoutHost?.addEventListener("mouseleave", () => {
      if (!rightDockPinned) {
        scheduleRightPeekHide();
      }
    });

    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!leftDockPinned && leftFlyoutHost && !leftFlyoutHost.contains(event.target)) {
          leftDockPeek = false;
          clearTimeout(leftPeekHideTimer);
        }
        if (!rightDockPinned && rightFlyoutHost && !rightFlyoutHost.contains(event.target)) {
          rightDockPeek = false;
          clearTimeout(rightPeekHideTimer);
        }
        if (!topBarPinned && topChromeWrap && !topChromeWrap.contains(event.target)) {
          topBarPeek = false;
          clearTimeout(topPeekHideTimer);
        }
        if (!bottomBarPinned && bottomChromeWrap && !bottomChromeWrap.contains(event.target)) {
          bottomBarPeek = false;
          clearTimeout(bottomPeekHideTimer);
        }
        syncDockPeekClasses();
      },
      true
    );

    leftPanelPinBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      leftDockPinned = !leftDockPinned;
      if (leftDockPinned) {
        leftDockPeek = true;
        clearTimeout(leftPeekHideTimer);
      } else if (!leftFlyoutHost?.matches(":hover")) {
        leftDockPeek = false;
      }
      syncDockPeekClasses();
      triggerWindowResize();
    });

    rightPanelPinBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      rightDockPinned = !rightDockPinned;
      if (rightDockPinned) {
        rightDockPeek = true;
        clearTimeout(rightPeekHideTimer);
      } else if (!rightFlyoutHost?.matches(":hover")) {
        rightDockPeek = false;
      }
      syncDockPeekClasses();
      triggerWindowResize();
    });

    syncLayoutPinsFromEditorSettings();
    syncDockPeekClasses({ persist: false });
    initDockChromeInsetTracking();
  }

  function init() {
    initChromeFlyoutsAndViewMenu();
  }

  return {
    init,
    syncFromSettings,
    resetPeekState,
    syncDockPeekClasses,
    peekRightDock
  };
}
