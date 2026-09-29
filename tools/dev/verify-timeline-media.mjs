/** Real installed-browser media smoke checks. No downloaded browser or paid API. */
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderSceneMedia } from "../../packages/scene-tools/js/media.js";
import { Input, BufferSource, ALL_FORMATS } from "mediabunny";
import gifenc from "gifenc";
import { chromium } from "playwright";
import { packMediaDocument } from "../../packages/media-kit/js/documents.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/timeline-media", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const executablePath = process.env.THREEJSON_BROWSER;
if (!executablePath) throw new Error("Set THREEJSON_BROWSER to an installed Edge/Chrome executable.");
const scene = {
  sceneConfig: { scene: { background: "#14283f" }, camera: { position: {x:0,y:2,z:7}, lookAt: {x:0,y:0,z:0} } },
  objectList: [{ objType: "box", threeJsonId: "cube", width: 2, height: 2, depth: 2, material: { type: "basic", color: "#ffb020" } }],
  timeline: { duration: 2, tracks: [{ id: "spin", target: "cube", property: "rotation.y", keyframes: [{ time: 0, value: 0 }, { time: 2, value: 3.14 }] }],
    captions: [{ id: "title", text: "ThreeJSON Timeline", start: 0, duration: 2 }],
    audio: [{ id: "score", duration: 2, padSilence: true, recipe: { kind: "score", score: { version: 1, tracks: [{ id: "piano", instrument: "soft-piano", notes: [{ id: "a", tick: 0, duration: 960, pitch: 60 }, { id: "b", tick: 960, duration: 960, pitch: 67 }] }] } } }] }
};
const reports = [];
for (const format of ["png", "gif", "mp4", "webm"]) {
  const file = path.join(output, `timeline.${format}`);
  const result = await renderSceneMedia({ json: scene, output: file, format, executablePath, mediaOptions: { width: 480, height: 270, fps: 12 } });
  if (result.ok) {
    const bytes = await readFile(file); result.bytes = bytes.length;
    if (format === "mp4" || format === "webm") {
      const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
      try { const video = await input.getPrimaryVideoTrack(), audio = await input.getPrimaryAudioTrack(); result.decodedMetadata = { duration: await input.computeDuration(), width: video.displayWidth, height: video.displayHeight, audio: Boolean(audio) }; if (!audio || Math.abs(result.decodedMetadata.duration - 2) > .15) result.ok = false; }
      finally { input.dispose(); }
    }
  }
  reports.push({ format, ...result }); console.log(JSON.stringify(reports.at(-1)));
}
const composition = { documentType: "composition", compositionVersion: 1, scenes: { a: scene, b: { ...scene, objectList: [{ ...scene.objectList[0], material: { type: "basic", color: "#30eecc" } }] } }, timeline: { duration: 3, clips: [{ id: "a", source: "a", start: 0, duration: 2 }, { id: "b", source: "b", start: 1, duration: 2, fadeIn: 1 }] } };
const compositionResult = await renderSceneMedia({ json: composition, output: path.join(output, "composition.webm"), format: "webm", executablePath, mediaOptions: { width: 480, height: 270, fps: 12, trimAudio: true } });
reports.push({ composition: true, ...compositionResult }); console.log(JSON.stringify(reports.at(-1)));
// A packed composition must use the same decoder and playback, not a cube fallback.
const archiveFile = path.join(output, "composition.tjz");
await writeFile(archiveFile, await packMediaDocument(composition));
const packed = await renderSceneMedia({ file: archiveFile, output: path.join(output,"packed.png"), executablePath, mediaOptions: { width:480,height:270,time:1.5 } });
reports.push({ packed: true, ...packed }); console.log(JSON.stringify(reports.at(-1)));

// Verify the optional GIF texture decoder, exact timestamp sampling and local
// peer bundling with real decoded pixels (no CDN or canvas-existence-only test).
const gif = gifenc.GIFEncoder();
gif.writeFrame(new Uint8Array(4),2,2,{palette:[[255,0,0],[0,255,0]],delay:100,repeat:0});
gif.writeFrame(new Uint8Array(4).fill(1),2,2,{palette:[[255,0,0],[0,255,0]],delay:100});gif.finish();
const textureScene = { sceneConfig: { renderer:{toneMapping:"none"}, camera:{position:{x:0,y:0,z:5}} }, objectList:[{objType:"plane",threeJsonId:"screen",geometry:{width:4,height:4},material:{type:"basic",color:"#ffffff",textureKind:"gif",textureUrl:`data:image/gif;base64,${Buffer.from(gif.bytes()).toString("base64")}`}}],timeline:{duration:1} };
const browser=await chromium.launch({executablePath,headless:true});
try {
  for(const [time,channel] of [[.05,0],[.15,1]]) {
    const file=path.join(output,`gif-texture-${channel}.png`),result=await renderSceneMedia({json:textureScene,output:file,executablePath,mediaOptions:{width:64,height:64,time}});
    if(result.ok){
      const page=await browser.newPage();
      result.pixel=await page.evaluate(async(base64)=>{const blob=await(await fetch(`data:image/png;base64,${base64}`)).blob(),bitmap=await createImageBitmap(blob),canvas=document.createElement("canvas");canvas.width=64;canvas.height=64;const ctx=canvas.getContext("2d");ctx.drawImage(bitmap,0,0);return [...ctx.getImageData(32,32,1,1).data];},(await readFile(file)).toString("base64"));
      result.ok=result.pixel[channel]>220&&result.pixel[1-channel]<30;await page.close();
    }
    reports.push({gifTexture:time,...result});console.log(JSON.stringify(reports.at(-1)));
  }
}finally{await browser.close();}
const cancelledFile=path.join(output,"cancelled.mp4"),controller=new AbortController();
const cancelled=await renderSceneMedia({json:scene,output:cancelledFile,executablePath,signal:controller.signal,onProgress:()=>controller.abort(),mediaOptions:{width:480,height:270,fps:12}});
const outputRemoved=await access(cancelledFile).then(()=>false,()=>true);
reports.push({cancellation:true,ok:cancelled.status==="cancelled"&&outputRemoved,status:cancelled.status,outputRemoved});console.log(JSON.stringify(reports.at(-1)));
if (process.env.MEDIA_LONG === "1") {
  const longScene = structuredClone(scene);longScene.timeline.duration=60;longScene.timeline.tracks[0].keyframes[1]={time:60,value:Math.PI*12};longScene.timeline.audio[0].duration=60;longScene.timeline.audio[0].loop=true;
  const result = await renderSceneMedia({ json:longScene, output:path.join(output,"minute-1080p.mp4"), format:"mp4", executablePath, timeoutMs:900000, mediaOptions:{width:1920,height:1080,fps:30} });
  if(result.ok){const input=new Input({source:new BufferSource(await readFile(result.output)),formats:ALL_FORMATS});try{const video=await input.getPrimaryVideoTrack();result.decodedMetadata={duration:await input.computeDuration(),width:video.displayWidth,height:video.displayHeight,audio:Boolean(await input.getPrimaryAudioTrack())};result.ok=result.decodedMetadata.audio&&Math.abs(result.decodedMetadata.duration-60)<.15;}finally{input.dispose();}}
  reports.push({long1080p:true,...result});console.log(JSON.stringify(reports.at(-1)));
}
await writeFile(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
console.log(`Report: ${output}`);
if (reports.some((entry) => !entry.ok)) process.exitCode = 1;
