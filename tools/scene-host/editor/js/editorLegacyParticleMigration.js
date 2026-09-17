import { normalizeParticleEmitterV2 } from "../../../../core/builder/particle/particleV2Descriptor.js";

const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const legacyFields = ["material", "count", "distribution", "positions", "bounds", "geometry", "motion", "provider", "particleProvider", "emitter", "gpuCompute", "colors", "velocity", "speed", "wrap"];
const renderFields = new Set(["color", "size", "opacity", "transparent", "depthWrite", "depthTest", "blending", "sizeAttenuation", "map"]);

function visit(value, path, callback) {
  if (!value || typeof value !== "object") return;
  // Large BufferGeometry/particle arrays must not allocate an Object.entries() pair per number.
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (value[index] && typeof value[index] === "object") visit(value[index], `${path}/${index}`, callback);
    }
    return;
  }
  if (String(value.objType || "").toLowerCase() === "particleemitter") callback(value, path || "/");
  for (const [key, child] of Object.entries(value)) {
    if (key === "metadata" || key === "userData") continue;
    if (child && typeof child === "object") visit(child, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, callback);
  }
}

function migrateParticle(record) {
  const changes = [], warnings = [];
  const unsupported = ["motion", "provider", "particleProvider", "emitter", "gpuCompute", "colors", "radius", "innerRadius", "thickness", "velocity", "speed", "wrap"]
    .filter((key) => has(record, key));
  if (unsupported.length) throw new Error(`不能可靠转换旧粒子扩展或动画字段：${unsupported.join("、")}；请手动迁移，不会删除这些字段。`);
  const next = structuredClone(record);
  if (typeof next.simulation === "string") {
    if (next.simulation.trim().toLowerCase() !== "cpu") throw new Error(`不能可靠转换旧粒子后端 ${next.simulation}，不会自动切换为 CPU。`);
    next.simulation = { backend: "cpu" };
    changes.push('simulation: "cpu" → simulation: { backend: "cpu" }');
  }
  if (has(next, "material")) {
    if (!isRecord(next.material)) throw new Error("旧 material 必须是对象。");
    if (has(next, "render") && !isRecord(next.render)) throw new Error("render 必须是对象。");
    const unknown = Object.keys(next.material).filter((key) => !renderFields.has(key));
    if (unknown.length) throw new Error(`不能可靠转换材质字段：${unknown.join("、")}。`);
    for (const [key, value] of Object.entries(next.material)) {
      if (has(next.render || {}, key) && JSON.stringify(next.render[key]) !== JSON.stringify(value)) {
        throw new Error(`material.${key} 与 render.${key} 冲突，请手动选择，不能自动覆盖。`);
      }
    }
    if (has(next.material, "map") && typeof next.material.map !== "string") throw new Error("旧纹理 map 不是 URL 字符串，需要手动迁移。");
    next.render = { ...next.material, ...next.render };
    delete next.material;
    changes.push("material → render（保留颜色、尺寸、透明度及纹理 URL 等已知参数）");
  }
  if (has(next, "count")) {
    if (!Number.isInteger(next.count) || next.count <= 0) throw new Error("旧 count 必须是正整数。");
    if (has(next, "emission") && !isRecord(next.emission)) throw new Error("emission 必须是对象。");
    if (has(next.emission || {}, "count") && next.emission.count !== next.count) throw new Error("count 与 emission.count 冲突。");
    next.emission = { ...next.emission, count: next.count };
    delete next.count;
    changes.push("count → emission.count");
  }
  const sourceFields = ["positions", "distribution", "bounds", "geometry"].filter((key) => has(next, key));
  if (sourceFields.length && has(next, "source")) throw new Error(`旧 ${sourceFields.join("、")} 与新版 source 并存，请手动合并。`);
  if (has(next, "positions")) {
    if (sourceFields.length > 1) throw new Error("旧 positions 与其他分布字段并存，请手动确认实际使用的分布。");
    if (!Array.isArray(next.positions) || !next.positions.length || next.positions.some((point) => {
      const coordinates = Array.isArray(point) ? point : [point?.x, point?.y, point?.z];
      return coordinates.length !== 3 || !coordinates.every(Number.isFinite);
    })) throw new Error("positions 必须包含有效的三维坐标。");
    if (next.emission?.count !== undefined && next.emission.count !== next.positions.length) {
      throw new Error("旧 count 与显式坐标数量不一致，请手动确认，不能自动重复或截断坐标。");
    }
    next.source = { type: "positions", positions: next.positions };
    delete next.positions;
    changes.push("positions → source.positions");
  } else if (sourceFields.length) {
    const distribution = typeof next.distribution === "string" ? { type: next.distribution } : next.distribution ?? {};
    const bounds = next.bounds ?? next.geometry ?? {};
    if (!isRecord(distribution) || !isRecord(bounds)) throw new Error("旧分布或范围参数不是对象。");
    if (has(next, "bounds") && has(next, "geometry")) throw new Error("旧 bounds 与 geometry 并存，请手动确认范围。");
    const type = String(distribution.type || distribution.mode || "box").toLowerCase();
    if (distribution.type && distribution.mode && distribution.type !== distribution.mode) throw new Error("旧分布 type 与 mode 冲突。");
    if (!["box", "sphere"].includes(type)) throw new Error(`暂不自动转换旧 ${type} 分布，以免改变形状。`);
    const allowed = type === "sphere" ? ["radius", "innerRadius"] : ["width", "height", "depth"];
    const unknown = [...Object.keys(distribution).filter((key) => !["type", "mode", ...allowed].includes(key)),
      ...Object.keys(bounds).filter((key) => !allowed.includes(key))];
    if (unknown.length) throw new Error(`不能可靠转换分布参数：${unknown.join("、")}。`);
    for (const key of allowed) {
      if (has(distribution, key) && has(bounds, key) && distribution[key] !== bounds[key]) throw new Error(`分布 ${key} 与范围参数冲突。`);
      const value = distribution[key] ?? bounds[key];
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) throw new Error(`分布参数 ${key} 必须是非负有限数值。`);
    }
    next.source = { type };
    for (const key of allowed) {
      const value = distribution[key] ?? bounds[key];
      if (value !== undefined) next.source[key] = value;
    }
    for (const key of sourceFields) delete next[key];
    changes.push(`${sourceFields.join(" / ")} → source（${type}）`);
  }
  // No legacy runtime is kept. Freeze the explicit defaults used by this conversion so that
  // saving/reopening the converted document does not depend on future runtime default changes.
  const normalized = normalizeParticleEmitterV2(next);
  if (!next.source) {
    next.source = { type: "box", width: 100, height: 100, depth: 100 };
    warnings.push("未指定粒子分布：采用新版默认的 100 × 100 × 100 盒状分布。");
  }
  if (!has(next.emission || {}, "count")) warnings.push(`未指定粒子数量：采用新版计算结果 ${normalized.emission.count} 个。`);
  next.emission = normalized.emission;
  next.particle = normalized.particle;
  next.simulation = normalized.simulation;
  next.render = normalized.render;
  if (!record.particle && !isRecord(record.simulation)) warnings.push("未显式定义运动：采用新版默认静态粒子，不重建旧版可能存在的默认漂移效果。");
  return { record: next, changes, warnings };
}

