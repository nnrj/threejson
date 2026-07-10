const TOAST_DURATION_MS = 2600;

let toastTimer = null;

/** @param {string} text @param {"info"|"success"|"warning"|"error"} [type] */
export function showToast(text, type = "info") {
  const el = document.getElementById("messageToast");
  if (!el) {
    return;
  }
  el.textContent = String(text || "");
  el.dataset.type = type;
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), TOAST_DURATION_MS);
}
