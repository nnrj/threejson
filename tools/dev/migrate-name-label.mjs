/**
 * 迁移场景 JSON：name/label 分工，删除 businessInfo.businessName，roomName → label。
 * Run: node tools/dev/migrate-name-label.mjs [file.json ...]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BUSINESS_NAME_TO_BATCH = {
  wall: "room-wall",
  glass: "room-glass",
  ceiling: "room-ceiling",
  airConditioning: "air-conditioning",
  headCabinet: "head-cabinet",
  leakLine: "leak-line",
  container: "port-container",
  floor: "room-floor",
  instanceAir: "air-conditioning"
};

const OBJTYPE_BATCH = {
  wall: "room-wall",
  door: "room-door"
};

const DOMAIN_BATCH = {
  glass: "room-glass"
};

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function looksLikeDisplayName(text) {
  if (!text || typeof text !== "string") {
    return false;
  }
  return /[\u4e00-\u9fff]/.test(text) || /[\s]/.test(text) || text.includes("机柜");
}

function migrateRecord(record) {
  if (!isObject(record)) {
    return;
  }
  const bi = isObject(record.businessInfo) ? { ...record.businessInfo } : null;
  const businessName = bi?.businessName;
  const objType = typeof record.objType === "string" ? record.objType.trim().toLowerCase() : "";
  const domain = typeof record.domain === "string" ? record.domain.trim().toLowerCase() : "";

  let batchName = "";
  if (businessName && BUSINESS_NAME_TO_BATCH[businessName]) {
    batchName = BUSINESS_NAME_TO_BATCH[businessName];
  } else if (domain && DOMAIN_BATCH[domain]) {
    batchName = DOMAIN_BATCH[domain];
  } else if (OBJTYPE_BATCH[objType]) {
    batchName = OBJTYPE_BATCH[objType];
  } else if (domain === "glass") {
    batchName = "room-glass";
  } else if (objType === "door") {
    batchName = "room-door";
  }

  const prevName = typeof record.name === "string" ? record.name.trim() : "";
  const prevLabel = typeof record.label === "string" ? record.label.trim() : "";

  if (batchName) {
    if (!prevLabel && prevName && looksLikeDisplayName(prevName)) {
      record.label = prevName;
    } else if (!prevLabel && prevName && prevName !== batchName) {
      record.label = prevName;
    }
    record.name = batchName;
  } else if (!prevLabel && prevName && looksLikeDisplayName(prevName)) {
    record.label = prevName;
  }

  if (bi) {
    delete bi.businessName;
    if (Object.keys(bi).length === 0) {
      delete record.businessInfo;
    } else {
      record.businessInfo = bi;
    }
  }

  delete record.legacyObjType;
}

function walkDeep(node, visitor) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walkDeep(node[i], visitor);
    }
    return;
  }
  visitor(node);
  for (const key of Object.keys(node)) {
    walkDeep(node[key], visitor);
  }
}

function migrateSceneRoot(payload) {
  if (!isObject(payload)) {
    return payload;
  }
  const roomName =
    (typeof payload.roomName === "string" && payload.roomName.trim()) ||
    (isObject(payload.worldInfo) && typeof payload.worldInfo.roomName === "string" && payload.worldInfo.roomName.trim()) ||
    "";
  if (roomName && !payload.label) {
    payload.label = roomName;
  }
  delete payload.roomName;
  if (isObject(payload.worldInfo)) {
    delete payload.worldInfo.roomName;
  }
  walkDeep(payload, (record) => {
    if (!isObject(record)) {
      return;
    }
    if (!("objType" in record) && !("domain" in record) && !isObject(record.businessInfo)) {
      return;
    }
    migrateRecord(record);
  });
  return payload;
}

function collectJsonFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === ".git") {
          continue;
        }
        walk(p);
      } else if (name.endsWith(".json")) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out;
}

const repoRoot = resolve(__dirname, "../..");
const args = process.argv.slice(2);
const files = args.length > 0
  ? args.map((f) => resolve(f))
  : collectJsonFiles(join(repoRoot, "assets/json"));

let changed = 0;
for (const file of files) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  const before = JSON.stringify(parsed);
  migrateSceneRoot(parsed);
  const after = JSON.stringify(parsed);
  if (before !== after) {
    writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    changed++;
    console.log("migrated:", file);
  }
}
console.log(`done: ${changed} file(s) updated`);
