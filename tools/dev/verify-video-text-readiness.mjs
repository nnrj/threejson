import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";

// Isolated, offline browser regression: actual Troika/Three.js, without AI,
// production services or a reachable external font CDN.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/video-text-readiness", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const bundle = await build({ stdin: { resolveDir: root, contents: `
  import {createJsonScene} from './core/handler/sceneLoadHandler.js';
  import {getObjectByThreeJsonId} from './core/handler/objectRegistry.js';
  import {createMediaProject} from './packages/media-kit/js/project.js';
  import {createThreeBoxSceneCard} from './tools/scene-host/threebox/js/threeBoxSceneCard.js';
  import {loadHostLocaleCatalog} from './tools/scene-host/shared/i18n/index.js';
  window.scene = (font, content='Hello') => ({version:'next', name:'readiness',
    sceneConfig:{scene:{background:'#102438'}, renderer:{preserveDrawingBuffer:true},
      camera:{position:{x:0,y:0,z:10},lookAt:{x:0,y:0,z:0}},controls:{type:'none',enabled:false},renderLoop:{autoStart:false},
      textFont:{fontUrl:font}},
    objectList:[{objType:'text',threeJsonId:'title',content,mode:'sdf',fontSize:0.8,color:'#ffffff',position:{x:0,y:1,z:0},sdf:{gpuAccelerateSDF:false}},
      ...Array.from({length:6},(_,i)=>({objType:'box',threeJsonId:'box-'+i,geometry:{width:.4,height:.4,depth:.4},position:{x:i*.6-1.5,y:-1,z:0},material:{type:'basic',color:'#48ccff'}}))],
    timeline:{duration:3, tracks:[{id:'fade',target:'title',property:'material.opacity',keyframes:[{time:0,value:1},{time:3,value:.4}]}]}});
  window.check = async ({font,content,composition=false,abort=false,preload=false,billboard=false}) => {
    const source=scene(font,content), canvas=document.createElement('canvas');
    if(preload)source.sceneConfig.textFont.preloadCharacters='Hello';
    if(billboard)source.objectList[0].billboard=true;
    const original=JSON.stringify(source);
    canvas.width=480;canvas.height=270;document.body.replaceChildren(canvas);
    const controller=new AbortController(), progress=[];let runtime,project;
    const opts={canvas,signal:controller.signal,textLoadTimeoutMs:font?.includes('kenpixel')?5000:400,onDeployProgress:({deploy})=>{progress.push([deploy.done,deploy.total]);if(abort && deploy.done===deploy.total)controller.abort();}};
    const started=performance.now();
    try {
      if(composition){project=await createMediaProject({documentType:'composition',compositionVersion:1,scenes:{shot:source},timeline:{duration:3,clips:[{id:'clip',source:'shot',start:0,duration:3}]}},
        {canvas,width:480,height:270,signal:controller.signal,createScene:async (json,options)=>{runtime=await createJsonScene(json,options);return runtime;},runtimeOptions:opts});await project.renderAt(0);}
      else {runtime=await createJsonScene(source,opts);await runtime.timeline.renderAt(0);}
      const text=getObjectByThreeJsonId('title',runtime.scene);
      const copy=document.createElement('canvas');copy.width=480;copy.height=270;const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);
      const data=ctx.getImageData(0,0,480,270).data;let bright=0,maxRed=0;
      for(let i=0;i<data.length;i+=4)if(data[i]>170 && data[i+1]>170 && data[i+2]>170)bright++;
      for(let i=0;i<data.length;i+=4)maxRed=Math.max(maxRed,data[i]);
      await runtime.timeline.renderAt(1);
      return {elapsed:performance.now()-started,progress,bright,maxRed,unchanged:original===JSON.stringify(source),mode:text.userData.objJson.mode,
        sdf:!!text.textRenderInfo,opacity:(text.material||text.children[0]?.material)?.opacity,diagnostics:project?.resourceDiagnostics||runtime.runtimeContext.resourceDiagnostics};
    }catch(error){return {error:error.name,message:error.message,progress,elapsed:performance.now()-started,disposed:runtime?.runtimeContext?.disposed};}
    finally{project?.dispose();if(!project)runtime?.dispose();}
  };
  window.checkCard=async()=>{
    await loadHostLocaleCatalog('en-US');
    const card=createThreeBoxSceneCard();document.body.replaceChildren(card.el);
    const wrap=card.el.querySelector('.sceneCardCanvasWrap');Object.assign(wrap.style,{width:'360px',height:'240px'});
    const shot=scene('/missing-card-font.ttf','网络异常仍可播放');
    const film={documentType:'composition',compositionVersion:1,scenes:{shot},timeline:{duration:3,clips:[{id:'clip',source:'shot',start:0,duration:3}]}};
    const pending=card.render(film);window.testCard={card,pending,film};return true;
  };
