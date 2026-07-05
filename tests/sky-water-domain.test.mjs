import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../builtins/register.js";
import { deploySkyDome, setSkyTimeOfDay, getSkyTimeOfDay } from "../domains/nature/sky/skyFactory.js";
import { buildSkyDomeRecord, isSkyHandler } from "../domains/nature/sky/skyPresets.js";
import {
  advanceSkyCycleTime,
  hourToSunDirection,
  parseSkyCycleConfig,
  sampleSkyAtHour,
  updateSkyCycleUniforms
} from "../domains/nature/sky/skyTimeOfDay.js";
import { deployWaterSurface } from "../domains/nature/water/waterFactory.js";
import { buildWaterSurfaceRecord, isWaterHandler } from "../domains/nature/water/waterPresets.js";
import {
  parseWaterQuality,
  WATER_QUALITY_TIER
} from "../domains/nature/water/waterQuality.js";
import { hasShaderPreset } from "../core/builder/shader/shaderPresetRegistry.js";
import { updateShaderMotion } from "../core/builder/shader/shaderMotion.js";
import { getDomain, isDomainDispatchable } from "../core/handler/businessDomainRegistry.js";
import { normalizeFriendlyScenePayload } from "../core/handler/sceneFriendlyNormalizer.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("nature.sky and nature.water are dispatchable subdomains", () => {
  assert.equal(isDomainDispatchable(getDomain("nature.sky")), true);
  assert.equal(isDomainDispatchable(getDomain("nature.water")), true);
});

test("sky handlers and presets are registered", () => {
  assert.equal(isSkyHandler("sunset"), true);
  assert.equal(isSkyHandler("atmosphere"), true);
  assert.equal(isSkyHandler("dawn"), true);
  assert.equal(isSkyHandler("night"), true);
  assert.equal(isSkyHandler("cycle"), true);
  assert.equal(hasShaderPreset("sunset"), true);
  assert.equal(hasShaderPreset("atmosphere"), true);
  assert.equal(hasShaderPreset("skyCycle"), true);
});

test("sampleSkyAtHour interpolates and hourToSunDirection tracks day arc", () => {
  const noon = sampleSkyAtHour(12);
  const night = sampleSkyAtHour(0);
  assert.ok(noon.sunDirection.y > night.sunDirection.y);
  assert.ok(noon.sunIntensity > night.sunIntensity);
  const dir6 = hourToSunDirection(6);
  const dir18 = hourToSunDirection(18);
  assert.ok(Math.abs(dir6.x - dir18.x) > 0.2);
});

test("buildSkyDomeRecord cycle and dawn presets", () => {
  const cycle = buildSkyDomeRecord("cycle", {
    timeOfDay: 18,
    autoCycle: true,
    cycleDuration: 120
  });
  assert.ok(cycle);
  assert.equal(cycle.handler, "cycle");
  assert.equal(cycle.shaderPreset, "skyCycle");
  assert.equal(cycle.timeOfDay, 18);
  assert.equal(cycle.autoCycle, true);
  assert.equal(cycle.cycleDuration, 120);
  assert.ok(cycle.uniforms?.zenithColor);

  const dawn = buildSkyDomeRecord("dawn");
  assert.equal(dawn.handler, "dawn");
  assert.equal(dawn.shaderPreset, "atmosphere");
  assert.ok(dawn.uniforms?.horizonColor);
});

test("cycle sky advances time via updateShaderMotion", () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#111111");
  const mesh = deploySkyDome(
    {
      domain: "nature.sky",
      handler: "cycle",
      timeOfDay: 6,
      autoCycle: true,
      cycleDuration: 24,
      name: "cycle-sky"
    },
    scene
  );
  assert.ok(mesh?.isMesh);
  assert.equal(mesh.userData.skyCycle.timeOfDay, 6);
  const before = getSkyTimeOfDay(mesh);
  updateShaderMotion(6, { scene, deltaSeconds: 6 });
  assert.ok(getSkyTimeOfDay(mesh) > before);
});

test("setSkyTimeOfDay updates cycle config", () => {
  const scene = new THREE.Scene();
  const mesh = deploySkyDome({ handler: "cycle", timeOfDay: 12 }, scene);
  setSkyTimeOfDay(mesh, 20);
  assert.equal(getSkyTimeOfDay(mesh), 20);
});

test("syncBackground updates solid scene.background only", () => {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#000000");
  const mesh = deploySkyDome(
    {
      handler: "cycle",
      timeOfDay: 12,
      syncBackground: true
    },
    scene
  );
  const material = mesh.material;
  updateSkyCycleUniforms(material, {
    mesh,
    scene,
    deltaSeconds: 0
  });
  assert.notEqual(scene.background.getHex(), 0x000000);
});

test("water handlers and ocean preset are registered", () => {
  assert.equal(isWaterHandler("ocean"), true);
  assert.equal(isWaterHandler("flow"), true);
  assert.equal(hasShaderPreset("ocean"), true);
});

