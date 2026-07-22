/** Device-scoped notices for users who opted in to the built-in provider. This is deliberately
 * separate from Cloud account notifications: no cookie or account identifier is used. */
export function createThreeBoxBuiltinNotifications(settingsProvider) {
  let interval = null;
  let seen = new Set();
  function config() {
    const settings = settingsProvider?.() || {};
    const provider = settings.ai?.providers?.find((entry) => entry.provider === "threebox-builtin");
    return { enabled: settings.general?.builtinNotificationsEnabled === true, base: String(settings.ai?.builtinBackendUrl || "https://api.threebox.org").replace(/\/$/, ""), key: provider?.apiKey || "" };
  }
  function toast(notification) {
    const node = document.createElement("div");
    node.className = "threeboxBuiltinNotice";
    node.textContent = `${notification.title}: ${notification.body}`;
    Object.assign(node.style, { position: "fixed", right: "18px", bottom: "18px", zIndex: "10000", maxWidth: "360px", padding: "12px", borderRadius: "8px", background: "#263247", color: "#fff", boxShadow: "0 6px 24px #0006" });
    document.body.append(node); setTimeout(() => node.remove(), 7000);
  }
  async function poll() {
    const current = config(); if (!current.enabled || !current.key) return;
    const response = await fetch(`${current.base}/v1/builtin-notifications`, { headers: { Authorization: `Bearer ${current.key}` } });
    if (!response.ok) return;
    const body = await response.json();
    for (const notification of body.notifications || []) if (!notification.read && !seen.has(notification.id)) {
      seen.add(notification.id); toast(notification);
      void fetch(`${current.base}/v1/builtin-notifications/${encodeURIComponent(notification.id)}/read`, { method: "POST", headers: { Authorization: `Bearer ${current.key}` } });
    }
  }
  return { start() { clearInterval(interval); void poll(); interval = setInterval(() => void poll(), 5 * 60_000); }, refresh: poll, stop() { clearInterval(interval); interval = null; } };
}
