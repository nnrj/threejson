/**
 * Restore examples/html-demo/*.html from temp_old with UTF-8, then re-apply assetsBase.
 * One-off fix for PowerShell Set-Content encoding corruption on Windows.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC_ROOT = path.join(ROOT, "temp_old", "examples", "html-demo");
const DST_ROOT = path.join(ROOT, "examples", "html-demo");

function applyAssetsBase(content) {
  if (content.includes("assetsBase:")) {
    return content;
  }
  let c = content;

  c = c.replace(
    /createJsonScene\(sceneData,\s*\{\s*canvas:\s*canvasContainer,\s*resetScene:\s*true,\s*beforeFrame:/s,
    `createJsonScene(sceneData, {
        canvas: canvasContainer,
        assetsBase: "/assets",
        resetScene: true,
        beforeFrame:`
  );

  c = c.replace(
    /createJsonScene\(sceneData,\s*\{\s*canvas,\s*resetScene:\s*true,\s*onSceneReady:/s,
    `createJsonScene(sceneData, {
        canvas,
        assetsBase: "/assets",
        resetScene: true,
        onSceneReady:`
  );

  c = c.replace(
    /createJsonScene\(scenePayload,\s*\{\s*canvas,\s*pluginHost\s*\}\)/s,
    `createJsonScene(scenePayload, {
      canvas,
      assetsBase: "/assets",
      pluginHost
    })`
  );

  c = c.replace(
    /createJsonScene\(sceneData,\s*\{\s*canvas,\s*pluginHost,/s,
    `createJsonScene(sceneData, {
      canvas,
      assetsBase: "/assets",
      pluginHost,`
  );

  c = c.replace(
    /createJsonScene\(sceneData,\s*\{\s*canvas,\s*async onSceneReady:/s,
    `createJsonScene(sceneData, {
      canvas,
      assetsBase: "/assets",
      async onSceneReady:`
  );

  c = c.replace(
    /createJsonScene\(sceneData,\s*\{\s*canvas,\s*resetScene:\s*true,\s*\.\.\.lifecycleOptions\s*\}\)/s,
    `createJsonScene(sceneData, {
    canvas,
    assetsBase: "/assets",
    resetScene: true,
    ...lifecycleOptions
  })`
  );

  c = c.replace(
    /createJsonScene\(sceneData,\s*\{\s*canvas,\s*resetScene:\s*true\s*\}\)/g,
    `createJsonScene(sceneData, {
    canvas,
    assetsBase: "/assets",
    resetScene: true
  })`
  );

  c = c.replace(
    /createJsonScene\(sceneData,\s*\{\s*canvas\s*\}\)/g,
    `createJsonScene(sceneData, { canvas, assetsBase: "/assets" })`
  );

  c = c.replace(
    /createJsonScene\(scenePayload,\s*\{\s*canvas\s*\}\)/g,
    `createJsonScene(scenePayload, { canvas, assetsBase: "/assets" })`
  );

  c = c.replace(
    /createJsonScene\(sceneData,\s*\{\s*canvas:\s*canvasContainer\s*\}\)/g,
    `createJsonScene(sceneData, { canvas: canvasContainer, assetsBase: "/assets" })`
  );

  c = c.replace(
    /createJsonScene\(sceneData,\s*\{\s*canvas:\s*canvasContainer,\s*assetsBase:\s*"\/assets"\s*\}\)/g,
    `createJsonScene(sceneData, {
        canvas: canvasContainer,
        assetsBase: "/assets"
      })`
  );

  c = c.replace(
    /\{ canvas, resetScene: true \}/g,
    `{ canvas, resetScene: true, assetsBase: "/assets" }`
  );

  c = c.replace(
    /createJsonScene\(sceneJson,\s*\{ canvas, resetScene: true \}\)/g,
    `createJsonScene(sceneJson, { canvas, resetScene: true, assetsBase: "/assets" })`
  );

  return c;
}

function walkHtml(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      walkHtml(full, out);
    } else if (name.endsWith(".html")) {
      out.push(full);
    }
  }
  return out;
}

const files = walkHtml(SRC_ROOT);
let restored = 0;
for (const src of files) {
  const rel = path.relative(SRC_ROOT, src);
  const dst = path.join(DST_ROOT, rel);
  if (!fs.existsSync(path.dirname(dst))) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
  }
  const raw = fs.readFileSync(src, "utf8");
  const patched = applyAssetsBase(raw);
  fs.writeFileSync(dst, patched, "utf8");
  restored += 1;
}

console.log(`Restored ${restored} html-demo pages from temp_old (UTF-8 + assetsBase).`);
