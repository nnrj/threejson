/**
 * Generates assets/json/roomShow.json — Tier-III style datacenter layout.
 * Run: node tools/dev/build/generate-roomShow.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DOOR_OPEN_ANGLE_PRESETS } from "../../../domains/door/doorDescriptor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "../../../assets/json/roomShow.json");

const WALL_TEX = "/assets/textures/building/floor/cement.png";
const FLOOR_RAISED = "/assets/textures/building/floor/wood_floor.webp";
const FLOOR_CORRIDOR = "/assets/textures/building/floor/cement.png";
const FLOOR_TEX_REPEAT = { x: 10, y: 5 };

const wallMat = {
  color: "#b8bcc4",
  type: "standard",
  textureUrl: WALL_TEX,
  metalness: 0.35,
  roughness: 0.55,
  textureRepeat: FLOOR_TEX_REPEAT
};

const AC_DEPTH = 10;
const AC_WIDTH = 6;
const AC_HEIGHT = 20;

function acMaterials() {
  const face = (extra = {}) => ({
    color: "#7a7d82",
    type: "standard",
    receiveShadow: true,
    ...extra
  });
  return [
    face(),
    face(),
    face({ color: "#8E8E8E" }),
    face(),
    face({
      color: "#8A8A8A",
      textureUrl: "/assets/textures/device/air_conditioner_back.png"
    }),
    face({
      color: "#8A8A8A",
      textureUrl: "/assets/textures/device/air_conditioner_front.png"
    })
  ];
}

function acUnit(label, x, z, deviceId = null) {
  return {
    objType: "domain",
    domain: "device.airConditioner",
    handler: "deployAirConditioner",
    visible: true,
    name: "air-conditioning",
    label,
    geometry: { width: AC_WIDTH, depth: AC_DEPTH, height: AC_HEIGHT },
    position: { x, y: AC_HEIGHT / 2, z },
    businessInfo: {
      deviceTypeCode: "air",
      ...(deviceId != null ? { deviceId } : {})
    },
    materials: acMaterials()
  };
}

function calcDeviceUsedU(devices) {
  if (!Array.isArray(devices) || devices.length === 0) {
    return 0;
  }
  return devices.reduce((sum, d) => sum + (Number(d.uSize) > 0 ? Number(d.uSize) : 1), 0);
}

/** 机房机柜 U 数（cabinet_24u_*.png） */
const CABINET_SLOT_TOTAL = 24;

function estimateCabinetLoad(usedU, total = CABINET_SLOT_TOTAL) {
  if (usedU <= 0) {
    return 0;
  }
  return Math.round(120 + (usedU / total) * 2480);
}

/**
 * 将设备列表压缩进 [1, total] U 范围，避免超出导轨贴图规格。
 * @param {object[]} devices
 * @param {number} total
 * @returns {object[]}
 */
function packDevicesForSlotTotal(devices, total) {
  if (!Array.isArray(devices) || devices.length === 0) {
    return [];
  }
  const sorted = [...devices].sort((a, b) => (Number(b.uStart) || 0) - (Number(a.uStart) || 0));
  const occupied = new Set();
  const placed = [];
  for (const device of sorted) {
    const uSize = Math.min(Math.max(1, Number(device.uSize) || 1), total);
    let placedStart = null;
    for (let u = total; u >= uSize; u--) {
      const uStart = u - uSize + 1;
      let free = true;
      for (let k = uStart; k <= uStart + uSize - 1; k++) {
        if (occupied.has(k)) {
          free = false;
          break;
        }
      }
      if (free) {
        placedStart = uStart;
        for (let k = uStart; k <= uStart + uSize - 1; k++) {
          occupied.add(k);
        }
        break;
      }
    }
    if (placedStart != null) {
      placed.push({ ...device, uStart: placedStart, uSize });
    }
  }
  return placed.sort((a, b) => (Number(b.uStart) || 0) - (Number(a.uStart) || 0));
}

/** 单条 U 位设备（默认 server） */
function uDevice(uStart, uSize, name, brandName, deviceType = "server") {
  return { deviceType, uStart, uSize, name, brandName };
}

/**
 * 18 台机柜各异：空柜、稀疏、半满、近满、单台大设备等。
 * @param {number} num 1–18
 * @returns {object[]}
 */
