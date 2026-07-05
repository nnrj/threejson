/**
 * 一次性迁移：从场景 JSON 移除 worldId，补 threeJsonId。
 * 用法：node scripts/migrate-remove-worldId.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const JSON_ROOTS = [
  path.join(ROOT, "assets", "json"),
  path.join(ROOT, "tests", "fixtures")
];

const UI_CHROME_KEYS = new Set([
  "leftPanelShow",
  "rightPanelShow",
  "topBarShow",
  "bottomBarShow",
  "leftMouseClick",
  "rightMouseClick",
  "throughModel",
  "destroyFullScreenStatus",
  "layoutType",
  "alarmList"
]);

function slugFromFile(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "scene-doc";
}

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

function stripUiChrome(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return;
  }
  for (const key of UI_CHROME_KEYS) {
    delete obj[key];
  }
}

function migrateSceneInfoList(worldInfo) {
  if (!worldInfo?.sceneInfoList || !Array.isArray(worldInfo.sceneInfoList)) {
    return;
  }
  for (let i = 0; i < worldInfo.sceneInfoList.length; i++) {
    const entry = worldInfo.sceneInfoList[i];
    if (entry && typeof entry === "object") {
      delete entry.worldId;
    }
  }
}

function stripWorldIdDeep(value) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      stripWorldIdDeep(value[i]);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(value, "worldId")) {
    delete value.worldId;
  }
  for (const key of Object.keys(value)) {
    stripWorldIdDeep(value[key]);
  }
}

function migratePayload(payload, filePath) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const before = JSON.stringify(payload);
  stripWorldIdDeep(payload);
  if (payload.worldInfo && typeof payload.worldInfo === "object") {
    if (Object.prototype.hasOwnProperty.call(payload.worldInfo, "id")) {
      delete payload.worldInfo.id;
    }
    stripUiChrome(payload.worldInfo);
    migrateSceneInfoList(payload.worldInfo);
  }
  stripUiChrome(payload);
  if (!payload.threeJsonId || !String(payload.threeJsonId).trim()) {
    payload.threeJsonId = slugFromFile(filePath);
  }
  return before !== JSON.stringify(payload);
}

let total = 0;
let updated = 0;

for (const root of JSON_ROOTS) {
  const files = walkJsonFiles(root);
  for (const file of files) {
    total += 1;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (migratePayload(data, file)) {
      fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      updated += 1;
      console.log("updated:", path.relative(ROOT, file));
    }
  }
}

console.log(`done: ${updated}/${total} files updated`);
