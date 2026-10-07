import { createMediaProjectSession, createMediaOperationService, createMediaProject, packMediaDocument, probeMediaAsset, extractMediaAudio, isMediaSource } from "@threejson/media-kit";
import { getTimelineDuration } from "threejson/timeline";
import { createEditorStorage } from "../../shared/js/videoProjectStorage.js";
import { ingestMediaDocument } from "./documents.js";
import { createEditorPreview } from "./preview.js";
import { createTimelineView, defaultLanes } from "./timeline.js";
import { $, element, field, toast, modal, confirm, download, timecode, uid } from "./ui.js";

let storage, session, service, adapters, projectId, selection, unsubscribe, changeCounter = 0, saveQueue = Promise.resolve(), savedRevision = -1, job, jsonBase = -1, jsonOwner, jsonDirty = false, shotFacts = [];
const handoffs = new Map(), channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("threejson-video-editor") : null;
const report = error => { console.error("[video-editor]", error); toast(error.message || String(error), true); };
const selected = () => session?.document.timeline[selection?.section]?.find(item => item.id === selection.id);
const selectedClip = () => selection?.section === "clips" ? selected() : null;
const shotScene = clip => clip && !isMediaSource(clip.source) ? typeof clip.source === "string" ? session.document.scenes?.[clip.source] : clip.source : null;
const endOf = item => (item.start || 0) + item.duration;
const laneId = kind => session.document.timeline.lanes?.find(lane => lane.kind === kind)?.id;
const command = (op, args) => ({ op, args });
const wrap = fn => async event => { try { await fn(event); } catch (error) { report(error); } };
const bind = (id, fn, type = "click") => $(id).addEventListener(type, wrap(fn));
const emptyProject = () => ({ documentType: "composition", compositionVersion: 1, name: "未命名工程", output: { width: 1920, height: 1080, fps: 30 }, scenes: {}, timeline: { version: 1, clips: [], lanes: structuredClone(defaultLanes) }, production: { version: 1, state: "planning", shots: {} } });
const basicScene = (color = "#77dbc9") => ({ version: "next", sceneConfig: { scene: { background: "#0b1321" }, camera: { position: { x: 0, y: 1, z: 8 }, lookAt: { x: 0, y: 0, z: 0 } }, controls: { type: "none" } }, objectList: [{ threeJsonId: "subject", objType: "torus", geometry: { radius: 1.2, tube: .32, tubularSegments: 96, radialSegments: 24 }, material: { type: "normal" } }], timeline: { version: 1, duration: 8, tracks: [{ id: "spin", target: "subject", property: "rotation.y", keyframes: [{ time: 0, value: 0 }, { time: 8, value: Math.PI * 2 }] }], captions: [{ id: "title", text: "ThreeJSON · 每一帧都可以编辑", start: .5, duration: 6.5, fontSize: 40, color }] } });

const preview = createEditorPreview({ canvas: $("preview"), resolveDocument: value => storage.resolveDocument(value), onStatus: text => { $("previewStatus").textContent = text; }, onTime: (time, playing) => {
  $("seek").value = time; $("timeLabel").textContent = `${timecode(time)} / ${timecode(session ? getTimelineDuration(session.document.timeline) : 0)}`;
  $("play").textContent = playing ? "Ⅱ" : "▶"; $("play").setAttribute("aria-label", playing ? "暂停" : "播放"); timeline.updateTime(time);
  updateEmptyState(time);
}, onError: report });
const timeline = createTimelineView({ getDocument: () => session?.document || emptyProject(), getSelection: () => selection, getTime: () => preview.time, seek: time => preview.seek(Math.min(time, getTimelineDuration(session.document.timeline))), execute: (...args) => execute(...args), select, onError: report });

