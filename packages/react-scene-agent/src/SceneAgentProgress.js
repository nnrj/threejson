import { createElement as h } from "react";

export function SceneAgentProgress({ text = "", stream = "", busy = false }) {
  if (!busy && !text && !stream) return null;
  return h(
    "div",
    { className: "sceneAgentProgress", role: "status", "aria-live": "polite" },
    busy ? h("span", { className: "sceneAgentProgressSpinner", "aria-hidden": "true" }) : null,
    text ? h("span", { className: "sceneAgentProgressText" }, text) : null,
    stream ? h("pre", { className: "sceneAgentProgressStream" }, stream) : null
  );
}
