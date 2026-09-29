import test from "node:test";
import assert from "node:assert/strict";
import { createAudioModelManager, validateAudioModelManifest } from "../packages/audio-kit/js/models.js";
import { createSherpaOnnxAudioProducer } from "../packages/audio-kit/js/sherpa.js";
import { selectMediaAnalysisRoute, analyzeMediaReference } from "../packages/media-kit/js/reconstruction.js";
import { createNodeAudioModelStorage } from "../packages/audio-kit/js/nodeModels.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function fixture(){
  const blob=new Blob([new Uint8Array([1,2,3,4])]),bytes=blob.size,sha256=[...new Uint8Array(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,"0")).join("");
  const files=new Map(),storage={async getJson(k){return files.get(k);},async putJson(k,v){files.set(k,structuredClone(v));},async getBlob(k){return files.get(k);},async remove(k){files.delete(k);},async list(){return [...files.keys()];},async createWriter(k){const chunks=[];return{async write(v){chunks.push(v);},async close(){files.set(k,new Blob(chunks));},async abort(){}};}};
  return{blob,storage,files,manifest:{id:"fixture",version:"1",adapter:"test-only",license:"test-fixture",files:[{role:"model",bytes,sha256}]}};
}
test("model installs are explicit, checked, transactional and protected by leases",async()=>{
  const f=await fixture(),manager=createAudioModelManager(f.storage);
  assert.equal((await manager.status(f.manifest)).status,"missing");
  await manager.import(f.manifest,{model:f.blob});
  const lease=await manager.acquire(f.manifest);assert.equal(lease.files.model.size,4);
  await assert.rejects(manager.remove(f.manifest),{code:"AUDIO_MODEL_BUSY"});lease.release();
  await assert.rejects(manager.import(f.manifest,{model:new Uint8Array([1,2,3,5])}),{code:"AUDIO_MODEL_HASH_MISMATCH"});
  assert.equal((await manager.status(f.manifest)).status,"ready");
  assert.equal(f.files.size,2);
  const old=(await manager.list())[0].files[0].storageKey,remove=f.storage.remove;
  f.storage.remove=async(key)=>{if(key===old)throw new Error("Simulated old-file cleanup failure");return remove(key);};
  await manager.import(f.manifest,{model:f.blob});assert.equal((await manager.status(f.manifest)).status,"ready");
  f.storage.remove=remove;await manager.remove(f.manifest);assert.equal((await manager.status(f.manifest)).status,"missing");
});
test("invalid models and cancelled installs never become ready",async()=>{
  const f=await fixture(),manager=createAudioModelManager(f.storage),controller=new AbortController();controller.abort();
  await assert.rejects(manager.import(f.manifest,{model:f.blob},{signal:controller.signal}),{name:"AbortError"});assert.equal(f.files.size,0);
  assert.throws(()=>validateAudioModelManifest({...f.manifest,files:[{...f.manifest.files[0],role:"__proto__"}]}));
});

test("Node cache supports Unicode identities and non-colliding model/version keys", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "threejson-model-test-"));
  try {
    const f = await fixture(), storage = await createNodeAudioModelStorage(directory), manager = createAudioModelManager(storage);
    const models = [{ ...f.manifest, id: "语音！", version: "v1" }, { ...f.manifest, id: "a-b", version: "c" }, { ...f.manifest, id: "a", version: "b-c" }];
    for (const model of models) await manager.import(model, { model: f.blob });
    assert.equal((await manager.list()).length, 3);
    for (const model of models) { const lease = await manager.acquire(model); assert.equal(lease.files.model.size, 4); lease.release(); await manager.remove(model); }
    assert.equal((await manager.list()).length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("sherpa adapter mounts verified files and returns real runtime PCM contract, not WebSpeech",async()=>{
  const f=await fixture(),manager=createAudioModelManager(f.storage);await manager.import(f.manifest,{model:f.blob});
  const mounted=new Map();let freed=0;
  const producer=createSherpaOnnxAudioProducer({modelManager:manager,model:f.manifest,config:{model:{file:"model"}},loadRuntime:async()=>({Module:{FS:{mkdir(){},rmdir(){},writeFile(p,data){mounted.set(p,data);},unlink(p){mounted.delete(p);}}},createOfflineTts(Module,config){assert.ok(mounted.has(config.model));return{handle:1,sampleRate:16000,generate({text}){assert.equal(text,"hello");return{samples:new Float32Array([.2,-.2]),sampleRate:16000};},free(){freed++;}};}})});
  const pcm=await producer.synthesize({text:"hello"});assert.equal(pcm.sampleRate,16000);assert.equal(pcm.channels[0].length,2);
  await assert.rejects(manager.remove(f.manifest),{code:"AUDIO_MODEL_BUSY"});producer.dispose();assert.equal(freed,1);assert.equal(mounted.size,0);await manager.remove(f.manifest);
});
test("reverse-media seam negotiates declared modalities without making a provider call implicitly",async()=>{
  assert.equal(selectMediaAnalysisRoute({inputModalities:["video","image"]},"video"),"video");
  assert.equal(selectMediaAnalysisRoute({inputModalities:["image"]},"video"),"frames");
  assert.throws(()=>selectMediaAnalysisRoute({inputModalities:["text"]},"image"),{code:"MEDIA_ANALYSIS_UNAVAILABLE"});
  const analyzer={capabilities:{inputModalities:["image"]},async analyze({reference,userPrompt}){return `${userPrompt}:${reference.frames[0].time}`;}};
  await assert.rejects(analyzeMediaReference({kind:"video",source:"local-reference"},{analyzer}),{code:"MEDIA_FRAME_EXTRACTOR_UNAVAILABLE"});
  const result=await analyzeMediaReference({kind:"video",source:"local-reference"},{analyzer,userPrompt:"Describe",extractFrames:async()=>[{time:0,source:"frame0"}]});
  assert.equal(result.analysis,"Describe:0");assert.equal(result.reconstruction,"approximate");assert.equal(result.kind,"media-analysis");
});