async function execute(input, options = {}) {
  if (job && !options.internal) throw new Error("任务进行中，请先停止，再手动编辑。");
  preview.pause();
  const result = await service.execute(input, { baseRevision: options.baseRevision ?? session.revision });
  if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code });
  return result;
}
function save() {
  const id = projectId, document = session.snapshot(), revision = session.revision;
  $("saveStatus").textContent = "正在保存…";
  saveQueue = saveQueue.catch(() => {}).then(() => storage.saveProject(id, document)).then(() => {
    if (id !== projectId || revision !== session.revision) return;
    savedRevision = revision; $("saveStatus").textContent = "已保存到此浏览器";
  }).catch(error => { $("saveStatus").textContent = "保存失败，请下载工程包"; report(error); });
  return saveQueue;
}
async function openProject(document, id = crypto.randomUUID()) {
  if (job) throw new Error("请先停止正在执行的任务。");
  // Validate before closing the current session.
  const next = createMediaProjectSession(document, { duration: document?.timeline ? Math.max(8, getTimelineDuration(document.timeline)) : 8, historyLimit: 100 });
  unsubscribe?.(); session?.dispose(); preview.pause(); session = next; projectId = id; savedRevision = -1; selection = undefined; jsonBase = -1; jsonDirty = false; $("jsonDraft").value = "";
  adapters = { captureFrames: async (document, args, context) => {
    if (args.times.length > 12) throw new Error("每次最多捕获 12 帧，请分批检查。");
    const project = await createMediaProject(await storage.resolveDocument(document), { width: Math.min(1280, args.width || 640), height: Math.min(720, args.height || 360), signal: context.signal, preloadNext: false });
    try { const frames = []; for (const time of args.times) { await project.renderAt(time); frames.push({ time, dataUrl: project.canvas.toDataURL("image/png"), kind: "actual-project" }); } return frames; } finally { project.dispose(); }
  } };
  service = createMediaOperationService({ session, adapters });
  unsubscribe = session.subscribe(() => { refresh(); save(); });
  refresh(); await save();
}
function refresh() {
  if (!session) return;
  const document = session.document, duration = getTimelineDuration(document.timeline);
  shotFacts = session.inspect().shots;
  if (selection && !selected()) selection = undefined;
  $("projectName").value = document.name || "未命名工程";
  for (const name of ["width", "height", "fps"]) $(name).value = document.output?.[name] || { width: 1920, height: 1080, fps: 30 }[name];
  $("undo").disabled = !session.canUndo || Boolean(job); $("redo").disabled = !session.canRedo || Boolean(job);
  $("seek").max = Math.max(.001, duration); $("emptyState").hidden = document.timeline.clips.length > 0 || (document.timeline.captions || []).length > 0;
  $("projectInfo").textContent = `${document.timeline.clips.length} 个片段 · ${duration.toFixed(1)} 秒`;
  timeline.draw(); drawInspector(); drawAssets();
  if (jsonDirty && jsonBase !== session.revision) $("jsonStatus").textContent = "工程已发生改变。草稿已保留；请备份草稿并重新读取，避免覆盖新修改。";
  preview.setDocument(document, ++changeCounter).catch(report);
}
function updateEmptyState(time) {
  if (!session) return;
  const visible = shotFacts.filter(s => s.enabled && time >= s.start && time < s.start + s.duration), planned = visible.length && visible.every(s => s.stage === "planned" && !s.hasContent);
  const empty = !session.document.timeline.clips.length && !(session.document.timeline.captions || []).length;
  $("emptyState").hidden = !empty && !planned; $("emptyDemo").hidden = !empty;
  $("emptyState").querySelector("h1").textContent = planned ? "分镜已规划，画面尚未制作" : "从一个镜头开始";
  $("emptyState").querySelector("p").textContent = planned ? `${visible[0].title || visible[0].id} · 确认分镜后，让 AI 继续制作。` : "用 AI 编排故事，也可以导入素材亲手剪辑。";
}
function select(section, id) { selection = { section, id }; drawInspector(); timeline.draw(); }
function drawAssets() {
  $("assetList").replaceChildren();
  for (const [id, asset] of Object.entries(session.document.mediaAssets || {})) $("assetList").append(element("button", { class: "assetItem", title: "再次添加到播放头位置", onclick: wrap(() => insertAsset(id, preview.time)) }, `${{ video: "▣", image: "▧", audio: "♫" }[asset.kind]} ${asset.name || id}`));
  if (!Object.keys(session.document.mediaAssets || {}).length) $("assetList").append(element("span", { class: "hint" }, "暂无外部素材 · 原生镜头在下方时间线中"));
}

