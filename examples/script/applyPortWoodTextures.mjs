/**
 * 一次性脚本：智慧港口 JSON 全量应用木地板占位贴图，并插入地板/渡口/堤岸块。
 * 运行（仓库根目录）：node examples/script/applyPortWoodTextures.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(__dirname, '../../assets/json/portShow.json');
const WOOD = '/assets/textures/building/floor/wood_floor.webp';

/** 海面/海岸块：保留半透明海水色，不铺木地板 */
const SEA_OBJ_TYPES = new Set(['seaSurface', 'deepWater', 'coastShallow']);

function ensureDepthFromLength(obj) {
  if (!obj || typeof obj !== 'object') {
    return;
  }
  const g = obj.geometry;
  if (g != null && g.length != null && (g.depth == null || g.depth === undefined)) {
    g.depth = g.length;
  }
}

function walkGeometryDepth(list) {
  if (!Array.isArray(list)) {
    return;
  }
  for (const b of list) {
    if (!b || typeof b !== 'object') {
      continue;
    }
    ensureDepthFromLength(b);
    if (Array.isArray(b.boxModelList)) {
      walkGeometryDepth(b.boxModelList);
    }
    if (Array.isArray(b.subGroup)) {
      for (const sg of b.subGroup) {
        if (sg && Array.isArray(sg.boxModelList)) {
          walkGeometryDepth(sg.boxModelList);
        }
      }
    }
  }
}

function repeatFromGeometry(g = {}) {
  const w = Number(g.width) || 40;
  const len = Number(g.length ?? g.depth ?? w) || w;
  const h = Number(g.height) || 24;
  const repX = Math.max(4, Math.round(Math.max(w, len) / 22));
  const repY = Math.max(4, Math.round(h / 20));
  return { x: repX, y: repY };
}

function woodMaterialFromOld(old, geometry) {
  const m = {
    type: 'lambert',
    color: '#ffffff',
    textureUrl: WOOD,
    textureRepeat: repeatFromGeometry(geometry)
  };
  if (old && old.opacity != null) {
    m.opacity = old.opacity;
    m.transparent = old.opacity < 1 || !!old.transparent;
  }
  return m;
}

function applyWoodToBoxList(list) {
  if (!Array.isArray(list)) return;
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    if (b.objType && SEA_OBJ_TYPES.has(b.objType)) {
      if (Array.isArray(b.boxModelList)) applyWoodToBoxList(b.boxModelList);
      if (Array.isArray(b.subGroup)) {
        for (const sg of b.subGroup) {
          if (sg && Array.isArray(sg.boxModelList)) applyWoodToBoxList(sg.boxModelList);
        }
      }
      continue;
    }
    const g = b.geometry || {};
    const geoForRepeat = {
      width: g.width,
      length: g.length,
      depth: g.depth ?? g.length,
      height: g.height
    };
    b.material = woodMaterialFromOld(b.material, geoForRepeat);
    if (Array.isArray(b.boxModelList)) applyWoodToBoxList(b.boxModelList);
    if (Array.isArray(b.subGroup)) {
      for (const sg of b.subGroup) {
        if (sg && Array.isArray(sg.boxModelList)) applyWoodToBoxList(sg.boxModelList);
      }
    }
  }
}

const raw = fs.readFileSync(JSON_PATH, 'utf8');
const data = JSON.parse(raw);
const wi = data.worldInfo;

walkGeometryDepth(wi.boxModelList);
for (const grp of wi.groupList || []) {
  walkGeometryDepth(grp.boxModelList);
}

applyWoodToBoxList(wi.boxModelList);
for (const grp of wi.groupList || []) {
  applyWoodToBoxList(grp.boxModelList);
}

for (const s of wi.sphereModelList || []) {
  if (!s.material) s.material = {};
  s.material.type = 'lambert';
  s.material.color = '#ffffff';
  s.material.textureUrl = WOOD;
  if (s.material.opacity != null && s.material.opacity < 1) s.material.transparent = true;
}

for (const wind of wi.windList || []) {
  if (!wind.material) wind.material = {};
  wind.material.textureUrl = WOOD;
  wind.material.textureRepeat = wind.material.textureRepeat || { x: 3, y: 22 };
  wind.material.color = wind.material.color || '#ffffff';
}

for (const om of wi.objModelList || []) {
  if (!om.material) om.material = {};
  om.material.textureUrl = WOOD;
  om.material.textureRepeat = om.material.textureRepeat || { x: 6, y: 6 };
  om.material.color = '#ffffff';
}

for (const ip of wi.infoPanelList || []) {
  if (ip.type === 'img' && typeof ip.text === 'string') {
    ip.text = WOOD;
  }
  if (ip.panel && ip.panel.material && !ip.panel.material.textureUrl) {
    ip.panel.material.textureUrl = WOOD;
    ip.panel.material.textureRepeat = { x: 2, y: 2 };
    ip.panel.material.color = '#ffffff';
  }
}

const dockIdx = (wi.boxModelList || []).findIndex((b) => b && b.objType === 'dockFloor');
const insertAt = dockIdx >= 0 ? dockIdx + 1 : 1;
const hasWoodDeck = (wi.boxModelList || []).some((b) => b && b.objType === 'yardWoodDeck');
if (!hasWoodDeck) {
  const inserts = [
    {
      name: '港区木地板层',
      objType: 'yardWoodDeck',
      geometry: { width: 560, length: 400, height: 1.6 },
      position: { x: 200, y: 1.1, z: 42 },
      material: woodMaterialFromOld({}, { width: 560, length: 400, height: 40 })
    },
    {
      name: '渡口登船平台',
      objType: 'ferryLanding',
      geometry: { width: 240, length: 105, height: 3.5 },
      position: { x: 0, y: 5, z: -268 },
      material: woodMaterialFromOld({}, { width: 240, length: 105, height: 24 })
    },
    {
      name: '海侧堤岸护面',
      objType: 'seaEmbankment',
      geometry: { width: 1220, length: 36, height: 7 },
      position: { x: 0, y: 5, z: -412 },
      material: woodMaterialFromOld({ opacity: 0.96 }, { width: 1220, length: 36, height: 36 })
    }
  ];
  wi.boxModelList.splice(insertAt, 0, ...inserts);
}

fs.writeFileSync(JSON_PATH, `${JSON.stringify(data, null, 2)}\n`);
console.log('Updated', JSON_PATH);
