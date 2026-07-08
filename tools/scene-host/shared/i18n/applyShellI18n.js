import { t } from "./index.js";

/**
 * Apply shell UI translations from data-i18n* attributes under root.
 */
export function applyShellI18n(root = document) {
  if (!root) {
    return;
  }
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) {
      return;
    }
    const fallback = el.getAttribute("data-i18n-fallback") || el.textContent || "";
    const text = t(key, fallback);
    if (applyAssociatedControlLabel(el, text)) {
      return;
    }
    if (applyElementWithChildrenText(el, text)) {
      return;
    }
    if (el.children.length > 0) {
      return;
    }
    el.textContent = text;
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (!key) {
      return;
    }
    const fallback = el.getAttribute("data-i18n-fallback-title") || el.title || "";
    el.title = t(key, fallback);
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (!key) {
      return;
    }
    const fallback = el.getAttribute("data-i18n-fallback-aria") || el.getAttribute("aria-label") || "";
    el.setAttribute("aria-label", t(key, fallback));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) {
      return;
    }
    const fallback = el.getAttribute("data-i18n-fallback-placeholder") || el.placeholder || "";
    el.placeholder = t(key, fallback);
  });
  root.querySelectorAll("[data-i18n-value]").forEach((el) => {
    const key = el.getAttribute("data-i18n-value");
    if (!key) {
      return;
    }
    const fallback = el.getAttribute("data-i18n-fallback-value") || el.value || el.textContent || "";
    const text = t(key, fallback);
    if ("value" in el) {
      el.value = text;
    } else {
      el.textContent = text;
    }
  });
}

function applyAssociatedControlLabel(el, text) {
  const tag = el.tagName?.toLowerCase();
  const isControl = tag === "input" || tag === "select" || tag === "textarea";
  if (!isControl) {
    return false;
  }
  const controlType = String(el.getAttribute("type") || "").toLowerCase();
  if (controlType === "checkbox" || controlType === "radio") {
    return false;
  }
  const id = el.id;
  const label = id ? el.ownerDocument?.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  if (label) {
    label.textContent = text;
    return true;
  }
  const parentLabel = el.closest?.("label");
  if (parentLabel) {
    replaceTrailingLabelText(parentLabel, el, text);
    return true;
  }
  return false;
}

function applyElementWithChildrenText(el, text) {
  if (!el.children?.length) {
    return false;
  }
  if (el.matches?.("button,[role='menuitemcheckbox'],label")) {
    const textSpan = Array.from(el.querySelectorAll(":scope > span")).find(
      (span) => !span.classList.contains("viewChromeCheck") && span.getAttribute("aria-hidden") !== "true"
    );
    if (textSpan) {
      textSpan.textContent = text;
      return true;
    }
    const textNode = Array.from(el.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
    if (textNode) {
      textNode.textContent = text;
      return true;
    }
  }
  return false;
}

function replaceTrailingLabelText(label, control, text) {
  const textNode = Array.from(label.childNodes)
    .reverse()
    .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) {
    textNode.textContent = ` ${text}`;
    return;
  }
  control.insertAdjacentText("afterend", ` ${text}`);
}