function drawInspector() {
  const box = $("inspectorFields"), item = selected(), section = selection?.section;
  box.replaceChildren(); $("selectionKind").textContent = section || "INSPECTOR";
  if (!item) { box.append(element("p", { class: "hint" }, "在时间线上选择片段、字幕或音轨。")); return; }
  const values = {}, add = (key, label, value, options) => { const f = field(label, value, options); values[key] = f.input; box.append(f.wrapper); return f.input; };
  box.append(element("p", { class: "hint" }, `ID: ${item.id}`));
  if (section === "captions") add("text", "字幕文本", item.text || "", { multiline: true });
  else add("name", "名称", item.name || session.document.production?.shots?.[item.id]?.title || item.id);
  add("start", "开始（秒）", item.start || 0, { min: 0 }); add("duration", "时长（秒）", item.duration ?? Math.max(.04, getTimelineDuration(session.document.timeline) - (item.start || 0)), { min: .01 });
  if (item.duration === undefined) box.append(element("p", { class: "hint" }, "原条目未指定时长；当前按工程结束位置显示。应用属性将明确写入时长。"));
  if (section !== "captions") { add("sourceStart", "源入点（秒）", item.sourceStart || 0, { min: 0 }); add("rate", "播放速度", item.rate ?? 1, { min: .01 }); }
  if (section === "clips") {
    add("opacity", "画面不透明度", item.opacity ?? 1, { min: 0 });
    add("fit", "画面适配", item.fit || "contain", { options: [["contain", "完整显示"], ["cover", "铺满裁切"], ["stretch", "拉伸"]] });
  }
  if (section !== "captions") { add("fadeIn", "淡入（秒）", item.fadeIn || 0, { min: 0 }); add("fadeOut", "淡出（秒）", item.fadeOut || 0, { min: 0 }); }
  if (section === "audio") add("gain", "音量（1 = 原始音量）", item.gain ?? 1, { min: 0 });
  if (section === "captions") { add("fontSize", "字号（输出像素）", item.fontSize || 42, { min: 1 }); add("y", "纵向位置（0～1）", item.y ?? .9, { min: 0 }); }
  const kind = { clips: "visual", audio: "audio", captions: "caption" }[section], lanes = session.document.timeline.lanes?.filter(l => l.kind === kind) || [];
  if (lanes.length) add("laneId", "轨道", item.laneId || lanes[0].id, { options: lanes.map(l => [l.id, `${l.name || l.id}${l.locked ? "（已锁定）" : ""}`]) });
  const timing = element("div", { class: "pair" }); timing.append(values.start.parentElement, values.duration.parentElement); box.append(timing);
  const properties = element("details"); properties.append(element("summary", {}, "更多属性 · 速度、淡化与轨道"));
  for (const [key, input] of Object.entries(values)) if (!["name", "text", "start", "duration"].includes(key)) properties.append(input.parentElement);
  const actions = element("div", { class: "row" });
  actions.append(element("button", { class: "accent", onclick: wrap(async () => {
    const changes = Object.fromEntries(Object.entries(values).map(([key, input]) => [key, input.type === "number" ? Number(input.value) : input.value]));
    if (section === "clips") await execute(command("media.clip.update", { id: item.id, changes }));
    else await execute(command("timeline.edit", { section, upsert: [{ ...item, ...changes }], retimeAutomation: true }));
  }) }, "应用属性"));
  if (section === "clips" && shotScene(item)) actions.append(element("button", { onclick: wrap(() => openShotEditor(item)) }, "3D 镜头编辑"));
  box.append(actions);
  box.append(properties);
  if (item.linkedClipId) box.append(element("button", { onclick: wrap(() => { const next = { ...item }; delete next.linkedClipId; return execute(command("timeline.edit", { section, upsert: [next] })); }) }, "解除与画面的联动"));
  if (section === "clips") {
    box.append(element("p", { class: "hint" }, "源入点和速度作用于镜头自身时间；分割或复制后，修改本镜头不会改动副本。跨轨叠加按轨道从上到下绘制。"));
    const advanced = element("details"), body = element("div", { class: "row" }); advanced.append(element("summary", {}, "剪辑与转场"));
    const all = session.document.timeline.clips.filter(c => c.laneId === item.laneId).toSorted((a, b) => (a.start || 0) - (b.start || 0)), at = all.findIndex(c => c.id === item.id);
    if (at > 0) body.append(element("button", { onclick: wrap(() => execute(command("media.clip.reorder", { id: item.id, beforeId: all[at - 1].id }))) }, "前移一个"));
    if (at < all.length - 1) body.append(element("button", { onclick: wrap(() => execute(command("media.clip.reorder", { id: item.id, beforeId: all[at + 2]?.id }))) }, "后移一个"));
    body.append(element("button", { onclick: wrap(() => transitionDialog(item)) }, "设置转场"));
    if (at < all.length - 1) body.append(element("button", { onclick: wrap(async () => { const f = field("新切点（秒）", endOf(item), { min: .01 }); if (await modal("滚动剪辑 · 保持总长度", f.wrapper) === "ok") await execute(command("media.clip.roll", { id: item.id, nextId: all[at + 1].id, time: Number(f.input.value) })); }) }, "滚动切点"));
    advanced.append(body); box.append(advanced);
  }
}
async function transitionDialog(clip) {
  const body = element("div"), type = field("转场", clip.transitionIn?.type || "none", { options: [["none", "无"], ["wipe", "擦除"], ["dissolve", "颗粒溶解"]] }), duration = field("转场时长（秒）", clip.transitionIn?.duration || 1, { min: .01 });
  body.append(type.wrapper, duration.wrapper, element("p", { class: "hint" }, "与上一镜头重叠时从上一镜头过渡；没有重叠时从背景揭示。交叉淡化可让两片段重叠，并设置淡入 / 淡出。"));
  if (await modal("片段入场转场", body) !== "ok") return;
  await execute(command("media.clip.update", { id: clip.id, changes: { transitionIn: type.input.value === "none" ? undefined : { type: type.input.value, duration: Number(duration.input.value), direction: "left", seed: 7 } } }));
}

