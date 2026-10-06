import { createMediaNarrationPanel } from "./mediaNarrationPanel.js";

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
  style.textContent = `
    .threejsonMediaStudio{box-sizing:border-box;width:min(820px,96vw);max-height:94dvh;overflow:auto;border:1px solid var(--line,#8885);border-radius:14px;padding:18px;background:var(--panel,#f7f7f8);color:var(--text,#20242a);font:14px/1.5 system-ui;scrollbar-width:thin}
    .threejsonMediaStudio::backdrop{background:#0009}.threejsonMediaStudio *{box-sizing:border-box}.threejsonMediaStudio [hidden]{display:none!important}
    .threejsonMediaStudio header,.threejsonMediaStudio .mediaRow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}.threejsonMediaStudio header strong{flex:1}
    .threejsonMediaStudio button,.threejsonMediaStudio select,.threejsonMediaStudio input,.threejsonMediaStudio textarea{font:inherit;color:inherit;background:var(--panel2,#e9eaed);border:1px solid var(--line,#8885);border-radius:6px;padding:6px 10px;min-height:36px;max-width:100%}
    .threejsonMediaStudio button{cursor:pointer}.threejsonMediaStudio button:disabled{opacity:.5;cursor:wait}.threejsonMediaStudio button.primary{background:#4066bb;color:white;border-color:#4066bb;min-width:110px}
    .threejsonMediaStudio label{display:flex;align-items:center;gap:6px;flex:1 1 180px;min-width:0}.threejsonMediaStudio select{min-width:0}.threejsonMediaStudio input[type=number]{width:90px}.threejsonMediaStudio input[type=checkbox]{min-height:0}
    .threejsonMediaStudio .mediaChoices label{flex-direction:column;align-items:stretch}.threejsonMediaStudio .mediaChoices label:first-child{flex:0 1 120px}.threejsonMediaStudio .mediaChoices label:last-child{flex:1 1 230px}
    .threejsonMediaStudio canvas{width:100%;height:auto;max-height:35dvh;object-fit:contain;display:block;background:#080b13;aspect-ratio:16/9;border-radius:8px;margin-bottom:10px}.threejsonMediaStudio input[type=range]{flex:1;min-width:80px;padding:0}
    .threejsonMediaStudio .mediaStatus{min-height:24px;overflow-wrap:anywhere}.threejsonMediaStudio details{margin:12px 0}.threejsonMediaStudio summary{cursor:pointer}.threejsonMediaStudio p{font-size:12px;overflow-wrap:anywhere;opacity:.85}.threejsonMediaStudio textarea{width:100%;resize:vertical}
    .threejsonMediaStudio progress{width:100%;accent-color:#5679d5}.threejsonMediaStudio footer{position:sticky;bottom:-18px;background:var(--panel);padding:12px 0 4px;border-top:1px solid var(--line);z-index:1}.threejsonMediaStudio footer .mediaRow{justify-content:flex-end;margin:8px 0 0}
    @media(max-width:520px){.threejsonMediaStudio{padding:12px}.threejsonMediaStudio label{flex-basis:100%}.threejsonMediaStudio .mediaChoices label:first-child{flex:1 1 100%}.threejsonMediaStudio button,.threejsonMediaStudio select{min-height:42px}.threejsonMediaStudio footer{bottom:-12px}.threejsonMediaStudio canvas{max-height:28dvh}}
  `;
  dialog.append(style);
  const node = (tag, content, parent=dialog) => { const element=document.createElement(tag); if(content!==undefined)element.textContent=content; parent.append(element); return element; };
  const row = (parent=dialog) => { const element=node("div",undefined,parent);element.className="mediaRow";return element; };
  const header=node("header"); node("strong",text("时间线与媒体导出","Timeline & media export"),header);
  const close=node("button",text("关闭","Close"),header);close.type="button";
  const canvas=node("canvas"); canvas.width=640;canvas.height=360;
  const transport=row(),play=node("button",text("播放","Play"),transport),seek=node("input",undefined,transport),time=node("output","0.00 s",transport);
  seek.type="range";seek.min="0";seek.step="0.01";seek.value="0";seek.setAttribute("aria-label",text("场景时间","Scene time"));
  const choices=row();choices.classList.add("mediaChoices");
  const formatLabel=node("label",text("格式","Format"),choices),format=node("select",undefined,formatLabel);format.setAttribute("aria-label",text("导出格式","Export format"));
  for(const value of ["mp4","webm","gif","png","jpeg","webp"]){const item=node("option",value.toUpperCase(),format);item.value=value;}
  if (["mp4","webm","gif","png","jpeg","webp"].includes(options.initialFormat)) format.value=options.initialFormat;
  const audioLabel=node("label",text("声音","Sound"),choices),audio=node("select",undefined,audioLabel);
  audio.setAttribute("aria-label",text("声音","Sound"));
  for(const[value,label]of[["auto",text("自动旁白＋原有音轨（默认）","Automatic narration + existing audio (default)")],["existing",text("仅原有音轨","Existing audio only")],["mute",text("静音","Mute")]])node("option",label,audio).value=value;
  const audioHint=node("p",text("正在读取字幕和台词…","Reading captions and narration…"));audioHint.className="mediaAudioHint";
  const advanced=node("details");advanced.className="mediaAdvanced";node("summary",text("更多设置","More settings"),advanced);
  const settings=row(advanced);
  const field=(label,type,value)=>{const owner=node("label",label,settings),input=node("input",undefined,owner);input.type=type;input.value=String(value);input.min="1";return input;};
  const duration=field(text("时长（秒）","Seconds"),"number",documentDuration(source));duration.step="0.1";duration.min="0.1";
  const width=field(text("宽","Width"),"number",source.output?.width||1920),height=field(text("高","Height"),"number",source.output?.height||1080),fps=field("FPS","number",source.output?.fps||30);
  const imports=row(advanced);
  const openFile=node("button",text("打开 JSON / .tjz","Open JSON / .tjz"),imports),fileInput=node("input",undefined,imports);fileInput.type="file";fileInput.accept=".json,.tjz";fileInput.hidden=true;
  openFile.onclick=()=>fileInput.click();fileInput.onchange=()=>{if(fileInput.files[0])void openSceneMediaStudio(fileInput.files[0],options);};
  const audioFileButton=node("button",text("导入配乐 / 旁白","Import music / voice"),imports),audioFile=node("input",undefined,imports);audioFile.type="file";audioFile.accept="audio/*";audioFile.hidden=true;
  let localAudioUrl=null;
  audioFileButton.onclick=()=>audioFile.click();
  audioFile.onchange=async()=>{if(busy||!ready||!audioFile.files[0])return;if(localAudioUrl)URL.revokeObjectURL(localAudioUrl);localAudioUrl=URL.createObjectURL(audioFile.files[0]);audioFileButton.textContent=audioFile.files[0].name;try{await preparePreview();}catch(error){fail(error);}};
  node("p",text("导出在本机完成，不调用付费接口。GIF 无声音；PNG/JPEG/WebP 导出当前时刻。跨域资源须允许读取。","Export runs locally without paid APIs. GIF has no sound; images capture the selected time. Remote assets must permit cross-origin access."),advanced);
  const summary=node("details",undefined,advanced);node("summary",text("片段与音轨","Clips and audio tracks"),summary);
  const listing=node("ul",undefined,summary);
  for(const clip of [...(source.timeline?.clips||[]),...(source.timeline?.audio||[])])node("li",`${clip.id}: ${clip.start||0}s → ${clip.duration??"auto"}s`,listing);
  if(!listing.children.length)node("li",text("单场景；可在 JSON 的 timeline 中编排。","Single scene; author tracks in JSON timeline."),listing);
  const narrationSection=node("details",undefined,advanced); narrationSection.className="mediaNarration";node("summary",text("旁白设置与文本","Narration settings and script"),narrationSection);
  const models=node("details",undefined,advanced);node("summary",text("高级：语音资源与缓存","Advanced: speech resources and cache"),models);
  let modelPanel, narrationPanel;
  models.addEventListener("toggle",async()=>{if(!models.open||models.dataset.loaded)return;models.dataset.loaded="yes";try{const {createAudioModelPanel}=await import("./audioModelPanel.js");if(!closed){modelPanel=createAudioModelPanel(models,{text,catalog:options.modelCatalog});modelPanel.setDisabled(busy);}}catch(error){delete models.dataset.loaded;fail(error);}});
  const footer=node("footer"),progress=node("progress",undefined,footer);progress.max=1;progress.value=0;progress.hidden=true;
  const status=node("div",text("准备场景…","Preparing scene…"),footer);status.className="mediaStatus";status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const actions=row(footer),exportButton=node("button",text("导出","Export"),actions),cancel=node("button",text("取消","Cancel"),actions);cancel.hidden=true;exportButton.className="primary";
  const lifecycle=new AbortController();let exportController, project, kit, playing=false, frame, closed=false, audioPlayback, playbackContext, mixer, previewNarrationClips, previewAudioError, startTime=0, offset=0, busy=false, ready=false, paintQueue=Promise.resolve(), paintId=0, narrationSummary={cues:0};
  play.disabled=true;exportButton.disabled=true;
  const stopAudio=()=>audioPlayback?.pause();
  const pause=()=>{playing=false;cancelAnimationFrame(frame);stopAudio();play.textContent=text("播放","Play");};
  const closeStudio=()=>{if(closed)return;closed=true;pause();lifecycle.abort();exportController?.abort();narrationPanel?.dispose();project?.dispose();audioPlayback?.dispose();void playbackContext?.close();modelPanel?.dispose();if(localAudioUrl)URL.revokeObjectURL(localAudioUrl);dialog.close();dialog.remove();if(currentClose===closeStudio)currentClose=null;previousFocus?.focus?.();};
  currentClose=closeStudio;close.onclick=closeStudio;dialog.addEventListener("cancel",event=>{event.preventDefault();closeStudio();});
  document.body.append(dialog);dialog.showModal();close.focus();
  const fail=(error)=>{if(!closed&&error?.name!=="AbortError")status.textContent=String(error.message||error);};
  const isVideo=()=>["mp4","webm"].includes(format.value);
  const extraAudio=()=>[...(localAudioUrl?[{id:"$imported-audio",url:localAudioUrl}]:[]),...(audio.value==="auto"?narrationPanel?.getAudioClips()||[]:[])];
  const updateAudioHint=()=>{
    if(!isVideo())audioHint.textContent=text("此格式不含声音。","This format has no audio.");
    else if(audio.value==="mute")audioHint.textContent=text("将导出无声视频。","The exported video will be silent.");
    else if(audio.value==="existing")audioHint.textContent=mixer?text("保留已有配乐和旁白，不自动朗读字幕。","Keep existing music and speech; do not read captions."):text("当前没有原有音轨，此选项将导出无声视频。","No existing audio: this option will export a silent video.");
    else if(narrationSummary.cues)audioHint.textContent=narrationSummary.prepared?text(`已准备 ${narrationSummary.cues} 段旁白，导出时保留原有音轨。`,`${narrationSummary.cues} narration cues ready; existing audio will be kept.`):text(`将自动朗读 ${narrationSummary.cues} 段字幕/台词。`,`Automatically read ${narrationSummary.cues} captions/narration cues. `)+(options.createNarrationHost?text("播放或导出时自动调用宿主配音引擎。","Play/export automatically uses the host speech engine."):text("首次播放或导出需下载约 71 MiB 配音资源，之后使用缓存，无需安装或手动生成。","First play/export downloads about 71 MiB of cached speech resources. No installation or separate generation step."));
    else audioHint.textContent=narrationSummary.skipped?text("已有旁白，不重复合成；保留原有音轨。","Narration already exists; keep audio without doubling it."):mixer?text("未发现可朗读文本，保留原有音轨。","No narration text found; keep existing audio."):text("未发现字幕、台词或音轨，导出将无声；可在更多设置中填写旁白或导入配音。","No captions, narration or audio found; export will be silent. Add narration text or import audio in More settings.");
  };
  const syncBusy=()=>{
    play.disabled=exportButton.disabled=busy||!ready;
    for(const input of [openFile,duration,width,height,fps,format,audio,audioFileButton,seek])input.disabled=busy||!ready;
    modelPanel?.setDisabled(busy);
    narrationPanel?.setState({ready,busy:busy||!ready});
  };
  const paint=(value)=>{const id=++paintId;paintQueue=paintQueue.catch(()=>{}).then(async()=>{if(closed||id!==paintId)return;await project.renderAt(Math.min(value,Math.max(0,project.duration-1e-6)));if(closed||id!==paintId)return;seek.value=String(value);time.textContent=`${value.toFixed(2)} s`;});return paintQueue;};
  async function playAudio(at){
    stopAudio(); if(audio.value==="mute"||!isVideo()||!mixer)return;
    audioPlayback??=(await import("@threejson/audio-kit")).createPcmPlayback(mixer,{context:playbackContext,onError:fail});
    if(playing&&!closed)await audioPlayback.play(at,{duration:Number(duration.value)});
  }
  const tick=async()=>{if(!playing||closed)return;const value=Math.min(Number(duration.value),audioPlayback?.playing?audioPlayback.time:offset+(performance.now()-startTime)/1000);try{await paint(value);}catch(error){pause();fail(error);return;}if(value>=Number(duration.value)){pause();return;}if(playing&&!closed)frame=requestAnimationFrame(tick);};
  const beginOperation=()=>{exportController=new AbortController();busy=true;syncBusy();cancel.hidden=false;progress.hidden=false;progress.removeAttribute("value");return AbortSignal.any([exportController.signal,lifecycle.signal]);};
  const finishOperation=()=>{busy=false;if(!closed){syncBusy();cancel.hidden=true;progress.hidden=true;}};
  const narrationProgress=value=>{
    if(closed)return;
    if(value.stage==="model-download"){
      progress.value=value.progress;
      status.textContent=text(`首次准备配音资源：${(value.loaded/1048576).toFixed(1)} / ${(value.total/1048576).toFixed(1)} MiB，下载后自动继续…`,`Preparing speech resources: ${(value.loaded/1048576).toFixed(1)} / ${(value.total/1048576).toFixed(1)} MiB; continuing automatically…`);
    }else if(value.stage==="narration"){
      progress.value=(value.cue-1)/value.cues;
      status.textContent=text(`正在本机配音 ${value.cue}/${value.cues}…`,`Generating local narration ${value.cue}/${value.cues}…`);
    }else{progress.removeAttribute("value");status.textContent=text("正在准备自动旁白…","Preparing automatic narration…");}
  };
  const prepareNarration=signal=>isVideo()&&audio.value==="auto"?narrationPanel.prepare({signal,onProgress:narrationProgress}):Promise.resolve();
  play.onclick=async()=>{
    if(!ready||busy)return;if(playing){pause();return;}
    const at=Number(seek.value)>=Number(duration.value)?0:Number(seek.value),signal=beginOperation();
    try{
      // Resume in the click gesture, before potentially lengthy speech synthesis.
      if(isVideo()&&audio.value!=="mute"){
        const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
        if(Context){playbackContext??=new Context();await playbackContext.resume();}
      }
      await prepareNarration(signal);signal.throwIfAborted();
      // Adding generated speech only changes the mixer. Don't reload geometry,
      // textures or WebGL contexts every time the user presses Play.
      const currentClips=narrationPanel.getAudioClips();
      if(isVideo()&&audio.value!=="mute"&&(!mixer||audio.value==="auto"&&currentClips!==previewNarrationClips&&(currentClips.length||previewNarrationClips?.length))){
        audioPlayback?.dispose();audioPlayback=null;mixer=null;
        const clips=[...(await project.getAudioClips()).filter(clip=>clip.id!=="$imported-audio"&&!clip.id?.startsWith("$export-narration-")),...extraAudio()];
        mixer=await kit.prepareProjectAudio({resolveAsset:project.resolveAsset,getAudioClips:async()=>clips},{signal});
        previewNarrationClips=currentClips;previewAudioError=null;
        listing.replaceChildren();for(const clip of[...(project.document.timeline?.clips||[]),...clips])node("li",`${clip.id}: ${clip.start||0}s → ${clip.duration??"auto"}s`,listing);
      }
      if(previewAudioError&&audio.value!=="mute"&&isVideo())throw previewAudioError;
      signal.throwIfAborted();offset=at;await paint(at);startTime=performance.now();playing=true;play.textContent=text("暂停","Pause");await playAudio(offset);void tick();
    }catch(error){pause();if(!closed){if(error.name==="AbortError")status.textContent=text("已取消。","Cancelled.");else fail(error);}}
    finally{finishOperation();}
  };
  seek.oninput=()=>{pause();if(ready&&!busy)void paint(Number(seek.value)).catch(fail);};
  duration.onchange=()=>{if(ready&&!busy)void preparePreview().catch(fail);};
  format.onchange=()=>{pause();audioLabel.hidden=!isVideo();narrationSection.hidden=!isVideo()||audio.value!=="auto";updateAudioHint();};format.onchange();
  audio.onchange=()=>{pause();narrationSection.hidden=audio.value!=="auto";updateAudioHint();if(ready&&!busy)void preparePreview().catch(fail);};
  cancel.onclick=()=>exportController?.abort();
  exportButton.onclick=async()=>{
    if(busy||!ready)return;pause();const signal=beginOperation();
    let writable;
    try{
      // A file-backed target keeps long films out of a single in-memory Blob.
      // Unsupported browsers retain the explicit download fallback.
      if (["mp4","webm"].includes(format.value) && typeof showSaveFilePicker === "function") {
        const handle = await showSaveFilePicker({ suggestedName: `${options.name||"threejson-media"}.${format.value}`, types: [{ description: "Video", accept: { [`video/${format.value}`]: [`.${format.value}`] } }] });
        writable = await handle.createWritable();
      }
      signal.throwIfAborted();
      for(const field of[duration,width,height,fps])if(!field.checkValidity())throw new Error(text("请检查时长、尺寸和帧率。","Check duration, dimensions and frame rate."));
      await prepareNarration(signal);signal.throwIfAborted();
      progress.value=0;status.textContent=text("正在渲染并封装视频…","Rendering and encoding…");
      const config={...options.exportOptions,width:Number(width.value),height:Number(height.value),fps:Number(fps.value),end:Number(duration.value),audio:audio.value!=="mute",audioClips:[...(options.exportOptions?.audioClips||[]),...extraAudio()],time:Number(seek.value),signal,onProgress:(value)=>{if(!closed){progress.value=value.progress;status.textContent=text(`正在导出 ${Math.round(value.progress*100)}%`,`Exporting ${Math.round(value.progress*100)}%`);}}};
      if (writable) config.writable = writable;
      let result;
      if(["png","jpeg","webp"].includes(format.value))result=await kit.renderImage(source,{...config,type:`image/${format.value}`});
      else if(format.value==="gif")result=await kit.renderGif(source,config);
      else result=await kit.renderVideo(source,{...config,format:format.value});
      if(!closed){if(result.blob)save(result.blob,`${options.name||"threejson-media"}.${format.value}`);status.textContent=text("已导出。","Export complete.");}
    }catch(error){await writable?.abort().catch(()=>{});if(error.name==="AbortError")status.textContent=text("导出已取消。","Export cancelled.");else fail(error);}
    finally{finishOperation();}
  };
  async function preparePreview(signal=lifecycle.signal) {
    pause();ready=false;syncBusy();
    audioPlayback?.dispose();audioPlayback=null;
    await paintQueue.catch(()=>{});project?.dispose();
    const snapshot=structuredClone(source);seek.max=duration.value;
    canvas.style.aspectRatio=`${Number(width.value)} / ${Number(height.value)}`;
    project=await kit.createMediaProject(snapshot,{canvas,width:640,height:Math.round(640*Number(height.value)/Number(width.value)),duration:Number(duration.value),...options.projectOptions,signal,audioClips:[...(options.projectOptions?.audioClips||[]),...extraAudio()]});
    if(closed){project.dispose();return{close:closeStudio};}
    listing.replaceChildren();
    for(const clip of [...(project.document.timeline?.clips||[]),...await project.getAudioClips()])node("li",`${clip.id}: ${clip.start||0}s → ${clip.duration??"auto"}s`,listing);
    if(!listing.children.length)node("li",text("单场景；可在 JSON 的 timeline 中编排。","Single scene; author tracks in JSON timeline."),listing);
    await paint(0);
    // A missing optional voice must not prevent viewing/exporting the picture.
    let audioError;
    try { mixer=audio.value==="mute"||!isVideo()?null:await kit.prepareProjectAudio(project,{signal});status.textContent=mixer?.duration>Number(duration.value)+.1?text(`音轨长 ${mixer.duration.toFixed(2)} 秒，当前导出范围将裁剪结尾；可增加时长。`,`Audio is ${mixer.duration.toFixed(2)} seconds; the selected range trims its end. Increase duration to keep it.`):text("可播放、拖动时间或直接导出。","Ready to play, seek or export."); }
    catch(error){mixer=null;audioError=error;fail(error);}
    if(closed)return;
    previewNarrationClips=narrationPanel?.getAudioClips();previewAudioError=audioError;
    ready=true;syncBusy();updateAudioHint();void narrationPanel?.refreshScript();return {audioError};
  }
  try {
    kit=await (options.loadMediaKit?.() || import("@threejson/media-kit"));
    if(typeof source === "string" || source instanceof Blob){const opened=await kit.openMediaDocument(source,{signal:lifecycle.signal});duration.value=String(documentDuration(opened.document));for(const[key,field]of Object.entries({width,height,fps}))if(opened.document.output?.[key])field.value=String(opened.document.output[key]);opened.dispose();}
    if(closed)return {close:closeStudio};
    narrationPanel=createMediaNarrationPanel(narrationSection,{text,signal:lifecycle.signal,loadMediaKit:()=>kit,
      createNarrationHost:options.createNarrationHost,projectOptions:options.projectOptions,
      getSource:()=>source,getDuration:()=>Number(duration.value),getAudioClips:async()=>[...(await project?.getAudioClips()||[]).filter(clip=>!clip.id?.startsWith("$export-narration-")),...(options.exportOptions?.audioClips||[])],
      onSummary:value=>{narrationSummary=value;updateAudioHint();},onError:fail,
      onChange:async()=>{const result=await preparePreview();if(result?.audioError)throw result.audioError;}});
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
