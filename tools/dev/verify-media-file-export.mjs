// Offline, real WebCodecs and browser filesystem regression (not a mock muxer).
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "dist/media-file-export", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(out, { recursive: true });
const bundle = await build({ stdin: { resolveDir: root, contents: `
  import {openSceneMediaStudio} from './packages/host-kit/js/mediaStudio.js';
  import * as kit from './packages/media-kit/js/index.js';
  import * as codecs from 'mediabunny';
  import reported from './tests/fixtures/media-export-relativity.json';
  window.kit=kit;window.reported=reported;window.sourceBefore=JSON.stringify(reported);
  window.simple={version:'next',output:{width:320,height:180,fps:10},
    sceneConfig:{scene:{background:'#071422'},camera:{position:{x:0,y:0,z:8}},controls:{type:'none'}},
    objectList:[{objType:'box',threeJsonId:'actor',material:{type:'basic',color:'#39caff'}}],timeline:{version:1,duration:1}};
  window.events=[];window.pickerCalls=0;window.openedStreams=0;
  window.showSaveFilePicker=async()=>{window.pickerCalls++;const dir=await navigator.storage.getDirectory();
    window.file=await dir.getFileHandle('test-export.mp4',{create:true});return{getFile:()=>file.getFile(),createWritable:()=>{openedStreams++;if(window.failNextSave){window.failNextSave=false;throw new Error('fixture disk unavailable');}return file.createWritable();}};};
  window.openStudio=(source=simple,extra={})=>openSceneMediaStudio(source,{language:'zh-CN',
    projectOptions:{runtimeOptions:{textLoadTimeoutMs:300}},
    exportOptions:{runtimeOptions:{textLoadTimeoutMs:300},onProgress:p=>events.push(p)},...extra});
  window.inspect=async(blob)=>{const input=new codecs.Input({source:new codecs.BlobSource(blob),formats:codecs.ALL_FORMATS});
    try{const video=await input.getPrimaryVideoTrack(),audio=await input.getPrimaryAudioTrack();return{bytes:blob.size,duration:await input.computeDuration(),video:!!video,audio:!!audio};}finally{input.dispose();}};
  window.seedFile=async()=>{const dir=await navigator.storage.getDirectory();window.file=await dir.getFileHandle('test-export.mp4',{create:true});const w=await file.createWritable();await w.write('previous-good-file');await w.close();};
  window.checkShots=async()=>{
    const results=[];
    for(const clip of reported.timeline.clips){const doc=structuredClone(reported.scenes[clip.source]);let project;
      try{project=await kit.createMediaProject(doc,{width:320,height:180,runtimeOptions:{textLoadTimeoutMs:300}});
        for(const time of [0,clip.duration/2,clip.duration-.01])await project.renderAt(time);
        results.push({id:clip.id,ok:true});
      }catch(e){results.push({id:clip.id,error:e.message});}finally{project?.dispose();}}
    return results;
  };
  window.textComparison=async()=>{
    const captures=[];
    for(const variant of ['old-point-size','declared-point-size','text-only']){
      const doc=structuredClone(reported.scenes.intro);
      doc.sceneConfig.textFont={fontUrl:'/__test-chinese.ttf'};
      for(const item of doc.objectList){
        if(item.objType==='text')item.sdf={gpuAccelerateSDF:false};
        if(item.objType==='points'){
          if(variant==='old-point-size')item.material.size=4;
          if(variant==='text-only')item.visible=false;
        }
      }
      const project=await kit.createMediaProject(doc,{width:960,height:540,runtimeOptions:{textLoadTimeoutMs:15000}});
      try{await project.renderAt(4);captures.push({variant,png:project.canvas.toDataURL(),diagnostics:project.resourceDiagnostics});}finally{project.dispose();}
    }
    return captures;
  };
` }, bundle: true, format: "esm", write: false, logLevel: "silent" });
const { server, port } = await startStaticServer(root);
let browser; const results = [], errors = [];
try {
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  page.setDefaultTimeout(60000);
  page.on("pageerror", e => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, route => route.abort());
  await page.route("**/__file-export", route => route.fulfill({ contentType: "text/html", body: '<html lang="zh-CN"><style>body{background:#202124;color:#eee}</style><script type="module" src="/__file-export.js"></script></html>' }));
  await page.route("**/__file-export.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  // Test-only local font. Never bundled, redistributed, or used as a product default.
  if (process.argv.includes("--text")) {
    const font = await readFile(process.env.THREEJSON_TEST_FONT || "C:/Windows/Fonts/simhei.ttf");
    await page.route("**/__test-chinese.ttf", route => route.fulfill({ contentType: "font/ttf", body: font }));
  }
  await page.goto(`http://127.0.0.1:${port}/__file-export`);
  await page.waitForFunction(() => typeof window.openStudio === "function");
  const shots = await page.evaluate(() => checkShots()); results.push({ shots });console.log(JSON.stringify({ shots }));
  assert.ok(shots.every(shot=>shot.ok), "The original, unrepaired scene descriptors must all render");
  if (process.argv.includes("--text")) {
    for (const capture of await page.evaluate(() => textComparison())) {
      await writeFile(path.join(out, `${capture.variant}.png`), Buffer.from(capture.png.split(",")[1], "base64"));
      assert.equal(capture.diagnostics.some(d => d.code === "TEXT_SDF_FALLBACK"), false);
      results.push({ textComparison: capture.variant, diagnostics: capture.diagnostics });
    }
  }
  if (process.argv.includes("--diagnose")) process.exitCode = 0;
  else {
    await page.evaluate(() => openStudio(reported));
    const dialog = page.getByRole("dialog", { name: "时间线与媒体导出", exact: true });
    await dialog.locator(".mediaStatus").filter({ hasText: "66.75" }).waitFor();
    await dialog.getByRole("button", { name: "导出", exact: true }).click();
    assert.equal(await page.evaluate(() => pickerCalls), 0, "Known invalid audio must not create an empty file");
    await dialog.getByRole("button", { name: "循环此配乐", exact: true }).click();
    await dialog.locator(".mediaStatus").filter({ hasText: "可播放" }).waitFor();
    assert.equal(await page.evaluate(() => JSON.stringify(reported) === sourceBefore), true);
    await page.screenshot({ path: path.join(out, "repaired-audio.png") });
    if (process.argv.includes("--film")) {
      // Exercise the actual dialog with the ORIGINAL JSON. Only export settings
      // and the explicit music-loop choice change; no fixture sanitization.
      await dialog.getByLabel("声音",{exact:true}).selectOption("existing");
      await dialog.locator(".mediaStatus").filter({hasText:"可播放"}).waitFor();
      await dialog.locator(".mediaAdvanced").evaluate(node=>node.open=true);
      const sizes=dialog.locator(".mediaAdvanced input[type=number]");
      await sizes.nth(1).fill("320");await sizes.nth(2).fill("180");await sizes.nth(3).fill("10");
      const pickerBefore=await page.evaluate(()=>pickerCalls);
      await dialog.getByRole("button",{name:"导出",exact:true}).click();
      await dialog.locator(".mediaStatus").filter({hasText:"视频已生成，请点击保存视频"}).waitFor({timeout:300000});
      assert.equal(await page.evaluate(()=>pickerCalls),pickerBefore);
      await dialog.getByRole("button",{name:"保存视频",exact:true}).click();
      await dialog.locator(".mediaStatus").filter({hasText:"已保存"}).waitFor();
      const film=await page.evaluate(async()=>({...await inspect(await file.getFile()),frames:events.filter(e=>e.stage==='encoding').at(-1)?.frame,productionState:reported.production.state,unchanged:JSON.stringify(reported)===sourceBefore}));
      assert.equal(film.frames,1500);assert.equal(film.productionState,"paused");assert.equal(film.unchanged,true);
      assert.ok(film.video&&film.audio&&film.bytes>0&&Math.abs(film.duration-150)<.1);
      results.push({originalFilmViaDialog:film});console.log(JSON.stringify({originalFilmViaDialog:film}));
      await page.screenshot({path:path.join(out,"original-film-saved.png")});
    }
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    results.push({ audioPreflight: "blocked before picker; explicit loop repairs preview without changing JSON" });

    const draft = await page.evaluate(async () => {
      let opened=false,error,clipId;
      const broken=structuredClone(reported);broken.scenes.dilation.timeline.tracks[0].target='missing-target';
      try{await kit.renderVideo(broken,{width:320,height:180,fps:5,runtimeOptions:{textLoadTimeoutMs:300},
        audioClipOverrides:{score:{loop:true}},openWritable:()=>{opened=true;throw new Error('should not open');}});}catch(e){error=e.message;clipId=e.clipId;}
      return{opened,error,clipId};
    });
    assert.equal(draft.opened,false);assert.equal(draft.clipId,"dilation");assert.match(draft.error,/missing-target/);results.push({draft});
    // The same late error must be caught BEFORE expensive automatic narration,
    // not merely before frame encoding. No user-visible output file is selected.
    const pickerBeforeBroken=await page.evaluate(()=>{
      window.narrationCalls=0;const broken=structuredClone(reported);broken.scenes.dilation.timeline.tracks[0].target='missing-target';
      window.broken=broken;return pickerCalls;
    });
    await page.evaluate(()=>openStudio(broken,{createNarrationHost:async()=>{window.narrationCalls++;throw new Error('Must not synthesize invalid film');}}));
    await dialog.getByRole("button",{name:"循环此配乐",exact:true}).click();
    await dialog.locator(".mediaStatus").filter({hasText:"可播放"}).waitFor();
    await dialog.getByRole("button",{name:"导出",exact:true}).click();
    await dialog.locator(".mediaStatus").filter({hasText:"missing-target"}).waitFor();
    assert.equal(await page.evaluate(()=>narrationCalls),0);assert.equal(await page.evaluate(()=>pickerCalls),pickerBeforeBroken);
    await page.screenshot({path:path.join(out,"late-shot-before-narration.png")});
    results.push({lateShotPreflight:"no narration calls, no file selection"});
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();

    for (const format of ["mp4", "webm"]) {
      await page.evaluate(() => openStudio());
      await dialog.getByLabel("导出格式", { exact: true }).selectOption(format);
      await dialog.locator(".mediaStatus").filter({hasText:"可播放"}).waitFor();
      const picks=await page.evaluate(()=>pickerCalls);
      await dialog.getByRole("button", { name: "导出", exact: true }).click();
      await dialog.locator(".mediaStatus").filter({hasText:"视频已生成，请点击保存视频"}).waitFor();
      assert.equal(await page.evaluate(()=>pickerCalls),picks);
      const encoded=await page.evaluate(()=>events.filter(p=>p.stage==='encoding').length);
      if(format==="mp4"){
        await page.evaluate(()=>window.failNextSave=true);
        await dialog.getByRole("button",{name:"保存视频",exact:true}).click();
        await dialog.locator(".mediaStatus").filter({hasText:"fixture disk unavailable"}).waitFor();
      }
      await dialog.getByRole("button",{name:"保存视频",exact:true}).click();
      await dialog.locator(".mediaStatus").filter({hasText:"已保存"}).waitFor();
      assert.equal(await page.evaluate(()=>events.filter(p=>p.stage==='encoding').length),encoded,"Save retries must not encode again");
      const result = await page.evaluate(async () => inspect(await file.getFile()));
      assert.ok(result.bytes > 100 && result.video); assert.ok(Math.abs(result.duration - 1) < .1);
      const phases = await page.evaluate(() => events.map(p => p.stage));
      for (const stage of ["preparing", "audio", "rendering", "encoding", "finalizing", "saving", "complete"]) assert.ok(phases.includes(stage), stage);
      results.push({ format, ...result });console.log(JSON.stringify(results.at(-1)));
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await page.waitForFunction(async()=>{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('threejson-media-exports');for await(const _ of dir.keys())return false;return true;});
    }
    // Real FileSystemWritableFileStream rolls back on mid-encode cancellation.
    const cancellation = await page.evaluate(async () => {
      await seedFile();const controller=new AbortController();let error;
      try{await kit.renderVideo(simple,{openWritable:()=>file.createWritable(),signal:controller.signal,onProgress:p=>{if(p.stage==='encoding')controller.abort();}});}catch(e){error=e.name;}
      return{error,text:await(await file.getFile()).text()};
    });
    assert.deepEqual(cancellation, { error: "AbortError", text: "previous-good-file" });results.push({ cancellation });
    const failure = await page.evaluate(async () => {
      await seedFile();const project=await kit.createMediaProject(simple,{width:320,height:180});let error;
      const render=project.renderAt;project.renderAt=t=>t>.1?Promise.reject(new Error('fixture lost context')):render(t);
      try{await kit.renderVideo(project,{openWritable:()=>file.createWritable(),fps:10});}catch(e){error=e.message;}finally{project.dispose();}
      return{error,text:await(await file.getFile()).text()};
    });
    assert.deepEqual(failure,{error:"fixture lost context",text:"previous-good-file"});results.push({ failure });
    const withSound = await page.evaluate(async () => {
      const doc=structuredClone(simple);doc.timeline.audio=structuredClone(reported.timeline.audio);doc.timeline.audio[0].duration=1;
      const result=await kit.renderVideo(doc,{format:'mp4',openWritable:()=>file.createWritable()});
      return{...await inspect(await file.getFile()),bytesWritten:result.bytesWritten};
    });
    assert.ok(withSound.bytes>0 && withSound.video && withSound.audio);assert.equal(withSound.bytes,withSound.bytesWritten);results.push({withSound});
    if(process.argv.includes("--hd")){
      const hd=await page.evaluate(async()=>{
        const result=await kit.renderVideo(reported,{width:1920,height:1080,fps:30,start:34,end:40,
          audioClipOverrides:{score:{loop:true}},runtimeOptions:{textLoadTimeoutMs:300},openWritable:()=>file.createWritable()});
        return {...await inspect(await file.getFile()),frames:result.frames,width:result.width,height:result.height};
      });
      assert.equal(hd.frames,180);assert.equal(hd.width,1920);assert.equal(hd.height,1080);
      assert.ok(hd.video&&hd.audio&&hd.bytes>0&&Math.abs(hd.duration-6)<.1);
      results.push({hdAcrossReportedFailure:hd});console.log(JSON.stringify({hdAcrossReportedFailure:hd}));
    }
    // Buffered download remains available when the browser has no picker.
    await page.evaluate(() => {window.showSaveFilePicker=undefined;return openStudio();});
    const pending = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "导出", exact: true }).click();
    await (await pending).saveAs(path.join(out, "fallback.mp4"));
    await dialog.locator(".mediaStatus").filter({ hasText: /^已导出。$/ }).waitFor();
    results.push({ blobDownload: true });
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  }
  // Unavailable external fonts are an intentional offline fixture limitation.
  assert.ok(errors.every(e => /fetch|Failed to fetch|Load failed/i.test(e)), JSON.stringify(errors));
} catch (error) {
  results.push({ failure: String(error), filmProgress: await browser?.contexts()[0]?.pages()[0]?.evaluate(() => window.filmProgress).catch(() => null) });
  throw error;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(out, "report.json"), JSON.stringify({ results, errors }, null, 2));console.log("Report:", out);
}
