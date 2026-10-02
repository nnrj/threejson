let currentClose = null;
export const loadMediaKit = () => import("@threejson/media-kit");
export const packMediaDocument = async (...args) => (await loadMediaKit()).packMediaDocument(...args);
export const createLocalNarrationHost = async () => (await import("./localSpeech.js")).createLocalNarrationHost();
export const createMediaAudioPlayback = async (...args) => (await import("@threejson/audio-kit")).createPcmPlayback(...args);
const documentDuration = (source) => (source.timeline?.duration ?? Math.max(0, ...(source.timeline?.clips || []).map(c => (c.start || 0) + c.duration), ...(source.timeline?.tracks || []).flatMap(t => (t.keyframes || []).map(k => k.time)))) || 8;
const save = (blob, name) => { const url=URL.createObjectURL(blob), a=document.createElement("a"); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); };

/** Shared native/React media dialog. Preview/export own an isolated runtime. */
export async function openSceneMediaStudio(source, options = {}) {
  if (!source) throw new Error("No scene document is available.");
  currentClose?.();
  const english = (options.language || document.documentElement.lang || navigator.language).startsWith("en");
  const text = (zh,en) => english ? en : zh;
  const previousFocus = document.activeElement, dialog = document.createElement("dialog");
  dialog.className = "threejsonMediaStudio";
  // Native Editor/Player predate the shared CSS tokens. Inherit their palette
  // instead of putting a bright dialog on a dark host; modern hosts keep tokens.
  const hostStyle = getComputedStyle(document.body), channels = hostStyle.backgroundColor.match(/[\d.]+/g)?.slice(0,3).map(Number);
  const dark = options.theme ? options.theme === "dark" : channels?.length === 3 ? channels.reduce((a,b)=>a+b,0)/3 < 128 : matchMedia("(prefers-color-scheme: dark)").matches;
  for (const [key,value] of Object.entries({ "--panel": dark?"#252a31":"#f7f7f8", "--panel2":dark?"#333b46":"#e9eaed", "--text":dark?"#ececec":"#20242a", "--line":dark?"#566170":"#ccd2dc" })) if(!hostStyle.getPropertyValue(key).trim())dialog.style.setProperty(key,value);
  dialog.style.colorScheme = dark ? "dark" : "light";
  dialog.setAttribute("aria-label",text("时间线与媒体导出","Timeline and media export"));
  const style = document.createElement("style");
  style.textContent = `.threejsonMediaStudio{box-sizing:border-box;width:min(860px,96vw);max-height:94dvh;overflow:auto;border:1px solid var(--line,#8885);border-radius:14px;padding:18px;background:var(--panel,#f7f7f8);color:var(--text,#20242a);font:14px/1.5 system-ui;scrollbar-width:thin}.threejsonMediaStudio::backdrop{background:#0009}.threejsonMediaStudio *{box-sizing:border-box}.threejsonMediaStudio header,.threejsonMediaStudio .mediaRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}.threejsonMediaStudio header strong{flex:1}.threejsonMediaStudio button,.threejsonMediaStudio select,.threejsonMediaStudio input{font:inherit;color:inherit;background:var(--panel2,#e9eaed);border:1px solid var(--line,#8885);border-radius:6px;padding:6px 10px;min-height:36px}.threejsonMediaStudio button{cursor:pointer}.threejsonMediaStudio button:disabled{opacity:.5;cursor:wait}.threejsonMediaStudio label{display:flex;align-items:center;gap:6px;flex:1;white-space:nowrap}.threejsonMediaStudio input[type=number]{width:90px}.threejsonMediaStudio canvas{width:100%;height:auto;display:block;background:#12141b;aspect-ratio:16/9;border-radius:8px}.threejsonMediaStudio input[type=range]{flex:1;min-width:100px}.threejsonMediaStudio .mediaStatus{min-height:24px;overflow-wrap:anywhere}.threejsonMediaStudio details{margin-top:12px}.threejsonMediaStudio progress{width:100%;accent-color:#5679d5}@media(max-width:520px){.threejsonMediaStudio{padding:12px}.threejsonMediaStudio label{flex-basis:45%}.threejsonMediaStudio button{min-height:42px}}`;
  dialog.append(style);
  const node = (tag, content, parent=dialog) => { const element=document.createElement(tag); if(content!==undefined)element.textContent=content; parent.append(element); return element; };
  const row = () => { const element=node("div");element.className="mediaRow";return element; };
  const header=node("header"); node("strong",text("时间线与媒体导出","Timeline & media export"),header);
  const close=node("button",text("关闭","Close"),header);close.type="button";
  const openFile=node("button",text("打开 JSON / .tjz","Open JSON / .tjz"),header),fileInput=node("input",undefined,header);fileInput.type="file";fileInput.accept=".json,.tjz";fileInput.hidden=true;
  openFile.onclick=()=>fileInput.click();fileInput.onchange=()=>{if(fileInput.files[0])void openSceneMediaStudio(fileInput.files[0],options);};
  const canvas=node("canvas"); canvas.width=640;canvas.height=360;
  const transport=row(),play=node("button",text("播放","Play"),transport),seek=node("input",undefined,transport),time=node("output","0.00 s",transport);
  seek.type="range";seek.min="0";seek.step="0.01";seek.value="0";seek.setAttribute("aria-label",text("场景时间","Scene time"));
  const settings=row();
  const field=(label,type,value)=>{const owner=node("label",label,settings),input=node("input",undefined,owner);input.type=type;input.value=String(value);input.min="1";return input;};
  const duration=field(text("时长（秒）","Seconds"),"number",documentDuration(source));duration.step="0.1";duration.min="0.1";
  const width=field(text("宽","Width"),"number",source.output?.width||1920),height=field(text("高","Height"),"number",source.output?.height||1080),fps=field("FPS","number",source.output?.fps||30);
  const actions=row(),format=node("select",undefined,actions);format.setAttribute("aria-label",text("导出格式","Export format"));
  for(const value of ["mp4","webm","gif","png","jpeg","webp"]){const item=node("option",value.toUpperCase(),format);item.value=value;}
  const exportButton=node("button",text("导出","Export"),actions),cancel=node("button",text("取消导出","Cancel export"),actions);cancel.hidden=true;
  const audioLabel=node("label",text("带音轨","Include audio"),actions),audio=node("input",undefined,audioLabel);audio.type="checkbox";audio.checked=true;
  const audioFileButton=node("button",text("导入配乐 / 旁白","Import music / voice"),actions),audioFile=node("input",undefined,actions);audioFile.type="file";audioFile.accept="audio/*";audioFile.hidden=true;
  let localAudioUrl=null;
  audioFileButton.onclick=()=>audioFile.click();
  audioFile.onchange=async()=>{if(busy||!ready||!audioFile.files[0])return;if(localAudioUrl)URL.revokeObjectURL(localAudioUrl);localAudioUrl=URL.createObjectURL(audioFile.files[0]);audioFileButton.textContent=audioFile.files[0].name;try{await preparePreview();}catch(error){fail(error);}};
  const progress=node("progress");progress.max=1;progress.value=0;progress.hidden=true;
  const status=node("div",text("准备场景…","Preparing scene…"));status.className="mediaStatus";status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const notice=node("p",text("导出在本机逐帧渲染，不调用 AI。GIF 无声音；PNG/JPEG/WebP 导出进度条当前时刻。跨域资源须允许读取。","Export renders locally frame by frame, without AI. GIF has no sound; images capture the selected time. Remote assets must permit cross-origin access."));notice.style.fontSize="12px";
  const summary=node("details");node("summary",text("片段与音轨","Clips and audio tracks"),summary);
  const listing=node("ul",undefined,summary);
  for(const clip of [...(source.timeline?.clips||[]),...(source.timeline?.audio||[])])node("li",`${clip.id}: ${clip.start||0}s → ${clip.duration??"auto"}s`,listing);
  if(!listing.children.length)node("li",text("单场景；可在 JSON 的 timeline 中编排。","Single scene; author tracks in JSON timeline."),listing);
  const models=node("details");node("summary",text("可选语音模型与缓存","Optional speech models & cache"),models);
  let modelPanel;
  models.addEventListener("toggle",async()=>{if(!models.open||models.dataset.loaded)return;models.dataset.loaded="yes";try{const {createAudioModelPanel}=await import("./audioModelPanel.js");if(!closed)modelPanel=createAudioModelPanel(models,{text,catalog:options.modelCatalog});}catch(error){fail(error);}});
  const lifecycle=new AbortController();let exportController, project, kit, playing=false, frame, closed=false, audioPlayback, mixer, startTime=0, offset=0, busy=false, ready=false, paintQueue=Promise.resolve(), paintId=0;
  play.disabled=true;exportButton.disabled=true;
  const stopAudio=()=>audioPlayback?.pause();
  const pause=()=>{playing=false;cancelAnimationFrame(frame);stopAudio();play.textContent=text("播放","Play");};
  const closeStudio=()=>{if(closed)return;closed=true;pause();lifecycle.abort();exportController?.abort();project?.dispose();audioPlayback?.dispose();modelPanel?.dispose();if(localAudioUrl)URL.revokeObjectURL(localAudioUrl);dialog.close();dialog.remove();if(currentClose===closeStudio)currentClose=null;previousFocus?.focus?.();};
  currentClose=closeStudio;close.onclick=closeStudio;dialog.addEventListener("cancel",event=>{event.preventDefault();closeStudio();});
  document.body.append(dialog);dialog.showModal();close.focus();
  const fail=(error)=>{if(!closed&&error?.name!=="AbortError")status.textContent=String(error.message||error);};
  const paint=(value)=>{const id=++paintId;paintQueue=paintQueue.catch(()=>{}).then(async()=>{if(closed||id!==paintId)return;await project.renderAt(Math.min(value,Math.max(0,project.duration-1e-6)));if(closed||id!==paintId)return;seek.value=String(value);time.textContent=`${value.toFixed(2)} s`;});return paintQueue;};
  async function playAudio(at){
    stopAudio(); if(!audio.checked||!mixer)return;
    audioPlayback??=(await import("@threejson/audio-kit")).createPcmPlayback(mixer,{onError:fail});
    if(playing&&!closed)await audioPlayback.play(at,{duration:Number(duration.value)});
  }
  const tick=async()=>{if(!playing||closed)return;const value=Math.min(Number(duration.value),audioPlayback?.playing?audioPlayback.time:offset+(performance.now()-startTime)/1000);try{await paint(value);}catch(error){pause();fail(error);return;}if(value>=Number(duration.value)){pause();return;}if(playing&&!closed)frame=requestAnimationFrame(tick);};
  play.onclick=async()=>{if(!ready||busy)return;if(playing){pause();return;}offset=Number(seek.value);if(offset>=Number(duration.value))offset=0;startTime=performance.now();playing=true;play.textContent=text("暂停","Pause");void playAudio(offset).catch(fail);void tick();};
  seek.oninput=()=>{pause();if(ready&&!busy)void paint(Number(seek.value)).catch(fail);};
  duration.onchange=()=>{if(ready&&!busy)void preparePreview().catch(fail);};
  format.onchange=()=>{const noAudio=["gif","png","jpeg","webp"].includes(format.value);audioLabel.hidden=noAudio;};
  audio.onchange=()=>{if(!audio.checked)stopAudio();};
  cancel.onclick=()=>exportController?.abort();
  exportButton.onclick=async()=>{
    if(busy||!ready)return;pause();exportController=new AbortController();busy=true;exportButton.disabled=true;play.disabled=true;cancel.hidden=false;progress.hidden=false;progress.value=0;
    let writable;
    try{
      // A file-backed target keeps long films out of a single in-memory Blob.
      // Unsupported browsers retain the explicit download fallback.
      if (["mp4","webm"].includes(format.value) && typeof showSaveFilePicker === "function") {
        const handle = await showSaveFilePicker({ suggestedName: `${options.name||"threejson-media"}.${format.value}`, types: [{ description: "Video", accept: { [`video/${format.value}`]: [`.${format.value}`] } }] });
        writable = await handle.createWritable();
      }
      const config={...options.exportOptions,width:Number(width.value),height:Number(height.value),fps:Number(fps.value),end:Number(duration.value),audio:audio.checked,audioClips:localAudioUrl?[{id:"$imported-audio",url:localAudioUrl}]:[],time:Number(seek.value),signal:exportController.signal,onProgress:(value)=>{progress.value=value.progress;status.textContent=`${Math.round(value.progress*100)}%`;}};
      if (writable) config.writable = writable;
      let result;
      if(["png","jpeg","webp"].includes(format.value))result=await kit.renderImage(source,{...config,type:`image/${format.value}`});
      else if(format.value==="gif")result=await kit.renderGif(source,config);
      else result=await kit.renderVideo(source,{...config,format:format.value});
      if(!closed){if(result.blob)save(result.blob,`${options.name||"threejson-media"}.${format.value}`);status.textContent=text("已导出。","Export complete.");}
    }catch(error){await writable?.abort().catch(()=>{});if(error.name==="AbortError")status.textContent=text("导出已取消。","Export cancelled.");else fail(error);}
    finally{busy=false;exportButton.disabled=false;play.disabled=false;cancel.hidden=true;progress.hidden=true;}
  };
  async function preparePreview() {
    pause();ready=false;play.disabled=true;exportButton.disabled=true;
    audioPlayback?.dispose();audioPlayback=null;
    await paintQueue.catch(()=>{});project?.dispose();
    const snapshot=structuredClone(source);seek.max=duration.value;
    canvas.style.aspectRatio=`${Number(width.value)} / ${Number(height.value)}`;
    project=await kit.createMediaProject(snapshot,{canvas,width:640,height:Math.round(640*Number(height.value)/Number(width.value)),duration:Number(duration.value),signal:lifecycle.signal,audioClips:localAudioUrl?[{id:"$imported-audio",url:localAudioUrl}]:[],...options.projectOptions});
    if(closed){project.dispose();return{close:closeStudio};}
    listing.replaceChildren();
    for(const clip of [...(project.document.timeline?.clips||[]),...(project.document.timeline?.audio||[])])node("li",`${clip.id}: ${clip.start||0}s → ${clip.duration??"auto"}s`,listing);
    if(!listing.children.length)node("li",text("单场景；可在 JSON 的 timeline 中编排。","Single scene; author tracks in JSON timeline."),listing);
    await paint(0);
    // A missing optional voice must not prevent viewing/exporting the picture.
    try { mixer=await kit.prepareProjectAudio(project,{signal:lifecycle.signal});status.textContent=mixer?.duration>Number(duration.value)+.1?text(`音轨长 ${mixer.duration.toFixed(2)} 秒，当前导出范围将裁剪结尾；可增加时长。`,`Audio is ${mixer.duration.toFixed(2)} seconds; the selected range trims its end. Increase duration to keep it.`):text("可播放、拖动时间或导出。","Ready to play, seek or export."); }
    catch(error){mixer=null;fail(error);}
    ready=true;play.disabled=false;exportButton.disabled=false;
  }
  try {
    kit=await (options.loadMediaKit?.() || import("@threejson/media-kit"));
    if(typeof source === "string" || source instanceof Blob){const opened=await kit.openMediaDocument(source,{signal:lifecycle.signal});duration.value=String(documentDuration(opened.document));for(const[key,field]of Object.entries({width,height,fps}))if(opened.document.output?.[key])field.value=String(opened.document.output[key]);opened.dispose();}
    await preparePreview();
  } catch(error){fail(error);}
  return {close:closeStudio};
}