async function insertAsset(id, start, extraCommands = [], assetOverride) {
  const asset = assetOverride || session.document.mediaAssets[id], clipId = uid(asset.kind), commands = [...extraCommands];
  if (asset.kind === "audio") commands.push(command("timeline.edit", { section: "audio", upsert: [{ id: clipId, name: asset.name, url: asset.url, start, duration: asset.duration, gain: 1, laneId: laneId("audio") }] }));
  else {
    commands.push(command("media.clip.insert", { clip: { id: clipId, name: asset.name, source: { type: "media", assetId: id }, start, duration: asset.kind === "image" ? 5 : asset.duration, laneId: laneId("visual") } }));
    if (asset.audioUrl) commands.push(command("timeline.edit", { section: "audio", upsert: [{ id: `${clipId}-audio`, linkedClipId: clipId, linkedRange: "source", sourceDuration: asset.duration, name: `${asset.name} · 原声`, url: asset.audioUrl, start, duration: asset.duration, gain: 1, laneId: laneId("audio"), padSilence: true }] }));
  }
  await execute(commands); select(asset.kind === "audio" ? "audio" : "clips", clipId);
}
async function importFile(file) {
  if (job) throw new Error("请先停止当前任务再导入。");
  if (/\.(json|tj|tjz)$/i.test(file.name)) {
    const document = await ingestMediaDocument(file, storage);
    if (document.documentType === "composition") { if (!await confirm("打开工程", `将新建本地工程并打开导入的视频。${jsonDirty ? "尚未应用的 JSON 草稿会丢弃，请先备份。" : "当前工程的已应用修改保留在最近工程中。"}是否继续？`)) return; await openProject(document); }
    else { const id = uid("shot"); await execute(command("media.shot.put", { id, scene: document, clip: { start: preview.time, duration: Math.max(8, getTimelineDuration(document.timeline)), laneId: laneId("visual") }, metadata: { title: file.name, stage: "draft" } })); select("clips", id); }
    return;
  }
  toast(`正在读取 ${file.name}…`);
  const revision = session.revision, owner = projectId, metadata = await probeMediaAsset(file), id = uid("asset");
  const asset = { ...metadata, name: file.name, url: await storage.addAsset(file, file.name) };
  if (metadata.hasAudio) {
    const result = await extractMediaAudio(file);
    if (result) { const url = await storage.addAsset(result.blob, `${file.name}.wav`); if (asset.kind === "audio") asset.url = url; else asset.audioUrl = url; }
  }
  if (owner !== projectId || revision !== session.revision) throw new Error("导入期间工程已改变，请重新导入；原工程未被覆盖。");
  await insertAsset(id, preview.time, [command("media.asset.put", { id, asset })], asset); toast(`已导入 ${file.name}`);
}

