/**
 * 迁移 textureRepeat：
 * - 删除显式 1×1（引擎默认）
 * - 对曾依赖 box 隐式 10×5 的建筑贴图补写 10×5
 */
import fs from "fs";
import path from "path";

const LEGACY_IMPLICIT_BOX_REPEAT = { x: 10, y: 5 };

const ROOTS = ["assets/json", "examples", "tests/fixtures", "domains"];

function walkJsonAndJs(d, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
      walkJsonAndJs(p, acc);
    } else if (e.isFile() && (/\.json$/i.test(e.name) || /\.js$/i.test(e.name))) {
      acc.push(p);
    }
  }
  return acc;
}

function isDefaultOneOne(tr) {
  if (!tr || typeof tr !== "object" || Array.isArray(tr)) {
    return false;
  }
  const x = tr.x === undefined ? 1 : Number(tr.x);
  const y = tr.y === undefined ? 1 : Number(tr.y);
  return x === 1 && y === 1;
}

function needsLegacyImplicitBoxRepeat(url) {
  const u = String(url || "").trim();
  if (!u) {
    return false;
  }
  if (/\/device\//.test(u)) {
    return false;
  }
  if (/\/door\//.test(u)) {
    return false;
  }
  if (/\/planet\//.test(u) || /pano\//.test(u)) {
    return false;
  }
  if (/\/environment\/nature\/weather\//.test(u)) {
    return false;
  }
  if (u.includes("stainless_steel")) {
    return false;
  }
  if (
    u.includes("temperature_display")
    || u.includes("pass_control")
    || u.includes("dashboard_screen")
    || u.includes("air_conditioning_controller")
  ) {
    return false;
  }
  if (/\/building\/(floor|wall)\//.test(u)) {
    return true;
  }
  if (u.includes("iron_frame.webp")) {
    return true;
  }
  if (u.includes("/environment/nature/landform/sea")) {
    return true;
  }
  return false;
}

const stats = {
  filesTouched: 0,
  removedDefaultOneOne: 0,
  addedLegacyTenFive: 0
};

function processMaterial(material) {
  if (!material || typeof material !== "object" || Array.isArray(material)) {
    return;
  }
  const url = typeof material.textureUrl === "string" ? material.textureUrl.trim() : "";
  if (isDefaultOneOne(material.textureRepeat)) {
    delete material.textureRepeat;
    stats.removedDefaultOneOne += 1;
  }
  if (url && needsLegacyImplicitBoxRepeat(url) && !material.textureRepeat) {
    material.textureRepeat = { ...LEGACY_IMPLICIT_BOX_REPEAT };
    stats.addedLegacyTenFive += 1;
  }
}

function processNode(node) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(processNode);
    return;
  }
  if (node.material) {
    processMaterial(node.material);
  }
  if (Array.isArray(node.materials)) {
    node.materials.forEach(processMaterial);
  }
  if (Array.isArray(node.materialArr)) {
    node.materialArr.forEach(processMaterial);
  }
  for (const key of Object.keys(node)) {
    if (key === "material" || key === "materials" || key === "materialArr") {
      continue;
    }
    processNode(node[key]);
  }
}

function stripJsDefaultOneOne(source) {
  let next = source;
  let changed = false;
  const blockRe = /\n[\t ]*textureRepeat\s*:\s*\{\s*\n[\t ]*x:\s*1,\s*\n[\t ]*y:\s*1\s*\n[\t ]*\},?\s*\n/g;
  if (blockRe.test(next)) {
    next = next.replace(blockRe, "\n");
    changed = true;
  }
  const inlineRe = /[\t ]*textureRepeat\s*:\s*\{\s*x:\s*1,\s*y:\s*1\s*\},?\s*\n/g;
  if (inlineRe.test(next)) {
    next = next.replace(inlineRe, "");
    changed = true;
  }
  return { next, changed };
}

for (const root of ROOTS) {
  if (!fs.existsSync(root)) {
    continue;
  }
  for (const file of walkJsonAndJs(root)) {
    const raw = fs.readFileSync(file, "utf8");
    if (/\.json$/i.test(file)) {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      const before = JSON.stringify(data);
      processNode(data);
      const after = JSON.stringify(data);
      if (before !== after) {
        fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
        stats.filesTouched += 1;
        console.log("updated json:", file);
      }
    } else {
      const { next, changed } = stripJsDefaultOneOne(raw);
      if (changed) {
        fs.writeFileSync(file, next, "utf8");
        stats.filesTouched += 1;
        console.log("updated js:", file);
      }
    }
  }
}

console.log(JSON.stringify(stats, null, 2));
