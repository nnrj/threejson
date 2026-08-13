import { renderMarkdownToSafeHtml } from "./threeBoxMarkdown.js";

const POLL_INTERVAL_MS = 5 * 60_000;
const TOAST_DURATION_MS = 8_500;
const BELL_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
    <path d="M10 21h4" />
  </svg>`;

const escapeHtml = (value) => String(value ?? "").replace(
  /[&<>"']/g,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
);

export function normalizeNotificationChannels(value) {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function selectNewestPopupNotification(notifications, excludedIds = new Set()) {
  return [...(notifications || [])]
    .filter((notification) => (
      !notification.read
      && normalizeNotificationChannels(notification.channels).includes("modal")
      && !excludedIds.has(notification.id)
    ))
    .sort((left, right) => Number(right.created_at || 0) - Number(left.created_at || 0))[0] || null;
}

function notificationBodyHtml(notification) {
  return notification.content_format === "markdown"
    ? renderMarkdownToSafeHtml(notification.body)
    : escapeHtml(notification.body).replace(/\r?\n/g, "<br>");
}

function secureLinks(root) {
  for (const link of root.querySelectorAll("a")) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
}

function lastPopupStorageKey(base) {
  return `threebox:builtin-notifications:last-popup:${base}`;
}

export function createThreeBoxBuiltinNotifications(settingsProvider) {
  let interval = null;
  let toastTimer = null;
  let list = [];
  let bell = null;
  let panel = null;
  let toastNode = null;
  let started = false;
  let hasPolled = false;
  let pollVersion = 0;
  const seen = new Set();

  function config() {
    const settings = settingsProvider?.() || {};
    const provider = settings.ai?.providers?.find((entry) => entry.provider === "threebox-builtin");
    return {
      enabled: settings.general?.builtinNotificationsEnabled === true,
      base: String(settings.ai?.builtinBackendUrl || "https://api.threebox.org").replace(/\/$/, ""),
      key: provider?.apiKey || ""
    };
  }

  function setPanelOpen(open) {
    if (!bell || !panel) return;
    panel.hidden = !open;
    bell.setAttribute("aria-expanded", String(open));
  }

  async function markRead(notification) {
    if (notification.read) return;
    const current = config();
    if (!current.key) return;
    try {
      const response = await fetch(`${current.base}/v1/builtin-notifications/${encodeURIComponent(notification.id)}/read`, {
        method: "POST",
        credentials: "include",
        headers: { Authorization: `Bearer ${current.key}` }
      });
      if (!response.ok) return;
      notification.read = 1;
      render();
    } catch {
      // Keep the item unread so a later click or poll can retry.
    }
  }

  function render() {
    if (!bell || !panel) return;
    const unread = list.filter((item) => !item.read).length;
    const badge = unread ? `<em aria-label="${unread} 条未读通知">${unread > 99 ? "99+" : unread}</em>` : "";
    bell.innerHTML = `${BELL_ICON}${badge}`;
    bell.title = unread ? `通知（${unread} 条未读）` : "通知";

    panel.replaceChildren();
    const header = document.createElement("header");
    header.className = "threeboxNoticeHeader";
    header.innerHTML = `<strong>通知</strong><span>${unread ? `${unread} 条未读` : "已全部阅读"}</span>`;
    panel.append(header);
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "threeboxNoticeEmpty";
      empty.textContent = "暂无通知";
      panel.append(empty);
      return;
    }

    for (const notification of list) {
      const row = document.createElement("article");
      row.className = `threeboxNoticeItem level-${escapeHtml(notification.level || "notice")} ${notification.read ? "read" : "unread"}`;
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `${notification.read ? "已读" : "未读"}通知：${notification.title}`);
      row.innerHTML = `
        <b>${escapeHtml(notification.title)}</b>
        <div class="threeboxNoticeBody">${notificationBodyHtml(notification)}</div>
        <small>${new Date(notification.created_at || Date.now()).toLocaleString()}</small>`;
      secureLinks(row);
      row.addEventListener("click", (event) => {
        if (event.target.closest?.("a")) {
          void markRead(notification);
          return;
        }
        void markRead(notification);
      });
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          void markRead(notification);
        }
      });
      panel.append(row);
    }
  }

  function onDocumentPointerDown(event) {
    if (panel && !panel.hidden && !bell?.contains(event.target) && !panel.contains(event.target)) setPanelOpen(false);
  }

  function ensureUi() {
    if (bell) return;
    bell = document.createElement("button");
    bell.type = "button";
    bell.className = "threeboxNotificationBell";
    bell.setAttribute("aria-label", "通知");
    bell.setAttribute("aria-expanded", "false");
    bell.setAttribute("aria-controls", "threeboxNotificationInbox");
    bell.addEventListener("click", () => setPanelOpen(Boolean(panel?.hidden)));

    panel = document.createElement("section");
    panel.id = "threeboxNotificationInbox";
    panel.className = "threeboxNotificationInbox";
    panel.setAttribute("aria-label", "通知列表");
    panel.hidden = true;
    document.body.append(bell, panel);
    document.addEventListener("pointerdown", onDocumentPointerDown);
    render();
  }

  function removeUi() {
    document.removeEventListener("pointerdown", onDocumentPointerDown);
    bell?.remove();
    panel?.remove();
    toastNode?.remove();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    toastNode = null;
    bell = null;
    panel = null;
  }

  function toast(notification, base) {
    toastNode?.remove();
    if (toastTimer) clearTimeout(toastTimer);
    const node = document.createElement("aside");
    node.className = `threeboxBuiltinNotice level-${escapeHtml(notification.level || "notice")}`;
    node.tabIndex = 0;
    node.setAttribute("role", "status");
    node.innerHTML = `
      <strong>${escapeHtml(notification.title)}</strong>
      <div class="threeboxBuiltinNoticeBody">${notificationBodyHtml(notification)}</div>`;
    secureLinks(node);
    const openInbox = (event) => {
      if (event?.target?.closest?.("a")) {
        void markRead(notification);
        return;
      }
      setPanelOpen(true);
      void markRead(notification);
      node.remove();
    };
    node.addEventListener("click", openInbox);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openInbox(event);
      }
    });
    document.body.append(node);
    toastNode = node;
    try { localStorage.setItem(lastPopupStorageKey(base), notification.id); } catch { /* storage is optional */ }
    toastTimer = setTimeout(() => {
      node.remove();
      if (toastNode === node) toastNode = null;
    }, TOAST_DURATION_MS);
  }

  async function poll() {
    const version = ++pollVersion;
    const current = config();
    if (!current.enabled || !current.key) {
      list = [];
      removeUi();
      return;
    }
    try {
      const response = await fetch(`${current.base}/v1/builtin-notifications`, { credentials: "include", headers: { Authorization: `Bearer ${current.key}` } });
      if (!response.ok || !started || version !== pollVersion) return;
      const body = await response.json();
      if (!started || version !== pollVersion) return;
      list = Array.isArray(body.notifications) ? body.notifications : [];
      ensureUi();
      render();

      const alreadySeen = hasPolled ? seen : new Set();
      const newestPopup = selectNewestPopupNotification(list, alreadySeen);
      for (const notification of list) seen.add(notification.id);
      if (!hasPolled) {
        let lastPopupId = "";
        try { lastPopupId = localStorage.getItem(lastPopupStorageKey(current.base)) || ""; } catch { /* storage is optional */ }
        if (newestPopup && newestPopup.id !== lastPopupId) toast(newestPopup, current.base);
      } else if (newestPopup) {
        toast(newestPopup, current.base);
      }
      hasPolled = true;
    } catch {
      // Notifications are optional and must never interrupt scene generation or editing.
    }
  }

  return {
    start() {
      started = true;
      if (interval) clearInterval(interval);
      void poll();
      interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    },
    refresh: poll,
    stop() {
      started = false;
      pollVersion += 1;
      if (interval) clearInterval(interval);
      interval = null;
      hasPolled = false;
      seen.clear();
      removeUi();
    }
  };
}
