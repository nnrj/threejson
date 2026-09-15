/** Shower's walk/pause UX. No application shortcuts or DOM presentation live in the engine. */
export function createShowerFirstPersonUi(container, t) {
  const doc = container.ownerDocument;
  const root = doc.createElement("div");
  root.className = "showerWalkOverlay";
  root.hidden = true;
  const panel = doc.createElement("div");
  panel.className = "showerWalkPanel";
  const title = doc.createElement("strong");
  const description = doc.createElement("p");
  const button = doc.createElement("button");
  button.type = "button";
  const errorText = doc.createElement("p");
  errorText.className = "showerWalkError";
  errorText.setAttribute("role", "status");
  const hint = doc.createElement("div");
  hint.className = "showerWalkHint";
  panel.append(title, description, button, errorText);
  root.append(panel, hint);
  container.appendChild(root);
  let controls = null;
  let entered = false;
  let loading = false;
  let error = false;
  let suspendedEnabled;

  function refresh() {
    root.hidden = !controls;
    if (!controls) return;
    const state = controls.getInputState();
    const active = !loading && state.inputActive;
    if (active) entered = true;
    root.dataset.state = active ? "walking" : state.lockPending ? "pending" : "paused";
    panel.hidden = active;
    hint.hidden = !active;
    title.textContent = t(entered ? "walkPaused" : "walkReady");
    const unavailable = state.pointerLockEnabled && !state.pointerLockSupported;
    description.textContent = t(unavailable ? "walkUnsupported" : state.pointerLockEnabled ? "walkInstructions" : "walkFocusInstructions");
    button.textContent = t(loading ? "loading" : state.lockPending ? "walkEntering" : entered ? "walkResume" : "walkEnter");
    button.disabled = loading || state.lockPending || !state.enabled || unavailable;
    errorText.hidden = !error;
    errorText.textContent = error ? t("walkFailed") : "";
    hint.textContent = t(state.pointerLockEnabled ? "walkActiveHint" : "walkFocusHint");
  }

  function pause() {
    controls?.unlock();
    controls?.clearInput();
    if (doc.activeElement === controls?.domElement) controls.domElement.blur?.();
    refresh();
  }

  function enter() {
    if (!controls || button.disabled) return;
    error = false;
    if (controls.getInputState().pointerLockEnabled) void controls.lock();
    else controls.focusInput();
    refresh();
  }
  function onError() { error = true; refresh(); }
  function onStateChange(event) { if (event.state?.isLocked) error = false; refresh(); }
  function onKeyDown(event) {
    // Only this host assigns Escape to pausing. Native pointerlockchange also covers
    // browser-handled Escape, for which no keydown is delivered to the page.
    if (event.code === "Escape" && (controls?.isLocked || controls?.inputActive)) pause();
  }
  function restoreEnabled() {
    if (controls && suspendedEnabled !== undefined) controls.enabled = suspendedEnabled;
    suspendedEnabled = undefined;
  }
  function suspend() {
    if (!controls || suspendedEnabled !== undefined) return;
    suspendedEnabled = controls.enabled;
    pause();
    controls.enabled = false;
  }

  button.addEventListener("click", enter);
  doc.defaultView?.addEventListener("keydown", onKeyDown);
  return {
    refresh, pause,
    setRuntime(runtime) {
      if (controls) {
        controls.removeEventListener("inputstatechange", onStateChange);
        controls.removeEventListener("lockerror", onError);
        pause();
        restoreEnabled();
      }
      controls = runtime?.controls?.threeJsonControlsKind === "firstPerson" ? runtime.controls : null;
      entered = false;
      error = false;
      if (controls) {
        // Runtime-only host policy: do not rewrite the author's scene JSON.
        controls.applyInputConfig({ inputMode: controls.getInputState().pointerLockEnabled ? "locked" : "focused",
          lockOnClick: true, releaseOnBlur: true });
        controls.addEventListener("inputstatechange", onStateChange);
        controls.addEventListener("lockerror", onError);
        if (loading) suspend();
      }
      refresh();
    },
    setLoading(value) {
      loading = value === true;
      if (loading) suspend();
      else restoreEnabled();
      refresh();
    },
    dispose() {
      this.setRuntime(null);
      button.removeEventListener("click", enter);
      doc.defaultView?.removeEventListener("keydown", onKeyDown);
      root.remove();
    }
  };
}