async function openShotEditor(clip) {
  if (job) throw new Error("请先停止当前任务。");
  const popup = window.open("about:blank", "_blank"); if (!popup) throw new Error("弹出窗口被浏览器阻止，请允许此站点打开编辑器。");
  popup.opener = null;
  try {
    const token = crypto.randomUUID(), revision = session.revision;
    const record = { type: "scene-edit", projectId, clipId: clip.id, revision, sceneJson: await storage.portableJson(shotScene(clip)), label: clip.name || clip.id };
    await storage.saveHandoff(token, record); handoffs.set(token, record);
    popup.location.href = `../editor/index.html?openFrom=video-editor&sceneKey=${encodeURIComponent(token)}`;
    toast("已打开场景编辑器。完成后点击其中的“应用到视频工程”。");
  } catch (error) { popup.close(); throw error; }
}
async function applyShotReply(token) {
  const original = handoffs.get(token); if (!original) return;
  const reply = await storage.getHandoff(`${token}:reply`); if (!reply?.sceneJson) return;
  handoffs.delete(token);
  if (projectId !== original.projectId || session.revision !== original.revision || job) {
    const blob = new Blob([JSON.stringify(reply.sceneJson, null, 2)], { type: "application/json" });
    if (await confirm("镜头返回时工程已改变", "为避免覆盖新修改，未自动应用。是否下载返回的镜头 JSON？可稍后重新导入。")) download(blob, `${original.clipId}.json`);
    return;
  }
  await execute(command("media.shot.put", { id: original.clipId, scene: reply.sceneJson }), { baseRevision: original.revision });
  toast("镜头修改已应用，可撤销。");
}
channel?.addEventListener("message", wrap(event => { if (event.data?.action === "shot-return") return applyShotReply(event.data.token); }));
window.addEventListener("focus", wrap(async () => { for (const token of handoffs.keys()) await applyShotReply(token); }));

async function savePack() {
  await save(); const document = session.snapshot();
  const data = await packMediaDocument(document, { assets: await storage.assetsFor(document), outputType: "bytes" });
  download(new Blob([data], { type: "application/zip" }), `${document.name || "video-project"}.tjz`);
  toast("工程包已下载。本地导入素材已打包；远程 URL 资源仍需要联网。");
}
function setJob(value) {
  job = value; $("cancelJob").hidden = !job;
  for (const id of ["runAi", "narration", "newProject", "importFiles", "demoProject", "recentProjects", "addScene", "applyJson", "addCaption", "addMusic", "split", "duplicate", "deleteClip", "rippleDelete", "applyOutput", "exportMedia"]) $(id).disabled = Boolean(job);
  $("undo").disabled = Boolean(job) || !session.canUndo; $("redo").disabled = Boolean(job) || !session.canRedo;
}
function log(text) { $("aiLog").textContent = `${$("aiLog").textContent}\n${text}`.slice(-9000); $("aiLog").scrollTop = $("aiLog").scrollHeight; }
async function generate() {
  const prompt = $("aiPrompt").value.trim(); if (!prompt) throw new Error("请先输入视频要求。");
  const clip = selectedClip(), scoped = $("aiScope").value === "shot";
  if (scoped && !shotScene(clip)) throw new Error("请先选择一个原生 3D 镜头。普通视频/图片可手动剪辑，但不能编辑其内部 3D 对象。");
  const controller = new AbortController(); setJob(controller); preview.pause();
  log(`将${scoped ? `调整镜头 ${clip.id}` : "生成 / 调整视频工程"}。可随时停止；已提交的镜头会保留。`);
  let narration;
  try {
    const { runEditorVideoAgent } = await import("./agent.js");
    const { createLocalNarrationHost } = await import("../../../../packages/host-kit/js/localSpeech.js");
    narration = await createLocalNarrationHost();
    if (narration.available) adapters.narrate = narration.narrate;
    const result = await runEditorVideoAgent({ service, prompt, shotId: scoped ? clip.id : undefined, signal: controller.signal, confirmStoryboard: $("storyApproval").checked && !session.document.timeline.clips.length, onProgress: value => log(value.operations?.join("、") || ({ reasoning: "正在编排或细化镜头…", invalid_output: "响应格式无效，正在请求修正…" }[value.stage] || value.stage)) });
    if (result.stopReason === "storyboard_approval_required") {
      log("分镜已保存。请检查下方镜头；确认后再次点击“生成 / 调整视频”继续制作。场景仍为空的分镜不是成片。");
      const shots = session.inspect().shots;
      await modal("请确认分镜", element("div", {}, shots.map(s => `${s.title || s.id} · ${s.duration}s\n${s.intent || ""}`).join("\n\n")), [{ label: "稍后继续", value: "ok" }]);
    } else log(result.completed ? "本轮操作已完成。请播放检查视觉效果与声音。" : `已停止（${result.stopReason}），保留已完成内容。再次提交可继续。`);
  } catch (error) { if (controller.signal.aborted) log("已停止，已完成内容和撤销记录均保留。"); else throw error; }
  finally { delete adapters.narrate; narration?.dispose(); setJob(null); await save(); }
}
async function synthesizeNarration() {
  const controller = new AbortController(), revision = session.revision, doc = session.snapshot();
  setJob(controller); preview.pause();
  let project, host;
  try {
    const { collectExportNarration, synthesizeExportNarration } = await import("../../../../packages/host-kit/js/mediaNarrationExport.js");
    const { prepareDefaultLocalNarrationHost } = await import("../../../../packages/host-kit/js/localSpeech.js");
    project = await createMediaProject(await storage.resolveDocument(doc), { width: 320, height: 180, signal: controller.signal });
    const plan = await collectExportNarration(doc, { duration: project.duration, audioClips: await project.getAudioClips(), mode: "auto", signal: controller.signal });
    if (!plan.cues.length) { toast(plan.skipped ? "已有配音覆盖这些字幕，没有重复生成。" : "请先添加字幕，或让 AI 在分镜中写入台词。"); return; }
    log(`正在为 ${plan.cues.length} 段字幕 / 台词合成旁白。首次需要下载约 71 MiB 本地语音资源。`);
    host = await prepareDefaultLocalNarrationHost({ signal: controller.signal, onProgress: p => { $("previewStatus").textContent = `下载语音资源 ${Math.round((p.progress || 0) * 100)}%`; } });
    const audio = await synthesizeExportNarration(plan, host, { signal: controller.signal, speed: 1, maxSpeed: 1.5, onProgress: p => { $("previewStatus").textContent = `合成旁白 ${p.cue} / ${p.cues}`; } });
    await execute(command("timeline.edit", { section: "audio", upsert: audio.map(item => {
      const cue = plan.cues.find(c => item.start >= c.start && endOf(item) <= c.start + c.duration + 1e-5);
      const linked = doc.timeline.clips.find(c => cue?.id === c.id || cue?.id.startsWith(`${c.id}/`))?.id || doc.timeline.captions?.find(c => c.id === cue?.id)?.linkedClipId;
      return { ...item, id: uid("narration"), name: "本地旁白", laneId: laneId("audio"), ...(linked ? { linkedClipId: linked } : {}) };
    }) }), { internal: true, baseRevision: revision });
    toast("旁白已加入工程音轨，可预览、剪辑和导出。");
  } catch (error) { if (!controller.signal.aborted) throw error; toast("已取消旁白合成，工程未被更改。"); }
  finally { host?.dispose(); project?.dispose(); setJob(null); }
}

