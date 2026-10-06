import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";

// Offline real-renderer regression: supplied scene, particle shader opacity and
// both host routing/Stop boundaries. Never contact a real AI or external CDN.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/video-particle-opacity", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const bundle = await build({ stdin: { resolveDir: root, contents: `
  import * as THREE from 'three';
  import {createJsonScene, getObjectByThreeJsonId} from 'threejson';
  import {runThreeBoxGenerateTurn} from './tools/scene-host/threebox/js/threeBoxOrchestrator.js';
  import {runSceneAgentGenerateTurn} from './packages/scene-agent-kit/js/controller.js';
  import {loadHostLocaleCatalog} from './tools/scene-host/shared/i18n/index.js';
  import {loadHostLocaleCatalog as loadPackagedLocale} from './packages/host-kit/i18n/index.js';
  import fixture from './tests/fixtures/double-slit-video-particle-opacity.json';
  let runtime;
  async function mount(source){
    runtime?.dispose(); const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    document.body.replaceChildren(canvas);
    const renderer=new THREE.WebGLRenderer({canvas,preserveDrawingBuffer:true});renderer.setSize(640,360);
    runtime=await createJsonScene(source,{canvas,renderer,textLoadTimeoutMs:400});
    runtime.renderLoop?.stop();return canvas;
  }
  function pixels(canvas){
    const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
    const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);const data=ctx.getImageData(0,0,copy.width,copy.height).data;
    let lit=0,energy=0;for(let i=0;i<data.length;i+=4){if(Math.max(data[i],data[i+1],data[i+2])>90)lit++;energy+=data[i]+data[i+1]+data[i+2];}
    return {lit,energy};
  }
  window.fixtureCheck=async()=>{
    const before=JSON.stringify(fixture),canvas=await mount(fixture),frames=[];
    for(const time of [0,6,12,18,24,6]){
      await runtime.timeline.renderAt(time);const beam=getObjectByThreeJsonId('electron-beam',runtime.scene);
      frames.push({time,...pixels(canvas),opacity:beam.render.opacity,uniform:beam.material.uniforms.opacity.value});
    }
    return {frames,unchanged:JSON.stringify(fixture)===before,diagnostics:runtime.runtimeContext.resourceDiagnostics};
  };
  window.opacityCheck=async(backend,type,property)=>{
    const source={version:'next',sceneConfig:{scene:{background:'#000000'},camera:{position:{x:0,y:0,z:6}},controls:{type:'none'},renderLoop:{autoStart:false}},
      objectList:[{objType:'particleEmitter',threeJsonId:'p',source:{type:'positions',positions:[0,0,0]},emission:{count:1,mode:'static',seed:4},
        particle:{lifetime:0,opacityOverLife:[0.5,0.5]},simulation:{backend},render:{type,size:40,sizeAttenuation:false,opacity:0.8,blending:'additive'}}],
      timeline:{duration:1,tracks:[{id:'fade',target:'p',property,keyframes:[{time:0,value:0},{time:1,value:1}]}]}};
    const before=JSON.stringify(source),canvas=await mount(source),frames=[];
    for(const time of [0,1,0.5,0]){await runtime.timeline.renderAt(time);frames.push({time,...pixels(canvas)});}
    return {backend,type,property,frames,unchanged:JSON.stringify(source)===before};
  };
  window.stopCheck=async(packaged)=>{
    runtime?.dispose();runtime=null;await loadHostLocaleCatalog('zh-CN');await loadPackagedLocale('zh-CN');
    document.body.innerHTML='<p id="route" role="status"></p><button id="stop">停止</button>';
    const controller=new AbortController();document.querySelector('#stop').onclick=()=>controller.abort();let authoringCalls=0;
    const run=packaged?runSceneAgentGenerateTurn:runThreeBoxGenerateTurn;
    window.pendingStop=run({userPrompt:'用视频科普一下双缝干涉实验',outputKind:'video',signal:controller.signal,
      onOutputKind:async({message})=>{document.querySelector('#route').textContent=message;await new Promise(resolve=>controller.signal.addEventListener('abort',resolve,{once:true}));},
      request:async()=>{authoringCalls++;throw new Error('Must not author after Stop');}
    }).then(()=>({aborted:false,authoringCalls}),error=>({aborted:error.name==='AbortError',authoringCalls}));
  };
` }, bundle: true, format: "esm", write: false, logLevel: "silent", external: ["node:fs/promises", "node:url"] });
const { server, port } = await startStaticServer(root);
let browser; const results = [], errors = [], shaderErrors = [];
try {
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 680, height: 400 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (/WebGLProgram|VALIDATE_STATUS|Shader Error/i.test(message.text())) shaderErrors.push(message.text()); });
  await page.route(/^https:\/\//, route => route.abort());
  // Bundling moves import.meta.url to the test entry; serve locale modules at
  // that entry's relative URL without changing the production locale loader.
  await page.route("**/locales/*.json", route => route.fulfill({ path: path.join(root, "tools/scene-host/shared/i18n/locales", path.basename(new URL(route.request().url()).pathname)) }));
  await page.route("**/__particle_check", route => route.fulfill({ contentType: "text/html", body: '<link rel="stylesheet" href="/tools/scene-host/threebox/css/threebox.css"><script type="module" src="/__particle_check.js"></script>' }));
  await page.route("**/__particle_check.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto(`http://127.0.0.1:${port}/__particle_check`);
  await page.waitForFunction(() => typeof window.fixtureCheck === "function");
  const fixture = await page.evaluate(() => window.fixtureCheck()); results.push({ fixture });
  assert.equal(fixture.unchanged, true);
  for (const frame of fixture.frames) { assert.ok(frame.lit > 20, JSON.stringify(frame)); assert.equal(frame.opacity, frame.uniform); }
  await page.screenshot({ path: path.join(output, "double-slit-frame.png") });
  for (const backend of ["cpu", "webgl-compute"]) for (const type of ["points", "billboard"]) for (const property of ["render.opacity", "material.opacity"]) {
    const result = await page.evaluate(({backend,type,property}) => window.opacityCheck(backend,type,property), {backend,type,property});
    results.push(result); const [off,on,half,offAgain] = result.frames;
    assert.equal(off.energy, 0); assert.equal(offAgain.energy, 0); assert.ok(on.energy > half.energy && half.energy > 0, JSON.stringify(result));
    assert.equal(result.unchanged, true);
  }
  await page.setViewportSize({width:320,height:700});
  for (const packaged of [false,true]) {
    await page.evaluate(packaged=>window.stopCheck(packaged),packaged);
    await page.getByText('将生成视频。如判断有误，可点击停止。').waitFor();
    await page.screenshot({path:path.join(output,packaged?'packaged-stop.png':'native-stop.png')});
    await page.getByRole('button',{name:'停止'}).click();
    const stopped=await page.evaluate(()=>window.pendingStop);results.push({packaged,stopped});
    assert.deepEqual(stopped,{aborted:true,authoringCalls:0});
  }
  assert.deepEqual(shaderErrors, []);
  assert.ok(errors.every(error=>/fetch|Failed to fetch|Load failed/i.test(error)),JSON.stringify(errors));
  console.log(JSON.stringify(results));
} finally {
  await browser?.close(); await new Promise(resolve=>server.close(resolve));
  await writeFile(path.join(output,"report.json"),JSON.stringify({results,errors,shaderErrors},null,2));
  console.log(`Report: ${output}`);
}
