import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { unzipSync, strFromU8 } from "fflate";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";

// Isolated, offline regression of real native/React cards and local video encoding.
// No provider calls and no shared development server required.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/scene-card-download-menu", new Date().toISOString().replaceAll(/[:.]/g, "-"));
await mkdir(output, { recursive: true });
const bundle = await build({ stdin: { resolveDir: root, contents: `
  import {createElement} from 'react';
  import {createRoot} from 'react-dom/client';
  import {SceneAgentSceneCard} from './packages/react-scene-agent/src/SceneAgentSceneCard.js';
  import {createThreeBoxSceneCard} from './tools/scene-host/threebox/js/threeBoxSceneCard.js';
  import {loadHostLocaleCatalog,t} from './tools/scene-host/shared/i18n/index.js';
  import {loadHostLocaleCatalog as loadPackagedLocale} from './packages/host-kit/i18n/index.js';
  const scene={version:'next',name:'Download test',sceneConfig:{scene:{background:'#071422'},
    camera:{position:{x:0,y:0,z:8},lookAt:{x:0,y:0,z:0}},controls:{type:'none'}},
    objectList:[{objType:'box',threeJsonId:'actor',geometry:{width:2,height:2,depth:2},material:{type:'basic',color:'#3adaff'}}]};
  const single={...scene,timeline:{version:1,duration:1,tracks:[{id:'motion',target:'actor',property:'position.x',keyframes:[{time:0,value:-1},{time:1,value:1}]}]}};
  const film={documentType:'composition',compositionVersion:1,output:{width:320,height:180,fps:10},scenes:{shot:single},
    timeline:{version:1,duration:1,clips:[{id:'shot',source:'shot',start:0,duration:1}]}};
  const sources={scene,single,film};let mounted;
  window.mountCard=async(react,kind='scene',defer=false)=>{
    mounted?.();await loadHostLocaleCatalog('zh-CN');await loadPackagedLocale('zh-CN');document.documentElement.lang='zh-CN';
    const container=document.createElement('main');document.body.replaceChildren(container);let card;
    const options={translate:(key,fallback)=>t(key.replace(/^sceneAgent[.]/,'threebox.'),fallback),selectMeshFormat:async()=>'obj',
      showToast:(message,kind)=>{if(kind==='error')window.cardErrors.push(message);}};
    window.cardErrors=[];
    if(react){const reactRoot=createRoot(container);mounted=()=>reactRoot.unmount();
      card=await new Promise(resolve=>reactRoot.render(createElement(SceneAgentSceneCard,{managed:true,options,onReady:card=>card&&resolve(card)})));
    }else{card=createThreeBoxSceneCard(options);container.append(card.el);mounted=()=>card.dispose();}
    window.card=card;window.source=sources[kind];await card.render(sources[kind],{label:'download-test',defer});return true;
  };
  window.dispose=()=>mounted?.();
  window.showSaveFilePicker=undefined; // Exercise the download fallback, not an OS picker.
` }, bundle: true, format: "esm", write: false, external: ["node:fs/promises", "node:url"], logLevel: "silent" });
const { server, port } = await startStaticServer(root);
let browser;
const results = [], errors = [];
try {
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 740 }, acceptDownloads: true, locale: "zh-CN" });
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:)/, route => route.abort());
  await page.route("**/locales/*.json", route => route.fulfill({ path: path.join(root, "tools/scene-host/shared/i18n/locales", new URL(route.request().url()).pathname.split("/").at(-1)), contentType: "application/json" }));
  await page.route("**/__downloads", route => route.fulfill({ contentType: "text/html", body: '<link rel="stylesheet" href="/tools/scene-host/threebox/css/threebox.css"><link rel="stylesheet" href="/packages/react-scene-agent/src/styles.css"><style>body{margin:0;padding:12px;box-sizing:border-box;background:#202124;color:#eee}main{width:100%}.sceneCardCanvasWrap{height:260px!important;min-height:260px!important}</style><script type="module" src="/__downloads.js"></script>' }));
  await page.route("**/__downloads.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text }));
  await page.goto(`http://127.0.0.1:${port}/__downloads`);
  await page.waitForFunction(() => typeof window.mountCard === "function");
  const trigger = page.getByRole("button", { name: "下载", exact: true });
  const menu = page.getByRole("menu", { name: "下载", exact: true });
  async function openMenu(expected) {
    await trigger.click();await menu.waitFor();
    assert.deepEqual(await menu.getByRole("menuitem").allTextContents(), expected);
    const bounds = await menu.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width);
  }
  async function download(action) {
    const pending = page.waitForEvent("download");
    await menu.locator(`[data-download-action="${action}"]`).click();
    const result = await pending;
    return { fileName: result.suggestedFilename(), data: await readFile(await result.path()) };
  }
  const modelItems = ["下载 JSON", "下载 .tjz 场景包", "下载三方模型"];
  const videoItems = ["下载视频", "下载 .tjz 场景包", "下载 JSON"];
  for (const react of [false, true]) {
    await page.evaluate(react => window.mountCard(react), react);
    assert.equal(await trigger.count(), 1);
    assert.equal(await page.locator('.sceneCardActionBar button[aria-label="下载 JSON"]').count(), 0);
    await openMenu(modelItems);
    await page.keyboard.press("End");assert.equal(await page.locator(":focus").textContent(), modelItems[2]);
    await page.keyboard.press("Home");assert.equal(await page.locator(":focus").textContent(), modelItems[0]);
    await page.keyboard.press("Escape");assert.equal(await menu.count(), 0);
    assert.equal(await trigger.evaluate(button => button === document.activeElement), true);
    await page.keyboard.press("ArrowUp");assert.equal(await page.locator(":focus").textContent(), modelItems[2]);
    await page.keyboard.press("ArrowDown");assert.equal(await page.locator(":focus").textContent(), modelItems[0]);
    await page.mouse.click(2, 2);assert.equal(await menu.count(), 0);
    await openMenu(modelItems);
    await page.screenshot({ path: path.join(output, `${react ? "react" : "native"}-mobile-menu.png`) });
    const json = await download("json");
    assert.match(json.fileName, /\.json$/);assert.deepEqual(JSON.parse(json.data), JSON.parse(await page.evaluate(() => card.exportSceneJsonString())));
    await openMenu(modelItems);const archive = await download("tjz");
    assert.match(archive.fileName, /\.tjz$/);const entries = unzipSync(archive.data);
    assert.ok(Object.keys(entries).some(key => key.endsWith("scene.json")));
    await openMenu(modelItems);
    const modelDownload = page.waitForEvent("download");await menu.locator('[data-download-action="mesh"]').click();
    if (!react) {
      const dialog = page.getByRole("dialog", { name: "导出三方模型", exact: true });
      await dialog.getByLabel("导出格式", { exact: true }).selectOption("obj");
      await dialog.getByRole("button", { name: "导出", exact: true }).click();
    }
    const model = await modelDownload;assert.match(model.suggestedFilename(), /\.obj$/);
    assert.match(await readFile(await model.path(), "utf8"), /^v /m);

    // Deferred history can download without creating a WebGL runtime.
    await page.evaluate(react => window.mountCard(react, "scene", true), react);
    await openMenu(modelItems);const dormant = await download("json");
    assert.equal(JSON.parse(dormant.data).objectList[0].threeJsonId, "actor");
    assert.equal(await page.locator("canvas").count(), 0);

    await page.evaluate(react => window.mountCard(react, "film"), react);
    await page.waitForFunction(() => !!document.querySelector('input[aria-label="Video time"]'));
    const authoring = await page.evaluate(() => card.exportSceneJsonString());
    await openMenu(videoItems);const filmArchive = await download("tjz");
    const filmEntries = unzipSync(filmArchive.data);
    const filmEntry = Object.entries(filmEntries).find(([key]) => key.endsWith("composition.json"));
    assert.equal(JSON.parse(strFromU8(filmEntry[1])).documentType, "composition");
    await openMenu(videoItems);const filmJson = await download("json");
    assert.deepEqual(JSON.parse(filmJson.data), JSON.parse(authoring));
    await openMenu(videoItems);await menu.locator('[data-download-action="video"]').click();
    const studio = page.getByRole("dialog", { name: "时间线与媒体导出", exact: true });
    const exportButton = studio.getByRole("button", { name: "导出", exact: true });
    await studio.waitFor();
    assert.equal(await studio.getByLabel("导出格式", { exact: true }).inputValue(), "mp4");
    await page.waitForFunction(() => [...document.querySelectorAll('.threejsonMediaStudio button')].some(button => button.textContent === "导出" && !button.disabled));
    await studio.getByLabel("导出格式", { exact: true }).selectOption("webm");
    const videoDownload = page.waitForEvent("download", { timeout: 60000 });await exportButton.click();
    const video = await videoDownload, videoBytes = await readFile(await video.path());
    assert.match(video.suggestedFilename(), /\.webm$/);
    assert.equal(videoBytes.subarray(0, 4).toString("hex"), "1a45dfa3");assert.ok(videoBytes.length > 1000);
    await video.saveAs(path.join(output, `${react ? "react" : "native"}.webm`));
    await studio.getByRole("button", { name: "关闭", exact: true }).click();
    // Preserve the user's existing scrubber export entry, not only the new menu.
    const scrubberExport = page.locator('button[title="Timeline / audio / export"]');
    assert.equal(await scrubberExport.count(), 1);await scrubberExport.click();await studio.waitFor();
    await studio.getByRole("button", { name: "关闭", exact: true }).click();
    assert.deepEqual(JSON.parse(await page.evaluate(() => card.exportSceneJsonString())), JSON.parse(authoring));
    assert.deepEqual(await page.evaluate(() => window.cardErrors), []);
    await page.setViewportSize({ width: 900, height: 740 });
    await openMenu(videoItems);await page.screenshot({ path: path.join(output, `${react ? "react" : "native"}-desktop-video-menu.png`) });
    await page.keyboard.press("Escape");
    // Older single-scene video documents get the video menu as well.
    await page.evaluate(react => window.mountCard(react, "single", true), react);
    await openMenu(videoItems);await page.evaluate(() => window.dispose());
    assert.equal(await menu.count(), 0);
    await page.setViewportSize({ width: 320, height: 740 });
    results.push({ react, modelBytes: (await readFile(await model.path())).length, archiveBytes: archive.data.length, videoBytes: videoBytes.length, preservedScrubber: true });
    console.log(JSON.stringify(results.at(-1)));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify({ results, errors }, null, 2));
  console.log("Report:", output);
}
