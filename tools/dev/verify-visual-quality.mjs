/** Offline, real-browser visual baselines. No provider calls, paid services or downloads. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const out = path.join(root, "dist/visual-quality-verification");
await mkdir(out, { recursive: true });
if (!process.env.THREEJSON_BROWSER) throw new Error("Set THREEJSON_BROWSER to an installed browser; this verifier never downloads one.");
const bundle = await build({ absWorkingDir: root, stdin: { resolveDir: root, contents: `
import './builtins/register.js';
import {createJsonScene} from './core/runtime.js';
import * as quality from './core/visualQuality.js';
import {resolveCreationQuality} from './tools/scene-host/shared/js/creationQualityPolicy.js';
import {createHostPreviewPerformance} from './tools/scene-host/shared/js/previewPerformancePolicy.js';
import {inspectSceneQuality,inspectMediaQuality} from './tools/scene-host/shared/js/sceneQualityReview.js';
import {createMediaProject} from './packages/media-kit/js/index.js';
import {applyRuntimeSceneConfigToPayload} from './core/util/sceneRuntimeConfigExport.js';
window.verify={createJsonScene,quality,resolveCreationQuality,createHostPreviewPerformance,inspectSceneQuality,inspectMediaQuality,createMediaProject,applyRuntimeSceneConfigToPayload};
` }, bundle: true, format: "esm", write: false, logLevel: "silent" });
const { server, port } = await startStaticServer(root); let browser;
const errors = [], blockedRequests = [], results = [];
try {
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER, headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    if (route.request().url() === `http://127.0.0.1:${port}/__visual-test`) return route.fulfill({ contentType: "text/html", body: "<!doctype html><html><head><meta charset=utf-8></head><body></body></html>" });
    if (!route.request().url().startsWith(`http://127.0.0.1:${port}/`)) { blockedRequests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(`http://127.0.0.1:${port}/__visual-test`);
  await page.evaluate(() => { document.body.replaceChildren(); document.body.style.cssText = "margin:0;background:#10141d;color:white"; });
  await page.addScriptTag({ type: "module", content: bundle.outputFiles[0].text });
  await page.waitForFunction(() => window.verify);
  for (const name of ["ceramic", "brushedMetal", "glass", "night", "interior", "closed-loft", "diagram-text"]) {
    const result = await page.evaluate(async name => {
      const { createJsonScene, quality, createMediaProject, applyRuntimeSceneConfigToPayload } = window.verify;
      const config = quality.createLightingRecipe(name === "night" || name === "interior" ? name : name === "diagram-text" ? "diagram" : "product", { center: [0, 0, 0], size: 2.5 });
      config.scene.background = name === "diagram-text" ? "#071122" : "#263443";
      config.camera = quality.createFramingCamera({ bounds: { min: [-1,-1,-1], max: [1,1,1] }, occupancy: .8 });
      config.controls = { type: "none" }; config.renderLoop = { autoStart: false, autoResize: false };
      config.renderer = { ...config.renderer, ratioRate: 1, antialias: true, preserveDrawingBuffer: true };
      config.scene.environmentRotation = { y: .4 };
      const material = quality.createMaterialRecipe(["ceramic", "brushedMetal", "glass"].includes(name) ? name : "ceramic");
      const object = name === "closed-loft" ? { objType: "loftMesh", geometry: { sections: [[[1,-1,0],[0,-1,1],[-1,-1,0],[0,-1,-1]], [[.6,1,0],[0,1,.6],[-.6,1,0],[0,1,-.6]]], caps: true } }
        : name === "diagram-text" ? { objType: "text", mode: "mesh", content: "E = hv", fontSize: .55, color: "#6bcaff", position: { x: -1, y: -.2, z: 0 }, mesh: { fontJsonUrl: `${location.origin}/assets/fonts/helvetiker_bold.typeface.json`, depth: .05 } }
        : { objType: "implicitSurface", geometry: { resolution: 22, sdf: { type: "sphere", radius: 1 } } };
      const source = { version: "next", objectList: [{ ...object, threeJsonId: "hero", material }], sceneConfig: config };
      const canvas = document.createElement("canvas"); document.body.append(canvas);
      const start = performance.now(), runtime = await createJsonScene(source, { canvas, viewportSize: { width: 640, height: 360 } });
      try {
        await runtime.renderer.compileAsync(runtime.scene, runtime.camera); await runtime.renderOnce();
        const capture = await quality.captureSceneFrame(runtime), observation = quality.observeSceneRuntime(runtime, { occlusion: true });
        const readback = document.createElement("canvas"); readback.width = canvas.width; readback.height = canvas.height;
        const context = readback.getContext("2d"); context.drawImage(canvas, 0, 0); const pixels = context.getImageData(0,0,canvas.width,canvas.height).data;
        const background = [...pixels.slice(0,3)]; let subjectPixels = 0;
        for (let i = 0; i < pixels.length; i += 4) if (Math.max(...background.map((v,j) => Math.abs(pixels[i+j]-v))) > 20) subjectPixels++;
        const roundtrip = structuredClone(source);
        applyRuntimeSceneConfigToPayload(roundtrip, runtime, runtime.scene);
        const reopened = await createJsonScene(roundtrip, { canvas: document.createElement("canvas"), viewportSize: { width:640, height:360 } });
        let reopenError, exportError;
        const difference = image => {
          context.clearRect(0,0,640,360); context.drawImage(image,0,0,640,360);
          const other = context.getImageData(0,0,640,360).data;
          return other.reduce((sum,v,i) => sum + Math.abs(v-pixels[i]),0)/pixels.length;
        };
        try { await quality.captureSceneFrame(reopened); reopenError = difference(reopened.renderer.domElement); }
        finally { reopened.dispose(); }
        const media = await createMediaProject({ documentType:"composition",compositionVersion:1,output:{width:640,height:360,fps:30},scenes:{a:roundtrip},timeline:{version:1,clips:[{id:"a",source:"a",start:0,duration:1}]} }, {width:640,height:360,preloadNext:false});
        try { exportError = difference(await media.renderAt(0)); } finally { media.dispose(); }
        window.lastSource = source;
        return { name, image: capture.views[0].dataUrl, subjectPixels, reopenMeanChannelError:reopenError, exportFrameMeanChannelError:exportError, loadAndCompileMs: performance.now()-start, renderer: runtime.renderer.info.render, geometries: runtime.renderer.info.memory, observation, lightCount: observation.lights.length };
      } finally { runtime.dispose(); canvas.remove(); }
    }, name);
    await writeFile(path.join(out, `${name}.png`), Buffer.from(result.image.split(",")[1], "base64")); delete result.image;
    results.push(result);
    assert.ok(result.subjectPixels > 300, `${name}: no discernible subject; ${JSON.stringify(result.observation)}`);
    assert.ok(!result.observation.warnings.some(w => w.severity === "error"), JSON.stringify(result.observation.warnings));
    assert.ok(result.reopenMeanChannelError < .5, `${name}: reopen differs from preview by ${result.reopenMeanChannelError}/255`);
    assert.ok(result.exportFrameMeanChannelError < .5, `${name}: export frame differs from preview by ${result.exportFrameMeanChannelError}/255`);
    console.log(`${name}: ${result.subjectPixels} subject pixels, ${Math.round(result.loadAndCompileMs)} ms`);
  }
  const video = await page.evaluate(async () => {
    const { createMediaProject, inspectMediaQuality, resolveCreationQuality } = window.verify;
    const source = structuredClone(window.lastSource);
    const film = { documentType: "composition", compositionVersion: 1, output: { width: 640, height: 360, fps: 30 }, scenes: { a: source }, timeline: { version: 1, clips: [{ id: "a", source: "a", start: 0, duration: 90 }], captions: [{ id: "caption", text: "光的能量 · Energy", start: 1, duration: 80, fontSize: 24 }] } };
    const project = await createMediaProject(film, { width: 640, height: 360, preloadNext: false });
    try {
      const frames = [];
      for (const time of [2, 44, 88, 2]) { const started = performance.now(); const canvas = await project.renderAt(time); frames.push({ time, renderMs: performance.now()-started, image: canvas.toDataURL() }); }
      const observed = await inspectMediaQuality(film, { profile: resolveCreationQuality("standard") });
      return { frames, observed: { ...observed, views: observed.views.map(({ dataUrl, ...view }) => view) } };
    } finally { project.dispose(); }
  });
  assert.equal(video.frames[0].image, video.frames[3].image, "Random seek must reproduce the same frame");
  assert.ok(video.observed.available); assert.equal(video.observed.imageSampleCount, 3);
  for (const frame of video.frames) { await writeFile(path.join(out, `video-${frame.time}.png`), Buffer.from(frame.image.split(",")[1], "base64")); delete frame.image; }
  results.push({ name: "90s-film-seek", ...video });
  const preview = await page.evaluate(async () => {
    const { createJsonScene, createMediaProject, createHostPreviewPerformance } = window.verify;
    const positions = Array.from({ length: 100000 }, (_, i) => [(i % 400) / 100 - 2, Math.floor(i / 400) / 100 - 1.25, Math.sin(i / 97) * .05]);
    const source = { version:"next", sceneConfig:{ scene:{background:"#050812"},camera:{position:{x:0,y:0,z:6}},controls:{type:"none"},renderLoop:{autoStart:false,autoResize:false},renderer:{preserveDrawingBuffer:true} },objectList:[{objType:"points",threeJsonId:"dense",positions,material:{size:.01,color:"#99ddff"}}] };
    const before = JSON.stringify(source), canvas=document.createElement("canvas");
    let budget = createHostPreviewPerformance("economy").getBudget();
    const runtime=await createJsonScene(source,{canvas,viewportSize:{width:1920,height:1080},previewPerformance:{getBudget:()=>budget}});
    let statistics;
    try {
      for (let i=0;i<12;i++) runtime.renderLoop.renderCurrentFrame();
      let original; runtime.scene.traverse(o=>{ if(o.isPoints) original=o.geometry; });
      statistics={defaultPointsDrawn:runtime.renderer.info.render.points,width:canvas.width,height:canvas.height,sourcePoints:original.attributes.position.count,sourceIndex:original.index};
      budget = createHostPreviewPerformance("economy",{allowPointSampling:true}).getBudget();
      for (let i=0;i<12;i++) runtime.renderLoop.renderCurrentFrame();
      statistics.pointsDrawn=runtime.renderer.info.render.points; statistics.geometries=runtime.renderer.info.memory.geometries;
      budget = {};
      runtime.renderLoop.renderCurrentFrame();
      statistics.restoredPoints=runtime.renderer.info.render.points; statistics.restoredWidth=canvas.width;
    } finally { runtime.dispose(); }
    // Export's frame producer defaults to full, even on an economy preview device.
    const full=await createMediaProject(source,{width:1920,height:1080});
    try { await full.renderAt(0); statistics.exportMode=full.previewPerformance; statistics.exportWidth=full.canvas.width; }
    finally { full.dispose(); }
    statistics.unchanged=before===JSON.stringify(source); return statistics;
  });
  assert.equal(preview.defaultPointsDrawn,100000); assert.equal(preview.pointsDrawn,40000); assert.equal(preview.sourcePoints,100000); assert.equal(preview.sourceIndex,null);
  assert.equal(preview.restoredPoints,100000); assert.equal(preview.restoredWidth,1920);
  assert.equal(preview.width,720); assert.equal(preview.height,405); assert.equal(preview.unchanged,true); assert.equal(preview.exportMode,"full"); assert.equal(preview.exportWidth,1920);
  assert.ok(preview.geometries <= 2, "Preview must not leak one sampling geometry per frame");
  results.push({name:"device-preview-source-and-export-isolation",...preview});
  assert.deepEqual(errors, []); assert.deepEqual(blockedRequests, []);
  console.log(`PASS: ${results.length} visual checks. ${out}`);
} finally {
  await writeFile(path.join(out, "report.json"), JSON.stringify({ results, errors, blockedRequests }, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
