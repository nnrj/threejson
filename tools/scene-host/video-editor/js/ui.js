export const $ = id => document.getElementById(id);
export function element(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) { if (key.startsWith("on")) node.addEventListener(key.slice(2), value); else if (key === "class") node.className = value; else node.setAttribute(key, value); }
  if (text !== undefined) node.textContent = text;
  return node;
}
let toastTimer;
export function toast(message, error = false) { $("toast").textContent = message; $("toast").classList.toggle("error", error); $("toast").hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $("toast").hidden = true; }, error ? 11000 : 4500); }
export async function modal(title, body, actions = [{ label: "确定", value: "ok", accent: true }]) {
  const dialog = $("modal");
  if (dialog.open) {
    const closed = new Promise(resolve => dialog.addEventListener("close", resolve, { once: true }));
    dialog.close("cancel"); await closed;
  }
  $("modalTitle").textContent = title; $("modalBody").replaceChildren(typeof body === "string" ? element("p", {}, body) : body);
  $("modalActions").replaceChildren(...actions.map(action => element("button", { value: action.value, ...(action.accent ? { class: "accent" } : {}) }, action.label)));
  return new Promise(resolve => { dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true }); dialog.showModal(); });
}
export const confirm = (title, text) => modal(title, text, [{ label: "取消", value: "cancel" }, { label: "确定", value: "ok", accent: true }]).then(value => value === "ok");
export function field(label, value, options = {}) {
  const wrapper = element("label", {}, label), input = element(options.options ? "select" : options.multiline ? "textarea" : "input", { "aria-label": label });
  if (options.options) for (const [id, name] of options.options) input.append(element("option", { value: id }, name));
  else if (!options.multiline) input.type = options.type || (typeof value === "number" ? "number" : "text");
  if (input.type === "number") { input.step = options.step || "0.01"; if (options.min !== undefined) input.min = options.min; }
  input.value = value ?? ""; wrapper.append(input); return { wrapper, input };
}
export function download(blob, name) { const url = URL.createObjectURL(blob), link = element("a", { href: url, download: name }); link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
export const timecode = value => `${String(Math.floor(value / 60)).padStart(2, "0")}:${(value % 60).toFixed(1).padStart(4, "0")}`;
export const uid = prefix => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
