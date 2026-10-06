import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";
import { getBuiltinAudioModels, createAudioModelManager } from "../../packages/audio-kit/js/models.js";
import { createNodeAudioModelStorage } from "../../packages/audio-kit/js/nodeModels.js";

// Cold one-click export -> actual pinned local TTS -> MP4/WebM -> decoded PCM.
// Only reuse the explicitly installed test cache. No remote model/AI requests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/media-narration-export", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const manager = createAudioModelManager(await createNodeAudioModelStorage(path.join(root, "dist/local-chinese-tts/model-cache")));
const installed = await manager.status(getBuiltinAudioModels()[0]);
manager.close();
if (installed.status !== "ready") throw new Error("First explicitly install the pinned test model using verify-local-chinese-tts.mjs --download. This check never downloads it.");
const bundle = await build({ stdin: { resolveDir: root, contents: `
  import {openSceneMediaStudio} from './packages/host-kit/js/mediaStudio.js';
  import {Input,BufferSource,ALL_FORMATS} from 'mediabunny';
  const scene={version:'next',output:{width:320,height:180,fps:5},
    sceneConfig:{scene:{background:'#071422'},camera:{position:{x:0,y:0,z:8}},controls:{type:'none'}},
    objectList:[{objType:'box',threeJsonId:'actor',geometry:{width:2,height:2,depth:2},material:{type:'basic',color:'#3adaff'}}],
    timeline:{version:1,duration:6,captions:[{id:'narration',text:'你好，这是双缝实验。',start:.5,duration:5.5}]}};
  window.source=scene;window.before=JSON.stringify(scene);window.showSaveFilePicker=undefined;
  window.previewCreates=0;
  window.openStudio=(options={},source=scene)=>openSceneMediaStudio(source,{name:'local-narration',language:'zh-CN',
    loadMediaKit:async()=>{const kit=await import('@threejson/media-kit');return{...kit,createMediaProject:(...args)=>{window.previewCreates++;return kit.createMediaProject(...args);}};},...options});
  window.inspectVideo=async(base64)=>{
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const input=new Input({source:new BufferSource(bytes),formats:ALL_FORMATS});const context=new AudioContext();
    try{
      const audio=await input.getPrimaryAudioTrack(),video=await input.getPrimaryVideoTrack();
      const decoded=audio?await context.decodeAudioData(bytes.buffer.slice(0)):null,samples=decoded?.getChannelData(0)||new Float32Array(1);
      let peak=0,energy=0;for(const sample of samples){peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;}
      return{audio:!!audio,video:!!video,duration:await input.computeDuration(),peak,rms:Math.sqrt(energy/samples.length),samples:samples.length};
    }finally{input.dispose();await context.close();}
  };
` }, bundle: true, format: "esm", write: false, logLevel: "silent" });
const worker = await build({ entryPoints: [path.join(root, "packages/audio-kit/js/meloWorker.js")], bundle: true, format: "esm", write: false, logLevel: "silent" });
const { server, port } = await startStaticServer(root);
let browser;const errors = [], requests = [], modelRequests = [], results = [];
try {
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, route => {
    const file=installed.manifest.files.find(file=>file.url===route.request().url());
    if(file){modelRequests.push(file.role);return route.fulfill({path:path.join(root,"dist/local-chinese-tts/model-cache",file.storageKey),contentType:"application/octet-stream",headers:{"Access-Control-Allow-Origin":"*"}});}
    requests.push(route.request().url());return route.abort();
  });
  await page.route("**/__narration", route => route.fulfill({ contentType: "text/html", body: '<html lang="zh-CN"><style>body{background:#202124;color:#eee}</style><script type="module" src="/__narration.js"></script></html>' }));
  await page.route("**/__narration.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.route("**/meloWorker.js", route => route.fulfill({ contentType: "text/javascript", body: worker.outputFiles[0].text }));
  await page.goto(`http://127.0.0.1:${port}/__narration`);
  await page.waitForFunction(() => typeof window.openStudio === "function");
  await page.evaluate(() => window.openStudio());
  const studio = page.getByRole("dialog", { name: "时间线与媒体导出", exact: true });
  await studio.locator(".mediaAudioHint").filter({hasText:"将自动朗读 1 段"}).waitFor();
  assert.equal(await studio.getByLabel("声音", {exact:true}).inputValue(),"auto");
  assert.equal(await studio.locator(".mediaAdvanced").evaluate(node=>node.open),false);
  assert.equal(await studio.getByRole("button", {name:"生成本地旁白",exact:true}).count(),0);
  assert.deepEqual(modelRequests,[]);
  assert.equal(await page.evaluate(() => localStorage.getItem("threejson.localSpeechModel")), null);
  assert.deepEqual(requests, []);
  for(const width of[390,320,1100]){
    await page.setViewportSize({width,height:844});
    assert.equal(await studio.evaluate(node => node.scrollWidth > node.clientWidth + 2), false);
    const box=await studio.getByRole("button",{name:"导出",exact:true}).boundingBox();
    assert.ok(box.y>=0&&box.y+box.height<=844,"Export is visible without scrolling through advanced settings");
    await page.screenshot({path:path.join(output,`automatic-narration-${width}.png`)});
  }
  for (const format of ["webm", "mp4"]) {
    await studio.getByLabel("导出格式", { exact: true }).selectOption(format);
    const pending = page.waitForEvent("download", { timeout: 180000 });
    await studio.getByRole("button", { name: "导出", exact: true }).click();
    const download = await pending, file = path.join(output, `local-narration.${format}`);await download.saveAs(file);
    const bytes = await readFile(file), result = await page.evaluate(data => window.inspectVideo(data), bytes.toString("base64"));
    assert.equal(result.audio, true);assert.equal(result.video, true);assert.ok(result.peak > .01 && result.rms > .001);assert.ok(Math.abs(result.duration - 6) < .2);
    results.push({ format, bytes: bytes.length, ...result });console.log(JSON.stringify(results.at(-1)));
    assert.equal(modelRequests.length,installed.manifest.files.length,"Resources fetched once, reused for the next export");
  }
  assert.equal(await page.evaluate(() => localStorage.getItem("threejson.localSpeechModel")),null,"Export must not enable Agent synthesis globally");
  assert.equal(await page.evaluate(() => JSON.stringify(source) === before), true);
  // Explicitly opting out removes generated speech, not authoring data.
  await studio.getByLabel("声音",{exact:true}).selectOption("existing");
  await studio.locator(".mediaAudioHint").filter({hasText:"此选项将导出无声视频"}).waitFor();
  const silentDownload=page.waitForEvent("download");
  await studio.getByRole("button",{name:"导出",exact:true}).click();
  const silentFile=path.join(output,"existing-only.mp4");await(await silentDownload).saveAs(silentFile);
  const silent=await page.evaluate(data=>window.inspectVideo(data),(await readFile(silentFile)).toString("base64"));
  assert.equal(silent.audio,false);results.push({mode:"existing",...silent});
  await studio.getByRole("button", { name: "关闭", exact: true }).click();
  // A reopened dialog uses cached resources even without the old Enable flag.
  await page.evaluate(()=>window.openStudio());
  const previewCreates=await page.evaluate(()=>window.previewCreates);
  await studio.getByRole("button",{name:"播放",exact:true}).click();
  await studio.getByRole("button",{name:"暂停",exact:true}).waitFor({timeout:120000});
  assert.equal(modelRequests.length,installed.manifest.files.length);
  assert.equal(await page.evaluate(()=>window.previewCreates),previewCreates,"Adding speech should not recreate the WebGL project");
  await studio.getByRole("button",{name:"暂停",exact:true}).click();
  await studio.getByRole("button",{name:"播放",exact:true}).click();
  await studio.getByRole("button",{name:"暂停",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.previewCreates),previewCreates,"Repeated Play reuses the project");
  await studio.getByRole("button",{name:"暂停",exact:true}).click();
  await studio.getByRole("button", { name: "关闭", exact: true }).click();
  // Failure and cancellation never start a silent export.
  let unexpectedDownloads=0;page.on("download",()=>unexpectedDownloads++);
  await page.evaluate(()=>window.openStudio({createNarrationHost:async()=>{throw Object.assign(new Error("fixture network failure"),{code:"LOCAL_NARRATION_DOWNLOAD_FAILED"});}}));
  await studio.getByRole("button",{name:"导出",exact:true}).click();
  await studio.locator(".mediaStatus").filter({hasText:"配音资源下载失败，未导出无声视频"}).waitFor();
  assert.equal(await studio.getByRole("button",{name:"导出",exact:true}).isEnabled(),true);
  await studio.getByRole("button", { name: "关闭", exact: true }).click();
  await page.evaluate(()=>window.openStudio({createNarrationHost:({signal})=>new Promise((resolve,reject)=>signal.addEventListener("abort",()=>reject(new DOMException("cancelled","AbortError")),{once:true}))}));
  await studio.getByRole("button",{name:"导出",exact:true}).click();
  await studio.locator(".mediaStatus").filter({hasText:"正在准备自动旁白"}).waitFor();
  await studio.getByRole("button",{name:"取消",exact:true}).click();
  await studio.locator(".mediaStatus").filter({hasText:"导出已取消"}).waitFor();
  assert.equal(unexpectedDownloads,0);
  await studio.getByRole("button", { name: "关闭", exact: true }).click();
  for(const mode of["mute","no-text","png","gif"]){
    await page.evaluate(mode=>{
      const document=structuredClone(source);if(mode==="no-text")document.timeline.captions=[];
      return window.openStudio({initialFormat:mode==="png"||mode==="gif"?mode:"mp4",createNarrationHost:async()=>{throw new Error("Speech must not run for this mode");}},document);
    },mode);
    if(mode==="mute")await studio.getByLabel("声音",{exact:true}).selectOption("mute");
    const pending=page.waitForEvent("download",{timeout:60000});
    await studio.getByRole("button",{name:"导出",exact:true}).click();await pending;
    assert.equal(modelRequests.length,installed.manifest.files.length);
    await studio.getByRole("button",{name:"关闭",exact:true}).click();
    results.push({mode,skippedSpeech:true});
  }
  assert.deepEqual(errors, []);assert.deepEqual(requests, []);
} finally {
  await browser?.close();await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify({ results, errors, externalRequests: requests, modelRequestsServedFromLocalCache:modelRequests }, null, 2));
  console.log("Report:", output);
}
