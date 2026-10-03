import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";

// Real native/React cards, offline deterministic provider fixtures, isolated server.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/video-production-feedback", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const bundle = await build({ stdin: { resolveDir: root, contents: `
  import {createElement} from 'react';
  import {createRoot} from 'react-dom/client';
  import {SceneAgentSceneCard} from './packages/react-scene-agent/src/SceneAgentSceneCard.js';
  import {createThreeBoxSceneCard} from './tools/scene-host/threebox/js/threeBoxSceneCard.js';
  import {createThreeBoxChatPanel} from './tools/scene-host/threebox/js/threeBoxChatPanel.js';
  import {runAiVideoTurn} from './packages/host-kit/js/videoTurn.js';
  import {getMediaContinuation} from './packages/host-kit/js/mediaProductionFeedback.js';
  import {loadHostLocaleCatalog} from './tools/scene-host/shared/i18n/index.js';
  import fixture from './tests/fixtures/video-storyboard-paused.json';
  window.fixture=fixture; let mounted;
  window.mountCard=async(react=false,source=fixture)=>{
    mounted?.(); await loadHostLocaleCatalog('zh-CN'); document.documentElement.lang='zh-CN';
    const container=document.createElement('main');document.body.replaceChildren(container);
    let card;
    if(react){const root=createRoot(container);mounted=()=>root.unmount();
      card=await new Promise(resolve=>root.render(createElement(SceneAgentSceneCard,{managed:true,onReady:card=>card&&resolve(card)})));
    }else{card=createThreeBoxSceneCard();container.append(card.el);mounted=()=>card.dispose();}
    window.card=card;window.source=source;await card.render(source);return true;
  };
  window.resume=async()=>{
    let round=0;const ids=Object.keys(fixture.scenes);
    const result=await runAiVideoTurn({project:fixture,userPrompt:getMediaContinuation(fixture).prompt,request:async()=>{
      if(round>=ids.length)return {message:{role:'assistant',content:'# done'}};
      const id=ids[round++];const command={op:'media.shot.put',args:{id,scene:{version:'next',
        sceneConfig:{scene:{background:'#071422'},camera:{position:{x:0,y:0,z:8},lookAt:{x:0,y:0,z:0}},controls:{type:'none'}},
        objectList:[{objType:'sphere',threeJsonId:'actor',geometry:{radius:1.3},material:{type:'basic',color:'#3adaff'}}],
        timeline:{duration:22,tracks:[{id:'motion',target:'actor',property:'position.x',keyframes:[{time:0,value:-1},{time:22,value:1}]}]}},metadata:{stage:'complete'}}};
      return {message:{role:'assistant',content:'\x60\x60\x60jsonl\\n'+JSON.stringify(command,null,2)+'\\n\x60\x60\x60'}};
    }});window.resumed=result;await card.render(result.sceneJson);return result.agentResult.completed;
  };
  window.partial=async()=>{
    const source=structuredClone(resumed.sceneJson);for(const id of ['shot1','shot3','shot4']){source.scenes[id]=fixture.scenes[id];source.production.shots[id].stage='planned';}
    source.production.state='paused';source.production.stopReason='provider_or_execution_failed';source.production.lastError='Fixture provider offline';
    await card.render(source);return JSON.parse(await card.exportSceneJsonString());
  };
  window.dispose=()=>mounted?.();
  window.checkContinuationRoute=async()=>{
    mounted?.();document.body.innerHTML='<div id="chatMessages"></div><textarea id="composerInput"></textarea><button id="composerSendBtn"></button>';
    let received;const panel=createThreeBoxChatPanel({onUserMessage:async(text,api,route)=>{received={text,route};api.finishInitialActivity('Fixture continuation');}});
    const continuation=getMediaContinuation(fixture);await panel.sendMessage(continuation.prompt,{intent:'adjust',targetTurnId:'saved-video-turn'});
    return received;
  };
` }, bundle: true, format: "esm", write: false, logLevel: "silent" });
const { server, port } = await startStaticServer(root);
let browser; const results = [], errors = [];
try {
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, route => route.abort());
  await page.route("**/__production", route => route.fulfill({ contentType: "text/html", body: '<link rel="stylesheet" href="/tools/scene-host/threebox/css/threebox.css"><style>body{padding:12px;background:#202124;color:#eee}main{width:100%}.sceneCardCanvasWrap{height:300px!important;min-height:300px!important}</style><script type="module" src="/__production.js"></script>' }));
  await page.route("**/__production.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto(`http://127.0.0.1:${port}/__production`);
  await page.waitForFunction(() => typeof window.mountCard === "function");
  for (const react of [false, true]) {
    await page.evaluate(react => window.mountCard(react), react);
    await page.waitForFunction(() => !document.querySelector('.sceneCardLoadingMask:not([hidden])'));
    const planned = await page.evaluate(async () => ({
      notice:document.querySelector('.mediaProductionNotice')?.textContent,
      player:!!document.querySelector('input[aria-label="Video time"]'),
      shots:document.querySelectorAll('.mediaProductionNotice li').length,
      unchanged:JSON.stringify(JSON.parse(await card.exportSceneJsonString()))===JSON.stringify(fixture),
      overflow:document.documentElement.scrollWidth>innerWidth
    }));
    assert.match(planned.notice,/尚未生成可播放画面/);assert.match(planned.notice,/repeated_invalid_output/);
    assert.equal(planned.player,false);assert.equal(planned.shots,4);assert.equal(planned.unchanged,true);assert.equal(planned.overflow,false);
    await page.screenshot({path:path.join(output,react?'react-storyboard.png':'native-storyboard.png')});
    assert.equal(await page.evaluate(()=>window.resume()),true);
    await page.waitForFunction(()=>!!document.querySelector('input[aria-label="Video time"]'));
    const produced=await page.evaluate(()=>{
      const canvas=document.querySelector('canvas'),copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
      const ctx=copy.getContext('2d');ctx.drawImage(canvas,0,0);const data=ctx.getImageData(0,0,copy.width,copy.height).data;let bright=0;
      for(let i=0;i<data.length;i+=4)if(data[i+1]>160&&data[i+2]>160)bright++;
      return {bright,notice:!!document.querySelector('.mediaProductionNotice'),duration:resumed.mediaProject.duration};
    });
    assert.ok(produced.bright>100);assert.equal(produced.notice,false);assert.equal(produced.duration,90);
    await page.evaluate(()=>window.partial());
    const partial=await page.evaluate(()=>({notice:document.querySelector('.mediaProductionNotice')?.textContent,time:Number(document.querySelector('input[aria-label="Video time"]').value)}));
    assert.match(partial.notice,/1\/4/);assert.equal(partial.time,22);
    results.push({react,planned,produced,partial});console.log(JSON.stringify(results.at(-1)));
  }
  const continuation=await page.evaluate(()=>window.checkContinuationRoute());
  assert.equal(continuation.route.targetTurnId,'saved-video-turn');assert.equal(continuation.route.intent,'adjust');assert.match(continuation.text,/继续制作当前视频/);
  results.push({continuation});assert.deepEqual(errors,[]);
} finally {
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  await writeFile(path.join(output,'report.json'),JSON.stringify({results,errors},null,2));console.log('Report:',output);
}
