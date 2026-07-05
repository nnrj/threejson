/**
 * Normalizes assets/json/portShow.json — slug `name` + Chinese `label`.
 * Run: node tools/dev/build/normalize-portShow-names.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../../../assets/json/portShow.json");

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** @type {Record<string, string>} */
const EXACT_NAME_MAP = {
  "告警球-岸桥1": "port-alarm-sphere",
  "告警球-电力": "port-alarm-sphere",
  "告警球-岸桥3": "port-alarm-sphere",
  "状态球-场桥RTG": "port-status-sphere",
  "巡逻车组": "port-patrol-vehicle",
  "车体": "port-vehicle-body",
  "驾驶舱": "port-vehicle-cabin",
  "闸口检查站": "port-gate-station",
  "收费亭": "port-gate-booth",
  "栏杆": "port-gate-barrier",
  "应急巡逻二组": "port-emergency-patrol",
  "警灯条": "port-emergency-light-bar",
  "航道流线-01": "port-logistics-line",
  "物流路径-无人车": "port-logistics-line",
  "集卡疏港线路": "port-logistics-line",
  "堆场巡检环线": "port-yard-patrol-line",
  "引桥辅助线": "port-approach-line",
  "巡洋舰-泊1": "port-vessel",
  "巡洋舰-泊2": "port-vessel",
  "巡洋舰-外海": "port-vessel",
  "岸线灯杆1": "port-lamp-post",
  "岸线灯杆2": "port-lamp-post",
  "岸线灯杆3": "port-lamp-post",
  "岸线灯杆4": "port-lamp-post",
  "场桥RTG-01": "rtg-crane",
  "场桥RTG-02": "rtg-crane",
  "岸桥1": "dock-crane",
  "岸桥2": "dock-crane",
  "岸桥3": "dock-crane",
  "岸桥4": "dock-crane",
  "港口地面": "port-ground",
  "近岸海面": "port-near-sea",
  "外海深水区": "port-deep-sea",
  "海岸浅滩带": "port-shoal",
  "港口泊位区": "port-berth-zone",
  "港区木地板层": "port-wood-deck",
  "渡口登船平台": "port-ferry-platform",
  "海侧堤岸护面": "port-seawall",
  "主仓库": "port-warehouse",
  "仓库屋顶": "port-warehouse-roof",
  "调度中心": "port-dispatch-center",
  "配电站A": "port-power-station",
  "环境塔": "port-weather-tower",
  "巡检摄像头塔": "port-camera-tower",
  "堆场分区A": "port-yard-zone",
  "堆场分区B": "port-yard-zone",
  "主干道标线": "port-road-marking",
  "岸边防波凸起": "port-breakwater-bump"
};

/** @type {Record<string, string>} */
const THREE_JSON_ID_MAP = {
  "room-info-panel-ac-11": "port-info-panel-dispatch",
  "room-info-panel-pdu-a": "port-info-panel-weather",
  "room-info-panel-pdu-b": "port-info-panel-gallery"
};

/**
 * @param {object} record
 */
function resolveBatchName(record) {
  const current = String(record.name || "").trim();
  if (!current || SLUG.test(current)) {
    return current;
  }
  if (EXACT_NAME_MAP[current]) {
    return EXACT_NAME_MAP[current];
  }
  const handler = String(record.handler || "").trim();
  if (handler === "portLampPost") {
    return "port-lamp-post";
  }
  if (handler === "rtgCrane") {
    return "rtg-crane";
  }
  if (handler === "dockCrane") {
    return "dock-crane";
  }
  const code = String(record.businessInfo?.deviceTypeCode || "").trim().toLowerCase();
  if (record.objType === "line" && code === "logistics") {
    return "port-logistics-line";
  }
  if (code === "vessel") {
    return "port-vessel";
  }
  if (code === "camera") {
    return "port-camera-tower";
  }
  if (code === "weather") {
    return "port-weather-tower";
  }
  if (code === "yard") {
    return "port-yard-zone";
  }
  return current;
}

/**
 * @param {unknown} node
 */
function walkRecords(node) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walkRecords(item);
    }
    return;
  }
  if (typeof node.name === "string" && node.name.trim()) {
    const display = String(node.label || node.name).trim() || node.name;
    node.label = display;
    node.name = resolveBatchName(node);
  }
  if (typeof node.threeJsonId === "string") {
    const mapped = THREE_JSON_ID_MAP[node.threeJsonId];
    if (mapped) {
      node.threeJsonId = mapped;
    }
  }
  for (const value of Object.values(node)) {
    walkRecords(value);
  }
}

const payload = JSON.parse(readFileSync(OUT, "utf8"));
payload.version = payload.version || "next";
payload.name = "portShow-enterprise-port";
payload.threeJsonId = "portShow";
payload.label = payload.label || "智慧港口调度中心";
walkRecords(payload);
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Normalized ${OUT}`);
