/**
 * Bump three.js importmap pins (0.153 → target) and add mesh-bvh / bvh-csg entries.
 * Run: node tools/dev/importmap/bump-three-importmap.mjs
 */
import fs from "fs";
import path from "path";

const THREE_VER = "0.184.0";
const MESH_BVH_VER = "0.9.10";
const BVH_CSG_VER = "0.0.18";

const THREE_ESM = `https://esm.sh/three@${THREE_VER}`;
const MESH_BVH_ESM = `https://esm.sh/three-mesh-bvh@${MESH_BVH_VER}?deps=three@${THREE_VER}`;
const BVH_CSG_ESM = `https://esm.sh/three-bvh-csg@${BVH_CSG_VER}?deps=three@${THREE_VER},three-mesh-bvh@${MESH_BVH_VER}`;

function walkHtml(dir, out = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, n.name);
    if (n.isDirectory()) {
      if (n.name === "node_modules" || n.name === ".git") continue;
      walkHtml(f, out);
    } else if (n.name.endsWith(".html")) {
      out.push(f);
    }
  }
  return out;
}

function patchImportmapBlock(jsonText) {
  const data = JSON.parse(jsonText);
  if (!data.imports) return null;
  const imp = data.imports;
  imp.three = THREE_ESM;
  imp["three/examples/jsm/"] = `${THREE_ESM}/examples/jsm/`;
  delete imp["three/src/"];
  imp["three-mesh-bvh"] = MESH_BVH_ESM;
  imp["three-bvh-csg"] = BVH_CSG_ESM;
  return JSON.stringify(data, null, 2).replace(/\n/g, "\n    ");
}

const re = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/gi;
const root = process.cwd();
let count = 0;

for (const file of walkHtml(root)) {
  let html = fs.readFileSync(file, "utf8");
  if (!html.includes("three@0.153.0") && !html.includes("three/src/")) {
    continue;
  }
  html = html.replace(re, (full, inner) => {
    const trimmed = inner.trim();
    if (!trimmed.includes('"three"')) return full;
    const patched = patchImportmapBlock(trimmed);
    if (!patched) return full;
    return full.replace(trimmed, "\n    " + patched + "\n  ");
  });
  html = html.replaceAll("three@0.153.0", `three@${THREE_VER}`);
  fs.writeFileSync(file, html, "utf8");
  count += 1;
  console.log("patched", path.relative(root, file));
}

console.log(`done: ${count} html files`);