function cabinetDevicesFor(num) {
  const layouts = {
    1: [
      uDevice(34, 1, "计算节点", "Huawei"),
      uDevice(8, 2, "存储节点", "Inspur")
    ],
    2: [
      uDevice(36, 2, "虚拟化主机", "Lenovo"),
      uDevice(30, 1, "应用服务器", "HP"),
      uDevice(24, 2, "数据库服务器", "Dell"),
      uDevice(18, 4, "核心交换机", "H3C"),
      uDevice(11, 2, "防火墙", "Fortinet")
    ],
    3: [],
    4: [
      uDevice(40, 1, "计算节点", "Huawei"),
      uDevice(39, 1, "计算节点", "Huawei"),
      uDevice(38, 1, "K8s 节点", "Inspur"),
      uDevice(35, 2, "存储节点", "Inspur"),
      uDevice(32, 2, "虚拟化主机", "Lenovo"),
      uDevice(28, 4, "核心交换机", "H3C"),
      uDevice(24, 2, "数据库服务器", "Dell"),
      uDevice(20, 2, "应用服务器", "HP"),
      uDevice(16, 4, "分布式存储", "XSKY"),
      uDevice(12, 2, "备份设备", "EMC"),
      uDevice(8, 2, "汇聚交换", "Cisco"),
      uDevice(5, 2, "存储节点", "Inspur"),
      uDevice(2, 2, "计算节点", "Huawei")
    ],
    5: [uDevice(30, 8, "刀片机箱", "Huawei")],
    6: [
      uDevice(35, 2, "虚拟化主机", "Lenovo"),
      uDevice(22, 4, "核心交换机", "H3C"),
      uDevice(14, 2, "存储节点", "Inspur"),
      uDevice(5, 1, "计算节点", "Huawei")
    ],
    7: [uDevice(20, 1, "防火墙", "Fortinet")],
    8: [
      uDevice(40, 1, "计算节点", "Huawei"),
      uDevice(39, 1, "计算节点", "Huawei"),
      uDevice(38, 1, "K8s 节点", "Inspur"),
      uDevice(37, 1, "K8s 节点", "Inspur"),
      uDevice(36, 1, "K8s 节点", "Inspur"),
      uDevice(35, 1, "K8s 节点", "Inspur"),
      uDevice(34, 1, "应用服务器", "HP"),
      uDevice(31, 2, "数据库服务器", "Dell"),
      uDevice(28, 2, "虚拟化主机", "Lenovo"),
      uDevice(24, 4, "核心交换机", "H3C"),
      uDevice(22, 2, "备份设备", "EMC"),
      uDevice(19, 1, "监控探针", "Zabbix"),
      uDevice(17, 2, "汇聚交换", "Cisco"),
      uDevice(13, 4, "分布式存储", "XSKY"),
      uDevice(10, 2, "存储节点", "Inspur"),
      uDevice(6, 2, "虚拟化主机", "Lenovo"),
      uDevice(3, 2, "计算节点", "Huawei"),
      uDevice(1, 1, "防火墙", "Fortinet")
    ],
    9: [
      uDevice(28, 1, "计算节点", "Huawei"),
      uDevice(16, 2, "存储节点", "Inspur"),
      uDevice(6, 3, "应用服务器", "HP")
    ],
    10: [
      uDevice(37, 1, "K8s 节点", "Inspur"),
      uDevice(33, 2, "虚拟化主机", "Lenovo"),
      uDevice(28, 2, "数据库服务器", "Dell"),
      uDevice(22, 4, "核心交换机", "H3C"),
      uDevice(17, 2, "存储节点", "Inspur"),
      uDevice(10, 4, "备份设备", "EMC")
    ],
    11: [
      uDevice(32, 2, "计算节点", "Huawei"),
      uDevice(12, 1, "防火墙", "Fortinet")
    ],
    12: [],
    13: [
      uDevice(26, 2, "异常节点", "Huawei"),
      uDevice(18, 2, "存储节点", "Inspur"),
      uDevice(8, 2, "应用服务器", "HP")
    ],
    14: [
      uDevice(38, 2, "虚拟化主机", "Lenovo"),
      uDevice(34, 2, "计算节点", "Huawei"),
      uDevice(30, 2, "计算节点", "Huawei"),
      uDevice(26, 2, "K8s 节点", "Inspur"),
      uDevice(22, 4, "核心交换机", "H3C"),
      uDevice(16, 4, "分布式存储", "XSKY"),
      uDevice(10, 2, "数据库服务器", "Dell"),
      uDevice(5, 2, "存储节点", "Inspur")
    ],
    15: [
      uDevice(35, 2, "虚拟化主机", "Lenovo"),
      uDevice(28, 4, "核心交换机", "H3C"),
      uDevice(20, 2, "存储节点", "Inspur"),
      uDevice(14, 2, "数据库服务器", "Dell"),
      uDevice(8, 2, "应用服务器", "HP"),
      uDevice(3, 4, "备份设备", "EMC")
    ],
    16: [
      uDevice(24, 1, "计算节点", "Huawei"),
      uDevice(11, 1, "防火墙", "Fortinet"),
      uDevice(4, 2, "存储节点", "Inspur")
    ],
    17: [
      uDevice(32, 4, "核心路由", "Cisco"),
      uDevice(24, 2, "汇聚交换", "H3C"),
      uDevice(16, 2, "防火墙", "Fortinet"),
      uDevice(8, 2, "负载均衡", "F5")
    ],
    18: [
      uDevice(30, 4, "汇聚交换", "H3C"),
      uDevice(20, 2, "核心路由", "Cisco"),
      uDevice(12, 2, "存储节点", "Inspur"),
      uDevice(5, 1, "监控探针", "Zabbix")
    ]
  };
  return layouts[num] ? layouts[num].map((d) => ({ ...d })) : [];
}

function makeCabinet(num, x, z, toward, opts = {}) {
  const slotTotal = opts.slotTotal ?? CABINET_SLOT_TOTAL;
  const devices = packDevicesForSlotTotal(opts.devices ?? cabinetDevicesFor(num), slotTotal);
  const usedSlot = opts.usedSlot ?? calcDeviceUsedU(devices);
  const usedLoad = opts.usedLoad ?? estimateCabinetLoad(usedSlot, slotTotal);
  const cabNum = String(num).padStart(2, "0");
  const { threeJsonId = null } = opts;
  return {
    objType: "domain",
    domain: "device.cabinet",
    handler: "deployCabinet",
    name: "cabinet",
    label: `机柜${cabNum}`,
    doors: [
      { side: "front", swing: "right", leafCount: 1, label: { text: cabNum } },
      { side: "back", swing: "right", leafCount: 2 }
    ],
    toward,
    devices,
    slots: { total: slotTotal, unitHeight: 0.48, bottomMargin: 0.77 },
    stats: {
      slots: { used: usedSlot, total: slotTotal },
      load: { used: usedLoad, total: 2600 }
    },
    cabLabel: cabNum,
    geometry: { width: 6, length: 12, height: 20 },
    position: { x, y: 0, z },
    ...(threeJsonId != null ? { threeJsonId } : {})
  };
}

function upsUnit(label, x, y, z, infoHtml, infoY) {
  return {
    objType: "domain",
    domain: "device.ups",
    handler: "deployUps",
    name: "device-ups",
    label,
    geometry: { width: 8, depth: 10, height: UPS_H },
    position: { x, y, z },
    door: { panelKind: "glass", swing: "right", glassKind: "clear" },
    panelShowTrigger: "dblclick",
    panelHideTrigger: "dblclick",
    infoPanel: createInfoPanelSpriteRecord(infoHtml, x, infoY, z)
  };
}

function glassWindow(label, x, y, z, w, h, d, glassKind = "clear") {
  return {
    name: "room-glass",
    label,
    objType: "domain",
    domain: "glass",
    handler: "addToScene",
    glassKind,
    boxType: "box",
    geometry: { width: w, height: h, depth: d },
    material: {
      type: "standard",
      color: "#7ec8e8",
      opacity: 0.32,
      transparent: true,
      metalness: 0.08,
      roughness: 0.12
    },
    position: { x, y, z },
    visible: true,
    subScene: []
  };
}

const COLD_WIND_TEX = "/assets/textures/environment/nature/weather/wind_cold_left.png";
const HOT_WIND_TEX = "/assets/textures/environment/nature/weather/wind_hot_left.png";
/** roomShow（机房 demo）已验证：倾斜角 + Z 旋转让横向箭头贴图沿 U 轴滚动呈现上下流向 */
const WIND_TILT = 1.0471975511965976;
const WIND_SPIN_Z = 4.71238898038469;

function coldWindMaterial() {
  return {
    textureUrl: COLD_WIND_TEX,
    textureRepeat: { x: 0.1, y: 13 },
    opacity: 0.85,
    transparent: true,
    side: "double"
  };
}

function hotWindMaterial() {
  return {
    textureUrl: HOT_WIND_TEX,
    textureRepeat: { x: 0.1, y: 30 },
    opacity: 0.85,
    transparent: true,
    side: "double"
  };
}