test("buildSkyDomeRecord merges overrides", () => {
  const rec = buildSkyDomeRecord("sunset", {
    geometry: { radius: 2000 },
    uniforms: { sunIntensity: 2 }
  });
  assert.ok(rec);
  assert.equal(rec.objType, "skyDome");
  assert.equal(rec.shaderPreset, "sunset");
  assert.equal(rec.geometry.radius, 2000);
  assert.equal(rec.uniforms.sunIntensity, 2);
});

test("buildWaterSurfaceRecord merges overrides", () => {
  const rec = buildWaterSurfaceRecord("ocean", {
    uniforms: { waveSpeed: 2.5 }
  });
  assert.ok(rec);
  assert.equal(rec.objType, "waterSurface");
  assert.equal(rec.shaderPreset, "ocean");
  assert.equal(rec.uniforms.waveSpeed, 2.5);
  assert.equal(rec.uniforms.quality, "medium");
  assert.equal(rec.parallelTo, "xz");
  assert.ok(rec.geometry.widthSegments >= 96);
});

test("parseWaterQuality maps labels and mirror flag", () => {
  const low = parseWaterQuality({ quality: "low" });
  assert.equal(low.tier, WATER_QUALITY_TIER.low);
  assert.equal(low.profile.useMirror, false);

  const ultra = parseWaterQuality({ quality: "ultra", uniforms: { mirrorResolution: 1024 } });
  assert.equal(ultra.tier, WATER_QUALITY_TIER.ultra);
  assert.equal(ultra.profile.useMirror, true);
  assert.equal(ultra.profile.mirrorResolution, 1024);
});

test("buildWaterSurfaceRecord respects explicit low quality segments", () => {
  const rec = buildWaterSurfaceRecord("ocean", {
    quality: "low",
    geometry: { width: 40, height: 40 }
  });
  assert.equal(rec.quality, "low");
  assert.equal(rec.geometry.widthSegments, 32);
});

test("deploySkyDome and deployWaterSurface add meshes to scene", () => {
  const scene = new THREE.Scene();
  const sky = deploySkyDome(
    { domain: "nature.sky", objType: "domain", handler: "atmosphere", name: "test-sky" },
    scene
  );
  const water = deployWaterSurface(
    {
      domain: "nature.water",
      objType: "domain",
      handler: "ocean",
      name: "test-water",
      geometry: { width: 50, height: 50 }
    },
    scene
  );
  assert.ok(sky?.isMesh);
  assert.ok(water?.isMesh);
  assert.equal(sky.userData.objJson.domain, "nature.sky");
  assert.equal(water.userData.objJson.domain, "nature.water");
  assert.equal(scene.children.length, 2);
});

test("parseSkyCycleConfig defaults", () => {
  const cfg = parseSkyCycleConfig({});
  assert.equal(cfg.timeOfDay, 12);
  assert.equal(cfg.autoCycle, false);
  assert.equal(cfg.cycleDuration, 600);
  assert.equal(cfg.syncBackground, false);
});

test("advanceSkyCycleTime wraps at 24h", () => {
  const cfg = parseSkyCycleConfig({ timeOfDay: 23, autoCycle: true, cycleDuration: 24 });
  advanceSkyCycleTime(cfg, 6);
  assert.ok(cfg.timeOfDay >= 0 && cfg.timeOfDay < 24);
});

test("02-07 tutorial JSON uses nature.sky and nature.water in domainModelList", () => {
  const jsonPath = path.join(
    __dirname,
    "../assets/json/tutorial/track-02/02-07-shader-sky-water.json"
  );
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.equal(raw.worldInfo.domainModelList.length, 2);
  assert.equal(raw.worldInfo.shaderSurfaceList.length, 1);

  const normalized = normalizeFriendlyScenePayload(raw);
  const list = normalized.objectList || [];
  const domains = list.filter((item) => item.objType === "domain");
  assert.equal(domains.length, 2);
  assert.ok(domains.some((item) => item.domain === "nature.sky" && item.handler === "sunset"));
  assert.ok(domains.some((item) => item.domain === "nature.water" && item.handler === "ocean"));
  assert.ok(list.some((item) => item.objType === "shaderSurface"));
});

test("02-08 tutorial JSON uses sky cycle handler", () => {
  const jsonPath = path.join(
    __dirname,
    "../assets/json/tutorial/track-02/02-08-shader-sky-cycle.json"
  );
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const sky = raw.worldInfo.domainModelList.find((item) => item.domain === "nature.sky");
  assert.ok(sky);
  assert.equal(sky.handler, "cycle");
  assert.equal(sky.autoCycle, true);
  assert.equal(sky.syncBackground, true);

  const normalized = normalizeFriendlyScenePayload(raw);
  const cycleEntry = (normalized.objectList || []).find(
    (item) => item.domain === "nature.sky" && item.handler === "cycle"
  );
  assert.ok(cycleEntry);
});
