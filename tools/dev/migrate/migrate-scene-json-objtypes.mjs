/**
 * 将场景 JSON 中“业务语义 objType”迁移为 core 官方 objType + businessInfo.businessName。
 * 用法: node tools/dev/migrate/migrate-scene-json-objtypes.mjs [glob]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const CORE_OBJ_TYPES = new Set([
  "box", "sphere", "cylinder", "cone", "ring", "torus", "capsule",
  "group", "line", "infopanel", "panel", "heatmap", "heat", "heatmapvolume", "heatmap3d",
  "wind", "audio", "externalmodel", "domain", "default",
  "scene", "camera", "renderer", "controls", "light", "renderloop"
]);

const PORT_LEGACY = new Set(["dockcrane", "berthship", "rtgcrane", "portlamppost"]);

const LINE_SEMANTIC = new Set([
  "shippineline", "logisticsline", "haulageline", "yardpatrolring", "linkspanline", "leakline"
]);

const GROUP_SEMANTIC = new Set(["patrolfleet", "gatecheckgroup"]);

const BOX_SEMANTIC = new Set([
  "ground", "seasurface", "deepwater", "coastshallow", "dockfloor", "yardwooddeck",
  "ferrylanding", "seaembankment", "warehouse", "warehouseroof", "dispatchcenter",
  "powerstation", "weatherstation", "devicecamera", "stackzone", "lanemark", "container",
  "patrolvehicle", "gatebooth", "gatebarrierstick", "breakwaterbump", "alarmball",
  "instanceair", "headcabinet", "wall"
]);

function norm(t) {
  return typeof t === "string" ? t.trim().toLowerCase() : "";
}

function ensureBusinessInfo(record) {
  if (!record.businessInfo || typeof record.businessInfo !== "object") {
    record.businessInfo = {};
  }
  return record.businessInfo;
}

function migrateRecord(record, listContext) {
  if (!record || typeof record !== "object" || typeof record.objType !== "string") {
    return;
  }
  const raw = record.objType.trim();
  const t = norm(raw);
  if (!t || CORE_OBJ_TYPES.has(t) || PORT_LEGACY.has(t)) {
    if (t === "domain" || record.domain) {
      if (record.domain && norm(record.objType) !== "domain") {
        record.objType = "domain";
      }
    }
    return;
  }

  if (listContext === "lineList" || LINE_SEMANTIC.has(t) || (Array.isArray(record.points) && record.points.length > 0)) {
    ensureBusinessInfo(record).businessName = raw;
    record.objType = "line";
    return;
  }

  if (listContext === "groupList" || GROUP_SEMANTIC.has(t) || Array.isArray(record.boxModelList)) {
    if (GROUP_SEMANTIC.has(t) || (listContext === "groupList" && Array.isArray(record.boxModelList))) {
      ensureBusinessInfo(record).businessName = raw;
    }
    record.objType = "group";
    if (Array.isArray(record.boxModelList)) {
      for (let i = 0; i < record.boxModelList.length; i++) {
        migrateRecord(record.boxModelList[i], "groupChild");
      }
    }
    if (Array.isArray(record.subGroup)) {
      for (let i = 0; i < record.subGroup.length; i++) {
        migrateNode(record.subGroup[i], "groupList");
      }
    }
    return;
  }

  if (BOX_SEMANTIC.has(t) || listContext === "boxModelList" || listContext === "groupChild" || listContext === "sphereModelList") {
    ensureBusinessInfo(record).businessName = raw;
    if (record.geometry?.radius != null && !record.geometry?.width && norm(record.objType) !== "box") {
      record.objType = "sphere";
    } else {
      record.objType = "box";
    }
  }
}

function migrateNode(node, listContext = "") {
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      migrateNode(node[i], listContext);
    }
    return;
  }
  migrateRecord(node, listContext);
  for (const key of Object.keys(node)) {
    if (key === "objType") {
      continue;
    }
    const val = node[key];
    if (Array.isArray(val) && /List$/.test(key)) {
      const childCtx = key;
      for (let i = 0; i < val.length; i++) {
        migrateNode(val[i], childCtx);
      }
    } else if (val && typeof val === "object") {
      migrateNode(val, listContext);
    }
  }
}

function migrateWallsToDomain(worldInfo) {
  if (!worldInfo?.boxModelList?.length) {
    return;
  }
  const kept = [];
  const wallEntries = [];
  for (let i = 0; i < worldInfo.boxModelList.length; i++) {
    const item = worldInfo.boxModelList[i];
    const bn = item?.businessInfo?.businessName;
    if (bn === "wall" || norm(item?.objType) === "wall" || (item?.material?.type === "wall" && item?.geometry)) {
      wallEntries.push(item);
      continue;
    }
    kept.push(item);
  }
  worldInfo.boxModelList = kept;
  if (wallEntries.length === 0) {
    return;
  }
  if (!Array.isArray(worldInfo.domainModelList)) {
    worldInfo.domainModelList = [];
  }
  for (const wall of wallEntries) {
    const { objType, businessInfo, ...rest } = wall;
    worldInfo.domainModelList.push({
      objType: "domain",
      domain: "wall",
      handler: "addToScene",
      ...rest,
      businessInfo: {
        ...(businessInfo || {}),
        businessName: businessInfo?.businessName || "wall"
      }
    });
  }
}

function migratePayload(payload) {
  migrateNode(payload);
  if (payload.worldInfo) {
    migrateWallsToDomain(payload.worldInfo);
  }
}

function collectJsonFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
      } else if (name.endsWith(".json")) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out;
}

function collectHtmlFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory() && name !== "node_modules") {
        walk(p);
      } else if (name.endsWith(".html")) {
        out.push(p);
      }
    }
  };
  walk(root);
  return out;
}

const repoRoot = resolve(import.meta.dirname, "..");
const jsonFiles = collectJsonFiles(join(repoRoot, "resources", "json"));

for (const file of jsonFiles) {
  const text = readFileSync(file, "utf8");
  const data = JSON.parse(text);
  migratePayload(data);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log("migrated", file);
}

console.log("done", jsonFiles.length, "json files");