/** Editor-only, copy-on-convert migration; neither the input nor the source file is modified. */
export function inspectEditorParticleMigration(payload) {
  const entries = [], issues = [];
  visit(payload, "", (record, path) => {
    if (!legacyFields.some((key) => has(record, key)) && typeof record.simulation !== "string") return;
    const label = String(record.name || record.threeJsonId || path);
    try {
      const converted = migrateParticle(record);
      entries.push({ path, label, ...converted });
    } catch (error) { issues.push({ path, label, reason: error.message }); }
  });
  if (issues.length || !entries.length) return { needed: entries.length > 0 || issues.length > 0, payload, entries, issues };
  const copy = structuredClone(payload);
  const replacements = new Map(entries.map((entry) => [entry.path, entry.record]));
  visit(copy, "", (record, path) => {
    const replacement = replacements.get(path);
    if (!replacement) return;
    for (const key of Object.keys(record)) delete record[key];
    Object.assign(record, replacement);
  });
  return { needed: true, payload: copy, entries, issues };
}

export function describeEditorParticleMigration(report) {
  return ["检测到旧版粒子格式。是否转换副本并导入？原文件不会被覆盖。",
    ...report.entries.map((entry) => `\n对象「${entry.label}」 (${entry.path})\n${[...entry.changes, ...entry.warnings].map((line) => `• ${line}`).join("\n")}`),
    "\n其余未填写参数采用新版默认值，采样算法也可能不同，不能保证与旧版外观完全一致。导入后可检查并另存为新版 JSON。"
  ].join("\n");
}