bind("newProject", async () => { if (await confirm("新建视频工程", `当前工程会保留在“最近工程”中。${jsonDirty ? "尚未应用的 JSON 草稿会丢弃，请先备份。" : ""}是否新建？`)) await openProject(emptyProject()); });
bind("recentProjects", async () => {
  const list = await storage.listProjects(), body = element("div");
  for (const record of list) body.append(element("button", { type: "button", class: "recentItem", onclick: wrap(async () => { if (jsonDirty && !await confirm("切换工程", "JSON 草稿尚未应用，切换会丢弃草稿。请先备份。")) return; $("modal").close(); const latest = await storage.getProject(record.id); await openProject(latest.document, latest.id); }) }, `${record.document.name || "未命名工程"} · ${new Date(record.updated).toLocaleString()}`));
  await modal("此浏览器中的最近工程", body, [{ label: "关闭", value: "cancel" }]);
});
bind("importFiles", () => $("fileInput").click());
bind("fileInput", async event => { const files = [...event.target.files]; event.target.value = ""; for (const file of files) await importFile(file); }, "change");
bind("projectName", () => execute(command("media.project.set", { name: $("projectName").value })), "change");
bind("savePack", savePack);
bind("saveJson", async () => { const value = await storage.portableJson(session.snapshot()); download(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), `${session.document.name || "video-project"}.json`); });
bind("exportMedia", async () => { preview.pause(); const { openSceneMediaStudio } = await import("../../shared/js/mediaStudio.js"); await openSceneMediaStudio(await storage.resolveDocument(session.snapshot()), { name: session.document.name || "video", initialFormat: "mp4" }); });
bind("addScene", async () => { const id = uid("shot"); await execute(command("media.shot.put", { id, scene: basicScene(), clip: { start: preview.time, duration: 8, laneId: laneId("visual") }, metadata: { title: "新镜头" } })); select("clips", id); });
async function demo() {
  if ((session.document.timeline.clips.length || jsonDirty) && !await confirm("打开示例工程", `当前工程会保留在最近工程中。${jsonDirty ? "尚未应用的 JSON 草稿会丢弃，请先备份。" : ""}是否打开示例？`)) return;
  const document = emptyProject(); document.name = "第一个故事 · 时间与形状"; document.output = { width: 1280, height: 720, fps: 30 };
  document.scenes = { first: basicScene(), second: basicScene("#ffe09c") };
  document.scenes.second.objectList[0].objType = "sphere"; document.scenes.second.objectList[0].geometry = { radius: 1.5, widthSegments: 48, heightSegments: 32 };
  document.scenes.second.timeline.captions[0].text = "镜头、字幕和声音，共用一条时间线";
  document.timeline.clips = [{ id: "intro", source: "first", start: 0, duration: 8, laneId: "visual", fadeOut: 1 }, { id: "final", source: "second", start: 7, duration: 8, laneId: "visual", fadeIn: 1 }];
  document.production.shots = { intro: { title: "开场 · 形状" }, final: { title: "结尾 · 时间" } };
  await openProject(document); await addMusic(); select("clips", "intro");
}
bind("demoProject", demo); bind("emptyDemo", demo);
bind("play", () => preview.play($("previewSound").checked)); bind("seek", event => preview.seek(Number(event.target.value)), "input"); bind("previewSound", () => preview.pause(), "change");
bind("applyOutput", () => { const output = Object.fromEntries(["width", "height", "fps"].map(name => [name, Number($(name).value)])); if (!Number.isInteger(output.width) || !Number.isInteger(output.height) || output.width < 16 || output.height < 16 || output.width > 7680 || output.height > 4320 || output.fps < 1 || output.fps > 120) throw new Error("输出尺寸需在 16～7680 × 16～4320 范围内，帧率为 1～120。"); return execute(command("media.project.set", { output })); });
bind("undo", () => { if (!job) return session.undo(); }); bind("redo", () => { if (!job) return session.redo(); });
bind("split", async () => { const clip = selectedClip(); if (!clip) throw new Error("请选择画面片段，并把播放头放到要分割的位置。"); await execute(command("media.clip.split", { id: clip.id, time: preview.time })); });
bind("duplicate", async () => {
  const item = selected(); if (!item) throw new Error("请先选择片段。");
  const id = uid("copy");
  await execute(command("media.item.duplicate", { section: selection.section, id: item.id, newId: id }));
  select(selection.section, id);
});
async function remove(ripple) { const item = selected(); if (!item) throw new Error("请选择要删除的片段。"); if (ripple && selection.section !== "clips") throw new Error("波纹删除从画面轨发起；普通删除不会移动其他内容。"); if (!await confirm(ripple ? "波纹删除" : "删除片段", ripple ? "删除该画面及关联音轨/字幕，并前移后续各轨道内容。与删除区间重叠的其他片段会阻止此次操作。支持撤销。" : "删除当前片段（画面片段的关联音轨/字幕也会删除），保留时间空隙。支持撤销。")) return; await execute(selection.section === "clips" ? command("media.clip.remove", { id: item.id, ripple }) : command("timeline.edit", { section: selection.section, remove: [item.id] })); }
bind("deleteClip", () => remove(false)); bind("rippleDelete", () => remove(true));
bind("addCaption", async () => { const id = uid("caption"), clip = selectedClip(); await execute(command("timeline.edit", { section: "captions", upsert: [{ id, text: "在这里输入字幕", start: preview.time, duration: clip && preview.time >= (clip.start || 0) && preview.time < endOf(clip) ? Math.min(3, endOf(clip) - preview.time) : 3, fontSize: 42, y: .9, laneId: laneId("caption"), ...(clip && preview.time >= (clip.start || 0) && preview.time < endOf(clip) ? { linkedClipId: clip.id } : {}) }] })); select("captions", id); });
async function addMusic() {
  const duration = Math.max(4, getTimelineDuration(session.document.timeline)), id = uid("music"), count = Math.ceil(duration / 2);
  await execute(command("timeline.edit", { section: "audio", upsert: [{ id, name: "电子合成配乐", start: 0, duration, gain: .18, fadeIn: .5, fadeOut: 1, laneId: laneId("audio"), ducking: { mode: "narration", gain: .25 }, recipe: { kind: "score", score: { version: 1, ppq: 480, tempos: [{ tick: 0, bpm: 120 }], tracks: [{ id: "keys", instrument: "soft-piano", notes: [60, 64, 67, 72].map((pitch, index) => ({ id: `n${index}`, tick: index * 480, duration: 440, pitch, velocity: .5 })) }], repeats: [{ startTick: 0, endTick: 1920, count: Math.max(1, count) }] } } }] })); select("audio", id);
}
bind("addMusic", addMusic); bind("narration", synthesizeNarration);
bind("aiSettings", async () => { const { editVideoAiSettings } = await import("./agent.js"); await editVideoAiSettings(); }); bind("runAi", generate); bind("cancelJob", () => job?.abort());
bind("loadJson", async () => { if (jsonDirty && !await confirm("重新读取 JSON", "这会覆盖尚未应用的 JSON 草稿，是否继续？")) return; const value = $("jsonScope").value === "shot" ? shotScene(selectedClip()) : session.snapshot(); if (!value) throw new Error("请选择原生 3D 镜头。"); $("jsonDraft").value = JSON.stringify(value, null, 2); jsonBase = session.revision; jsonOwner = { projectId, shotId: $("jsonScope").value === "shot" ? selectedClip().id : null }; jsonDirty = false; $("jsonStatus").textContent = `读取版本 ${jsonBase}。修改后点击“校验并应用”。`; });
bind("jsonDraft", () => { jsonDirty = true; }, "input");
bind("applyJson", async () => {
  if (!jsonOwner || jsonOwner.projectId !== projectId || jsonBase !== session.revision) throw new Error("工程版本已改变或未读取，请先备份草稿，再读取当前 JSON。");
  let value; try { value = JSON.parse($("jsonDraft").value); } catch (error) { $("jsonStatus").textContent = `JSON 格式错误：${error.message}`; throw error; }
  if (($("jsonScope").value === "shot") !== Boolean(jsonOwner.shotId)) throw new Error("编辑对象已切换，请先重新读取 JSON。");
  // Session validation is atomic; preview retains the last successful frame if a
  // resource cannot be loaded. No on-keystroke parse/load/overwrite loop.
  await execute(jsonOwner.shotId ? command("media.shot.put", { id: jsonOwner.shotId, scene: value }) : command("media.document.replace", { document: value }), { baseRevision: jsonBase });
  jsonBase = session.revision; jsonDirty = false; $("jsonStatus").textContent = `已应用版本 ${jsonBase}，可撤销。`;
});
document.querySelectorAll("[data-view]").forEach(node => { if (node.tagName !== "BUTTON") return; node.addEventListener("click", () => { document.querySelector(".workspace").dataset.view = node.dataset.view; document.querySelectorAll(".mobileTabs button").forEach(button => button.classList.toggle("active", button === node)); }); });
document.addEventListener("keydown", wrap(async event => {
  if (event.target.closest("input,textarea,select,[contenteditable=true]") || $("modal").open) return;
  if (event.code === "Space") { event.preventDefault(); await preview.play($("previewSound").checked); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !job) { event.preventDefault(); await (event.shiftKey ? session.redo() : session.undo()); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); await savePack(); }
}));
window.addEventListener("beforeunload", event => { if (job || jsonDirty || session && savedRevision !== session.revision) { event.preventDefault(); event.returnValue = ""; } });
document.addEventListener("visibilitychange", () => { if (document.hidden) preview.pause(); });

