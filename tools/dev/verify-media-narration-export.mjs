import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";
import { getBuiltinAudioModels, createAudioModelManager } from "../../packages/audio-kit/js/models.js";
import { createNodeAudioModelStorage } from "../../packages/audio-kit/js/nodeModels.js";

// Actual pinned local TTS -> media-studio UI -> encoded MP4/WebM -> decoded PCM.
// Only reuse the explicitly installed test cache. No remote model/AI requests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/media-narration-export", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const manager = createAudioModelManager(await createNodeAudioModelStorage(path.join(root, "dist/local-chinese-tts/model-cache")));
const installed = await manager.status(getBuiltinAudioModels()[0]);
if (installed.status !== "ready") throw new Error("First explicitly install the pinned test model using verify-local-chinese-tts.mjs --download. This check never downloads it.");
const bundle = await build({ stdin: { resolveDir: root, contents: `
  import {openSceneMediaStudio} from './packages/host-kit/js/mediaStudio.js';
  import {createAudioModelManager,createBrowserAudioModelStorage} from './packages/audio-kit/js/models.js';
  import {Input,BufferSource,ALL_FORMATS} from 'mediabunny';
  const scene={version:'next',output:{width:320,height:180,fps:5},
    sceneConfig:{scene:{background:'#071422'},camera:{position:{x:0,y:0,z:8}},controls:{type:'none'}},
    objectList:[{objType:'box',threeJsonId:'actor',geometry:{width:2,height:2,depth:2},material:{type:'basic',color:'#3adaff'}}],
    timeline:{version:1,duration:6,captions:[{id:'narration',text:'你好，这是双缝实验。',start:.5,duration:5.5}]}};
  window.source=scene;window.before=JSON.stringify(scene);window.showSaveFilePicker=undefined;
  window.openStudio=()=>openSceneMediaStudio(scene,{name:'local-narration',language:'zh-CN'});
  window.install=async(manifest)=>{
    const sdk=createAudioModelManager(await createBrowserAudioModelStorage());
    const local=structuredClone(manifest);for(const file of local.files)file.url=location.origin+'/dist/local-chinese-tts/model-cache/'+file.storageKey;
    try{await sdk.download(local);}finally{sdk.close();}
  };
  window.inspectVideo=async(base64)=>{
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
    const input=new Input({source:new BufferSource(bytes),formats:ALL_FORMATS});const context=new AudioContext();
    try{
      const audio=await input.getPrimaryAudioTrack(),video=await input.getPrimaryVideoTrack();
      const decoded=await context.decodeAudioData(bytes.buffer.slice(0)),samples=decoded.getChannelData(0);
      let peak=0,energy=0;for(const sample of samples){peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;}
      return{audio:!!audio,video:!!video,duration:await input.computeDuration(),peak,rms:Math.sqrt(energy/samples.length),samples:samples.length};
    }finally{input.dispose();await context.close();}
  };
` }, bundle: true, format: "esm", write: false, logLevel: "silent" });
const worker = await build({ entryPoints: [path.join(root, "packages/audio-kit/js/meloWorker.js")], bundle: true, format: "esm", write: false, logLevel: "silent" });
const { server, port } = await startStaticServer(root);
let browser;const errors = [], requests = [], results = [];
try {
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/^https?:\/\/(?!127\.0\.0\.1:)/.test(request.url())) requests.push(request.url()); });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, route => route.abort());
  await page.route("**/__narration", route => route.fulfill({ contentType: "text/html", body: '<html lang="zh-CN"><style>body{background:#202124;color:#eee}</style><script type="module" src="/__narration.js"></script></html>' }));
  await page.route("**/__narration.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.route("**/meloWorker.js", route => route.fulfill({ contentType: "text/javascript", body: worker.outputFiles[0].text }));
  await page.goto(`http://127.0.0.1:${port}/__narration`);
  await page.waitForFunction(() => typeof window.openStudio === "function");
  await page.evaluate(() => window.openStudio());
  const studio = page.getByRole("dialog", { name: "时间线与媒体导出", exact: true });
  assert.match(await studio.locator(".mediaStatus").innerText(), /导出将无声/);
  await studio.getByRole("button", { name: "生成本地旁白", exact: true }).click();
  await studio.getByText("尚未安装并启用本地语音模型。请打开“管理语音模型”。", { exact: true }).waitFor();
  await studio.getByRole("button", { name: "管理语音模型", exact: true }).click();
  await studio.getByText("没有已缓存的模型。", { exact: true }).waitFor();
  await studio.getByLabel("可选模型", { exact: true }).selectOption("0");
  assert.equal(await page.evaluate(() => localStorage.getItem("threejson.localSpeechModel")), null);
  assert.deepEqual(requests, []);
  await studio.getByRole("button", { name: "关闭", exact: true }).click();
  await page.evaluate(manifest => window.install(manifest), installed.manifest);
  await page.evaluate(() => window.openStudio());
  await studio.getByRole("button", { name: "管理语音模型", exact: true }).click();
  await studio.getByRole("button", { name: "启用本地旁白", exact: true }).click();
  await studio.getByText(/本地模型已就绪：melo-zh-en/).waitFor();
  await studio.getByRole("button", { name: "生成本地旁白", exact: true }).click();
  await studio.getByText(/已生成 1 段旁白/).waitFor({ timeout: 120000 });
  assert.equal(await studio.getByLabel("使用生成的旁白", { exact: true }).isChecked(), true);
  assert.match(await studio.locator(".mediaStatus").innerText(), /可播放/);
  assert.equal(await studio.evaluate(node => node.scrollWidth > node.clientWidth + 2), false);
  await studio.locator(".mediaNarration").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "local-narration-mobile.png") });
  for (const format of ["webm", "mp4"]) {
    await studio.getByLabel("导出格式", { exact: true }).selectOption(format);
    const pending = page.waitForEvent("download", { timeout: 60000 });
    await studio.getByRole("button", { name: "导出", exact: true }).click();
    const download = await pending, file = path.join(output, `local-narration.${format}`);await download.saveAs(file);
    const bytes = await readFile(file), result = await page.evaluate(data => window.inspectVideo(data), bytes.toString("base64"));
    assert.equal(result.audio, true);assert.equal(result.video, true);assert.ok(result.peak > .01 && result.rms > .001);assert.ok(Math.abs(result.duration - 6) < .2);
    results.push({ format, bytes: bytes.length, ...result });console.log(JSON.stringify(results.at(-1)));
  }
  // Toggling off generation removes only this extra track; source is untouched.
  await studio.getByLabel("使用生成的旁白", { exact: true }).uncheck();
  await studio.locator(".mediaStatus").filter({ hasText: "导出将无声" }).waitFor();
  assert.equal(await page.evaluate(() => JSON.stringify(source) === before), true);
  // Cancel synthesis after requesting a custom text; no partial audio is committed.
  await studio.getByLabel("朗读来源", { exact: true }).selectOption("custom");
  await studio.getByLabel("旁白文本", { exact: true }).fill("这是一段可以取消的本地旁白。");
  await studio.getByRole("button", { name: "生成本地旁白", exact: true }).click();
  await studio.getByRole("button", { name: "取消生成", exact: true }).click();
  await studio.getByText("已取消生成旁白。", { exact: true }).waitFor();
  await studio.getByRole("button", { name: "关闭", exact: true }).click();
  assert.deepEqual(errors, []);assert.deepEqual(requests, []);
} finally {
  await browser?.close();await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify({ results, errors, externalRequests: requests }, null, 2));
  console.log("Report:", output);
}
