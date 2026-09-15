import { EventDispatcher } from "three";

const INPUT_MODES = new Set(["locked", "focused", "manual"]);
// A cancelled asynchronous request must not unlock a newer controller's request.
const latestRequests = new WeakMap();

function resolveMode(mode, pointerLockEnabled) {
  const value = mode ?? (pointerLockEnabled ? "locked" : "focused");
  if (!INPUT_MODES.has(value)) throw new TypeError(`Unknown first-person inputMode: ${value}`);
  return value;
}

function isEditable(element) {
  for (let node = element; node; node = node.parentElement) {
    if (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName || "")) return true;
  }
  return false;
}

/** Generic input ownership; application shortcuts (including Escape) belong to the host. */
export function createFirstPersonInputController(domElement, pointerLock, config = {}, resetLook = () => {}) {
  const doc = domElement?.ownerDocument;
  const view = doc?.defaultView;
  const keyTarget = view ?? domElement;
  const controller = new EventDispatcher();
  const keyState = new Set();
  let enabled = config.enabled !== false;
  let pointerLockEnabled = config.pointerLock !== false;
  let inputMode = resolveMode(config.inputMode, pointerLockEnabled);
  let manualActive = config.inputActive === true;
  let lockOnClick = config.lockOnClick !== false;
  let releaseOnBlur = config.releaseOnBlur !== false;
  let pageFocused = doc?.hasFocus?.() !== false;
  let disposed = false;
  let pending = null;
  let lastState;
  let addedTabIndex = false;

  const isLocked = () => Boolean(domElement && doc?.pointerLockElement === domElement);
  function isActive() {
    if (disposed || !enabled || !pageFocused || doc?.visibilityState === "hidden"
      || isEditable(doc?.activeElement)) return false;
    // A different canvas owns the pointer, even if this host uses manual keyboard activation.
    if (doc?.pointerLockElement && !isLocked()) return false;
    if (inputMode === "locked") return isLocked();
    if (inputMode === "focused") return isLocked() || doc?.activeElement === domElement;
    return manualActive;
  }

  function getInputState() {
    return { enabled, inputMode, inputActive: isActive(), isLocked: isLocked(),
      lockPending: Boolean(pending), pointerLockEnabled,
      pointerLockSupported: typeof domElement?.requestPointerLock === "function" };
  }

  function clearInput() {
    keyState.clear();
    resetLook();
  }

  function syncState(reason) {
    const state = getInputState();
    // PointerLockControls also has a non-smoothed mouse path; gate both paths alike.
    pointerLock.enabled = state.inputActive && state.isLocked;
    if (lastState && Object.keys(state).every((key) => state[key] === lastState[key])) return;
    const previous = lastState;
    lastState = state;
    if (!state.inputActive || previous?.isLocked !== state.isLocked) clearInput();
    controller.dispatchEvent({ type: "inputstatechange", state, reason });
    if (previous && previous.isLocked !== state.isLocked) {
      controller.dispatchEvent({ type: state.isLocked ? "lock" : "unlock", state });
    }
  }

  function focusInput() {
    if (disposed || !enabled) return;
    if (!domElement.hasAttribute?.("tabindex")) {
      domElement.setAttribute?.("tabindex", "-1");
      addedTabIndex = true;
    }
    domElement.focus?.({ preventScroll: true });
    pageFocused = doc?.hasFocus?.() !== false;
    syncState("focus");
  }

  function releaseOwnedPointer() {
    if (isLocked()) doc?.exitPointerLock?.();
  }

  function cancelPending() {
    if (!pending) return;
    pending.cancelled = true;
    pending.resolve(false);
    pending = null;
    // Request observers stay only until the browser answers, to release a late grant.
  }

  function unlock() {
    cancelPending();
    clearInput();
    releaseOwnedPointer();
    syncState("unlock-request");
  }

  function lock() {
    if (disposed || !enabled) return Promise.resolve(false);
    if (isLocked()) return Promise.resolve(true);
    if (pending) return pending.promise;
    if (typeof domElement?.requestPointerLock !== "function") {
      const error = new Error("Pointer Lock API is unavailable");
      error.code = "E_POINTER_LOCK_UNAVAILABLE";
      controller.dispatchEvent({ type: "lockerror", error });
      return Promise.resolve(false);
    }
    const intent = { cancelled: false };
    intent.promise = new Promise((resolve) => { intent.resolve = resolve; });
    pending = intent;
    latestRequests.set(domElement, intent);
    let finished = false;
    const complete = (success, error) => {
      if (finished) return;
      finished = true;
      doc.removeEventListener("pointerlockchange", onResult);
      doc.removeEventListener("pointerlockerror", onError);
      if (pending === intent) pending = null;
      if (latestRequests.get(domElement) === intent) latestRequests.delete(domElement);
      intent.resolve(Boolean(success && !intent.cancelled && !disposed));
      if (!disposed) {
        syncState("lock-result");
        if (error && !intent.cancelled) controller.dispatchEvent({ type: "lockerror", error });
      }
    };
    const onResult = () => {
      // Unrelated canvases can change ownership while this browser request is
      // pending. Keep its late-grant observer until our own request is answered.
      if (finished || !isLocked()) return;
      if (intent.cancelled || disposed) {
        if (latestRequests.get(domElement) === intent) releaseOwnedPointer();
        complete(false);
      } else complete(true);
    };
    const onError = () => complete(false, new Error("Pointer lock request was rejected by the browser"));
    doc.addEventListener("pointerlockchange", onResult);
    doc.addEventListener("pointerlockerror", onError);
    focusInput();
    syncState("lock-request");
    try {
      // Must run in the original user gesture. Legacy browsers return void, not a Promise.
      const request = domElement.requestPointerLock();
      if (request?.then) {
        Promise.resolve(request).then(() => {
          onResult();
          if (!finished) complete(false);
        }, (error) => complete(false, error));
      }
    } catch (error) { complete(false, error); }
    return intent.promise;
  }

  function onKeyDown(event) {
    if (!isActive() || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey
      || (event.composedPath?.() || [event.target]).some(isEditable)) return;
    keyState.add(event.code);
  }
  function onKeyUp(event) { keyState.delete(event.code); }
  function onClick(event) {
    if (!enabled || event.defaultPrevented) return;
    focusInput();
    if (pointerLockEnabled && lockOnClick) void lock();
  }
  function onPointerChange() { syncState("pointerlockchange"); }
  function onFocusChange() { clearInput(); syncState("focuschange"); }
  function onFocus() { pageFocused = true; syncState("focus"); }
  function onBlur() {
    pageFocused = false;
    clearInput();
    if (releaseOnBlur) unlock();
    syncState("blur");
  }
  function onVisibility() {
    if (doc.visibilityState === "hidden") onBlur();
    else { pageFocused = doc.hasFocus?.() !== false; syncState("visibilitychange"); }
  }

  keyTarget?.addEventListener("keydown", onKeyDown);
  keyTarget?.addEventListener("keyup", onKeyUp);
  view?.addEventListener("blur", onBlur);
  view?.addEventListener("focus", onFocus);
  doc?.addEventListener("focusin", onFocusChange);
  doc?.addEventListener("focusout", onFocusChange);
  doc?.addEventListener("pointerlockchange", onPointerChange);
  doc?.addEventListener("visibilitychange", onVisibility);
  domElement?.addEventListener("click", onClick);

  Object.assign(controller, {
    domElement, getInputState, clearInput, focusInput, lock, unlock,
    isKeyPressed: (code) => isActive() && keyState.has(code),
    setInputMode(mode) { controller.applyInputConfig({ inputMode: mode }); },
    setInputActive(active) { manualActive = active === true; clearInput(); syncState("manual"); },
    applyInputConfig(next = {}) {
      if (next.inputMode !== undefined) inputMode = resolveMode(next.inputMode, pointerLockEnabled);
      if (next.inputActive !== undefined) manualActive = next.inputActive === true;
      if (next.lockOnClick !== undefined) lockOnClick = next.lockOnClick !== false;
      if (next.releaseOnBlur !== undefined) releaseOnBlur = next.releaseOnBlur !== false;
      if (next.pointerLock !== undefined) pointerLockEnabled = next.pointerLock !== false;
      clearInput(); syncState("config");
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unlock();
      pointerLock.enabled = false;
      keyTarget?.removeEventListener("keydown", onKeyDown);
      keyTarget?.removeEventListener("keyup", onKeyUp);
      view?.removeEventListener("blur", onBlur);
      view?.removeEventListener("focus", onFocus);
      doc?.removeEventListener("focusin", onFocusChange);
      doc?.removeEventListener("focusout", onFocusChange);
      doc?.removeEventListener("pointerlockchange", onPointerChange);
      doc?.removeEventListener("visibilitychange", onVisibility);
      domElement?.removeEventListener("click", onClick);
      if (addedTabIndex && domElement.getAttribute?.("tabindex") === "-1") domElement.removeAttribute("tabindex");
      controller._listeners = {};
    }
  });
  Object.defineProperties(controller, {
    enabled: { enumerable: true, get: () => enabled, set(value) {
      enabled = value !== false;
      if (!enabled) cancelPending();
      clearInput(); syncState("enabled");
    } },
    isLocked: { enumerable: true, get: isLocked },
    inputActive: { enumerable: true, get: isActive }
  });
  syncState("init");
  return controller;
}
