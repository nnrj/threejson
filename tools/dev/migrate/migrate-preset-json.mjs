/**
 * 1) material.type wall/glass -> standard（保留 color/opacity 等）
 * 2) roomShow：domainModelList 中 domain:wall 迁回 boxModelList（objType: wall）
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const repoRoot = resolve(import.meta.dirname, "..");
const jsonRoot = join(repoRoot, "resources", "json");

function fixMaterialType(node) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      fixMaterialType(node[i]);
    }
    return;
  }
  if (node.material && typeof node.material === "object" && typeof node.material.type === "string") {
    const t = node.material.type.trim().toLowerCase();
    if (t === "wall" || t === "glass") {
      node.material.type = "standard";
    }
  }
  if (Array.isArray(node.materials)) {
    for (let i = 0; i < node.materials.length; i++) {
      fixMaterialType({ material: node.materials[i] });
    }
  }
  for (const key of Object.keys(node)) {
    if (key === "material" || key === "materials") {
      continue;
    }
    const val = node[key];
    if (val && typeof val === "object") {
      fixMaterialType(val);
    }
  }
}

function wallDomainEntryToBox(entry) {
  const skip = new Set(["domain", "handler", "objType"]);
  const out = {
    objType: "wall",
    name: entry.name || "wall",
    geometry: entry.geometry,
    position: entry.position,
    rotation: entry.rotation,
    scale: entry.scale,
    visible: entry.visible,
    locked: entry.locked,
    businessInfo: {
      ...(entry.businessInfo && typeof entry.businessInfo === "object" ? entry.businessInfo : {}),
      businessName: "wall"
    }
  };
  if (entry.material && typeof entry.material === "object") {
    out.material = { ...entry.material, type: "standard" };
  }
  for (const k of Object.keys(entry)) {
    if (skip.has(k) || out[k] !== undefined) {
      continue;
    }
    if (k === "code" || k === "boxInfoId" || k === "mergeCode" || k === "takeEffect" || k === "hasChange") {
      continue;
    }
    out[k] = entry[k];
  }
  return out;
}

function migrateRoomShowWalls(payload) {
  const wi = payload.worldInfo;
  if (!wi || !Array.isArray(wi.domainModelList)) {
    return;
  }
  if (!Array.isArray(wi.boxModelList)) {
    wi.boxModelList = [];
  }
  const kept = [];
  for (let i = 0; i < wi.domainModelList.length; i++) {
    const entry = wi.domainModelList[i];
    if (entry && entry.domain === "wall") {
      wi.boxModelList.push(wallDomainEntryToBox(entry));
      continue;
    }
    kept.push(entry);
  }
  wi.domainModelList = kept;
}

function collectJsonFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...collectJsonFiles(p));
    } else if (name.endsWith(".json")) {
      out.push(p);
    }
  }
  return out;
}

for (const file of collectJsonFiles(jsonRoot)) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  fixMaterialType(data);
  if (file.endsWith("roomShow.json")) {
    migrateRoomShowWalls(data);
  }
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log("updated", file);
}

console.log("done");