`, }, bundle: true, format: "esm", write: false, logLevel: "silent" });
const { server, port } = await startStaticServer(root);
let browser;
const results = [], errors = [];
try {
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("console", message => { if(message.type() === "error") console.log("Browser error:", message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/__readiness", route => route.fulfill({ contentType: "text/html", body: '<link rel="stylesheet" href="/tools/scene-host/threebox/css/threebox.css"><script type="module" src="/__readiness.js"></script>' }));
  await page.route("**/__readiness.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  // Explicitly keep this regression offline, including the implicit Unicode CDN.
  await page.route(/^https:\/\//, route => route.abort());
  await page.goto(`http://127.0.0.1:${port}/__readiness`);
  await page.waitForFunction(() => typeof window.check === "function");
  const cases = [
    { font: "/node_modules/three/examples/fonts/ttf/kenpixel.ttf" },
    { font: "/node_modules/three/examples/fonts/ttf/kenpixel.ttf?warmup", preload: true },
    { font: "/missing-test-font.ttf", content: "字体失效仍可播放" },
    { font: "/missing-film-font.ttf", content: "视频中文标题", composition: true },
    { font: null, content: "默认中文字体不可达" },
    { font: "/missing-billboard.ttf", content: "悬浮文字", billboard: true },
    { font: "/cancelled-font.ttf", abort: true }
  ];
  for (const input of cases) {
    const result = await page.evaluate(input => window.check(input), input);
    results.push({ input, result });
    console.log(JSON.stringify(results.at(-1)));
    if (input.abort) assert.equal(result.error, "AbortError");
    else {
      assert.equal(result.error, undefined); assert.ok(result.bright > 10, "Text must be visible, not just a nonblack backdrop.");
      assert.equal(result.unchanged, true); assert.equal(result.mode, "sdf");
      assert.ok(Math.abs(result.opacity - .8) < 1e-6, "Timeline still controls fallback text material.");
      assert.ok(result.progress.some(([done, total]) => total === 7 && (result.sdf || done === 7)));
      if (input.font?.includes("kenpixel")) { assert.equal(result.sdf, true); assert.equal(result.diagnostics.length, 0); }
      else assert.ok(result.diagnostics.some(item => item.code === "TEXT_SDF_FALLBACK"));
    }
  }
  await page.evaluate(() => window.checkCard());
  await page.waitForFunction(() => /首帧|first frame/i.test(document.querySelector('.sceneCardLoadingMask')?.textContent || ''));
  await page.evaluate(() => window.testCard.pending);
  const cardResult = await page.evaluate(async () => ({
    maskHidden:document.querySelector('.sceneCardLoadingMask').hidden,
    visibleCanvas:[...document.querySelectorAll('canvas')].some(canvas=>canvas.style.visibility==='visible'),
    hasPlayer:!!document.querySelector('input[aria-label="Video time"]'),
    hasWarning:document.body.textContent.includes('TEXT_SDF_FALLBACK'),
    sourcePreserved:JSON.stringify(JSON.parse(await testCard.card.exportSceneJsonString()))===JSON.stringify(testCard.film)
  }));
  results.push({ cardResult }); console.log(JSON.stringify(cardResult));
  assert.ok(Object.values(cardResult).every(Boolean));
  await page.screenshot({path:path.join(output,'mobile-video-card.png')});
  await page.evaluate(()=>testCard.card.dispose());
  // Troika's fallback-font client emits an unhandled fetch rejection when its
  // CDN is unavailable; the ThreeJSON readiness watchdog must still recover.
  assert.ok(errors.every(error => /fetch|Failed to fetch|Load failed/i.test(error)), JSON.stringify(errors));
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify({ results, errors }, null, 2));
  console.log(`Report: ${output}`);
}