try {
  storage = await createEditorStorage();
  const params = new URLSearchParams(location.search), bridgeKey = params.get("sceneKey"), projectKey = params.get("projectKey");
  let initial, id;
  if (projectKey && params.get("openFrom") === "threebox") {
    const record = await storage.getHandoff(projectKey);
    if (record?.type === "video-project") initial = record.document;
  }
  if (bridgeKey && params.get("openFrom") === "threebox") {
    const key = `threejson.editor.openScene.${bridgeKey}`, raw = localStorage.getItem(key);
    if (raw) { const record = JSON.parse(raw); initial = record.sceneJson; localStorage.removeItem(key); }
  }
  if (!initial && !params.has("bridgeSession")) {
    const record = await storage.getProject(localStorage.getItem("threejson.videoEditor.lastProject") || "");
    if (record) { initial = record.document; id = record.id; }
  }
  await openProject(initial || emptyProject(), id);
  if (projectKey && initial) await storage.deleteHandoff(projectKey);
  document.documentElement.dataset.ready = "true";
  // Same-origin native bridge plus an origin/session-bound bridge for separately
  // deployed ThreeBox. The protocol implementation owns the allowlist.
  if (params.has("bridgeSession")) { const { receiveVideoProject } = await import("./transfer.js"); receiveVideoProject(async value => openProject(await ingestMediaDocument(value, storage))); }
} catch (error) { $("saveStatus").textContent = "初始化失败"; report(error); }
