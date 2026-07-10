const LEFT_DOCK_PINNED_STORAGE_KEY = "threejson.threebox.leftDockPinned";
const PEEK_HIDE_DELAY_MS = 260;

function readPinnedFromStorage() {
  try {
    const raw = localStorage.getItem(LEFT_DOCK_PINNED_STORAGE_KEY);
    return raw === null ? true : raw === "1";
  } catch (_error) {
    return true;
  }
}

function persistPinnedToStorage(pinned) {
  try {
    localStorage.setItem(LEFT_DOCK_PINNED_STORAGE_KEY, pinned ? "1" : "0");
  } catch (_error) {
    /* ignore quota/availability errors */
  }
}

/**
 * Single-dock (left sidebar only) port of the editor's pin/auto-hide chrome pattern
 * (see tools/scene-host/editor/js/editorViewChrome.js): pinned by default, click the pin
 * button to unpin, then the sidebar hides and reveals on mouse-near-left-edge / dismisses on
 * outside click when unpinned.
 */
export function createThreeBoxViewChrome() {
  const rootContainer = document.getElementById("rootContainer");
  const leftFlyoutHost = document.getElementById("leftFlyoutHost");
  const leftDock = document.getElementById("leftDock");
  const leftDockPinBtn = document.getElementById("leftDockPinBtn");

  let leftDockPinned = readPinnedFromStorage();
  let leftDockPeek = false;
  let peekHideTimer = null;

  function syncClasses() {
    rootContainer?.classList.toggle("leftDockPinned", leftDockPinned);
    rootContainer?.classList.toggle("leftDockPeek", leftDockPeek);
    leftDock?.setAttribute("aria-hidden", leftDockPinned || leftDockPeek ? "false" : "true");
    if (leftDockPinBtn) {
      leftDockPinBtn.setAttribute("aria-pressed", leftDockPinned ? "true" : "false");
      leftDockPinBtn.title = leftDockPinned ? "已钉住：鼠标移开仍显示" : "未钉住：移到屏幕左边缘唤出";
    }
    window.dispatchEvent(new Event("resize"));
  }

  function scheduleHide() {
    clearTimeout(peekHideTimer);
    peekHideTimer = setTimeout(() => {
      leftDockPeek = false;
      syncClasses();
    }, PEEK_HIDE_DELAY_MS);
  }

  function togglePinned() {
    leftDockPinned = !leftDockPinned;
    if (leftDockPinned) {
      leftDockPeek = true;
      clearTimeout(peekHideTimer);
    } else if (!leftFlyoutHost?.matches(":hover")) {
      leftDockPeek = false;
    }
    persistPinnedToStorage(leftDockPinned);
    syncClasses();
  }

  function init() {
    leftFlyoutHost?.addEventListener("mouseenter", () => {
      clearTimeout(peekHideTimer);
      leftDockPeek = true;
      syncClasses();
    });
    leftFlyoutHost?.addEventListener("mouseleave", () => {
      if (!leftDockPinned) {
        scheduleHide();
      }
    });
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!leftDockPinned && leftFlyoutHost && !leftFlyoutHost.contains(event.target)) {
          leftDockPeek = false;
          clearTimeout(peekHideTimer);
          syncClasses();
        }
      },
      true
    );
    leftDockPinBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePinned();
    });
    syncClasses();
  }

  return { init };
}