/** 冷风：空调送风口向下送入冷通道（冷空气下沉） */
function coldWindFromAc(x, z, rotationY = Math.PI, speed = -1) {
  return {
    objType: "wind",
    visible: false,
    speed,
    geometry: { width: 5, height: 18 },
    position: { x, y: 17, z },
    rotation: { rotationX: WIND_TILT, rotationY, rotationZ: WIND_SPIN_Z },
    material: coldWindMaterial()
  };
}

/** 热风：机柜背板侧热通道上升（每通道一条宽条带，与 room-show 一致） */
function hotWindInAisle(z, northRow) {
  return {
    objType: "wind",
    visible: false,
    speed: 1.2,
    geometry: { width: 5, height: 48 },
    position: { x: 0, y: 20, z },
    rotation: northRow
      ? { rotationX: -WIND_TILT, rotationY: 0, rotationZ: WIND_SPIN_Z }
      : { rotationX: WIND_TILT, rotationY: 0, rotationZ: WIND_SPIN_Z },
    material: hotWindMaterial()
  };
}

function createInfoPanelSpriteRecord(text, x, y, z, threeJsonId) {
  return {
    name: "infoPanel",
    threeJsonId,
    text,
    type: "html",
    boxType: "sprite",
    visible: true,
    fix: false,
    topDistance: INFO_PANEL_TOP_DISTANCE,
    panel: {
      geometry: { width: INFO_PANEL_SPRITE_H, height: INFO_PANEL_SPRITE_H, depth: 0.1 },
      position: { x, y, z },
      material: { color: "#fff", transparent: true, opacity: 0.85 }
    }
  };
}

/** 南/北墙门：position 为铰链点；leafWidth 为门扇宽度（双开时两扇各占门洞一半） */
function doorOnWallX(label, code, doorType, hingeX, y, z, leafWidth = 4.5) {
  return {
    code,
    objType: "door",
    doorType,
    openAngleDeg: DOOR_OPEN_ANGLE_PRESETS.room,
    glassKind: "clear",
    textureFace: "exterior",
    exteriorFace: "-z",
    name: "room-door",
    label,
    geometry: { width: leafWidth, depth: 0.25, height: 19 },
    position: { x: hingeX, y, z },
    material: {
      color: "#2F3133",
      // 贴图按门扇局部坐标绘制；exterior 面 UV 相对门外视角水平镜像，swing 与文件名对调（同机柜 resolveCabinetDoorTexture）
      textureUrl:
        doorType === "left"
          ? "/assets/textures/building/door/right_door.png"
          : "/assets/textures/building/door/left_door.png"
    }
  };
}

/** 东/西墙门：门扇宽沿 Z，厚度沿 X */
function doorOnWallZ(label, code, doorType, x, y, z, leafDepth = 4.5, exteriorFace = "+x") {
  return {
    code,
    objType: "door",
    doorType,
    openAngleDeg: DOOR_OPEN_ANGLE_PRESETS.room,
    glassKind: "clear",
    textureFace: "exterior",
    exteriorFace,
    name: "room-door",
    label,
    geometry: { width: 0.25, depth: leafDepth, height: 19 },
    position: { x, y, z },
    material: {
      color: "#2F3133",
      textureUrl:
        doorType === "left"
          ? "/assets/textures/building/door/right_door.png"
          : "/assets/textures/building/door/left_door.png"
    }
  };
}

// --- Layout constants ---
const RW = 110;
const RD = 70;
const WH = 24;
const HY = WH / 2;
const WALL_THICK = 2;
const ENTRY_DOOR_HALF_W = 9;
/** 外墙外廓 span（墙心距 + 墙厚），北/南墙与东/西墙在外角各延伸半墙厚以消除 L 形凹槽 */
const RW_OUTER = RW + WALL_THICK;
const RD_OUTER = RD + WALL_THICK;
const ENTRY_DOOR_CLEAR_W = ENTRY_DOOR_HALF_W * 2;
const SOUTH_SEG_W = (RW_OUTER - ENTRY_DOOR_CLEAR_W) / 2;
const SOUTH_SEG_LEFT_X = -(ENTRY_DOOR_HALF_W + SOUTH_SEG_W / 2);
const SOUTH_SEG_RIGHT_X = ENTRY_DOOR_HALF_W + SOUTH_SEG_W / 2;
const SOUTH_WALL_Z = -RD / 2;
/** 南墙外侧（走廊侧）墙面 z */
const SOUTH_WALL_CORRIDOR_FACE_Z = SOUTH_WALL_Z - WALL_THICK / 2;

/** 走廊侧贴南墙：box 的 depth 沿 Z，中心置于墙外以免嵌入墙体 */
function corridorSouthWallMountZ(boxDepth) {
  return SOUTH_WALL_CORRIDOR_FACE_Z - boxDepth / 2 - 0.08;
}

const CORRIDOR_SCREEN_W = 5;
const CORRIDOR_SCREEN_H = 3.5;
const CORRIDOR_SCREEN_X = ENTRY_DOOR_HALF_W + 5;
const CORRIDOR_SCREEN_Y = 12;
const CORRIDOR_SCREEN_TOP = CORRIDOR_SCREEN_Y + CORRIDOR_SCREEN_H / 2;

const ACCESS_H = 2;
const ACCESS_X = -(ENTRY_DOOR_HALF_W + 2);
const ACCESS_Y = CORRIDOR_SCREEN_TOP - ACCESS_H / 2;

/** 南墙机房内侧墙面 z（墙心 SOUTH_WALL_Z，墙厚 WALL_THICK） */
const SOUTH_WALL_INNER_FACE_Z = SOUTH_WALL_Z + WALL_THICK / 2;

/** 机房内侧贴南墙：box 的 depth 沿 Z，中心置于墙内以免嵌入 */
function roomInteriorSouthWallMountZ(boxDepth, standoff = 0.08) {
  return SOUTH_WALL_INNER_FACE_Z + boxDepth / 2 + standoff;
}

const AC_CTRL_PANEL_SIZE = 0.55;
const AC_CTRL_PANEL_DEPTH = 0.12;
/** 入口门内侧右侧；操作高度与走廊门禁/监控屏一致 */
const AC_CTRL_PANEL_Y = 12;
const AC_CTRL_PANEL_GAP = 0.15;
const AC_CTRL_PAIR_CENTER_X = ENTRY_DOOR_HALF_W + 3;
/** 与走廊侧 mount 对称：内墙面 z 再探出 0.2，避免嵌入墙内 / z-fighting */
const AC_CTRL_PANEL_WALL_STANDOFF = 0.2;

function acControllerPanelMaterials() {
  const black = { color: "#111111", type: "standard" };
  const front = {
    color: "#ffffff",
    type: "standard",
    textureUrl: "/assets/textures/device/air_conditioning_controller.png"
  };
  return [black, black, black, black, front, black];
}

