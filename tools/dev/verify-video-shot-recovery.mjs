/** Offline installed-browser check of native import maps and the real video tool chain.
 * No user browser, AI requests, remote models, rendering or production state involved.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startStaticServer } from "../scene-host/desktop/static-server.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = JSON.parse(await readFile(path.join(root, "tests/fixtures/media-export-relativity.json"), "utf8"));
const { server, port } = await startStaticServer(root);
const origin = `http://127.0.0.1:${port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.THREEJSON_TEST_BROWSER || (process.platform === "win32" ? "msedge" : undefined) });
  for (const host of ["threebox", "video-editor"]) {
    const page = await browser.newPage(), blocked = [], errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const entry = `/tools/scene-host/${host}/index.html`;
    const html = await readFile(path.join(root, entry), "utf8");
    const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
    // Only vendor URLs change; ThreeJSON/media-kit entries use the host's actual map.
    Object.assign(map.imports, {
      three: "/node_modules/three/build/three.module.js", "three/webgpu": "/node_modules/three/build/three.webgpu.js", "three/tsl": "/node_modules/three/build/three.tsl.js",
      "three/examples/jsm/": "/node_modules/three/examples/jsm/", "@tweenjs/tween.js": "/node_modules/@tweenjs/tween.js/dist/tween.esm.js",
      fflate: "/node_modules/fflate/esm/browser.js"
    });
    await page.route("**/*", async route => {
      const url = route.request().url();
      if (!url.startsWith(origin + "/")) { blocked.push(url); return route.abort(); }
      if (url === origin + entry) return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><script type="importmap">${JSON.stringify(map)}</script></head><body>Offline video continuation test</body></html>` });
      return route.continue();
    });
    await page.goto(origin + entry);
    const result = await page.evaluate(async document => {
      const { createMediaProjectSession, createMediaOperationService } = await import("@threejson/media-kit");
      const { runVideoAgent } = await import("threejson/ai");
      const session = createMediaProjectSession(document), service = createMediaOperationService({ session });
      try {
        const invalid = { op: "media.shot.query", args: { id: "intro", commands: [{ op: "scene.inspect" }] } };
        const commands = [invalid, invalid, { op: "media.shot.discover", args: { ops: ["scene.query", "object.patch"] } },
          { op: "media.shot.query", args: { id: "intro", commands: [{ op: "scene.query", args: { selector: { ids: ["title"] }, projection: ["identity"] } }] } },
          { op: "media.shot.edit", args: { id: "intro", commands: [{ op: "object.patch", args: { id: "title", partial: { name: "Checked opening" } } }] } }, "# done"];
        let request = 0;
        const outcome = await runVideoAgent({ service, prompt: "继续制作当前视频", request: async () => {
          if (request >= commands.length) throw new Error("Unexpected extra provider request");
          const command = commands[request++];
          return { message: { role: "assistant", content: typeof command === "string" ? command : JSON.stringify(command) } };
        } });
        return { completed: outcome.completed, stopReason: outcome.stopReason, requests: outcome.requests,
          failures: outcome.receipts.filter(receipt => !receipt.ok).map(receipt => receipt.code),
          shots: session.document.timeline.clips.length, duration: session.inspect().duration,
          audioUnchanged: JSON.stringify(session.document.timeline.audio) === JSON.stringify(document.timeline.audio),
          corrected: session.document.scenes.intro.objectList.find(object => object.threeJsonId === "title").name };
      } finally { session.dispose(); }
    }, fixture);
    assert.equal(result.completed, true, JSON.stringify(result)); assert.equal(result.requests, 6);
    assert.deepEqual(result.failures, ["UNKNOWN_SCENE_OPERATION"]);
    assert.equal(result.shots, 8); assert.equal(result.duration, 150); assert.equal(result.audioUnchanged, true);
    assert.equal(result.corrected, "Checked opening"); assert.deepEqual(blocked, []); assert.deepEqual(errors, []);
    console.log(`PASS ${host}: ${JSON.stringify(result)}`);
    await page.close();
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
