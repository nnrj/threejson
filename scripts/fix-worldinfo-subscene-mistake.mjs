/**
 * 修复 migrate-group-to-subscene 误将 worldInfo.boxModelList/infoPanelList 并入 worldInfo.subScene 的问题。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "..", "assets", "json");

function walkJsonFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      walkJsonFiles(full, out);
    } else if (name.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

function fixWorldInfo(wi) {
  if (!wi || typeof wi !== "object" || !Array.isArray(wi.subScene) || wi.subScene.length === 0) {
    return false;
  }
  if (wi.objType) {
    return false;
  }
  let changed = false;
  const keep = [];
  for (const item of wi.subScene) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const objType = String(item.objType || "").trim().toLowerCase();
    if (objType === "infopanel" || item.panel || item.panelBoxType) {
      if (!Array.isArray(wi.infoPanelList)) {
        wi.infoPanelList = [];
      }
      const panel = { ...item };
      delete panel.objType;
      wi.infoPanelList.push(panel);
      changed = true;
      continue;
    }
    if (objType === "floor" || objType === "box" || objType === "wall" || item.geometry) {
      if (!Array.isArray(wi.boxModelList)) {
        wi.boxModelList = [];
      }
      wi.boxModelList.push(item);
      changed = true;
      continue;
    }
    keep.push(item);
  }
  if (changed) {
    if (keep.length > 0) {
      wi.subScene = keep;
    } else {
      delete wi.subScene;
    }
  }
  return changed;
}

let touched = 0;
for (const file of walkJsonFiles(ASSETS_DIR)) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const wi = data?.worldInfo;
  if (!fixWorldInfo(wi)) {
    continue;
  }
  touched += 1;
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log("[fixed]", path.relative(path.join(__dirname, ".."), file));
}
console.log(`Fixed ${touched} file(s).`);