function acControllerPanel(label, deviceId, x) {
  return {
    objType: "box",
    name: "ac-temp-controller",
    label,
    geometry: {
      width: AC_CTRL_PANEL_SIZE,
      depth: AC_CTRL_PANEL_DEPTH,
      height: AC_CTRL_PANEL_SIZE
    },
    position: {
      x,
      y: AC_CTRL_PANEL_Y,
      z: roomInteriorSouthWallMountZ(AC_CTRL_PANEL_DEPTH, AC_CTRL_PANEL_WALL_STANDOFF)
    },
    businessInfo: { deviceTypeCode: "hum", deviceId },
    materials: acControllerPanelMaterials()
  };
}

const AC_CTRL_PANEL_X_LEFT =
  AC_CTRL_PAIR_CENTER_X - AC_CTRL_PANEL_SIZE / 2 - AC_CTRL_PANEL_GAP / 2;
const AC_CTRL_PANEL_X_RIGHT =
  AC_CTRL_PAIR_CENTER_X + AC_CTRL_PANEL_SIZE / 2 + AC_CTRL_PANEL_GAP / 2;

/** 茶壶 glTF 根节点含 100× 矩阵；scale≈0.008 时高度约 3，与消防气瓶组接近 */
const TEAPOT_GLTF_INTERNAL_SCALE = 100;
const TEAPOT_MESH_HEIGHT = 3.754508367538452;
const TEAPOT_MESH_DEPTH = 6.515103816986084;
const TEAPOT_SCALE = 0.008;
const TEAPOT_WORLD_HEIGHT = TEAPOT_MESH_HEIGHT * TEAPOT_GLTF_INTERNAL_SCALE * TEAPOT_SCALE;
const TEAPOT_MOUNT_DEPTH = TEAPOT_MESH_DEPTH * TEAPOT_GLTF_INTERNAL_SCALE * TEAPOT_SCALE;
/** 模型原点不在几何中心，略低于 mesh 理论半高使底面贴走廊地面 (y=0) */
const TEAPOT_GROUND_Y = TEAPOT_WORLD_HEIGHT * 0.17;
/** 右门铰链 x=9、门扇宽 9；置于右门框外侧，避免挡门 */
const ENTRY_TEAPOT_X = ENTRY_DOOR_HALF_W + 8;
const ENTRY_TEAPOT = {
  name: "entry-teapot",
  label: "入口装饰茶壶",
  objType: "externalModel",
  modelPath: "/assets/model/gltf/teapot/scene.gltf",
  modelFileType: "gltf",
  position: {
    x: ENTRY_TEAPOT_X,
    y: TEAPOT_GROUND_Y,
    z: corridorSouthWallMountZ(TEAPOT_MOUNT_DEPTH)
  },
  rotation: { rotationX: 0, rotationY: -Math.PI, rotationZ: 0 },
  scale: { scaleX: TEAPOT_SCALE, scaleY: TEAPOT_SCALE, scaleZ: TEAPOT_SCALE }
};

const EAST_EMERGENCY_DOOR_CENTER_Z = 12;
const EAST_EMERGENCY_DOOR_HALF_DEPTH = 5;
const EAST_EMERGENCY_DOOR_Y = 9.5;
const EAST_EMERGENCY_DOOR_H = 19;
const EAST_EMERGENCY_DOOR_TOP_Y = EAST_EMERGENCY_DOOR_Y + EAST_EMERGENCY_DOOR_H / 2;
const EAST_TRANSOM_H = 3;
const EAST_TRANSOM_DEPTH = 8;
const EAST_TRANSOM_Y = EAST_EMERGENCY_DOOR_TOP_Y + 1 + EAST_TRANSOM_H / 2;

const UPS_PARTITION_X = -42;
const UPS_DOOR_CENTER_Z = -20;
const UPS_DOOR_OPENING_DEPTH = 8;
const UPS_DOOR_HALF_DEPTH = UPS_DOOR_OPENING_DEPTH / 2;
const UPS_DOOR_Y = 9.5;
const UPS_DOOR_H = 19;
const UPS_DOOR_WALL_X = UPS_PARTITION_X + WALL_THICK / 2;

const NORTH_WALL_INNER_Z = RD / 2 - WALL_THICK / 2;
const NORTH_WINDOW_W = 18;
const NORTH_WINDOW_H = 8;
const NORTH_WINDOW_HOLE_DEPTH = 4;
const NORTH_WINDOW_Y = 14;
const NORTH_WINDOW_X_WEST = -28;
const NORTH_WINDOW_X_EAST = 28;
const NORTH_WINDOW_GLASS_Z = RD / 2 - 1;
const WEST_WALL_INNER_X = -RW / 2 + WALL_THICK / 2;
const AC_ROW_Z = NORTH_WALL_INNER_Z - AC_DEPTH / 2;
const AC_WEST_X = WEST_WALL_INNER_X + AC_WIDTH / 2;

const CABINET_H = 20;
const UPS_H = 16;
const UPS_Y = 8;
const UPS_X = -50;
/** 网络骨干机柜：UPS 区无横向净空，置于分区东侧主列西端 */
const NET_SPINE_CABINET_X = -36;
/** UPS 组 position.y 为底部，壳体局部 0..UPS_H */
const UPS_WORLD_TOP_Y = UPS_Y + UPS_H;
const HEAD_CABINET_Y = 9;
const HEAD_CABINET_H = 18;
const HEAD_CABINET_WORLD_TOP_Y = HEAD_CABINET_Y + HEAD_CABINET_H / 2;
const INFO_PANEL_SPRITE_H = 10;
const INFO_PANEL_CLEARANCE = 4;
const INFO_PANEL_TOP_DISTANCE = INFO_PANEL_SPRITE_H / 2 + INFO_PANEL_CLEARANCE;
const INFO_PANEL_Y_ABOVE_CABINET = CABINET_H + INFO_PANEL_SPRITE_H / 2 + 1.5;
const INFO_PANEL_Y_ABOVE_HEAD_CABINET =
  HEAD_CABINET_WORLD_TOP_Y + INFO_PANEL_SPRITE_H / 2 + INFO_PANEL_CLEARANCE;
const INFO_PANEL_Y_ABOVE_UPS = UPS_WORLD_TOP_Y + INFO_PANEL_SPRITE_H / 2 + INFO_PANEL_CLEARANCE;
const COLD_AISLE_CENTER_Z = 0;

const cabinetXs = [-21, -15, -9, -3, 3, 9, 15, 21];
const cabinets = [];

cabinetXs.forEach((x, i) => {
  cabinets.push(makeCabinet(i + 1, x, -12, "front"));
});
cabinetXs.forEach((x, i) => {
  const num = i + 9;
  cabinets.push(
    makeCabinet(num, x, 12, "back", {
      threeJsonId: num === 13 ? "room-cabinet-13" : null
    })
  );
});
cabinets.push(makeCabinet(17, NET_SPINE_CABINET_X, -12, "front"));
cabinets.push(makeCabinet(18, NET_SPINE_CABINET_X, 12, "back"));

