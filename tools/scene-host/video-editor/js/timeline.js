import { snapMediaTime } from "@threejson/media-kit";
import { getTimelineDuration } from "threejson/timeline";
import { $, element } from "./ui.js";

export const defaultLanes = [{ id: "visual", kind: "visual", name: "画面 1" }, { id: "overlay", kind: "visual", name: "画面 2" }, { id: "caption", kind: "caption", name: "字幕" }, { id: "audio", kind: "audio", name: "配音 / 音乐" }];
export function createTimelineView({ getDocument, select, getSelection, execute, seek, getTime, onError }) {
  let pixels = Number($("zoom").value), dragging = false;
  const left = () => innerWidth <= 800 ? 88 : 120;
  const laneList = document => {
    const lanes = [...(document.timeline.lanes || [])];
    for (const item of defaultLanes) if (!lanes.some(l => l.kind === item.kind)) lanes.push({ ...item, id: `default-${item.kind}`, fallback: true });
    return lanes;
  };
  function draw() {
    if (dragging) return;
    const document = getDocument(), container = $("timelineInner"), projectDuration = getTimelineDuration(document.timeline), duration = Math.max(10, projectDuration);
    const width = Math.max($("timeline").clientWidth - left() - 10, duration * pixels + 60);
    container.style.width = `${width + left()}px`; container.replaceChildren();
    const ruler = element("div", { class: "ruler", "aria-label": "时间标尺" });
    const step = pixels < 15 ? 10 : pixels < 40 ? 5 : 1;
    for (let t = 0; t <= duration + 2; t += step) { const tick = element("span", {}, `${t}s`); tick.style.left = `${t * pixels}px`; ruler.append(tick); }
    ruler.addEventListener("pointerdown", event => { seek(Math.max(0, Math.min(duration, (event.clientX - ruler.getBoundingClientRect().left) / pixels))); });
    container.append(ruler);
    for (const lane of laneList(document)) {
      const section = { visual: "clips", caption: "captions", audio: "audio" }[lane.kind];
      const row = element("div", { class: "track" }), label = element("div", { class: "trackLabel" }), body = element("div", { class: "trackBody" });
      label.append(element("span", {}, lane.name || lane.id));
      if (!lane.fallback) {
        const controls = element("span");
        for (const [property, title, on, off] of [["muted", "隐藏 / 静音轨道", "○", "●"], ["locked", "锁定轨道", "锁", "开"]]) controls.append(element("button", { title, "aria-label": `${title} ${lane.name || lane.id}`, onclick: () => execute({ op: "media.lanes.set", args: { lanes: document.timeline.lanes.map(value => value.id === lane.id ? { ...value, [property]: !value[property] } : value) } }).catch(onError) }, lane[property] ? on : off));
        label.append(controls);
      }
      for (const record of document.timeline[section] || []) {
        const item = { ...record, duration: record.duration ?? Math.max(.04, projectDuration - (record.start || 0)) };
        if (lane.fallback ? item.laneId : item.laneId !== lane.id && !(lane === laneList(document).find(l => l.kind === lane.kind) && !item.laneId)) continue;
        const title = section === "clips" ? item.name || document.production?.shots?.[item.id]?.title || item.id : item.text || item.name || item.id;
        const selected = getSelection();
        const button = element("button", { class: `clip ${section}${selected?.id === item.id && selected?.section === section ? " selected" : ""}${lane.muted || item.enabled === false ? " disabled" : ""}`, title: `${title} · ${(item.start || 0).toFixed(2)}s / ${item.duration.toFixed(2)}s`, "data-id": item.id, "data-section": section, "aria-label": title });
        button.style.left = `${(item.start || 0) * pixels}px`; button.style.width = `${item.duration * pixels}px`;
        button.append(documentNode(title), element("span", { class: "handle left", "data-edge": "left" }), element("span", { class: "handle right", "data-edge": "right" }));
        button.addEventListener("click", () => select(section, item.id));
        button.addEventListener("pointerdown", event => {
          if (event.button !== 0 || lane.locked) return;
          dragging = true; select(section, item.id); event.preventDefault();
          const edge = event.target.dataset.edge, anchor = event.clientX, before = { ...item }, baseRevision = document;
          let changes, moved = false; dragging = true; button.setPointerCapture(event.pointerId);
          const move = event => {
            const delta = (event.clientX - anchor) / pixels; if (Math.abs(event.clientX - anchor) > 3) moved = true;
            const proposed = (before.start || 0) + (edge === "right" ? before.duration : 0) + delta;
            const at = $("snap").checked ? snapMediaTime(proposed, document.timeline, { fps: document.output?.fps || 30, threshold: 7 / pixels, excludeId: item.id, playhead: getTime() }) : Math.max(0, proposed);
            if (edge === "left") {
              const shift = Math.max(section === "captions" ? -(before.start || 0) : -(before.sourceStart || 0) / (before.rate ?? 1), Math.min(at - (before.start || 0), before.duration - .04));
              changes = { start: (before.start || 0) + shift, duration: before.duration - shift, ...(section !== "captions" ? { sourceStart: (before.sourceStart || 0) + shift * (before.rate ?? 1) } : {}) };
            } else if (edge === "right") changes = { duration: Math.max(.04, at - (before.start || 0)) };
            else changes = { start: Math.max(0, at) };
            button.style.left = `${(changes.start ?? before.start ?? 0) * pixels}px`; button.style.width = `${(changes.duration ?? before.duration) * pixels}px`;
          };
          const finish = async event => {
            button.removeEventListener("pointermove", move); button.removeEventListener("pointerup", finish); button.removeEventListener("pointercancel", finish); dragging = false;
            try { if (moved && changes && event.type !== "pointercancel") {
              if (getDocument() !== baseRevision) throw new Error("工程已改变，请重新拖动。");
              await execute(section === "clips" ? { op: "media.clip.update", args: { id: item.id, changes } } : { op: "timeline.edit", args: { section, upsert: [{ ...item, ...changes }], retimeAutomation: true } });
            } } catch (error) { onError(error); } finally { draw(); }
          };
          button.addEventListener("pointermove", move); button.addEventListener("pointerup", finish); button.addEventListener("pointercancel", finish);
        });
        body.append(button);
      }
      row.append(label, body); container.append(row);
    }
    container.append(element("div", { class: "playhead" })); updateTime(getTime());
  }
  function updateTime(time) { const node = $("timelineInner").querySelector(".playhead"); if (node) node.style.left = `${left() + time * pixels}px`; }
  $("zoom").addEventListener("input", () => { pixels = Number($("zoom").value); draw(); });
  window.addEventListener("resize", draw);
  return { draw, updateTime };
}
const documentNode = text => document.createTextNode(text);
