import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";
import { getBuiltinAudioModels, createAudioModelManager } from "../../packages/audio-kit/js/models.js";
import { createNodeAudioModelStorage } from "../../packages/audio-kit/js/nodeModels.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."), out = path.join(root, "dist/video-editor-verification", new Date().toISOString().replaceAll(":", "-"));
await fs.mkdir(out, { recursive: true });
let installed, worker;
if (process.argv.includes("--speech")) {
  const manager = createAudioModelManager(await createNodeAudioModelStorage(path.join(root, "dist/local-chinese-tts/model-cache")));
  installed = await manager.status(getBuiltinAudioModels()[0]); manager.close();
  if (installed.status !== "ready") throw new Error("--speech requires the previously installed pinned test voice. This test never downloads it.");
  worker = await build({ entryPoints: [path.join(root, "packages/audio-kit/js/meloWorker.js")], bundle: true, format: "esm", write: false, logLevel: "silent" });
}
const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
  import './tools/scene-host/video-editor/js/app.js';
  import * as kit from './packages/media-kit/js/index.js';
  import * as codecs from 'mediabunny';
  import {createEditorStorage} from './tools/scene-host/shared/js/videoProjectStorage.js';
  window.videoTest={kit,codecs,createEditorStorage};
` }, bundle: true, format: "esm", write: false, logLevel: "silent", plugins: [{ name: "keep-editor-entry", setup(build) { build.onResolve({ filter: /\/video-editor\/js\/app\.js$/ }, args => ({ path: path.resolve(args.resolveDir, args.path), sideEffects: true })); } }] });
await fs.writeFile(path.join(out, "editor-bundle.js"), bundle.outputFiles[0].text);
console.log("Bundle", bundle.outputFiles.map(file => [file.path, file.text.length, file.text.slice(0, 70)]));
const editorHtml = await fs.readFile(path.join(root, "tools/scene-host/video-editor/index.html"), "utf8");
const sceneEditorBundle = await build({ absWorkingDir: root, entryPoints: ["tools/scene-host/editor/js/main.js"], bundle: true, format: "esm", write: false, logLevel: "silent", external: ["codemirror", "@codemirror/*"] });
const sceneEditorHtml = await fs.readFile(path.join(root, "tools/scene-host/editor/index.html"), "utf8");
const { server, port } = await startStaticServer(root); let browser;
const errors = [], external = [], results = [], localModelRequests = [];
const externalRoute = route => {
  const file = installed?.manifest.files.find(file => file.url === route.request().url());
  if (file) { localModelRequests.push(file.role); return route.fulfill({ path: path.join(root, "dist/local-chinese-tts/model-cache", file.storageKey), contentType: "application/octet-stream", headers: { "Access-Control-Allow-Origin": "*" } }); }
  external.push(route.request().url()); return route.abort();
};
try {
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "zh-CN" });
  page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(30000);
  page.on("console", message => { if (message.type() === "error" || message.text().includes("video-editor")) console.log("browser:", message.text()); });
  page.on("pageerror", error => { errors.push(error.message); console.log("pageerror:", error.stack); });
  page.on("dialog", async dialog => { errors.push(`Native dialog: ${dialog.type()}`); await dialog.dismiss(); });
  await page.context().route(/^https?:\/\/(?!127\.0\.0\.1:)/, externalRoute);
  await page.context().route("**/editor/index.html**", route => route.fulfill({ contentType: "text/html", body: sceneEditorHtml.replace(/<script type="importmap">[\s\S]*?<\/script>/, "").replace('./js/main.js', '/__scene-editor.js') }));
  await page.context().route("**/__scene-editor.js", route => route.fulfill({ contentType: "text/javascript", body: sceneEditorBundle.outputFiles[0].text }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, externalRoute);
  if (worker) await page.route("**/meloWorker.js", route => route.fulfill({ contentType: "text/javascript", body: worker.outputFiles[0].text }));
  await page.route("**/video-editor/index.html**", route => route.fulfill({ contentType: "text/html", body: editorHtml.replace(/<script type="importmap">[\s\S]*?<\/script>/, "").replace('./js/app.js', '/__video-editor.js') }));
  await page.route("**/__video-editor.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto(`http://127.0.0.1:${port}/tools/scene-host/video-editor/index.html`);
  try { await page.waitForFunction(() => document.documentElement.dataset.ready === "true"); }
  catch (error) { console.log("startup", await page.evaluate(() => ({ title: document.title, scripts: [...document.scripts].map(s => s.src), text: document.body.innerText })), errors, external); throw error; }
  console.log("Editor ready");
  const menuAction = async (menu, action) => {
    await page.locator("#menubar").getByRole("menuitem", { name: menu, exact: true }).click();
    await page.locator(`#menuPopup [data-action="${action}"]`).click();
  };
  await page.locator("#emptyDemo").click();
  await page.waitForFunction(() => document.getElementById("projectInfo").textContent.includes("2 个片段"));
  await page.waitForFunction(() => document.getElementById("previewStatus").textContent === "预览已更新");
  await page.screenshot({ path: path.join(out, "desktop.png") });
  assert.equal(await page.evaluate(() => { const c=document.getElementById('preview'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let bright=0;for(let i=0;i<d.length;i+=4)if(d[i]+d[i+1]+d[i+2]>160)bright++;return bright>1000; }), true);
  results.push("Real 3D preview contains visible pixels");
  console.log(results.at(-1));
  // Actual playback mixes the procedural score; no TTS download/AI on open.
  await page.locator("#play").click(); await page.waitForFunction(() => Number(document.getElementById("seek").value) > .2); await page.locator("#play").click();
  await page.locator('[data-id="intro"]').click();
  await page.locator("#seek").evaluate(node => { node.value=3;node.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.locator("#split").click(); await page.waitForFunction(() => document.getElementById("projectInfo").textContent.includes("3 个片段"));
  await page.locator("#undo").click(); await page.waitForFunction(() => document.getElementById("projectInfo").textContent.includes("2 个片段"));
  await page.locator("#redo").click(); await page.waitForFunction(() => document.getElementById("projectInfo").textContent.includes("3 个片段"));
  results.push("Split/undo/redo share project history");
  console.log(results.at(-1));
  await page.locator('[data-mode="mixed"]').click(); await page.locator("#loadJson").click();
  const original = await page.locator("#jsonDraft").inputValue();
  await page.locator("#jsonDraft").fill('{"broken":'); await page.locator("#applyJson").click();
  assert.match(await page.locator("#jsonStatus").textContent(), /格式错误/);
  await page.locator("#jsonDraft").fill(original.replace('第一个故事 · 时间与形状','已编辑的视频工程')); await page.locator("#applyJson").click();
  await page.waitForFunction(() => document.getElementById("projectName").value === "已编辑的视频工程");
  await page.waitForFunction(() => document.getElementById("saveStatus").textContent.includes("已保存"));
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  assert.equal(await page.locator("#projectName").inputValue(), "已编辑的视频工程");
  results.push("Invalid JSON does not commit; valid edit/autosave survives reload");
  await page.locator('[data-mode="video"]').click();
  // Exercise the real scene editor, not a mock return event.
  await page.evaluate(() => localStorage.setItem('sceneEditor_settings_v1', JSON.stringify({general:{defaultSceneUrl:'data:application/json,'+encodeURIComponent(JSON.stringify({version:'next',sceneConfig:{},objectList:[]})),newSceneIncludeFloor:false},session:{promptOnBootRestore:false,openLastSceneOnStartup:false},ai:{providers:[{id:'fixture',provider:'custom',apiKey:'',model:'fixture'}],defaultProviderId:'fixture'}})));
  await page.locator('[data-id="intro"]').click();
  const [popup] = await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'3D 镜头编辑',exact:true}).click()]);
  popup.setDefaultTimeout(30000); popup.on('pageerror',error=>{errors.push(error.message);console.log('scene-editor:',error.message)});
  await popup.waitForFunction(()=>window.sceneEditor?.getEditorCommandApi && [...document.querySelectorAll('button')].some(b=>b.textContent==='应用到视频工程'));
  await popup.evaluate(async()=>{
    const text=await window.sceneEditor.getScenePayloadJsonTextForPersistViewEdit();
    const value=JSON.parse(text);value.name='edited-shot-roundtrip';
    const subject=value.objectList.find(o=>o.threeJsonId==='subject');subject.position={x:1,y:0,z:0};
    await window.sceneEditor.ingestScenePayloadFromParsedJson(value,'返回测试');
  });
  await popup.getByRole('button',{name:'应用到视频工程',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('镜头修改已应用'));
  await page.locator('[data-mode="mixed"]').click(); await page.locator('#loadJson').click();
  const returned=JSON.parse(await page.locator('#jsonDraft').inputValue()),returnedClip=returned.timeline.clips.find(c=>c.id==='intro');
  assert.equal(returned.scenes[returnedClip.source].objectList.find(o=>o.threeJsonId==='subject').position.x,1);
  assert.ok(returned.scenes[returnedClip.source].timeline.tracks.length,'Shot timeline must survive deep editing');
  await popup.close(); results.push('Actual scene-editor roundtrip preserves timeline and commits one reversible shot change');
  // Workbench modes share one canvas/session; changing layout must not apply drafts.
  const unchanged = await page.locator("#jsonDraft").inputValue();
  for (const mode of ["code", "video", "mixed"]) {
    await page.locator(`button[data-mode="${mode}"]`).click();
    assert.equal(await page.locator(".previewPanel").isVisible(), mode !== "code");
    assert.equal(await page.locator(".codePanel").isVisible(), mode !== "video");
    assert.equal(await page.locator("#jsonDraft").inputValue(), unchanged);
  }
  await page.locator("#workspaceDivider").focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#workspaceDivider").getAttribute("aria-valuenow"), "55");
  await page.screenshot({ path: path.join(out, "mixed.png") });
  await page.locator('button[data-mode="code"]').click();
  await page.screenshot({ path: path.join(out, "code.png") });
  await page.locator('button[data-mode="mixed"]').click();
  // Keyboard navigation, disabled-state dispatch and outside-click dismissal.
  await page.locator("#menubar").getByRole("menuitem", { name: "文件", exact: true }).click();
  assert.equal(await page.locator("#menuPopup").getAttribute("aria-label"), "文件菜单");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#menuPopup").getAttribute("aria-label"), "编辑菜单");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#menuPopup").isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "编辑");
  await page.locator("#menubar").getByRole("menuitem", { name: "AI", exact: true }).click();
  assert.equal(await page.locator('#menuPopup [data-action="cancelJob"]').isDisabled(), true);
  await page.locator(".codeHeading").click();
  assert.equal(await page.locator("#menuPopup").isVisible(), false);
  // Sequence settings commit through the same undo stack and sync pristine JSON.
  await menuAction("序列", "outputSettings");
  await page.getByLabel("帧率（FPS）", { exact: true }).fill("24");
  await page.locator("#modalActions button").click();
  await page.waitForFunction(() => JSON.parse(document.getElementById("jsonDraft").value).output.fps === 24);
  assert.equal(JSON.parse(await page.locator("#jsonDraft").inputValue()).output.fps, 24);
  await menuAction("编辑", "undo");
  await page.waitForFunction(() => JSON.parse(document.getElementById("jsonDraft").value).output.fps === 30);
  assert.equal(JSON.parse(await page.locator("#jsonDraft").inputValue()).output.fps, 30);
  await menuAction("视图", "toggleInspector");
  assert.equal(await page.locator(".inspector").isVisible(), false);
  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.ready === "true");
  assert.equal(await page.locator(".workspace").getAttribute("data-mode"), "mixed");
  assert.equal(await page.locator(".inspector").isVisible(), false);
  assert.equal(await page.locator("#workspaceDivider").getAttribute("aria-valuenow"), "55");
  await menuAction("视图", "toggleInspector");
  results.push("Menus support keyboard, dismissal, disabled commands; modes and splitter persist without project mutations");

  const cleanJson = await page.locator("#jsonDraft").inputValue();
  const brokenDocument = JSON.parse(cleanJson); brokenDocument.timeline.clips[0].duration = -2;
  await page.locator("#jsonDraft").fill(JSON.stringify(brokenDocument)); await page.locator("#applyJson").click();
  await page.waitForFunction(() => document.getElementById("jsonStatus").textContent.includes("校验未通过"));
  assert.match(await page.locator("#jsonStatus").textContent(), /校验未通过/);
  assert.equal(await page.locator("#projectName").inputValue(), "已编辑的视频工程");
  const dirtyDraft = cleanJson.replace("已编辑的视频工程", "只在草稿中的标题");
  await page.locator("#jsonDraft").fill(dirtyDraft);
  await page.keyboard.press("Alt+1"); await page.keyboard.press("Alt+3");
  assert.equal(await page.locator("#jsonDraft").inputValue(), dirtyDraft);
  assert.equal(await page.locator("#draftBadge").isVisible(), true);
  await menuAction("文件", "saveJson");
  assert.equal(await page.locator("#modalTitle").textContent(), "JSON 草稿尚未应用");
  await page.locator("#modalActions button[value=cancel]").click();
  assert.equal(await page.locator("#jsonDraft").inputValue(), dirtyDraft);
  await page.locator("#addCaption").click();
  await page.waitForFunction(() => document.getElementById("jsonStatus").dataset.state === "stale");
  assert.equal(await page.locator("#applyJson").isDisabled(), true);
  assert.match(await page.locator("#jsonStatus").textContent(), /工程已发生改变/);
  await page.locator("#jsonScope").selectOption("shot");
  await page.locator("#modalActions button[value=cancel]").click();
  assert.equal(await page.locator("#jsonScope").inputValue(), "project");
  assert.equal(await page.locator("#jsonDraft").inputValue(), dirtyDraft);
  const [draftDownload] = await Promise.all([page.waitForEvent("download"), menuAction("编辑", "downloadDraft")]);
  assert.match(draftDownload.suggestedFilename(), /-draft\.json$/);
  await page.locator("#loadJson").click(); await page.locator("#modalActions button[value=ok]").click();
  await page.waitForFunction(() => document.getElementById("draftBadge").hidden);
  assert.equal(await page.locator("#draftBadge").isVisible(), false);
  assert.ok(JSON.parse(await page.locator("#jsonDraft").inputValue()).timeline.captions.length);
  await menuAction("编辑", "undo");
  await page.waitForFunction(value => document.getElementById("jsonDraft").value === value, cleanJson);
  assert.equal(await page.locator("#jsonDraft").inputValue(), cleanJson);
  // Dirty per-shot drafts stay bound to the original clip after selection moves.
  await page.locator('[data-id="intro"]').click();
  await menuAction("片段", "editShotJson");
  await page.waitForFunction(() => document.getElementById("jsonScope").value === "shot");
  const shot = JSON.parse(await page.locator("#jsonDraft").inputValue()); shot.name = "只改原镜头";
  await page.locator("#jsonDraft").fill(JSON.stringify(shot));
  await page.locator('[data-id="final"]').click();
  assert.match(await page.locator("#jsonTarget").textContent(), /intro.*已固定/);
  await page.locator("#jsonDraft").focus(); await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => document.getElementById("jsonStatus").textContent.includes("已应用版本"));
  await page.locator("#jsonScope").selectOption("project");
  await page.waitForFunction(() => JSON.parse(document.getElementById("jsonDraft").value).documentType === "composition");
  const applied = JSON.parse(await page.locator("#jsonDraft").inputValue());
  assert.equal(applied.scenes[applied.timeline.clips.find(c => c.id === "intro").source].name, "只改原镜头");
  assert.notEqual(applied.scenes[applied.timeline.clips.find(c => c.id === "final").source].name, "只改原镜头");
  await menuAction("编辑", "undo");
  await page.waitForFunction(value => document.getElementById("jsonDraft").value === value, cleanJson);
  assert.equal(await page.locator("#jsonDraft").inputValue(), cleanJson);
  results.push("JSON atomic validation, scope ownership, stale drafts, export warning, backup and shared undo verified");
  await page.evaluate(() => { document.getElementById("toast").hidden = true; });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('button[data-mode="mixed"]').click();
    await page.screenshot({ path: path.join(out, `mobile-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    for (const mode of ["video", "code", "mixed"]) {
      await page.locator(`button[data-mode="${mode}"]`).click();
      assert.equal(await page.locator(".codePanel").isVisible(), mode !== "video");
      assert.equal(await page.locator(".previewPanel").isVisible(), mode !== "code");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    }
    await page.locator("#menubar").getByRole("menuitem", { name: "帮助", exact: true }).click();
    const bounds = await page.locator("#menuPopup").boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "片段属性", exact: true }).click(); assert.equal(await page.locator(".inspector").isVisible(), true);
    await page.getByRole("button", { name: "工作区", exact: true }).click();
    await page.locator("#fitTimeline").click();
    assert.equal(await page.locator(".centerWorkspace").isVisible(), true);
  }
  results.push("320/390px workspaces do not overflow");
  for (const size of [{ width: 1024, height: 700 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(size);
    await page.locator('button[data-mode="mixed"]').click();
    await page.locator("#jsonStatus").scrollIntoViewIfNeeded();
    const status = await page.locator("#jsonStatus").boundingBox(), timelineBounds = await page.locator(".timelinePanel").boundingBox();
    assert.ok(status.y >= 0 && status.y + status.height <= timelineBounds.y + 1, "Code status remains reachable in stacked/short mixed layouts");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.locator('button[data-mode="code"]').click();
    assert.equal(await page.locator(".codePanel").isVisible(), true);
    await page.locator('button[data-mode="video"]').click();
    assert.equal(await page.locator(".previewPanel").isVisible(), true);
  }
  await page.getByRole("button", { name: "片段属性", exact: true }).click();
  await menuAction("视图", "resetLayout");
  assert.equal(await page.locator(".workspace").getAttribute("data-panel"), "center");
  assert.equal(await page.locator(".workspace").getAttribute("data-mode"), "video");
  results.push("Tablet, short landscape and 320x568 layouts retain reachable code/status; reset restores the workspace");
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Produce an actual encoded video with red/blue halves and a sine audio track.
  const video = await page.evaluate(async () => {
    const m=window.videoTest.codecs,canvas=document.createElement('canvas');canvas.width=128;canvas.height=72;
    const target=new m.BufferTarget(),output=new m.Output({format:new m.WebMOutputFormat(),target}),v=new m.CanvasSource(canvas,{codec:'vp9',bitrate:200000}),a=new m.AudioBufferSource({codec:'opus',bitrate:64000});output.addVideoTrack(v,{frameRate:8});output.addAudioTrack(a);await output.start();
    for(let i=0;i<16;i++){canvas.getContext('2d').fillStyle=i<8?'#ff0000':'#0000ff';canvas.getContext('2d').fillRect(0,0,128,72);await v.add(i/8,1/8);}
    const pcm=new AudioBuffer({numberOfChannels:1,length:96000,sampleRate:48000}),d=pcm.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=.1*Math.sin(i*2*Math.PI*440/48000);await a.add(pcm);await output.finalize();
    let data='';for(const byte of new Uint8Array(target.buffer))data+=String.fromCharCode(byte);return btoa(data);
  });
  await page.locator("#fileInput").setInputFiles({ name: "red-blue.webm", mimeType: "video/webm", buffer: Buffer.from(video, "base64") });
  await page.waitForFunction(() => [...document.querySelectorAll('.assetItem')].some(n=>n.textContent.includes('red-blue.webm')));
  await page.waitForFunction(() => document.getElementById("saveStatus").textContent.includes("已保存"));
  const mediaResult = await page.evaluate(async () => {
    const {kit,createEditorStorage}=window.videoTest,storage=await createEditorStorage();
    try {
      const saved=await storage.getProject(localStorage.getItem('threejson.videoEditor.lastProject'));
      const clip=saved.document.timeline.clips.find(c=>c.source?.type==='media');
      if(!clip)throw new Error('Imported video missing');
      const audio=saved.document.timeline.audio.find(a=>a.linkedClipId===clip.id);
      const isolated={...saved.document,timeline:{version:1,clips:[{...clip,start:0}],audio:[{...audio,start:0}],lanes:saved.document.timeline.lanes}};
      const project=await kit.createMediaProject(await storage.resolveDocument(isolated),{width:128,height:72});
      try {
        const sample=async(t)=>{await project.renderAt(t);return [...project.canvas.getContext('2d').getImageData(64,36,1,1).data]};
        const red=await sample(.25),blue=await sample(1.5),again=await sample(.25);
        const mixed=await kit.prepareProjectAudio(project),pcm=mixed.render(0,48000);let energy=0;for(const v of pcm.channels[0])energy+=v*v;
        const exported=await kit.renderVideo(project,{format:'webm',fps:8,audio:true});
        const encoded=new Uint8Array(await exported.blob.arrayBuffer());
        const encodedInput=new window.videoTest.codecs.Input({source:new window.videoTest.codecs.BufferSource(encoded),formats:window.videoTest.codecs.ALL_FORMATS});
        const encodedAudio=!!await encodedInput.getPrimaryAudioTrack();encodedInput.dispose();
        const archive=await kit.packMediaDocument(isolated,{assets:await storage.assetsFor(isolated)}),reopened=await kit.createMediaProject(archive,{width:128,height:72});
        let packedBlue,packedRms;
        try{await reopened.renderAt(1.5);packedBlue=[...reopened.canvas.getContext('2d').getImageData(64,36,1,1).data];const pcm=(await kit.prepareProjectAudio(reopened)).render(0,48000);packedRms=Math.sqrt(pcm.channels[0].reduce((sum,v)=>sum+v*v,0)/48000);}finally{reopened.dispose();}
        const portable=await storage.portableJson(isolated);
        if(!Object.values(portable.mediaAssets).every(a=>a.url.startsWith('data:')))throw new Error('JSON retained local-only assets');
        return{red,blue,again,rms:Math.sqrt(energy/48000),bytes:encoded.length,hasAudio:!!audio,encodedAudio,packedBlue,packedRms,archiveBytes:archive.length};
      }finally{project.dispose();}
    }finally{storage.close();}
  });
  assert.ok(mediaResult.red[0] > 200 && mediaResult.blue[2] > 200 && mediaResult.again[0] > 200); assert.ok(mediaResult.rms > .01); assert.ok(mediaResult.bytes > 1000); assert.ok(mediaResult.hasAudio && mediaResult.encodedAudio); assert.ok(mediaResult.packedBlue[2] > 200 && mediaResult.packedRms > .01);
  results.push({ test: "Imported WebM deterministic seeks, linked original audio, real encoded export", ...mediaResult });
  const conflict = await page.evaluate(async () => {
    const { createEditorStorage } = window.videoTest, first = await createEditorStorage(), second = await createEditorStorage(), last = localStorage.getItem('threejson.videoEditor.lastProject'), id = crypto.randomUUID();
    try { await first.saveProject(id,{name:'first'});await second.getProject(id);await first.saveProject(id,{name:'newer'});let code;try{await second.saveProject(id,{name:'stale'});}catch(e){code=e.code;}return{code,name:(await first.getProject(id)).document.name}; }
    finally { first.close();second.close();localStorage.setItem('threejson.videoEditor.lastProject',last); }
  });
  assert.equal(conflict.code,'MEDIA_STORAGE_CONFLICT'); assert.equal(conflict.name,'newer'); results.push('Concurrent-tab storage version conflict preserves newer save');
  if (installed) {
    const document = {documentType:'composition',compositionVersion:1,name:'真实旁白验证',output:{width:320,height:180,fps:8},scenes:{scene:{version:'next',sceneConfig:{scene:{background:'#071422'},camera:{position:{x:0,y:0,z:8}},controls:{type:'none'}},objectList:[{objType:'box',threeJsonId:'actor',geometry:{width:2,height:2,depth:2},material:{type:'basic',color:'#3adaff'}}]}},timeline:{version:1,clips:[{id:'speech',source:'scene',duration:6}],captions:[{id:'narration',linkedClipId:'speech',text:'你好，这是双缝实验。',start:.5,duration:5.5}]}};
    await page.locator('button[data-mode="mixed"]').click();await page.locator('#loadJson').click();await page.locator('#jsonDraft').fill(JSON.stringify(document));await page.locator('#applyJson').click();
    assert.equal(localModelRequests.length,0,'No voice resources loaded on opening/import/editing');
    await menuAction("序列", "narration");
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('旁白已加入工程音轨'),null,{timeout:180000});
    await page.waitForFunction(()=>document.getElementById('saveStatus').textContent.includes('已保存'));
    const voice = await page.evaluate(async()=>{
      const {kit,codecs,createEditorStorage}=window.videoTest,storage=await createEditorStorage();
      try{
        const doc=(await storage.getProject(localStorage.getItem('threejson.videoEditor.lastProject'))).document,voice=doc.timeline.audio.find(a=>a.narration);
        if(!voice?.url.startsWith('data:audio/')||voice.linkedClipId!=='speech')throw new Error('Voice was not durably committed and linked');
        const project=await kit.createMediaProject(doc,{width:320,height:180});
        try{
          const output=await kit.renderVideo(project,{format:'webm',fps:8,audio:true}),bytes=await output.blob.arrayBuffer();
          const input=new codecs.Input({source:new codecs.BufferSource(bytes),formats:codecs.ALL_FORMATS}),context=new AudioContext();
          try{const hasAudio=!!await input.getPrimaryAudioTrack(),pcm=await context.decodeAudioData(bytes.slice(0)),data=pcm.getChannelData(0);return{hasAudio,bytes:bytes.byteLength,voiceDuration:voice.duration,rms:Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length)};}
          finally{input.dispose();await context.close();}
        }finally{project.dispose();}
      }finally{storage.close();}
    });
    assert.ok(voice.hasAudio && voice.rms>.001 && voice.voiceDuration>0);results.push({test:'One-click actual local TTS commits WAV, links to shot, survives WebM encode and decode',...voice});
    assert.equal(localModelRequests.length,installed.manifest.files.length);
    await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');assert.equal(await page.locator('#projectName').inputValue(),'真实旁白验证');
  }
  const projectKey=await page.evaluate(async()=>{
    const storage=await window.videoTest.createEditorStorage(),key=crypto.randomUUID();
    try{const saved=await storage.getProject(localStorage.getItem('threejson.videoEditor.lastProject'));const document={...saved.document,name:'大型视频交接',notes:'x'.repeat(6*1024*1024)};await storage.saveHandoff(key,{type:'video-project',document});return key;}finally{storage.close();}
  });
  await page.goto(`http://127.0.0.1:${port}/tools/scene-host/video-editor/index.html?openFrom=threebox&projectKey=${projectKey}`);
  await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
  assert.equal(await page.locator('#projectName').inputValue(),'大型视频交接');
  assert.equal(await page.evaluate(async key=>{const s=await window.videoTest.createEditorStorage();try{return await s.getHandoff(key);}finally{s.close();}},projectKey),undefined);
  results.push('Native ThreeBox handoff above localStorage quota uses IndexedDB and consumes its transfer record');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify({ results, errors, external, localModelRequests }, null, 2));
  console.log(JSON.stringify({ ok: true, out, results }, null, 2));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
