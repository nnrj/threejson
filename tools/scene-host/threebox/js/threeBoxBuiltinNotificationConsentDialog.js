import { getHostLocale } from "../../shared/i18n/index.js";

/** Application dialog for optional device-scoped built-in notifications. */
export function requestBuiltinNotificationConsent() {
  const zh = getHostLocale() === "zh-CN";
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modalOverlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const dialog = document.createElement("div");
    dialog.className = "modalDialog";
    dialog.innerHTML = `<div class="modalHeader">${zh ? "接收内置供应商通知" : "Built-in provider notifications"}</div><div class="modalBody"><p>${zh ? "接收当前匿名设备的内置供应商重要服务通知。不会关联账户或启用浏览器推送，且可随时在设置中关闭。" : "Receive important built-in provider service notices on this anonymous device. This does not link an account or enable browser push, and can be changed in Settings."}</p></div><div class="modalFooter"><button type="button" data-choice="no">${zh ? "暂不接收" : "Not now"}</button><button type="button" class="primary" data-choice="yes">${zh ? "允许接收" : "Allow"}</button></div>`;
    overlay.appendChild(dialog); document.body.appendChild(overlay);
    const finish = (value) => { overlay.remove(); resolve(value); };
    overlay.addEventListener("click", (event) => { if (event.target === overlay) finish(false); });
    dialog.querySelector('[data-choice="no"]')?.addEventListener("click", () => finish(false));
    dialog.querySelector('[data-choice="yes"]')?.addEventListener("click", () => finish(true));
  });
}
