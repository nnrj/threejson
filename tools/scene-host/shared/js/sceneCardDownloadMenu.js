/** Available downloads, not AI intent routing. Legacy single-scene films have
 * a timeline instead of a composition root; ordinary animated models still
 * retain the separate media-studio entry for recording/export.
 */
export function getSceneCardDownloadActions(source) {
  if (!source || typeof source !== "object") return [];
  const timeline = source.timeline;
  const timed = Number(timeline?.duration) > 0 || ["tracks", "clips", "captions", "audio", "effects"].some(key => timeline?.[key]?.length > 0);
  return source.documentType === "composition" || timed
    ? ["video", "tjz", "json"] : ["json", "tjz", "mesh"];
}

/** Small shared native/React menu. Its portal escapes canvas clipping and the
 * mobile toolbar's horizontal scroll area. No media/encoder dependency here.
 */
export function createSceneCardDownloadMenu({ button, getItems, onSelect, onError }) {
  const doc = button.ownerDocument, win = doc.defaultView;
  const id = `scene-download-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  let menu = null, listeners = null;
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", id);
  function close(restoreFocus = false) {
    if (!menu) return;
    listeners?.abort(); listeners = null;
    menu.remove(); menu = null;
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus && button.isConnected) button.focus();
  }
  function open(last = false) {
    if (button.disabled) return;
    const items = getItems();
    if (!items?.length) return;
    // Other card menus close through focusin; only an open menu owns listeners.
    menu = doc.createElement("div"); menu.id = id; menu.className = "sceneCardDownloadMenu";
    menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", button.getAttribute("aria-label") || button.title);
    const palette = win.getComputedStyle(button.closest(".sceneCard") || button);
    Object.assign(menu.style, {
      position: "fixed", zIndex: "10000", boxSizing: "border-box", width: "max-content",
      minWidth: "180px", maxWidth: "calc(100vw - 16px)", maxHeight: "calc(100dvh - 16px)", overflow: "auto",
      padding: "5px", border: `1px solid ${palette.getPropertyValue("--line").trim() || "#737985"}`,
      borderRadius: "10px", background: palette.getPropertyValue("--panel2").trim() || "#252a31",
      color: palette.getPropertyValue("--text").trim() || "#f2f4f8", boxShadow: "0 6px 24px #0005",
      font: "14px/1.5 system-ui"
    });
    const style = doc.createElement("style");
    style.textContent = ".sceneCardDownloadMenu>button{display:block;width:100%;min-height:44px;padding:8px 12px;box-sizing:border-box;border:0;border-radius:6px;text-align:start;font:inherit;color:inherit;background:transparent;cursor:pointer;white-space:normal;overflow-wrap:anywhere}.sceneCardDownloadMenu>button:hover,.sceneCardDownloadMenu>button:focus-visible{background:#8883;outline:2px solid #698ad1;outline-offset:-2px}";
    menu.append(style);
    for (const item of items) {
      const entry = doc.createElement("button"); entry.type = "button"; entry.tabIndex = -1;
      entry.setAttribute("role", "menuitem"); entry.dataset.downloadAction = item.id; entry.textContent = item.label;
      entry.onclick = () => {
        close(true);
        // A streamed draft may have changed representation while the menu was open.
        if (!getItems()?.some(current => current.id === item.id)) return;
        Promise.resolve().then(() => onSelect(item.id)).catch(error => onError?.(error));
      };
      menu.append(entry);
    }
    doc.body.append(menu); button.setAttribute("aria-expanded", "true");
    const anchor = button.getBoundingClientRect();
    const view = win.visualViewport, left = view?.offsetLeft || 0, top = view?.offsetTop || 0;
    const width = view?.width || win.innerWidth, height = view?.height || win.innerHeight;
    menu.style.maxWidth = `${Math.max(0, width - 16)}px`;
    menu.style.minWidth = `${Math.min(180, Math.max(0, width - 16))}px`;
    menu.style.maxHeight = `${Math.max(0, height - 16)}px`;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(left + 8, Math.min(anchor.left, left + width - bounds.width - 8))}px`;
    const above = anchor.top - bounds.height - 6;
    menu.style.top = `${Math.max(top + 8, Math.min(above >= top + 8 ? above : anchor.bottom + 6, top + height - bounds.height - 8))}px`;
    listeners = new AbortController(); const signal = listeners.signal;
    doc.addEventListener("pointerdown", event => { if (!menu?.contains(event.target) && !button.contains(event.target)) close(); }, { capture: true, signal });
    doc.addEventListener("focusin", event => { if (!menu?.contains(event.target) && !button.contains(event.target)) close(); }, { signal });
    doc.addEventListener("scroll", event => { if (!menu?.contains(event.target)) close(); }, { capture: true, passive: true, signal });
    win.addEventListener("resize", () => close(), { signal });
    view?.addEventListener("resize", () => close(), { signal });
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); close(true); return; }
      const entries = [...menu.querySelectorAll('[role="menuitem"]')];
      const index = entries.indexOf(doc.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1
        : event.key === "ArrowDown" ? (index + 1) % entries.length
        : event.key === "ArrowUp" ? (index - 1 + entries.length) % entries.length : null;
      if (next !== null) { event.preventDefault(); entries[next].focus(); }
    }, { signal });
    const entries = menu.querySelectorAll('[role="menuitem"]'); entries[last ? entries.length - 1 : 0]?.focus({ preventScroll: true });
  }
  const click = () => menu ? close(true) : open();
  const keydown = event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); if (!menu) open(event.key === "ArrowUp"); } };
  button.addEventListener("click", click); button.addEventListener("keydown", keydown);
  return { close, dispose() { close(); button.removeEventListener("click", click); button.removeEventListener("keydown", keydown); } };
}