const acUnits = [
  acUnit("机房空调-北1", -30, AC_ROW_Z, 11),
  acUnit("机房空调-北2", -10, AC_ROW_Z, 12),
  acUnit("机房空调-北3", 10, AC_ROW_Z, 13),
  acUnit("机房空调-北4", 30, AC_ROW_Z, 14),
  acUnit("机房空调-西备", AC_WEST_X, 0, 25)
];
const upsUnits = [
  upsUnit(
    "UPS主机A",
    UPS_X,
    UPS_Y,
    -18,
    "<div><div style='height:22px;background:#b71c1c;font-size:13px;color:#fff;padding:2px 6px'>UPS 主机 A</div><div style='background:#fff;color:#000;padding:6px;font-size:12px'>负载 <span style='color:#e65100'>62%</span><br/>电池 98%<br/>状态 <span style='color:green'>在线</span></div></div>",
    INFO_PANEL_Y_ABOVE_UPS
  ),
  upsUnit(
    "UPS主机B",
    UPS_X,
    UPS_Y,
    18,
    "<div><div style='height:22px;background:#b71c1c;font-size:13px;color:#fff;padding:2px 6px'>UPS 主机 B</div><div style='background:#fff;color:#000;padding:6px;font-size:12px'>负载 <span style='color:#e65100'>58%</span><br/>电池 96%<br/>状态 <span style='color:green'>在线</span></div></div>",
    INFO_PANEL_Y_ABOVE_UPS
  )
];

const windList = [];
const AC_BLOW_Z = AC_ROW_Z - AC_DEPTH / 2 - 0.5;
const HOT_AISLE_N_Z = -18;
const HOT_AISLE_S_Z = 18;
for (const x of [-30, -10, 10, 30]) {
  windList.push(coldWindFromAc(x, AC_BLOW_Z));
}
windList.push(coldWindFromAc(AC_WEST_X + AC_WIDTH / 2 + 1, 0, -Math.PI / 2));
windList.push(hotWindInAisle(HOT_AISLE_N_Z, true));
windList.push(hotWindInAisle(HOT_AISLE_S_Z, false));

const heatMapPoints = [];
for (let ix = 0; ix < 11; ix++) {
  for (let iz = 0; iz < 7; iz++) {
    const px = 10 + ix * 10;
    const py = 10 + iz * 10;
    let temp = 20 + ((ix + iz) % 3);
    if (Math.abs(py - 35) < 8 && px > 25 && px < 85) temp = 32 + (ix % 4);
    if (Math.abs(py - 35) < 4 && px > 30 && px < 80) temp = 22 + (iz % 2);
    heatMapPoints.push({ x: px, y: py, temperature: temp });
  }
}

const DEFAULT_VIEW_CAMERA = { x: 88, y: 62, z: -72 };
const DEFAULT_VIEW_TARGET = { x: 0, y: 8, z: -5 };

