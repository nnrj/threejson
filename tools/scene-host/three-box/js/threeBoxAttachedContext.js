import { createThreeBoxSceneCard } from "./threeBoxSceneCard.js";

/**
 * Manages the "attached scene" preview row above the composer (ChatGPT-style image-attachment
 * chip, but for a full 3D scene): a template picked from the sidebar gallery shows here as a
 * live mini scene card, collapsible to a small chip that sits inside the composer's top edge.
 * The attached scene is consumed as context for the NEXT message the user sends (threeBoxApp.js
 * reads `get()` when handling a send) — this module only owns the preview UI, not the send flow.
 */
export function createThreeBoxAttachedContext() {
  const row = document.getElementById("attachedContextRow");
  let current = null;
  let expanded = true;
  let sceneCard = null;

  function disposeSceneCard() {
    sceneCard?.dispose?.();
    sceneCard = null;
  }

  function renderExpanded() {
    const wrap = document.createElement("div");
    wrap.className = "attachedContextExpanded";

    const header = document.createElement("div");
    header.className = "attachedContextHeader";
    const label = document.createElement("span");
    label.className = "attachedContextLabel";
    label.textContent = `将作为上下文：${current.label}`;
    header.appendChild(label);

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "attachedContextHeaderBtn";
    collapseBtn.title = "折叠";
    collapseBtn.textContent = "–";
    collapseBtn.addEventListener("click", () => {
      expanded = false;
      render();
    });
    header.appendChild(collapseBtn);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "attachedContextHeaderBtn";
    removeBtn.title = "移除";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => clear());
    header.appendChild(removeBtn);

    wrap.appendChild(header);

    const canvasWrap = document.createElement("div");
    canvasWrap.className = "attachedContextCanvasWrap";
    wrap.appendChild(canvasWrap);
    row.appendChild(wrap);

    disposeSceneCard();
    sceneCard = createThreeBoxSceneCard();
    canvasWrap.appendChild(sceneCard.el);
    void sceneCard.render(current.sceneJson);
  }

  function renderChip() {
    disposeSceneCard();
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "attachedContextChip";
    chip.title = "点击展开预览";

    const thumb = document.createElement("span");
    thumb.className = "attachedContextChipThumb";
    thumb.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" d="M2 12.5 6 4.5 9 9.5 11 6.5 14 12.5z"/></svg>';
    chip.appendChild(thumb);

    const label = document.createElement("span");
    label.className = "attachedContextChipLabel";
    label.textContent = current.label;
    chip.appendChild(label);

    const removeBtn = document.createElement("span");
    removeBtn.className = "attachedContextChipRemoveBtn";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      clear();
    });
    chip.appendChild(removeBtn);

    chip.addEventListener("click", () => {
      expanded = true;
      render();
    });
    row.appendChild(chip);
  }

  function render() {
    if (!row) {
      return;
    }
    row.innerHTML = "";
    if (!current) {
      row.hidden = true;
      return;
    }
    row.hidden = false;
    if (expanded) {
      renderExpanded();
    } else {
      renderChip();
    }
  }

  function clear() {
    disposeSceneCard();
    current = null;
    render();
  }

  /** @param {{id:string, title?:string}} item @param {object} sceneJson */
  function setTemplate(item, sceneJson) {
    current = { kind: "template", id: item.id, label: item.title || item.id, sceneJson };
    expanded = true;
    render();
  }

  function get() {
    return current;
  }

  return { setTemplate, clear, get };
}
