/** Explicit opt-in model download and real offline WASM synthesis, no paid API. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";
import { getBuiltinAudioModels, createAudioModelManager } from "../../packages/audio-kit/js/models.js";
import { createNodeAudioModelStorage } from "../../packages/audio-kit/js/nodeModels.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "dist/local-chinese-tts"), model = getBuiltinAudioModels()[0];
await mkdir(output, { recursive: true });
const manager = createAudioModelManager(await createNodeAudioModelStorage(path.join(output, "model-cache")));
if ((await manager.status(model)).status !== "ready") {
  if (!process.argv.includes("--download")) throw new Error("Run with --download to explicitly cache the optional ~71 MiB public model/runtime.");
  console.log("Downloading pinned optional model/runtime for verification only.");
  await manager.download(model, { signal: AbortSignal.timeout(600000), onProgress: p => { if (p.loaded === p.total) console.log(`Verified transfer: ${p.role} (${p.total} bytes)`); } });
}
const { manifest } = await manager.status(model);
const { server, port } = await startStaticServer(root); let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.THREEJSON_BROWSER, headless: true });
  const page = await browser.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (/speech|wasm|sherpa|Runtime|Error/i.test(m.text())) console.log(m.type(), m.text()); });
  await page.goto(`http://127.0.0.1:${port}/tools/scene-host/threebox/index.html`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async manifest => {
    const sdk = await import("@threejson/audio-kit/models"), audio = await import("@threejson/audio-kit");
    const manager = sdk.createAudioModelManager(await sdk.createBrowserAudioModelStorage());
    const localManifest = structuredClone(manifest);
    for (const file of localManifest.files) file.url = `${location.origin}/dist/local-chinese-tts/model-cache/${file.storageKey}`;
    await manager.download(localManifest); console.log("speech: model installed");
    const producer = await sdk.createLocalSpeechProducer({ modelManager: manager });
    try {
      const start = performance.now(), pcm = await producer.synthesize({ kind: "tts", text: "你好，这是在用户电脑上合成的中文旁白。", speed: 1 }, { signal: AbortSignal.timeout(120000) });
      let peak = 0, energy = 0;
      for (const value of pcm.channels[0]) { peak = Math.max(peak, Math.abs(value)); energy += value * value; }
      const bytes = new Uint8Array(audio.encodeWav(pcm)), pieces = [];
      for (let i = 0; i < bytes.length; i += 8192) pieces.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
      return { sampleRate: pcm.sampleRate, duration: audio.pcmDuration(pcm), peak, rms: Math.sqrt(energy / pcm.channels[0].length), elapsedMs: performance.now() - start, wav: btoa(pieces.join("")) };
    } finally { producer.dispose(); manager.close(); }
  }, manifest);
  assert.ok(result.duration > 2 && result.duration < 60); assert.ok(result.peak > .01 && result.rms > .001);
  await writeFile(path.join(output, "chinese-narration.wav"), Buffer.from(result.wav, "base64")); delete result.wav;
  assert.deepEqual(errors, []); await writeFile(path.join(output, "report.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