const scene = {
  version: "next",
  name: "roomShow-enterprise-datacenter",
  threeJsonId: "roomShow",
  remark: "企业级模块化机房（冷热通道、UPS 分区、走廊入口）",
  label: "核心网络机房 A 区",
  sceneConfig: {
    camera: {
      fov: 48,
      near: 0.015,
      far: 400,
      position: DEFAULT_VIEW_CAMERA
    },
    renderer: {
      antialias: true,
      ratioRate: 1,
      precision: "highp",
      preserveDrawingBuffer: true,
      stencil: true,
      alpha: true,
      shadowMapEnabled: true,
      clearAlpha: 0.1
    },
    controls: {
      listenToKeyEvents: true,
      enableDamping: true,
      dampingFactor: 0.35,
      enableZoom: true,
      autoRotate: false,
      minDistance: 0.5,
      maxDistance: 280,
      maxPolarAngle: 1.66086,
      enablePan: true,
      target: DEFAULT_VIEW_TARGET
    },
    renderLoop: {
      autoResize: true,
      firstAutoResize: true,
      fps: 60,
      lowFps: false
    },
    extensions: {
      "fps-walk": {
        enabled: true,
        floorMeshRef: "floor-main"
      }
    },
    deployScheduler: {
      enabled: true,
      mode: "scheduled",
      policy: "timeslot",
      fluxMs: 10,
      density: 10,
      maxInFlightAsync: 4,
      retry: { maxAttempts: 2, backoffMs: 400 }
    }
  },
  worldInfo: {
    boxModelList: [
      {
        code: "roomFloorMain",
        objType: "floor",
        refName: "floor-main",
        name: "room-floor",
        label: "机房高架地板",
        geometry: { width: 140, depth: 92, height: 1 },
        position: { x: 0, y: -0.5, z: -4 },
        material: {
          color: "#e4e6ea",
          textureUrl: FLOOR_RAISED,
          type: "standard",
          metalness: 0.08,
          roughness: 0.82,
          textureRepeat: FLOOR_TEX_REPEAT
        }
      },
      {
        objType: "floor",
        refName: "floor-corridor",
        name: "room-floor",
        label: "入口走廊地面",
        // 仅保留机房地板外侧半段，避免与 roomFloorMain 发生 Z-fighting
        geometry: { width: 22, depth: 14, height: 1 },
        position: { x: 0, y: -0.52, z: -59 },
        material: {
          color: "#c8c8c8",
          textureUrl: FLOOR_CORRIDOR,
          type: "standard",
          metalness: 0.05,
          roughness: 0.92,
          textureRepeat: FLOOR_TEX_REPEAT
        }
      },
      {
        objType: "wall",
        name: "room-wall",
        label: "北墙",
        geometry: { width: RW_OUTER, depth: WALL_THICK, height: WH },
        position: { x: 0, y: HY, z: RD / 2 },
        material: wallMat,
        holes: [
          {
            geometry: { width: NORTH_WINDOW_W, depth: NORTH_WINDOW_HOLE_DEPTH, height: NORTH_WINDOW_H },
            position: { x: NORTH_WINDOW_X_WEST, y: NORTH_WINDOW_Y, z: RD / 2 },
            material: { type: "standard", color: "#111" }
          },
          {
            geometry: { width: NORTH_WINDOW_W, depth: NORTH_WINDOW_HOLE_DEPTH, height: NORTH_WINDOW_H },
            position: { x: NORTH_WINDOW_X_EAST, y: NORTH_WINDOW_Y, z: RD / 2 },
            material: { type: "standard", color: "#111" }
          }
        ]
      },
      {
        objType: "wall",
        name: "room-wall",
        label: "南墙-左段",
        geometry: { width: SOUTH_SEG_W, depth: WALL_THICK, height: WH },
        position: { x: SOUTH_SEG_LEFT_X, y: HY, z: -RD / 2 },
        material: wallMat
      },
      {
        objType: "wall",
        name: "room-wall",
        label: "南墙-右段",
        geometry: { width: SOUTH_SEG_W, depth: WALL_THICK, height: WH },
        position: { x: SOUTH_SEG_RIGHT_X, y: HY, z: -RD / 2 },
        material: wallMat
      },
      {
        objType: "wall",
        name: "room-wall",
        label: "南墙-门楣",
        geometry: { width: ENTRY_DOOR_CLEAR_W, depth: WALL_THICK, height: 5 },
        position: { x: 0, y: 21.5, z: -RD / 2 },
        material: wallMat
      },
      {
        objType: "wall",
        name: "room-wall",
        label: "东墙",
        geometry: { width: WALL_THICK, depth: RD_OUTER, height: WH },
        position: { x: RW / 2, y: HY, z: 0 },
        material: wallMat,
        holes: [
          {
            geometry: { width: 4, depth: 10, height: EAST_EMERGENCY_DOOR_H },
            position: { x: RW / 2, y: EAST_EMERGENCY_DOOR_Y, z: EAST_EMERGENCY_DOOR_CENTER_Z },
            material: { type: "standard", color: "#111" }
          },
          {
            geometry: { width: 4, depth: EAST_TRANSOM_DEPTH, height: EAST_TRANSOM_H },
            position: { x: RW / 2, y: EAST_TRANSOM_Y, z: EAST_EMERGENCY_DOOR_CENTER_Z },
            material: { type: "standard", color: "#111" }
          }
        ]
      },
      {
        objType: "wall",
        name: "room-wall",
        label: "西墙",
        geometry: { width: WALL_THICK, depth: RD_OUTER, height: WH },
        position: { x: -RW / 2, y: HY, z: 0 },
        material: wallMat
      },
      {
        objType: "wall",
        name: "room-wall",
        label: "UPS分区墙",
        geometry: { width: WALL_THICK, depth: 58, height: WH },
        position: { x: UPS_PARTITION_X, y: HY, z: 4 },
        material: {
          color: "#c4a882",
          type: "standard",
          textureUrl: "/assets/textures/building/wall/red_brick.webp",
          metalness: 0.35,
          roughness: 0.55
        },
        holes: [
          {
            geometry: { width: 4, depth: UPS_DOOR_OPENING_DEPTH, height: UPS_DOOR_H },
            position: { x: UPS_PARTITION_X, y: UPS_DOOR_Y, z: UPS_DOOR_CENTER_Z },
            material: { type: "standard", color: "#333" }
          }
        ]
      },
      doorOnWallX("入口左门", "entryDoorLeft", "left", -9, 9.5, -RD / 2, 9),
      doorOnWallX("入口右门", "entryDoorRight", "right", 9, 9.5, -RD / 2, 9),
      doorOnWallZ(
        "东侧应急门-左",
        "eastEmergencyLeft",
        "left",
        RW / 2 - 1,
        9.5,
        EAST_EMERGENCY_DOOR_CENTER_Z - EAST_EMERGENCY_DOOR_HALF_DEPTH,
        EAST_EMERGENCY_DOOR_HALF_DEPTH
      ),
      doorOnWallZ(
        "东侧应急门-右",
        "eastEmergencyRight",
        "right",
        RW / 2 - 1,
        9.5,
        EAST_EMERGENCY_DOOR_CENTER_Z + EAST_EMERGENCY_DOOR_HALF_DEPTH,
        EAST_EMERGENCY_DOOR_HALF_DEPTH
      ),
      doorOnWallZ(
        "UPS区左门",
        "upsDoorLeft",
        "left",
        UPS_DOOR_WALL_X,
        UPS_DOOR_Y,
        UPS_DOOR_CENTER_Z - UPS_DOOR_HALF_DEPTH,
        UPS_DOOR_HALF_DEPTH
      ),
      doorOnWallZ(
        "UPS区右门",
        "upsDoorRight",
        "right",
        UPS_DOOR_WALL_X,
        UPS_DOOR_Y,
        UPS_DOOR_CENTER_Z + UPS_DOOR_HALF_DEPTH,
        UPS_DOOR_HALF_DEPTH
      ),
      {
        objType: "box",
        name: "head-cabinet",
        threeJsonId: "room-head-cabinet-a",
        label: "配电柜A",
        geometry: { width: 4, depth: 8, height: 18 },
        position: { x: 48, y: 9, z: -12 },
        businessInfo: {
          deviceTypeCode: "ltg"
        },
        material: {
          color: "#3d4248",
          type: "standard",
          textureUrl: "/assets/textures/building/metal/stainless_steel.webp",
          metalness: 0.5,
          roughness: 0.35
        }
      },
      {
        objType: "box",
        name: "head-cabinet",
        label: "配电柜B",
        geometry: { width: 4, depth: 8, height: 18 },
        position: { x: 48, y: 9, z: 12 },
        businessInfo: {
          deviceTypeCode: "ltg",
          deviceId: 22
        },
        material: {
          color: "#3d4248",
          type: "standard",
          textureUrl: "/assets/textures/building/metal/stainless_steel.webp",
          metalness: 0.5,
          roughness: 0.35
        }
      },
      {
        objType: "box",
        name: "tempe-sensor",
        label: "环境监控主机",
        geometry: { width: 1.2, depth: 0.4, height: 1.6 },
        position: { x: -53, y: 5, z: -30 },
        businessInfo: { deviceTypeCode: "hum", deviceId: 16 },
        material: {
          type: "standard",
          textureUrl: "/assets/textures/device/temperature_display.png"
        }
      },
      acControllerPanel("冷通道空调温控", 17, AC_CTRL_PANEL_X_LEFT),
      acControllerPanel("热通道空调温控", 51, AC_CTRL_PANEL_X_RIGHT),
      {
        objType: "box",
        name: "access-reader",
        label: "门禁读头",
        geometry: { width: 1, depth: 0.25, height: ACCESS_H },
        position: {
          x: ACCESS_X,
          y: ACCESS_Y,
          z: corridorSouthWallMountZ(0.25)
        },
        material: {
          type: "standard",
          textureUrl: "/assets/textures/device/pass_control.png"
        }
      },
      {
        objType: "box",
        name: "fire-suppression",
        label: "消防气瓶组",
        geometry: { width: 2.5, depth: 1.2, height: 3 },
        position: {
          x: -(ENTRY_DOOR_HALF_W + 3),
          y: 1.5,
          z: corridorSouthWallMountZ(1.2)
        },
        material: { color: "#cc3333", type: "standard", metalness: 0.4, roughness: 0.5 }
      },
      {
        objType: "box",
        name: "corridor-screen",
        label: "走廊监控屏",
        geometry: { width: CORRIDOR_SCREEN_W, depth: 0.25, height: CORRIDOR_SCREEN_H },
        position: {
          x: CORRIDOR_SCREEN_X,
          y: CORRIDOR_SCREEN_Y,
          z: corridorSouthWallMountZ(0.25)
        },
        material: {
          type: "standard",
          textureUrl: "/assets/textures/device/dashboard_screen.png",
          emissive: "#2244aa",
          emissiveIntensity: 0.25
        }
      },
      {
        objType: "box",
        name: "room-ceiling",
        label: "吊顶",
        visible: false,
        geometry: { width: RW - 4, depth: RD - 4, height: 0.5 },
        position: { x: 0, y: 23.75, z: 0 },
        material: { color: "#eceff3", type: "standard", metalness: 0.15, roughness: 0.65 }
      },
      {
        objType: "box",
        name: "room-ceiling",
        label: "冷通道封闭顶板",
        visible: false,
        geometry: { width: 52, depth: 8, height: 0.35 },
        position: { x: 0, y: 20.5, z: 0 },
        material: {
          type: "standard",
          color: "#dde8f5",
          opacity: 0.55,
          transparent: true,
          metalness: 0.2,
          roughness: 0.4
        }
      },
      {
        objType: "box",
        name: "utility-cabinet",
        label: "工具柜",
        geometry: { width: 4, depth: 2, height: 8 },
        position: { x: 46, y: 4, z: -30 },
        material: { color: "#2F3133", type: "standard" }
      },
      {
        objType: "box",
        name: "fiber-patch",
        label: "光纤配线箱",
        geometry: { width: 3, depth: 1.5, height: 6 },
        position: { x: -53, y: 3, z: 28 },
        material: {
          color: "#555",
          type: "standard",
          textureUrl: "/assets/textures/building/metal/stainless_steel.webp"
        }
      }
    ],
    domainModelList: [
      glassWindow(
        "北墙观察窗-西",
        NORTH_WINDOW_X_WEST,
        NORTH_WINDOW_Y,
        NORTH_WINDOW_GLASS_Z,
        NORTH_WINDOW_W,
        NORTH_WINDOW_H,
        0.35
      ),
      glassWindow(
        "北墙观察窗-东",
        NORTH_WINDOW_X_EAST,
        NORTH_WINDOW_Y,
        NORTH_WINDOW_GLASS_Z,
        NORTH_WINDOW_W,
        NORTH_WINDOW_H,
        0.35
      ),
      glassWindow(
        "东墙应急门气窗",
        RW / 2 - 1,
        EAST_TRANSOM_Y,
        EAST_EMERGENCY_DOOR_CENTER_Z,
        0.35,
        EAST_TRANSOM_H,
        EAST_TRANSOM_DEPTH,
        "tinted"
      ),
      ...acUnits,
      ...upsUnits,
      ...cabinets
    ],
    externalModelList: [ENTRY_TEAPOT],
    windList,
    heatList: [
      {
        geometry: { width: RW, height: RD },
        position: { x: 0, y: 2, z: 0 },
        rotation: { rotationX: -1.5707963267948966, rotationY: 0, rotationZ: 0 },
        visible: false,
        heatMap: heatMapPoints
      }
    ],
    lineList: [
      {
        objType: "line",
        type: "line",
        name: "leak-line",
        label: "漏水感应绳-UPS区",
        material: { color: "#3186FF", opacity: 0.85, linewidth: "5", transparent: true },
        points: [
          { x: -54, y: 0.5, z: -30 },
          { x: -44, y: 0.5, z: -30 },
          { x: -44, y: 0.5, z: 30 },
          { x: -54, y: 0.5, z: 30 },
          { x: -54, y: 0.5, z: -30 }
        ],
        businessInfo: { deviceTypeCode: "lea", deviceId: 30 }
      },
      {
        objType: "line",
        type: "line",
        name: "leak-line",
        label: "漏水感应绳-冷通道",
        material: { color: "#3186FF", opacity: 0.85, linewidth: "5", transparent: true },
        points: [
          { x: -24, y: 0.5, z: -4 },
          { x: 24, y: 0.5, z: -4 },
          { x: 24, y: 0.5, z: 4 },
          { x: -24, y: 0.5, z: 4 },
          { x: -24, y: 0.5, z: -4 }
        ],
        businessInfo: { deviceTypeCode: "lea", deviceId: 31 }
      }
    ],
    infoPanelList: [
      {
        text: "<div><div style='height:22px;background:#1565c0;font-size:13px;font-weight:bold;color:#fff;padding:2px 6px'>机房空调 #05</div><div style='background:#fff;color:#000;padding:6px;font-size:12px'>送风温度 <span style='color:#00897b'>18.2℃</span><br/>回风温度 26.4℃<br/>湿度 45% RH<br/>状态 <span style='color:green'>运行</span></div></div>",
        type: "html",
        boxType: "sprite",
        visible: true,
        name: "infoPanel",
        fix: false,
        origin: "db",
        refresh: true,
        panel: {
          geometry: { width: 10, height: 10, depth: 0.1 },
          position: { x: -30, y: 24, z: AC_ROW_Z },
          material: { color: "#fff", transparent: true, opacity: 0.85 }
        }
      },
      {
        text: "<div><div style='height:22px;background:#6a1b9a;font-size:13px;color:#fff;padding:2px 6px'>配电柜 A</div><div style='background:#fff;color:#000;padding:6px;font-size:12px'>A 相 186A / 400A<br/>负载率 <span style='color:#e65100'>46%</span><br/>PDU 端口 28/42 占用</div></div>",
        type: "html",
        boxType: "plane",
        visible: true,
        name: "infoPanel",
        fix: false,
        panel: {
          geometry: { width: 10, height: 10, depth: 0.1 },
          position: { x: 48, y: INFO_PANEL_Y_ABOVE_HEAD_CABINET, z: -12 },
          material: { color: "#fff", transparent: true, opacity: 0.85 }
        }
      },
      {
        text: "<div><div style='height:22px;background:#6a1b9a;font-size:13px;color:#fff;padding:2px 6px'>配电柜 B</div><div style='background:#fff;color:#000;padding:6px;font-size:12px'>B 相 172A / 400A<br/>负载率 <span style='color:#e65100'>43%</span><br/>PDU 端口 24/42 占用</div></div>",
        type: "html",
        boxType: "box",
        visible: true,
        name: "infoPanel",
        fix: false,
        panel: {
          geometry: { width: 10, height: 10, depth: 0.1 },
          position: { x: 48, y: INFO_PANEL_Y_ABOVE_HEAD_CABINET, z: 12 },
          material: { color: "#fff", transparent: true, opacity: 0.85 }
        }
      },
      {
        text: "<div><div style='height:22px;background:#2e7d32;font-size:13px;color:#fff;padding:2px 6px'>环境监控</div><div style='background:#fff;color:#000;padding:6px;font-size:12px'>冷通道 22.1℃ / 48% RH<br/>热通道 34.6℃ / 38% RH<br/>露点 10.2℃</div></div>",
        type: "html",
        boxType: "sprite",
        visible: true,
        name: "infoPanel",
        fix: false,
        panel: {
          geometry: { width: INFO_PANEL_SPRITE_H, height: INFO_PANEL_SPRITE_H, depth: 0.1 },
          position: { x: 0, y: INFO_PANEL_Y_ABOVE_CABINET, z: COLD_AISLE_CENTER_Z },
          material: { color: "#fff", transparent: true, opacity: 0.85 }
        }
      },
      createInfoPanelSpriteRecord(
        "<div><div style='height:22px;background:#b71c1c;font-size:13px;color:#fff;padding:2px 6px'>UPS 主机 A</div><div style='background:#fff;color:#000;padding:6px;font-size:12px'>负载 <span style='color:#e65100'>62%</span><br/>电池 98%<br/>状态 <span style='color:green'>在线</span></div></div>",
        UPS_X,
        INFO_PANEL_Y_ABOVE_UPS,
        -18
      ),
      createInfoPanelSpriteRecord(
        "<div><div style='height:22px;background:#b71c1c;font-size:13px;color:#fff;padding:2px 6px'>UPS 主机 B</div><div style='background:#fff;color:#000;padding:6px;font-size:12px'>负载 <span style='color:#e65100'>58%</span><br/>电池 96%<br/>状态 <span style='color:green'>在线</span></div></div>",
        UPS_X,
        INFO_PANEL_Y_ABOVE_UPS,
        18
      )
    ],
    groupList: [
      {
        name: "room-ceiling",
        label: "cable-tray-group",
        objType: "group",
        position: { x: 0, y: 22, z: 0 },
        subScene: [
          {
            name: "tray-main",
            label: "tray-main",
            objType: "box",
            geometry: { width: 90, height: 1.2, depth: 2 },
            position: { x: 0, y: 0, z: -6 },
            material: {
              color: "#777",
              type: "standard",
              metalness: 0.65,
              roughness: 0.35,
              textureUrl: WALL_TEX,
              textureRepeat: FLOOR_TEX_REPEAT
            }
          },
          {
            name: "tray-branch-east",
            label: "tray-branch-east",
            objType: "box",
            geometry: { width: 2, height: 1.2, depth: 48 },
            position: { x: 24, y: 0, z: 10 },
            material: {
              color: "#777",
              type: "standard",
              metalness: 0.65,
              roughness: 0.35
            }
          },
          {
            name: "tray-branch-west",
            label: "tray-branch-west",
            objType: "box",
            geometry: { width: 2, height: 1.2, depth: 36 },
            position: { x: -30, y: 0, z: 8 },
            material: {
              color: "#777",
              type: "standard",
              metalness: 0.65,
              roughness: 0.35
            }
          }
        ]
      }
    ],
    tubeList: [
      {
        name: "room-ceiling",
        label: "chilled-water-main",
        path: {
          type: "catmullRom",
          points: [
            { x: -46, y: 21, z: -24 },
            { x: -20, y: 22, z: -24 },
            { x: 0, y: 21.5, z: 0 },
            { x: 30, y: 22, z: 24 }
          ]
        },
        geometry: { radius: 0.7, tubularSegments: 48, radialSegments: 8 },
        material: {
          type: "standard",
          color: "#3a8fd4",
          metalness: 0.35,
          roughness: 0.38
        }
      }
    ],
    sphereModelList: [
      {
        name: "room-ceiling",
        label: "smoke-1",
        geometry: { radius: 0.55 },
        position: { x: -18, y: 23, z: -18 },
        material: { color: "#e53935", type: "standard", transparent: true, opacity: 0.75 }
      },
      {
        name: "room-ceiling",
        label: "smoke-2",
        geometry: { radius: 0.55 },
        position: { x: 18, y: 23, z: -18 },
        material: { color: "#e53935", type: "standard", transparent: true, opacity: 0.75 }
      },
      {
        name: "room-ceiling",
        label: "smoke-3",
        geometry: { radius: 0.55 },
        position: { x: -18, y: 23, z: 18 },
        material: { color: "#e53935", type: "standard", transparent: true, opacity: 0.75 }
      },
      {
        name: "room-ceiling",
        label: "smoke-4",
        geometry: { radius: 0.55 },
        position: { x: 18, y: 23, z: 18 },
        material: { color: "#e53935", type: "standard", transparent: true, opacity: 0.75 }
      }
    ],
    spriteList: [
      {
        name: "room-ceiling",
        label: "cold-aisle-marker",
        position: { x: 0, y: 0.3, z: 0 },
        material: { color: "#0288d1", size: 22, transparent: true, opacity: 0.35 }
      },
      {
        name: "room-ceiling",
        label: "hot-aisle-marker-n",
        position: { x: 0, y: 0.3, z: -12 },
        material: { color: "#ff6d00", size: 18, transparent: true, opacity: 0.4 }
      },
      {
        name: "room-ceiling",
        label: "hot-aisle-marker-s",
        position: { x: 0, y: 0.3, z: 12 },
        material: { color: "#ff6d00", size: 18, transparent: true, opacity: 0.4 }
      }
    ],
    planeList: [
      {
        name: "ceiling-light",
        label: "ceiling-light-1",
        geometry: { width: 14, height: 5 },
        position: { x: -18, y: 23.5, z: 0 },
        rotation: { rotationX: -1.5707963267948966, rotationY: 0, rotationZ: 0 },
        material: {
          color: "#fffef5",
          type: "standard",
          emissive: "#fff8e1",
          emissiveIntensity: 0.45
        }
      },
      {
        name: "ceiling-light",
        label: "ceiling-light-2",
        geometry: { width: 14, height: 5 },
        position: { x: 18, y: 23.5, z: 0 },
        rotation: { rotationX: -1.5707963267948966, rotationY: 0, rotationZ: 0 },
        material: {
          color: "#fffef5",
          type: "standard",
          emissive: "#fff8e1",
          emissiveIntensity: 0.45
        }
      },
      {
        name: "ceiling-light",
        label: "ceiling-light-corridor",
        geometry: { width: 8, height: 4 },
        position: { x: 0, y: 23.5, z: -48 },
        rotation: { rotationX: -1.5707963267948966, rotationY: 0, rotationZ: 0 },
        material: {
          color: "#fffef5",
          type: "standard",
          emissive: "#fff8e1",
          emissiveIntensity: 0.35
        }
      }
    ]
  }
};

writeFileSync(OUT, JSON.stringify(scene, null, 2), "utf8");
console.log("Wrote", OUT, "— cabinets:", cabinets.length, "wind:", windList.length);