/** SceneEditor edits a selected scene, never mis-parses a composition as a cube. */
export async function chooseMediaShot(source) {
  if (source.documentType !== "composition") return source;
  const dialog = document.createElement("dialog"), select = document.createElement("select"), label = document.createElement("label"), ok = document.createElement("button"), cancel = document.createElement("button");
  dialog.className = "threejsonMediaStudio"; dialog.style.cssText = "max-width:94vw;padding:20px;border-radius:12px;background:var(--panel,#252a31);color:var(--text,#eee);border:1px solid #8886";
  label.textContent = "选择要编辑的镜头 / Select a shot "; label.append(select);
  for (const clip of source.timeline.clips) { const option = document.createElement("option"); option.value = clip.id; option.textContent = `${source.production?.shots?.[clip.id]?.title || clip.id} · ${clip.start || 0}s`; select.append(option); }
  ok.textContent = "打开 / Open"; cancel.textContent = "取消 / Cancel"; dialog.append(label, ok, cancel); document.body.append(dialog); dialog.showModal();
  const id = await new Promise(resolve => { ok.onclick = () => resolve(select.value); cancel.onclick = () => resolve(null); dialog.oncancel = e => { e.preventDefault(); resolve(null); }; });
  dialog.close(); dialog.remove(); if (!id) return null;
  const clip = source.timeline.clips.find(c => c.id === id);
  if (typeof clip.source === "object") return structuredClone(clip.source);
  if (source.scenes?.[clip.source]) return structuredClone(source.scenes[clip.source]);
  throw new Error("External shot: open its JSON/.tjz source in SceneEditor.");
}
