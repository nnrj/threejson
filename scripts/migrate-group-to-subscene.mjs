/**
 * 将 JSON 中 group 记录内的 boxModelList/subGroup/infoPanelList 迁移为 subScene。
 * 用法: node scripts/migrate-group-to-subscene.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ASSETS_DIR = path.join(ROOT, "assets", "json");
const dryRun = process.argv.includes("--dry-run");

function walkJsonFiles(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walkJsonFiles(full, out);
    } else if (name.endsWith(".json")) {
      out.push(full);
    }
  }
  return out;
}

function isGroupLike(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return false;
  }
  const hasChildLists =
    Array.isArray(record.boxModelList) ||
    Array.isArray(record.subGroup) ||
    Array.isArray(record.infoPanelList);
  if (!hasChildLists) {
    return false;
  }
  const objType = String(record.objType || "").trim().toLowerCase();
  if (
    objType === "group" ||
    objType === "cabinet" ||
    objType === "capacity" ||
    objType === "bear" ||
    objType === "rackspace" ||
    objType === "portcomposite"
  ) {
    return true;
  }
  // 仅迁移具 objType 的对象记录；跳过 worldInfo 等无 objType 的容器
  return Boolean(objType);
}

function migrateGroupRecord(record) {
  if (!isGroupLike(record)) {
    return false;
  }
  let changed = false;
  const subScene = Array.isArray(record.subScene) ? [...record.subScene] : [];

  if (Array.isArray(record.boxModelList) && record.boxModelList.length > 0) {
    for (const item of record.boxModelList) {
      subScene.push(item);
    }
    delete record.boxModelList;
    changed = true;
  }
  if (Array.isArray(record.subGroup) && record.subGroup.length > 0) {
    for (const item of record.subGroup) {
      if (migrateGroupRecord(item)) {
        changed = true;
      }
      subScene.push(item);
    }
    delete record.subGroup;
    changed = true;
  }
  if (Array.isArray(record.infoPanelList) && record.infoPanelList.length > 0) {
    for (const panel of record.infoPanelList) {
      if (!panel.objType) {
        panel.objType = "infopanel";
      }
      subScene.push(panel);
    }
    delete record.infoPanelList;
    changed = true;
  }
  if (subScene.length > 0) {
    record.subScene = subScene;
    for (const child of record.subScene) {
      if (migrateGroupRecord(child)) {
        changed = true;
      }
    }
  }
  return changed;
}

function migrateNode(node) {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (Array.isArray(node)) {
    let changed = false;
    for (const item of node) {
      if (migrateNode(item)) {
        changed = true;
      }
    }
    return changed;
  }
  let changed = migrateGroupRecord(node);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      if (migrateNode(value)) {
        changed = true;
      }
    }
  }
  return changed;
}

const files = walkJsonFiles(ASSETS_DIR);
let touched = 0;

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.warn("[skip] invalid JSON:", path.relative(ROOT, file));
    continue;
  }
  const clone = structuredClone(data);
  if (!migrateNode(clone)) {
    continue;
  }
  touched += 1;
  const rel = path.relative(ROOT, file);
  console.log(dryRun ? `[dry-run] would update ${rel}` : `[updated] ${rel}`);
  if (!dryRun) {
    fs.writeFileSync(file, `${JSON.stringify(clone, null, 2)}\n`, "utf8");
  }
}

console.log(`${dryRun ? "Would update" : "Updated"} ${touched} file(s).`);
